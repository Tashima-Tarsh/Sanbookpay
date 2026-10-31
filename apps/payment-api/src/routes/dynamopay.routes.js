import {enforcePaymentControls} from '../payment-controls.js';
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

import { HttpServer, resolveClientIp } from '../server.js';
import { validateUpiChannel } from '../upi-channel.js';
import { PaymentStatus } from '@youpi/common';
import crypto from 'node:crypto';
import { resolveSecret, safeEqual, toPaise, toRupeesString, buildUpiUri, validateOutboundWebhookUrl } from '@youpi/common';
import { isIP } from 'node:net';
import fs from 'node:fs';
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
      branch: raw.BRANCH || raw.Branch || '',
      city: raw.CITY || raw.CENTRE || raw.Center || '',
      state: raw.STATE || raw.State || '',
      address: raw.ADDRESS || raw.Address || '',
      contact: raw.CONTACT || raw.Contact || '',
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
  maxAttempts:5, retryDelaysMs:[5000,30000,120000,600000], timeoutMs:10000,
  successfulStatuses:'200-299', retryableStatuses:'All non-2xx responses and network errors',
  deliveryIdStableAcrossRetries:true
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
        // A persisted server secret keeps credentials stable without making them guessable from the public merchant ID.
        const clientSecret = crypto.createHmac('sha256',resolveSecret('dynamo_client_master_key')).update(m.id).digest('hex');
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
    const m=dynamoMerchants.get(serviceId);
    if(!m || !safeEqual(m.clientId,clientId) || !safeEqual(m.clientSecret,clientSecret) || !m.isActive)return null;
    const current=merchantRepo.findById(m.merchantId);
    if(!current)return null;
    return {...m,webhookUrl:current.webhookUrl,ipWhitelist:current.branding?.apiIpWhitelist||[]};
  }
  function publicOrigin(){
    if(process.env.DYNAMO_PUBLIC_URL)return process.env.DYNAMO_PUBLIC_URL.replace(/\/+$/,'');
    if(process.env.DYNAMO_UNIFIED_GATEWAY==='true'){
      try{const value=fs.readFileSync(new URL('../../../../data/.secrets/quick_tunnel_url',import.meta.url),'utf8').trim();if(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(value))return value;}catch{}
    }
    return (process.env.BASE_CHECKOUT_URL||'http://localhost:7000').replace(/\/+$/,'');
  }
  function collectionResponse(session){
    const account=session.metadata?.receivingAccountSnapshot||{};
    const intent=session.status===PaymentStatus.ACTIVE?buildUpiUri({payeeVpa:account.upiId,payeeName:account.payeeName||'Dynamo Pay',amountPaise:session.amountPaise,transactionRef:session.orderId})+'&cu=INR':null;
    return {transaction:session.id,uniquetransactionid:session.orderId,amount:toRupeesString(session.amountPaise),currency:'INR',status:session.status==='SUCCESS'?'SUCCESS':session.status==='FAILED'||session.status==='EXPIRED'||session.status==='CANCELLED'?'FAILED':'PENDING',internalStatus:session.status,intent,qr:intent?publicOrigin()+'/checkout/'+session.id+'/qr.svg':null,checkoutUrl:publicOrigin()+'/checkout/'+session.id,datetime:session.createdAt,expiresAt:session.expiresAt||null,payeeVpa:account.upiId||null,payeeName:account.payeeName||null,platform:'dynamo-pay'};
  }
  const aliases={'/v1/dynamo/collect/upi':'/v1.0/collect/upi','/v1/dynamo/checkstatus':'/v1.0/payin/checkstatus','/v1/dynamo/ifsc/:ifsc':'/v1.0/ifsc/:ifsc','/v1/dynamo/wallet':'/v1.0/wallet','/v1/dynamo/merchant/webhook':'/v1.0/merchant/webhook'};
  function post(route,handler){server.post(route,handler);if(aliases[route])server.post(aliases[route].replace('/v1.0/','/v1\\.0/'),handler);}

  function checkIpWhitelist(merchant, clientIp) {
    if (!merchant.ipWhitelist || merchant.ipWhitelist.length === 0) return true;
    return merchant.ipWhitelist.includes(clientIp);
  }

  function getClientIp(req) {
    return resolveClientIp(req);
  }

  function getWalletBalances(merchantId) {
    ledgerRepo.ensureAccounts(merchantId);
    const settled = Number(ledgerRepo.getAccount(merchantId, 'BANK_CASH')?.balance_paise || 0);
    const receivables = Number(ledgerRepo.getAccount(merchantId, 'MERCHANT_RECEIVABLES')?.balance_paise || 0);
    const clearing = Number(ledgerRepo.getAccount(merchantId, 'PROVIDER_CLEARING')?.balance_paise || 0);
    const lien = Number(ledgerRepo.getAccount(merchantId, 'PAYOUTS_IN_TRANSIT')?.balance_paise || 0);
    const unsettled = Math.max(0, clearing);
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
  post('/v1/dynamo/collect/upi', async (req, res) => {
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

    let amountPaise;
    try{
      if(!['string','number'].includes(typeof amount) || !/^\d+(?:\.\d{1,2})?$/.test(String(amount)))throw new Error();
      amountPaise=toPaise(String(amount));if(amountPaise<10000n || amountPaise>BigInt(Number.MAX_SAFE_INTEGER))throw new Error();
    }catch{return HttpServer.json(res,400,{error:'Amount must be at least INR 100.00 with at most two decimals',code:'INVALID_AMOUNT',platform:'dynamo-pay'});}
    if(typeof uniquetransactionid!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(uniquetransactionid))return HttpServer.json(res,400,{error:'uniquetransactionid must contain 1-120 letters, digits, hyphens or underscores',code:'INVALID_ORDER_ID'});
    const orderId=uniquetransactionid;
    const existing=sessionRepo.findByOrderId(merchant.merchantId,orderId);
    if(existing){
      if(existing.amountPaise!==amountPaise)return HttpServer.json(res,409,{error:'Order ID already exists with another amount',code:'IDEMPOTENCY_CONFLICT'});
      return HttpServer.json(res,200,collectionResponse(existing));
    }
    if(ctx.platformPayments){try{ctx.platformPayments.requireActive(merchant.merchantId);}catch(e){return HttpServer.json(res,e.statusCode||403,{error:e.message,code:e.code});}}
    const receivingAccount = ctx.accountRepo?.findActiveForMerchant?.(merchant.merchantId) ||
      (db.queryOne?.('SELECT * FROM payment_receiving_accounts WHERE merchant_id = $1 AND is_active = 1 LIMIT 1', [merchant.merchantId]));

    if (!receivingAccount) {
      return HttpServer.json(res, 500, { error: 'No active UPI receiving account configured', code: 'NO_RECEIVING_ACCOUNT', platform: 'dynamo-pay' });
    }

    const ruleError=enforcePaymentControls(ctx,merchant.merchantId,{RECEIVING_VPA:receivingAccount.upiId,CUSTOMER_VPA:body.payerVpa,CUSTOMER:body.customerId});
    if(ruleError)return HttpServer.json(res,403,ruleError);
    const channelError=validateUpiChannel(merchantRepo.findById(merchant.merchantId),amountPaise,receivingAccount.upiId);
    if(channelError)return HttpServer.json(res,400,channelError);
    const session = ctx.sessionRepo.create({
      // The settings apply only to new collections, preserving existing order status/reconciliation.
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

    return HttpServer.json(res,201,collectionResponse(sessionRepo.findById(session.id)));
  });

  // ========================================================================
  // POST /v1/dynamo/checkstatus  — Dynamo Pay payment status check
  // ========================================================================
  post('/v1/dynamo/checkstatus', async (req, res) => {
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

    const bank= session.attributedObservationId ? db.queryOne('SELECT bank_reference_number,sender_vpa FROM payment_observations WHERE id=?',[session.attributedObservationId]) : null;
    const upiTxn=bank?.bank_reference_number||null;

    return HttpServer.json(res, 200, {
      ...collectionResponse(session),
      transaction: session.id,
      uniquetransactionid: session.orderId,
      amount: (Number(session.amountPaise) / 100).toFixed(2),
      currency: session.currency,
      status: statusMap[session.status] || 'PENDING',
      upiTransactionId: upiTxn,
      bankReferenceNumber: upiTxn,
      senderVpa: bank?.sender_vpa || null,
      confirmationSource:session.verificationTag==='MERCHANT_CONFIRMED'?'MERCHANT':session.verificationLevel?'BANK_OBSERVER':null,
      reportedUtr:session.metadata?.reportedUtr||null,
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
  post('/v1/dynamo/ifsc/:ifsc', async (req, res, params) => {
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

    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
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
  post('/v1/dynamo/wallet', async (req, res) => {
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
      ...Object.fromEntries(Object.entries(balances).map(([key,value])=>[key,(value/100).toFixed(2)])),
      datetime: new Date().toISOString(),
      platform: 'dynamo-pay'
    });
  });

  // ========================================================================
  // POST /v1/dynamo/merchant/webhook  — Dynamo Pay webhook config
  // ========================================================================
  post('/v1/dynamo/merchant/webhook', async (req, res) => {
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

    const current=merchantRepo.findById(merchant.merchantId);
    const webhookUrl=body.webhookUrl===undefined?current.webhookUrl:body.webhookUrl||null;
    const ipWhitelist=body.ipWhitelist===undefined?merchant.ipWhitelist:body.ipWhitelist;
    const checked=webhookUrl?validateOutboundWebhookUrl(webhookUrl):{valid:true};
    if(!checked.valid || (webhookUrl&&new URL(webhookUrl).protocol!=='https:'))return HttpServer.json(res,400,{error:'Provide a public HTTPS webhook URL',code:'INVALID_WEBHOOK_URL'});
    if(!Array.isArray(ipWhitelist)||ipWhitelist.length>50||ipWhitelist.some(ip=>typeof ip!=='string'||!isIP(ip)))return HttpServer.json(res,400,{error:'ipWhitelist must contain up to 50 exact IPv4/IPv6 addresses',code:'INVALID_IP_WHITELIST'});
    merchantRepo.update(merchant.merchantId,{webhookUrl,branding:{...current.branding,apiIpWhitelist:ipWhitelist}});
    merchant.webhookUrl=webhookUrl;merchant.ipWhitelist=ipWhitelist;

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
      description: 'Up to five total delivery attempts. Any non-2xx response or network error is retried; acknowledge with HTTP 200.',
      maxAttempts: DYNAMO_WEBHOOK_RETRY_POLICY.maxAttempts,
      retryDelaysMs:DYNAMO_WEBHOOK_RETRY_POLICY.retryDelaysMs,
      platform: 'dynamo-pay'
    });
  });

  return {
    dynamoMerchants,
    resolveDynamoMerchant,
    DYNAMO_WEBHOOK_RETRY_POLICY
  };
}
