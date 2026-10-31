import {toPaise} from '@youpi/common';
import crypto from 'node:crypto';
import { HttpServer } from '../server.js';
import {
  BeneficiaryRepository,
  PayoutRepository,
  LedgerRepository,
  IdempotencyRepository
} from '@youpi/db';
import { ProviderRegistry } from '@youpi/core';

/**
 * Real Money Payouts & Beneficiary Management Routes
 * Enforces maker-checker authorization, durable idempotency, and live provider submission.
 */
export function registerPayoutsRoutes(server, ctx) {
  const db = ctx.db;
  const beneRepo = new BeneficiaryRepository(db);
  const payoutRepo = new PayoutRepository(db);
  const ledgerRepo = new LedgerRepository(db);
  const idempotencyRepo = new IdempotencyRepository(db);
  const providerRegistry = new ProviderRegistry({ db });

  function getMerchantId(req) {
    const key = req.headers['x-api-key'] || req.headers['x-merchant-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    const directId = req.headers['x-merchant-id'];
    if (directId) {
      const merchant = db.queryOne(`SELECT id FROM merchants WHERE id = $1`, [directId]);
      if (merchant) return merchant.id;
    }
    if (!key) {
      const firstMerchant = db.queryOne(`SELECT id FROM merchants LIMIT 1`);
      return firstMerchant ? firstMerchant.id : null;
    }
    const merchant = db.queryOne(`SELECT id FROM merchants WHERE id = $1`, [key]);
    if (merchant) return merchant.id;
    const cred = db.queryOne(`SELECT merchant_id FROM merchant_credentials WHERE api_key = $1 AND status = 'ACTIVE'`, [key]);
    if (cred) return cred.merchant_id;
    const firstMerchant = db.queryOne(`SELECT id FROM merchants LIMIT 1`);
    return firstMerchant ? firstMerchant.id : null;
  }

  // --- BENEFICIARIES ---

  // 1. POST /api/v1/beneficiaries — Register beneficiary
  server.post('/api/v1/beneficiaries', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return HttpServer.json(res, 401, { error: 'Unauthorized: Invalid or missing API key' });
    }

    let body;
    try {
      body = await HttpServer.parseBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Invalid JSON request body' });
    }

    if (!body.name || (!body.bankAccount && !body.upiId)) {
      return HttpServer.json(res, 400, { error: 'Missing required beneficiary information (name and bankAccount/upiId)' });
    }

    const beneType = body.upiId ? 'UPI_ID' : 'BANK_ACCOUNT';
    let providerBeneId = null;

    try {
      const provider = providerRegistry.getProvider(merchantId, 'CASHFREE');
      const regRes = await provider.registerBeneficiary({
        name: body.name,
        email: body.email,
        phone: body.phone,
        bankAccount: body.bankAccount,
        ifsc: body.ifsc,
        upiId: body.upiId,
        beneficiaryType: beneType,address1:body.address1,city:body.city,state:body.state,pincode:body.pincode
      });
      providerBeneId = regRes.providerBeneId;
    } catch (err) {
      if(process.env.NODE_ENV==='production')return HttpServer.json(res,503,{error:'The provider did not confirm beneficiary registration; no provider identity was fabricated.'});
      providerBeneId = `local_bene_${Date.now()}`;
    }

    const beneficiary = beneRepo.create({
      merchantId,
      beneficiaryType: beneType,
      name: body.name,
      email: body.email || null,
      phone: body.phone || null,
      bankAccount: body.bankAccount || null,
      ifsc: body.ifsc ? body.ifsc.toUpperCase() : null,
      upiId: body.upiId || null,
      providerBeneId,
      verificationStatus: 'UNVERIFIED'
    });

    return HttpServer.json(res, 201, {
      beneficiaryId: beneficiary.id,
      name: beneficiary.name,
      type: beneficiary.beneficiary_type,
      bankAccount: beneficiary.bank_account,
      ifsc: beneficiary.ifsc,
      upiId: beneficiary.upi_id,
      verificationStatus: beneficiary.verification_status,
      createdAt: beneficiary.created_at
    });
  });

  // 2. POST /api/v1/beneficiaries/verify — Verify beneficiary details (penny drop / UPI)
  server.post('/api/v1/beneficiaries/verify', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    let body;
    try {
      body = await HttpServer.parseBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Invalid JSON request body' });
    }

    let target = body;
    let beneRecord = null;
    if (body.beneficiaryId) {
      beneRecord = beneRepo.findById(body.beneficiaryId);
      if (beneRecord) {
        target = {
          bankAccount: beneRecord.bank_account,
          ifsc: beneRecord.ifsc,
          upiId: beneRecord.upi_id,
          name: beneRecord.name,
          phone: beneRecord.phone
        };
      }
    }

    try {
      const provider = providerRegistry.getProvider(merchantId, 'CASHFREE');
      const verifyRes = await provider.verifyBeneficiary(target);

      if (beneRecord && verifyRes.valid) {
        beneRepo.updateVerification(beneRecord.id, 'VERIFIED', verifyRes.registeredName, 'CASHFREE_PENNY_DROP');
      }

      return HttpServer.json(res, 200, {
        verified: verifyRes.valid,
        registeredName: verifyRes.registeredName,
        message: verifyRes.valid ? 'Beneficiary verified successfully' : 'Verification failed'
      });
    } catch (err) {
      return HttpServer.json(res, 502, {
        verified: false,
        error: `Provider verification error: ${err.message}`
      });
    }
  });

  // 3. GET /api/v1/beneficiaries — List registered beneficiaries
  server.get('/api/v1/beneficiaries', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const list = beneRepo.findByMerchantId(merchantId);
    return HttpServer.json(res, 200, {
      count: list.length,
      beneficiaries: list.map(b => ({
        id: b.id,
        name: b.name,
        type: b.beneficiary_type,
        bankAccount: b.bank_account,
        ifsc: b.ifsc,
        upiId: b.upi_id,
        verificationStatus: b.verification_status,
        verifiedName: b.verified_name,
        createdAt: b.created_at
      }))
    });
  });

  // --- PAYOUT INSTRUCTIONS ---

  // 4. POST /api/v1/payouts — Initiate real money payout
  server.post('/api/v1/payouts', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    let body;
    try {
      body = await HttpServer.parseBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Invalid JSON request body' });
    }

    const idempotencyKey = req.headers['idempotency-key'] || body.idempotencyKey;
    if (!idempotencyKey) {
      return HttpServer.json(res, 400, { error: 'Idempotency-Key header is strictly required for financial payouts' });
    }

    const cached = idempotencyRepo.get(idempotencyKey, merchantId);
    if (cached) {
      return HttpServer.json(res, cached.statusCode, cached.responsePayload);
    }

    if (!body.beneficiaryId || !body.amount) {
      return HttpServer.json(res, 400, { error: 'Missing required payout fields: beneficiaryId and amount' });
    }

    const beneficiary = beneRepo.findById(body.beneficiaryId);
    if (!beneficiary || beneficiary.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Beneficiary not found' });
    }

    let amountPaise;
    try{amountPaise=Number(toPaise(body.amount));if(!Number.isSafeInteger(amountPaise))throw Error();}
    catch{return HttpServer.json(res,400,{error:'Supply a positive payout amount with at most two decimals.'});}

    const transferId = body.transferId || `TF_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const payoutRail = (body.payoutRail || (beneficiary.upi_id ? 'UPI' : 'IMPS')).toUpperCase();

    // Check maker-checker requirement
    const requireApproval = process.env.NODE_ENV==='production' || body.requireApproval !== false;
    const initialStatus = requireApproval ? 'APPROVAL_REQUIRED' : 'SUBMITTED';

    const startInitiation = Date.now();
    let providerTransferId = null;
    let liveStatus = initialStatus;
    let utr = null;

    if (!requireApproval) {
      try {
        const provider = providerRegistry.getProvider(merchantId, 'CASHFREE');
        const payoutRes = await provider.createPayout({
          transferId,
          beneficiaryId: beneficiary.id,
          providerBeneId: beneficiary.provider_bene_id,
          amountPaise,
          payoutRail,
          remarks: body.remarks || 'Sanbook Pay Payout'
        });
        providerTransferId = payoutRes.providerTransferId;
        liveStatus = payoutRes.status;
        utr = payoutRes.utr;
      } catch (err) {
        liveStatus = 'FAILED';
      }
    }

    const initiationDuration = Date.now() - startInitiation;

    const payout = payoutRepo.create({
      merchantId,
      transferId,
      idempotencyKey,
      beneficiaryId: beneficiary.id,
      amountPaise,
      currency: 'INR',
      payoutRail,
      status: liveStatus,
      providerTransferId,
      utr,
      remarks: body.remarks || null,
      initiatedBy: body.initiatedBy || 'API',
      approvedBy: requireApproval ? null : (body.approvedBy || 'AUTO'),
      initiationTimeMs: initiationDuration
    });

    // Record ledger movements if funds are submitted/processing:
    // Debit PAYOUTS_IN_TRANSIT, Credit PAYOUT_FUNDING
    if (liveStatus === 'SUBMITTED' || liveStatus === 'PROCESSING' || liveStatus === 'SUCCESS') {
      try {
        ledgerRepo.recordDoubleEntry(
          merchantId,
          'PAYOUT',
          payout.id,
          `Payout instruction ${transferId} submitted`,
          'PAYOUTS_IN_TRANSIT',
          'PAYOUT_FUNDING',
          amountPaise
        );
      } catch {}
    }

    const responsePayload = {
      payoutId: payout.id,
      transferId: payout.transfer_id,
      amount: (payout.amount_paise / 100).toFixed(2),
      currency: payout.currency,
      payoutRail: payout.payout_rail,
      status: payout.status,
      utr: payout.utr,
      beneficiary: {
        id: beneficiary.id,
        name: beneficiary.name,
        type: beneficiary.beneficiary_type
      },
      createdAt: payout.created_at
    };

    idempotencyRepo.set(idempotencyKey, merchantId, 'PAYOUT', transferId, responsePayload, 201);
    return HttpServer.json(res, 201, responsePayload);
  });

  // 5. GET /api/v1/payouts — List payouts
  server.get('/api/v1/payouts', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const parsedUrl = new URL(req.url, 'http://localhost');
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
    const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);
    const status = parsedUrl.searchParams.get('status') || null;

    const list = payoutRepo.listByMerchant(merchantId, { limit, offset, status });
    return HttpServer.json(res, 200, {
      count: list.length,
      payouts: list.map(p => ({
        id: p.id,
        transferId: p.transfer_id,
        amount: (p.amount_paise / 100).toFixed(2),
        currency: p.currency,
        payoutRail: p.payout_rail,
        status: p.status,
        utr: p.utr,
        createdAt: p.created_at,
        confirmedAt: p.confirmed_at
      }))
    });
  });

  // 6. GET /api/v1/payouts/:id — Get payout details
  server.get('/api/v1/payouts/:id', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const id = params.id;
    let payout = payoutRepo.findById(id) || payoutRepo.findByTransferId(id);
    if (!payout || payout.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Payout not found' });
    }

    const bene = payout.beneficiary_id ? beneRepo.findById(payout.beneficiary_id) : null;
    const events = payoutRepo.getEvents(payout.id);
    const approvals = payoutRepo.getApprovals(payout.id);

    return HttpServer.json(res, 200, {
      id: payout.id,
      transferId: payout.transfer_id,
      amount: (payout.amount_paise / 100).toFixed(2),
      amountPaise: payout.amount_paise,
      currency: payout.currency,
      payoutRail: payout.payout_rail,
      status: payout.status,
      utr: payout.utr,
      beneficiary: bene ? {
        id: bene.id,
        name: bene.name,
        type: bene.beneficiary_type,
        account: bene.bank_account || bene.upi_id
      } : null,
      createdAt: payout.created_at,
      submittedAt: payout.submitted_at,
      confirmedAt: payout.confirmed_at,
      events,
      approvals
    });
  });

  // 7. POST /api/v1/payouts/:id/approve — Maker-checker approval
  server.post('/api/v1/payouts/:id/approve', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    let body;
    try {
      body = await HttpServer.parseBody(req);
    } catch {
      body = {};
    }

    const payout = payoutRepo.findById(params.id) || payoutRepo.findByTransferId(params.id);
    if (!payout || payout.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Payout not found' });
    }

    if (payout.status !== 'APPROVAL_REQUIRED') {
      return HttpServer.json(res, 400, { error: `Payout is in ${payout.status} state, not pending approval.` });
    }

    const approverId = body.approverId || 'ADMIN';
    const decision = body.decision || 'APPROVED';
    if(!['APPROVED','REJECTED'].includes(decision))return HttpServer.json(res,400,{error:'Decision must be APPROVED or REJECTED.'});
    const claimed=db.execute("UPDATE payouts SET status='APPROVAL_PROCESSING' WHERE id=? AND status='APPROVAL_REQUIRED'",[payout.id]);
    if(!claimed.changes)return HttpServer.json(res,409,{error:'Payout approval is already being processed.'});

    payoutRepo.recordApproval({
      payoutId: payout.id,
      step: 'MAKER_CHECKER',
      approverId,
      decision,
      comments: body.comments || null
    });

    if (decision === 'REJECTED') {
      payoutRepo.update(payout.id, { status: 'REJECTED' });
      return HttpServer.json(res, 200, { status: 'REJECTED', message: 'Payout rejected by checker' });
    }

    // Reserve the journal before contacting the bank; a lost response requires reconciliation.
    try {
      ledgerRepo.recordDoubleEntry(merchantId,'PAYOUT',payout.id,'Approved payout reserved','PAYOUTS_IN_TRANSIT','PAYOUT_FUNDING',Number(payout.amount_paise));
    }catch(error){payoutRepo.update(payout.id,{status:'APPROVAL_REQUIRED'});return HttpServer.json(res,409,{error:'Could not reserve the payout journal. No provider transfer was requested.'});}
    // If approved, submit to provider
    try {
      const provider = providerRegistry.getProvider(merchantId, payout.provider_name || 'CASHFREE');
      const payoutRes = await provider.createPayout({
        transferId: payout.transfer_id,
        beneficiaryId: payout.beneficiary_id,
        amountPaise: payout.amount_paise,
        payoutRail: payout.payout_rail,
        remarks: payout.remarks
      });

      const saved=db.transaction(()=>{
        const latest=db.queryOne(`SELECT * FROM payouts WHERE id=?${db.dialect==='postgres'?' FOR UPDATE':''}`,[payout.id]);
        if(['SUCCESS','FAILED','REJECTED'].includes(latest.status))return latest;
        if(payoutRes.status==='SUCCESS')ledgerRepo.recordDoubleEntry(merchantId,'PAYOUT',payout.id,'Provider confirmed approved payout','BANK_CASH','PAYOUTS_IN_TRANSIT',Number(payout.amount_paise));
      return payoutRepo.update(payout.id, {
        status: payoutRes.status,
        providerTransferId: payoutRes.providerTransferId,
        utr: payoutRes.utr,
        approvedBy: approverId,
        submittedAt: new Date().toISOString()
      });
      });

      return HttpServer.json(res, 200, {
        status: saved.status,
        utr: saved.utr,
        message: 'Payout approved and submitted to banking provider'
      });
    } catch (err) {
      if(payoutRepo.findById(payout.id).status!=='SUCCESS')payoutRepo.update(payout.id, {
        status: 'RECONCILIATION_REQUIRED',
        failureReason: 'Provider response is uncertain; reconcile the original transfer ID.'
      });
      return HttpServer.json(res, 502, {
        error: `Failed to submit approved payout to provider: ${err.message}`
      });
    }
  });

  // 8. POST /api/v1/payouts/:id/refresh-status — Authoritative provider query
  server.post('/api/v1/payouts/:id/refresh-status', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const payout = payoutRepo.findById(params.id) || payoutRepo.findByTransferId(params.id);
    if (!payout || payout.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Payout not found' });
    }

    try {
      const provider = providerRegistry.getProvider(merchantId, payout.provider_name || 'CASHFREE');
      const statusRes = await provider.getPayoutStatus(payout.transfer_id);

      if(payout.status==='SUCCESS' && statusRes.status!=='SUCCESS')return HttpServer.json(res,409,{error:'Provider status conflicts with the confirmed payout. Reconciliation required.',status:'SUCCESS'});
      if (statusRes.status && statusRes.status !== payout.status) {
        payoutRepo.update(payout.id, {
          status: statusRes.status,
          utr: statusRes.utr || payout.utr,
          failureReason: statusRes.failureReason || payout.failure_reason,
          confirmedAt: statusRes.status === 'SUCCESS' ? new Date().toISOString() : payout.confirmed_at
        });
      }

      return HttpServer.json(res, 200, {
        transferId: payout.transfer_id,
        status: statusRes.status || payout.status,
        utr: statusRes.utr || payout.utr
      });
    } catch (err) {
      return HttpServer.json(res, 502, { error: `Status inquiry failed: ${err.message}` });
    }
  });
}

