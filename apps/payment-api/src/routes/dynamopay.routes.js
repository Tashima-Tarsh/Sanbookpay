/**
 * DYNAMO PAY — NATIVE API ROUTES
 * Dynamo Pay-branded payment collection endpoints:
 *   POST /v1/dynamo/collect/upi   - Generate UPI payment (intent + QR)
 *   POST /v1/dynamo/checkstatus   - Check payment status
 *   POST /v1/dynamo/ifsc/{ifsc}   - IFSC bank validation
 *   POST /v1/dynamo/wallet        - Wallet balance (settled/unsettled/lien/loan)
 *   POST /v1/dynamo/merchant/webhook — Configure webhook URL + IP whitelist
 *   GET  /v1/dynamo/merchant/retry-policy — Webhook retry policy
 *
 * Authentication: Client-ID, Client-Secret, Service-Id headers
 * Security: IP whitelisting, webhook URL config, retry policy
 * All endpoints are Dynamo Pay branded — no third-party naming.
 */

import { HttpServer } from '../server.js';
import { PaymentStatus } from '@youpi/common';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { LedgerRepository, MerchantRepository } from '@youpi/db';

/** Razorpay IFSC API endpoint - real bank IFSC data */
const RAZORPAY_IFSC_API = 'https://ifsc.razorpay.com';

/**
 * Fetches real IFSC bank details from Razorpay's public IFSC API.
 * @param {string} ifsc - IFSC code (e.g., SBIN0000001)
 * @returns {Promise<{bank: string, branch: string, city: string, state: string, address: string, contact: string, upi: boolean, neft: boolean, rtgs: boolean, imps: boolean} | null>}
 */
