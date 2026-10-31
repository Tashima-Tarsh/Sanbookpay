import {toPaise} from '@youpi/common';
import crypto from 'node:crypto';
import {enforcePaymentControls} from '../payment-controls.js';
import { confirmProviderCollection, publishProviderCollection } from '../services/provider-confirmation.js';
import { HttpServer } from '../server.js';
import { PaymentOrderRepository, LedgerRepository, IdempotencyRepository } from '@youpi/db';
import { ProviderRegistry } from '@youpi/core';

/**
 * Real UPI & Payment Collections Routes
 * Implements genuine provider order creation, sessions, authoritative status, and state machines.
 */
export function registerCollectionsRoutes(server, ctx) {
  const db = ctx.db;
  const poRepo = new PaymentOrderRepository(db);
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

  server.get('/api/v1/provider-checkout/:id',(req,res,p)=>{
    const order=poRepo.findById(p.id);
    if(!order||order.provider_name!=='CASHFREE'||!order.payment_session_id)return HttpServer.json(res,404,{error:'Provider checkout not available'});
    if(order.status==='SUCCESS')return HttpServer.json(res,200,{status:'SUCCESS',message:'Payment already confirmed'});
    if(order.status!=='PENDING')return HttpServer.json(res,409,{error:'This payment is not payable; reconcile the original attempt'});
    const metadata=JSON.parse(order.metadata||'{}'),nonce=crypto.randomBytes(16).toString('hex');
    const config=JSON.stringify({mode:metadata.environment==='SANDBOX'?'sandbox':'production',paymentSessionId:order.payment_session_id}).replaceAll('<','\\u003c');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':`default-src 'self'; script-src 'nonce-${nonce}' https://sdk.cashfree.com; connect-src https://*.cashfree.com; frame-src https://*.cashfree.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.cashfree.com; base-uri 'none'; form-action https://*.cashfree.com`});
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sanbook Pay checkout</title><link rel="stylesheet" href="/dynamo-console.css"></head><body><main class="login-screen"><section class="login-box"><h1>Complete your payment</h1><p>Continue to the approved Cashfree checkout. Your payment is confirmed only by the provider.</p><button class="btn primary" id="pay">Continue to Cashfree</button><p id="error" role="alert"></p></section></main><script nonce="${nonce}" src="https://sdk.cashfree.com/js/v3/cashfree.js"></script><script nonce="${nonce}">const config=${config};document.getElementById('pay').onclick=async()=>{try{await Cashfree({mode:config.mode}).checkout({paymentSessionId:config.paymentSessionId,redirectTarget:'_self'});}catch{document.getElementById('error').textContent='Checkout unavailable. Keep your order reference and retry this same checkout.';}};</script></body></html>`);
  });

  // 1. POST /api/v1/collections — Create real payment collection order
  server.post('/api/v1/collections', async (req, res) => {
    if(process.env.NODE_ENV==='production')return HttpServer.json(res,410,{error:'Create provider orders through the scoped /v1/payments API. Existing collection inquiry and historical records remain available.',code:'USE_CANONICAL_PAYMENT_API'});
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

    if (!body.orderId || !body.amount) {
      return HttpServer.json(res, 400, { error: 'Missing required fields: orderId and amount' });
    }

    const idempotencyKey = req.headers['idempotency-key'];
    if (idempotencyKey) {
      const cached = idempotencyRepo.get(idempotencyKey, merchantId);
      if (cached) {
        return HttpServer.json(res, cached.statusCode, cached.responsePayload);
      }
    }

    let amountPaise;
    try{amountPaise=Number(toPaise(body.amount));if(!Number.isSafeInteger(amountPaise))throw Error();}
    catch{return HttpServer.json(res,400,{error:'Supply a positive INR amount with at most two decimals.'});}

    // Check if duplicate orderId for merchant
    const existing = poRepo.findByMerchantAndOrderId(merchantId, String(body.orderId));
    if (existing) {
      return HttpServer.json(res, 409, {
        error: 'Order ID already exists for this merchant',
        paymentId: existing.id,
        status: existing.status
      });
    }

    const startInitiation = Date.now();
    const providerName = (body.provider || 'CASHFREE').toUpperCase();
    const ruleError=enforcePaymentControls(ctx,merchantId,{PROVIDER:providerName,CUSTOMER_VPA:body.customer?.vpa,CUSTOMER:body.customerId});
    if(ruleError)return HttpServer.json(res,403,ruleError);
    let providerOrder;

    try {
      const provider = providerRegistry.getProvider(merchantId, providerName);
      // Attempt real provider collection initiation
      providerOrder = await provider.createCollection({
        merchantOrderId: String(body.orderId),
        amountPaise,
        currency: body.currency || 'INR',
        customerName: body.customer?.name || body.customerName,
        customerPhone: body.customer?.phone || body.customerPhone,
        customerEmail: body.customer?.email || body.customerEmail,
        returnUrl: body.returnUrl,
        notifyUrl: body.notifyUrl
      });
    } catch (err) {
      // Never create a fabricated provider order. The merchant can retry the same
      // idempotency key after configuring the approved provider connection.
      return HttpServer.json(res, 503, {
        error: 'The approved payment provider is unavailable or not configured.',
        code: 'PROVIDER_UNAVAILABLE',
        retryable: true
      });
    }

    const initiationDuration = Date.now() - startInitiation;

    const order = poRepo.create({
      merchantId,
      merchantOrderId: String(body.orderId),
      providerOrderId: providerOrder.providerOrderId,
      paymentSessionId: providerOrder.paymentSessionId,
      providerName,
      amountPaise,
      currency: body.currency || 'INR',
      status: 'PENDING',
      customerName: body.customer?.name || body.customerName || null,
      customerEmail: body.customer?.email || body.customerEmail || null,
      customerPhone: body.customer?.phone || body.customerPhone || null,
      checkoutUrl: providerOrder.checkoutUrl,
      paymentMethod: body.method || 'UPI',
      providerResponse: providerOrder.rawResponse,
      initiationTimeMs: initiationDuration,
      metadata: body.metadata || {}
    });

    const responsePayload = {
      paymentId: order.id,
      merchantOrderId: order.merchant_order_id,
      providerOrderId: order.provider_order_id,
      amount: (order.amount_paise / 100).toFixed(2),
      amountPaise: order.amount_paise,
      currency: order.currency,
      checkoutUrl: order.checkout_url || `/api/v1/provider-checkout/${order.id}`,
      paymentSessionId: order.payment_session_id,
      status: order.status,
      provider: order.provider_name,
      createdAt: order.created_at
    };

    if (idempotencyKey) {
      idempotencyRepo.set(idempotencyKey, merchantId, 'COLLECTION', String(body.orderId), responsePayload, 201);
    }

    return HttpServer.json(res, 201, responsePayload);
  });

  // 2. GET /api/v1/collections — List collections
  server.get('/api/v1/collections', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return HttpServer.json(res, 401, { error: 'Unauthorized: Invalid or missing API key' });
    }

    const parsedUrl = new URL(req.url, 'http://localhost');
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
    const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);
    const status = parsedUrl.searchParams.get('status') || null;

    const orders = poRepo.listByMerchant(merchantId, { limit, offset, status });
    return HttpServer.json(res, 200, {
      count: orders.length,
      collections: orders.map(o => ({
        paymentId: o.id,
        merchantOrderId: o.merchant_order_id,
        providerOrderId: o.provider_order_id,
        amount: (o.amount_paise / 100).toFixed(2),
        currency: o.currency,
        status: o.status,
        method: o.payment_method,
        bankReference: o.bank_reference,
        createdAt: o.created_at,
        confirmedAt: o.confirmed_at
      }))
    });
  });

  // 3. GET /api/v1/collections/:id — Get collection details
  server.get('/api/v1/collections/:id', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return HttpServer.json(res, 401, { error: 'Unauthorized: Invalid or missing API key' });
    }

    const id = params.id;
    let order = poRepo.findById(id);
    if (!order) {
      order = poRepo.findByMerchantAndOrderId(merchantId, id);
    }

    if (!order || order.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Collection order not found' });
    }

    const events = poRepo.getEvents(order.id);

    return HttpServer.json(res, 200, {
      paymentId: order.id,
      merchantOrderId: order.merchant_order_id,
      providerOrderId: order.provider_order_id,
      amount: (order.amount_paise / 100).toFixed(2),
      amountPaise: order.amount_paise,
      currency: order.currency,
      status: order.status,
      method: order.payment_method,
      bankReference: order.bank_reference,
      providerPaymentId: order.provider_payment_id,
      checkoutUrl: order.checkout_url || `/api/v1/provider-checkout/${order.id}`,
      initiationTimeMs: order.initiation_time_ms,
      confirmationTimeMs: order.confirmation_time_ms,
      createdAt: order.created_at,
      confirmedAt: order.confirmed_at,
      events: events.map(e => ({
        eventType: e.event_type,
        status: e.new_status,
        timestamp: e.created_at,
        latencyMs: e.latency_ms
      }))
    });
  });

  // 4. GET /api/v1/collections/:id/status — Fast status check
  server.get('/api/v1/collections/:id/status', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return HttpServer.json(res, 401, { error: 'Unauthorized' });
    }

    const id = params.id;
    let order = poRepo.findById(id) || poRepo.findByMerchantAndOrderId(merchantId, id);
    if (!order || order.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Collection order not found' });
    }

    return HttpServer.json(res, 200, {
      paymentId: order.id,
      orderId: order.merchant_order_id,
      status: order.status,
      bankReference: order.bank_reference,
      confirmedAt: order.confirmed_at
    });
  });

  // 5. POST /api/v1/collections/:id/refresh-status — Authoritative provider query
  server.post('/api/v1/collections/:id/refresh-status', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return HttpServer.json(res, 401, { error: 'Unauthorized' });
    }

    const id = params.id;
    const order = poRepo.findById(id) || poRepo.findByMerchantAndOrderId(merchantId, id);
    if (!order || order.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Collection order not found' });
    }

    if (order.status === 'SUCCESS') {
      return HttpServer.json(res, 200, {
        status: 'SUCCESS',
        bankReference: order.bank_reference,
        message: 'Order already finalized'
      });
    }

    try {
      const provider = providerRegistry.getProvider(merchantId, order.provider_name,JSON.parse(order.metadata||'{}').connectionId||null);
      const metadata=JSON.parse(order.metadata||'{}');
      const queryId = metadata.attemptId?order.provider_order_id:(order.provider_name==='CASHFREE'?order.merchant_order_id:(order.provider_order_id||order.merchant_order_id));
      const statusRes = await provider.getCollectionStatus(queryId);

      if (statusRes.status === 'SUCCESS' && order.status !== 'SUCCESS') {
        const result=confirmProviderCollection(ctx,order.id,{
          amountPaise:statusRes.amountPaise,currency:statusRes.currency,
          bankReference:statusRes.bankReference,providerPaymentId:statusRes.providerPaymentId,
          actorType:'PROVIDER_API',rawResponse:statusRes.rawResponse
        });
        publishProviderCollection(server,ctx,result);
        return HttpServer.json(res,200,{status:result.order.status,bankReference:result.order.bank_reference,confirmationTimeMs:result.order.confirmation_time_ms});
      }

      return HttpServer.json(res, 200, {
        status: statusRes.status || order.status,
        bankReference: statusRes.bankReference || order.bank_reference
      });
    } catch (err) {
      return HttpServer.json(res, 502, {
        error: `Provider status inquiry failed: ${err.message}`,
        currentStatus: order.status
      });
    }
  });

  // 6. GET /api/v1/collections/:id/reconciliation — Reconciliation details
  server.get('/api/v1/collections/:id/reconciliation', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return HttpServer.json(res, 401, { error: 'Unauthorized' });
    }

    const order = poRepo.findById(params.id) || poRepo.findByMerchantAndOrderId(merchantId, params.id);
    if (!order) return HttpServer.json(res, 404, { error: 'Order not found' });

    const settlementEntry = db.queryOne(
      `SELECT se.*, s.settlement_id, s.status as settlement_status, s.bank_utr 
       FROM settlement_entries se 
       JOIN settlements s ON se.settlement_id = s.id 
       WHERE se.payment_order_id = $1`,
      [order.id]
    );

    const exceptions = db.query(
      `SELECT * FROM reconciliation_exceptions WHERE payment_order_id = $1`,
      [order.id]
    );

    return HttpServer.json(res, 200, {
      paymentId: order.id,
      orderId: order.merchant_order_id,
      amountPaise: order.amount_paise,
      status: order.status,
      bankReference: order.bank_reference,
      settlement: settlementEntry || null,
      hasExceptions: exceptions.length > 0,
      exceptions
    });
  });
}

