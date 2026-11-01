import crypto from 'node:crypto';
import {encryptAtRest} from '@youpi/common';
import { toPaise } from '@youpi/common';
import { confirmProviderCollection, publishProviderCollection } from '../services/provider-confirmation.js';
import { HttpServer, resolveClientIp } from '../server.js';
import {
  PaymentOrderRepository,
  PayoutRepository,
  LedgerRepository
} from '@youpi/db';
import { ProviderRegistry } from '@youpi/core';
import { IpAllowlist } from '@youpi/core';
import { PhonePeProvider } from '../../../../packages/core/src/providers/phonepe-provider.js';
import { PaytmProvider } from '../../../../packages/core/src/providers/paytm-provider.js';

// Acknowledge only after verified financial processing commits; failures remain retryable.
export function registerProviderWebhooksRoutes(server, ctx) {
  const db = ctx.db;
  const poRepo = new PaymentOrderRepository(db);
  const payoutRepo = new PayoutRepository(db);
  const ledgerRepo = new LedgerRepository(db);
  const providerRegistry = new ProviderRegistry({ db });
  const ipAllowlist = new IpAllowlist(
    process.env.WEBHOOK_ALLOWED_IPS ? process.env.WEBHOOK_ALLOWED_IPS.split(',').map(s => s.trim()).filter(Boolean) : []
  );
  db.execute(`CREATE TABLE IF NOT EXISTS pp_provider_events(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,payment_order_id TEXT NOT NULL,provider_name TEXT NOT NULL,provider_payment_id TEXT,event_type TEXT NOT NULL,payload_encrypted TEXT NOT NULL,status TEXT NOT NULL,received_at TEXT NOT NULL)`);

  async function handleProviderWebhook(req, res, providerName) {
    // Forwarded headers are untrusted here. Empty allowlist disables only IP filtering;
    // provider signature verification remains mandatory.
    if (!ipAllowlist.isAllowed(resolveClientIp(req))) {
      return HttpServer.json(res, 403, {error:'Webhook source IP not in allowlist'});
    }
    let rawBody, payload;
    try { rawBody = await HttpServer.parseRawBody(req); }
    catch { return HttpServer.json(res,400,{error:'Failed to read request body'}); }
    try {
      let merchantOrderId, paymentData, eventType;
      if (providerName === 'PHONEPE' || providerName === 'PAYTM') {
        // Decoding is untrusted routing input, never payment evidence.
        const decoder = providerName === 'PHONEPE' ? new PhonePeProvider() : new PaytmProvider();
        const decoded = decoder.decodeWebhookResponse(rawBody);
        if (!decoded) return HttpServer.json(res,400,{error:'Malformed provider callback'});
        payload = decoded.rawResponse;
        merchantOrderId = decoded.merchantTransactionId;
        paymentData = {payment_status:decoded.state,cf_payment_id:decoded.transactionId,bank_reference:decoded.transactionId,amountPaise:decoded.amountPaise,payment_currency:'INR'};
        eventType = decoded.state;
      } else {
        try { payload = JSON.parse(rawBody); }
        catch { return HttpServer.json(res,400,{error:'Malformed JSON payload'}); }
        merchantOrderId = payload.data?.order?.order_id || payload.order?.order_id || payload.order_id;
        paymentData = payload.data?.payment || payload.payment || {};
        eventType = payload.type || paymentData.payment_status || 'UNKNOWN';
      }
      if (!merchantOrderId) return HttpServer.json(res,400,{error:'Missing provider order reference'});
      const candidates=db.query('SELECT * FROM payment_orders WHERE provider_order_id=? AND provider_name=?',[merchantOrderId,providerName]);
      if(candidates.length!==1) return HttpServer.json(res,candidates.length?409:404,{error:'Unknown or ambiguous provider order'});
      const order=candidates[0],connectionId=JSON.parse(order.metadata||'{}').connectionId||null;
      const provider=providerRegistry.getProvider(order.merchant_id,providerName,connectionId);
      if(!provider.verifyCollectionWebhook({rawBody,headers:req.headers})) return HttpServer.json(res,401,{error:'Invalid provider signature'});
      const eventId=crypto.createHash('sha256').update(rawBody).digest('hex');
      let result;
      try {
        db.transaction(()=>{
          db.execute('INSERT INTO pp_provider_events(id,merchant_id,payment_order_id,provider_name,provider_payment_id,event_type,payload_encrypted,status,received_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
            [eventId,order.merchant_id,order.id,providerName,paymentData.cf_payment_id?String(paymentData.cf_payment_id):null,eventType,encryptAtRest(rawBody.toString()),'RECEIVED',new Date().toISOString()]);
          if(paymentData.payment_status==='SUCCESS') {
            const amountPaise=paymentData.amountPaise ?? Number(toPaise(paymentData.payment_amount));
            if(!Number.isSafeInteger(amountPaise)||amountPaise<=0) throw Error('Invalid provider amount');
            result=confirmProviderCollection(ctx,order.id,{amountPaise,currency:paymentData.payment_currency,bankReference:paymentData.bank_reference||null,providerPaymentId:paymentData.cf_payment_id?String(paymentData.cf_payment_id):null,actorType:'PROVIDER_WEBHOOK',rawResponse:payload});
          } else if(paymentData.payment_status==='FAILED') {
            const current=db.queryOne(`SELECT * FROM payment_orders WHERE id=?${db.dialect==='postgres'?' FOR UPDATE':''}`,[order.id]);
            if(!['SUCCESS','FAILED'].includes(current.status)) poRepo.update(order.id,{status:'FAILED',actorType:'PROVIDER_WEBHOOK',providerResponse:payload});
          }
          db.execute('UPDATE pp_provider_events SET status=? WHERE id=?',['PROCESSED',eventId]);
        });
      } catch(error) {
        const stamp=new Date().toISOString();
        db.transaction(()=>{
          db.execute('INSERT INTO pp_provider_events(id,merchant_id,payment_order_id,provider_name,provider_payment_id,event_type,payload_encrypted,status,received_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status',
            [eventId,order.merchant_id,order.id,providerName,paymentData.cf_payment_id?String(paymentData.cf_payment_id):null,eventType,encryptAtRest(rawBody.toString()),'RECONCILIATION_REQUIRED',stamp]);
          db.execute('INSERT INTO pp_cases(id,merchant_id,kind,title,description,payment_id,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
            ['provider-'+eventId,order.merchant_id,'RECONCILIATION','Provider callback rejected',error.message,order.id,'OPEN','PROVIDER_WEBHOOK',stamp,stamp]);
        });
        console.error(`[${providerName} webhook] Processing rejected:`,error.message);
        return HttpServer.json(res,409,{error:'Provider event requires reconciliation'});
      }
      // Outgoing delivery has its own durable outbox; publication cannot undo a commit.
      if(result) try { publishProviderCollection(server,ctx,result); } catch(error) { console.error('[Provider event publication]',error.message); }
      return HttpServer.json(res,200,{received:true});
    } catch(error) {
      console.error(`[${providerName} webhook] Processing failed:`,error.message);
      return HttpServer.json(res,503,{error:'Provider callback processing unavailable; retry required'});
    }
  }

  // 1. POST /api/v1/webhooks/cashfree/collections — Cashfree PG Webhooks
  server.post('/api/v1/webhooks/cashfree/collections', async (req, res) => {
    return handleProviderWebhook(req, res, 'CASHFREE');
  });

  // 2. POST /api/v1/webhooks/phonepe/collections — PhonePe PG Webhooks
  server.post('/api/v1/webhooks/phonepe/collections', async (req, res) => {
    return handleProviderWebhook(req, res, 'PHONEPE');
  });

  // 3. POST /api/v1/webhooks/paytm/collections — Paytm PG Webhooks
  server.post('/api/v1/webhooks/paytm/collections', async (req, res) => {
    return handleProviderWebhook(req, res, 'PAYTM');
  });

  // 4. POST /api/v1/webhooks/cashfree/payouts — Cashfree Payout Webhooks
  server.post('/api/v1/webhooks/cashfree/payouts', async (req, res) => {
    let rawBody;
    try {
      rawBody = await HttpServer.parseRawBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Failed to read request body' });
    }

    let payload;
    try { payload = JSON.parse(rawBody); } catch { return HttpServer.json(res, 400, { error: 'Malformed JSON payload' }); }

    const transferId = payload.transferId || payload.data?.transferId || payload.data?.transfer?.transferId;
    if (!transferId) return HttpServer.json(res, 400, { error: 'Missing transferId in webhook' });

    const payout = payoutRepo.findByTransferId(transferId);
    if (!payout) return HttpServer.json(res, 404, { error: `Payout transfer ${transferId} not found` });

    const merchantId = payout.merchant_id;
    const provider = providerRegistry.getProvider(merchantId, 'CASHFREE');

    const isValid = provider.verifyPayoutWebhook({ rawBody, headers: req.headers });
    if (!isValid) return HttpServer.json(res, 401, { error: 'Invalid Cashfree payout webhook signature' });

    const rawStatus = (payload.status || payload.data?.status || '').toUpperCase();
    const utr = payload.utr || payload.data?.utr || null;

    db.transaction(() => {
      const current = db.queryOne(`SELECT status FROM payouts WHERE id=?${db.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, [payout.id]);
      if (['SUCCESS', 'FAILED'].includes(current.status)) return;
      if (rawStatus === 'SUCCESS') {
        payoutRepo.update(payout.id, { status: 'SUCCESS', utr, confirmedAt: new Date().toISOString() });
        ledgerRepo.recordDoubleEntry(merchantId, 'PAYOUT', payout.id, `Payout confirmed by bank. UTR: ${utr || 'N/A'}`, 'BANK_CASH', 'PAYOUTS_IN_TRANSIT', payout.amount_paise);
      } else if (rawStatus === 'FAILED' || rawStatus === 'REJECTED') {
        payoutRepo.update(payout.id, { status: 'FAILED', failureReason: payload.reason || payload.data?.reason || 'Provider declined transfer' });
        ledgerRepo.recordDoubleEntry(merchantId, 'REVERSAL', payout.id, `Payout failed/reversed. Ref: ${transferId}`, 'PAYOUT_FUNDING', 'PAYOUTS_IN_TRANSIT', payout.amount_paise);
      }
    });

    return HttpServer.json(res, 200, { received: true });
  });
}