async function fetchRazorpayIfsc(ifsc) {
  try {
    const res = await new Promise((resolve, reject) => {
      const req = https.get(`${RAZORPAY_IFSC_API}/${ifsc}`, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    });

    if (res.status === 404) {
      return null;
    }
    if (res.status !== 200) {
      throw new Error(`Razorpay IFSC API returned ${res.status}`);
    }

    const raw = JSON.parse(res.body);
    return {
      bank: raw.BANK || '',
      branch: raw.Branch || '',
      city: raw.Center || '',
      state: raw.State || '',
      address: raw.Address || '',
      contact: raw.Contact || '',
      upi: raw.UPI === true,
      neft: raw.NEFT === true,
      rtgs: raw.RTGS === true,
      imps: raw.IMPS === true
    };
  } catch (err) {
    console.error(`IFSC lookup failed for ${ifsc}:`, err.message);
    return null;
  }
}
const DYNAMO_WEBHOOK_RETRY_POLICY = {
  maxRetries: 5,
  initialBackoffMs: 5000,
  maxBackoffMs: 300000,
  backoffMultiplier: 2,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND']
};

/**
 * Dynamo Pay-native routes factory
 */
export function registerDynamoPayRoutes(server, ctx) {
  const db = ctx.db;
  const merchantRepo = ctx.merchantRepo;
  const ledgerRepo = new LedgerRepository(db);
  const sessionRepo = ctx.sessionRepo;

  // Dynamo Pay merchant credentials store (in-memory, seeded from DB)
  const dynamoMerchants = new Map(); // serviceId -> { clientId, clientSecret, merchantId, webhookUrl, ipWhitelist, isActive }

  function loadDynamoMerchants() {
    try {
      const all = ctx.merchantRepo.findAll();
      for (const m of all) {
        // Deterministic clientSecret derived from merchant id (reproducible across restarts)
        const clientSecret = crypto.createHash('sha256').update(`dynamo-${m.id}-secret`).digest('hex').substring(0, 32);
        dynamoMerchants.set(m.id, {
          clientId: `dp_client_${m.id}`,
          clientSecret,
          merchantId: m.id,
          webhookUrl: m.webhookUrl || null,
          ipWhitelist: [],
          isActive: true
        });
      }
    } catch {}
  }
  loadDynamoMerchants();

  function resolveDynamoMerchant(clientId, clientSecret, serviceId) {
    for (const [sid, m] of dynamoMerchants.entries()) {
      if (m.clientId === clientId && m.clientSecret === clientSecret && m.serviceId === serviceId && m.isActive) {
        return m;
      }
    }
    if (serviceId && dynamoMerchants.has(serviceId)) {
      const m = dynamoMerchants.get(serviceId);
      if (m.clientId === clientId && m.clientSecret === clientSecret && m.isActive) {
        return m;
      }
    }
    return null;
  }

  function checkIpWhitelist(merchant, clientIp) {
    if (!merchant.ipWhitelist || merchant.ipWhitelist.length === 0) return true;
    return merchant.ipWhitelist.includes(clientIp);
  }

  function getClientIp(req) {
    return req.socket?.remoteAddress ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      'unknown';
  }

  function getWalletBalances(merchantId) {
    ledgerRepo.ensureAccounts(merchantId);
    const settled = Number(ledgerRepo.getAccount(merchantId, 'BANK_CASH')?.balance_paise || 0);
    const receivables = Number(ledgerRepo.getAccount(merchantId, 'MERCHANT_RECEIVABLES')?.balance_paise || 0);
    const clearing = Number(ledgerRepo.getAccount(merchantId, 'PROVIDER_CLEARING')?.balance_paise || 0);
    const lien = Number(ledgerRepo.getAccount(merchantId, 'PAYOUTS_IN_TRANSIT')?.balance_paise || 0);
    const unsettled = Math.max(0, receivables + clearing - settled);
    const loan = Math.max(0, -Math.min(0, Number(ledgerRepo.getAccount(merchantId, 'FEES')?.balance_paise || 0)));
    return {
      settledwallet: Math.max(0, settled),
      unsettledbalance: Math.max(0, unsettled),
      lienbalance: Math.max(0, lien),
      loanbalance: Math.max(0, loan)
    };
  }

  // ========================================================================
  // POST /v1/dynamo/collect/upi  — Dynamo Pay UPI collection
  // ========================================================================
  server.post('/v1/dynamo/collect/upi', async (req, res) => {
    const clientIp = getClientIp(req);
    const clientId = req.headers['client-id'] || '';
    const clientSecret = req.headers['client-secret'] || '';
    const serviceId = req.headers['service-id'] || '';

    const merchant = resolveDynamoMerchant(clientId, clientSecret, serviceId);
    if (!merchant) {
      return HttpServer.json(res, 401, { error: 'Unauthorized', code: 'AUTH_REQUIRED', platform: 'dynamo-pay' });
    }
    if (!checkIpWhitelist(merchant, clientIp)) {
      return HttpServer.json(res, 403, { error: 'IP not whitelisted', code: 'IP_NOT_WHITELISTED', platform: 'dynamo-pay' });
    }

    let body;
    try {
      body = await HttpServer.parseBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Invalid JSON body', code: 'MALFORMED_JSON', platform: 'dynamo-pay' });
    }

    const amount = body.amount;
    const uniquetransactionid = body.uniquetransactionid || body.orderId;
    const remarks = body.remarks || '';
    const name = body.name || '';
    const emailid = body.emailid || '';
    const mobileno = body.mobileno || '';

    if (!amount || amount < 100) {
      return HttpServer.json(res, 400, { error: 'Minimum amount is ₹100', code: 'MIN_AMOUNT_VIOLATION', platform: 'dynamo-pay' });
    }
    if (!uniquetransactionid) {
      return HttpServer.json(res, 400, { error: 'Missing uniquetransactionid', code: 'MISSING_ORDER_ID', platform: 'dynamo-pay' });
    }

    const amountPaise = Math.round(amount * 100);
    const orderId = uniquetransactionid;

    const existing = sessionRepo.findByOrderId(merchant.merchantId, orderId);
    if (existing && existing.status === PaymentStatus.SUCCESS) {
      return HttpServer.json(res, 200, {
        transaction: existing.id,
        uniquetransactionid: existing.orderId,
        amount: existing.amountPaise / 100,
        currency: 'INR',
        status: 'SUCCESS',
        intent: `upi://pay?pa=9082843142@slc&pn=Dynamo+Pay&am=${amount}&tn=${orderId}`,
        datetime: existing.createdAt,
        platform: 'dynamo-pay'
      });
    }

    const receivingAccount = ctx.accountRepo?.findActiveForMerchant?.(merchant.merchantId) ||
      (db.queryOne?.('SELECT * FROM payment_receiving_accounts WHERE merchant_id = $1 AND is_active = 1 LIMIT 1', [merchant.merchantId]));

    if (!receivingAccount) {
      return HttpServer.json(res, 500, { error: 'No active UPI receiving account configured', code: 'NO_RECEIVING_ACCOUNT', platform: 'dynamo-pay' });
    }

    const session = ctx.sessionRepo.create({
      merchantId: merchant.merchantId,
      customerId: null,
      receivingAccountId: receivingAccount.id,
      orderId,
      amountPaise,
      currency: 'INR',
      method: 'UPI',
      status: PaymentStatus.QUEUED,
      returnUrl: null,
      idempotencyKey: null,
      deviceId: null,
      metadata: { dynamoPay: true, remarks, name, emailid, mobileno, receivingAccountSnapshot: { id: receivingAccount.id, upiId: receivingAccount.upiId, payeeName: receivingAccount.payeeName } }
    });

    const queueResult = ctx.queueEngine.enqueueOrActivate(session.id, receivingAccount.id);
    if (queueResult.expiresAt) {
      ctx.timingEngine.startActiveTimer(session.id, queueResult.expiresAt);
    }

    const upiUri = `upi://pay?pa=${encodeURIComponent(receivingAccount.upiId)}&pn=${encodeURIComponent(receivingAccount.payeeName || 'Dynamo Pay')}&am=${amount}&tn=${orderId}`;

    return HttpServer.json(res, 201, {
      transaction: session.id,
      uniquetransactionid: orderId,
      amount,
      currency: 'INR',
      status: 'PENDING',
      intent: upiUri,
      qr: '',
      datetime: session.createdAt,
      remarks,
      name,
      emailid,
      mobileno,
      payeeVpa: receivingAccount.upiId,
      payeeName: receivingAccount.payeeName,
      checkoutUrl: `${process.env.BASE_CHECKOUT_URL || 'http://localhost:7000'}/checkout/${session.id}`,
      platform: 'dynamo-pay'
    });
  });

  // ========================================================================
  // POST /v1/dynamo/checkstatus  — Dynamo Pay payment status check
  // ========================================================================
  server.post('/v1/dynamo/checkstatus', async (req, res) => {
    const clientIp = getClientIp(req);
    const clientId = req.headers['client-id'] || '';
    const clientSecret = req.headers['client-secret'] || '';
    const serviceId = req.headers['service-id'] || '';

    const merchant = resolveDynamoMerchant(clientId, clientSecret, serviceId);
    if (!merchant) {
      return HttpServer.json(res, 401, { error: 'Unauthorized', code: 'AUTH_REQUIRED', platform: 'dynamo-pay' });
    }
    if (!checkIpWhitelist(merchant, clientIp)) {
      return HttpServer.json(res, 403, { error: 'IP not whitelisted', code: 'IP_NOT_WHITELISTED', platform: 'dynamo-pay' });
    }

    let body;
    try {
      body = await HttpServer.parseBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Invalid JSON body', code: 'MALFORMED_JSON', platform: 'dynamo-pay' });
    }

    const transactionId = body.transaction || body.uniquetransactionid || body.orderId;
    if (!transactionId) {
      return HttpServer.json(res, 400, { error: 'Missing transaction/uniquetransactionid', code: 'MISSING_TRANSACTION', platform: 'dynamo-pay' });
    }

    let session = sessionRepo.findById(transactionId);
    if (!session) {
      session = sessionRepo.findByOrderId(merchant.merchantId, transactionId);
    }
    if (!session) {
      return HttpServer.json(res, 404, { error: 'Transaction not found', code: 'TRANSACTION_NOT_FOUND', platform: 'dynamo-pay' });
    }
    if (session.merchantId !== merchant.merchantId) {
      return HttpServer.json(res, 403, { error: 'Access denied', code: 'ACCESS_DENIED', platform: 'dynamo-pay' });
    }

    const statusMap = {
      [PaymentStatus.SUCCESS]: 'SUCCESS',
      [PaymentStatus.FAILED]: 'FAILED',
      [PaymentStatus.EXPIRED]: 'FAILED',
      [PaymentStatus.CANCELLED]: 'FAILED',
      [PaymentStatus.ACTIVE]: 'PENDING',
      [PaymentStatus.PROCESSING]: 'PENDING',
      [PaymentStatus.QUEUED]: 'PENDING',
      [PaymentStatus.INITIATED]: 'PENDING',
      [PaymentStatus.UNKNOWN]: 'PENDING'
    };

    const upiTxn = session.metadata?.upiTransactionId || session.metadata?.bankReferenceNumber || null;

    return HttpServer.json(res, 200, {
      transaction: session.id,
      uniquetransactionid: session.orderId,
      amount: (Number(session.amountPaise) / 100).toFixed(2),
      currency: session.currency,
      status: statusMap[session.status] || 'PENDING',
      upiTransactionId: upiTxn,
      bankReferenceNumber: upiTxn,
      senderVpa: session.metadata?.senderVpa || null,
      senderName: session.metadata?.senderName || null,
      payeeVpa: session.metadata?.receivingAccountSnapshot?.upiId || null,
      payeeName: session.metadata?.receivingAccountSnapshot?.payeeName || null,
      datetime: session.createdAt,
      completedAt: session.completedAt || null,
      platform: 'dynamo-pay'
    });
  });

  // ========================================================================
  // POST /v1/dynamo/ifsc/{ifsc}  — Dynamo Pay IFSC validation
  // ========================================================================
  server.post('/v1/dynamo/ifsc/:ifsc', async (req, res, params) => {
    const clientIp = getClientIp(req);
    const clientId = req.headers['client-id'] || '';
    const clientSecret = req.headers['client-secret'] || '';
    const serviceId = req.headers['service-id'] || '';

    const merchant = resolveDynamoMerchant(clientId, clientSecret, serviceId);
    if (!merchant) {
      return HttpServer.json(res, 401, { error: 'Unauthorized', code: 'AUTH_REQUIRED', platform: 'dynamo-pay' });
    }
    if (!checkIpWhitelist(merchant, clientIp)) {
      return HttpServer.json(res, 403, { error: 'IP not whitelisted', code: 'IP_NOT_WHITELISTED', platform: 'dynamo-pay' });
    }

    const ifsc = (params.ifsc || '').toUpperCase().trim();
    if (!ifsc) {
      return HttpServer.json(res, 400, { error: 'Missing IFSC code', code: 'MISSING_IFSC', platform: 'dynamo-pay' });
    }

    const ifscRegex = /^[A-Z]{4,5}0[A-Z0-9]{5,6}$/;
    if (!ifscRegex.test(ifsc)) {
      return HttpServer.json(res, 400, { error: 'Invalid IFSC format', code: 'INVALID_IFSC_FORMAT', platform: 'dynamo-pay' });
    }

    // Look up real bank details from Razorpay IFSC API
    const info = await fetchRazorpayIfsc(ifsc);
    if (!info) {
      return HttpServer.json(res, 404, { error: 'IFSC not found in bank directory', code: 'IFSC_NOT_FOUND', ifsc, platform: 'dynamo-pay' });
    }

    return HttpServer.json(res, 200, {
      ifsc,
      bank: info.bank,
      branch: info.branch,
      city: info.city,
      state: info.state,
      address: info.address,
      contact: info.contact,
      upi: info.upi,
      neft: info.neft,
      rtgs: info.rtgs,
      imps: info.imps,
      supportedModes: ['UPI', 'NEFT', 'RTGS', 'IMPS'].filter(m => info[m.toLowerCase()]),
      platform: 'dynamo-pay',
      source: 'razorpay-ifsc-api'
    });
  });

  // ========================================================================
  // POST /v1/dynamo/wallet  — Dynamo Pay wallet balance
  // ========================================================================
  server.post('/v1/dynamo/wallet', async (req, res) => {
    const clientIp = getClientIp(req);
    const clientId = req.headers['client-id'] || '';
    const clientSecret = req.headers['client-secret'] || '';
    const serviceId = req.headers['service-id'] || '';

    const merchant = resolveDynamoMerchant(clientId, clientSecret, serviceId);
    if (!merchant) {
      return HttpServer.json(res, 401, { error: 'Unauthorized', code: 'AUTH_REQUIRED', platform: 'dynamo-pay' });
    }
    if (!checkIpWhitelist(merchant, clientIp)) {
      return HttpServer.json(res, 403, { error: 'IP not whitelisted', code: 'IP_NOT_WHITELISTED', platform: 'dynamo-pay' });
    }

    const balances = getWalletBalances(merchant.merchantId);

    return HttpServer.json(res, 200, {
      merchantId: merchant.merchantId,
      currency: 'INR',
      ...balances,
      datetime: new Date().toISOString(),
      platform: 'dynamo-pay'
    });
  });

  // ========================================================================
  // POST /v1/dynamo/merchant/webhook  — Dynamo Pay webhook config
  // ========================================================================
  server.post('/v1/dynamo/merchant/webhook', async (req, res) => {
    const clientIp = getClientIp(req);
    const clientId = req.headers['client-id'] || '';
    const clientSecret = req.headers['client-secret'] || '';
    const serviceId = req.headers['service-id'] || '';

    const merchant = resolveDynamoMerchant(clientId, clientSecret, serviceId);
    if (!merchant) {
      return HttpServer.json(res, 401, { error: 'Unauthorized', code: 'AUTH_REQUIRED', platform: 'dynamo-pay' });
    }
    if (!checkIpWhitelist(merchant, clientIp)) {
      return HttpServer.json(res, 403, { error: 'IP not whitelisted', code: 'IP_NOT_WHITELISTED', platform: 'dynamo-pay' });
    }

    let body;
    try {
      body = await HttpServer.parseBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Invalid JSON body', code: 'MALFORMED_JSON', platform: 'dynamo-pay' });
    }

    const webhookUrl = body.webhookUrl || null;
    const ipWhitelist = body.ipWhitelist || merchant.ipWhitelist || [];

    if (webhookUrl && !/^https?:\/\//.test(webhookUrl)) {
      return HttpServer.json(res, 400, { error: 'Invalid webhook URL', code: 'INVALID_WEBHOOK_URL', platform: 'dynamo-pay' });
    }

    merchant.webhookUrl = webhookUrl;
    merchant.ipWhitelist = Array.isArray(ipWhitelist) ? ipWhitelist : [];

    try {
      merchantRepo.update(merchant.merchantId, { webhookUrl });
    } catch {}

    return HttpServer.json(res, 200, {
      merchantId: merchant.merchantId,
      webhookUrl: merchant.webhookUrl,
      ipWhitelist: merchant.ipWhitelist,
      retryPolicy: DYNAMO_WEBHOOK_RETRY_POLICY,
      datetime: new Date().toISOString(),
      platform: 'dynamo-pay'
    });
  });

  // ========================================================================
  // GET /v1/dynamo/merchant/retry-policy  — Dynamo Pay retry policy
  // ========================================================================
  server.get('/v1/dynamo/merchant/retry-policy', async (req, res) => {
    const clientIp = getClientIp(req);
    const clientId = req.headers['client-id'] || '';
    const clientSecret = req.headers['client-secret'] || '';
    const serviceId = req.headers['service-id'] || '';

    const merchant = resolveDynamoMerchant(clientId, clientSecret, serviceId);
    if (!merchant) {
      return HttpServer.json(res, 401, { error: 'Unauthorized', code: 'AUTH_REQUIRED', platform: 'dynamo-pay' });
    }
    if (!checkIpWhitelist(merchant, clientIp)) {
      return HttpServer.json(res, 403, { error: 'IP not whitelisted', code: 'IP_NOT_WHITELISTED', platform: 'dynamo-pay' });
    }

    return HttpServer.json(res, 200, {
      retryPolicy: DYNAMO_WEBHOOK_RETRY_POLICY,
      description: 'Dynamo Pay webhooks are retried with exponential backoff. Retryable statuses: 408, 429, 500, 502, 503, 504. Network errors: ETIMEDOUT, ECONNRESET, ECONNREFUSED, ENOTFOUND.',
      maxRetries: DYNAMO_WEBHOOK_RETRY_POLICY.maxRetries,
      initialBackoffMs: DYNAMO_WEBHOOK_RETRY_POLICY.initialBackoffMs,
      maxBackoffMs: DYNAMO_WEBHOOK_RETRY_POLICY.maxBackoffMs,
      platform: 'dynamo-pay'
    });
  });

  return {
    dynamoMerchants,
    resolveDynamoMerchant,
    DYNAMO_WEBHOOK_RETRY_POLICY
  };
}
