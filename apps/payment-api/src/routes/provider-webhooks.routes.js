import { toPaise } from '@youpi/common';
import { confirmProviderCollection, publishProviderCollection } from '../services/provider-confirmation.js';
import { HttpServer } from '../server.js';
import {
  PaymentOrderRepository,
  PayoutRepository,
  LedgerRepository
} from '@youpi/db';
import { ProviderRegistry } from '@youpi/core';

/**
 * Provider Webhook Ingress Routes
 * Handles authoritative server-to-server callbacks from Cashfree PG and Payouts.
 */
export function registerProviderWebhooksRoutes(server, ctx) {
  const db = ctx.db;
  const poRepo = new PaymentOrderRepository(db);
  const payoutRepo = new PayoutRepository(db);
  const ledgerRepo = new LedgerRepository(db);
  const providerRegistry = new ProviderRegistry({ db });


  // 1. POST /api/v1/webhooks/cashfree/collections — Ingress for Cashfree PG Webhooks
  server.post('/api/v1/webhooks/cashfree/collections', async (req, res) => {
    let rawBody;
    try {
      rawBody = await HttpServer.parseRawBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Failed to read request body' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return HttpServer.json(res, 400, { error: 'Malformed JSON payload' });
    }

    if(!payload || typeof payload!=='object' || Array.isArray(payload)) return HttpServer.json(res,400,{error:'A JSON object is required'});
    const orderData = payload.data?.order || payload.order || payload.data || {};
    const paymentData = payload.data?.payment || payload.payment || {};
    const merchantOrderId = orderData.order_id || payload.order_id;

    if (!merchantOrderId) {
      return HttpServer.json(res, 400, { error: 'Missing order_id in webhook payload' });
    }

    const candidates = db.query("SELECT * FROM payment_orders WHERE (provider_order_id=? OR merchant_order_id=?) AND provider_name='CASHFREE'", [merchantOrderId,merchantOrderId]);
    if(candidates.length>1) return HttpServer.json(res,409,{error:'Ambiguous provider order reference'});
    const order = candidates[0];

    if (!order) {
      return HttpServer.json(res, 404, { error: `Payment order ${merchantOrderId} not found` });
    }

    const merchantId = order.merchant_id;
    const provider = providerRegistry.getProvider(merchantId, 'CASHFREE');

    // Authoritative HMAC signature verification
    const isValid = provider.verifyCollectionWebhook({
      rawBody,
      headers: req.headers
    });

    if (!isValid) {
      return HttpServer.json(res, 401, { error: 'Invalid Cashfree webhook signature' });
    }

    const paymentStatus = paymentData.payment_status;
    if (paymentStatus === 'SUCCESS') {
      let amountPaise;
      try { amountPaise=Number(toPaise(paymentData.payment_amount)); }
      catch { return HttpServer.json(res,400,{error:'Invalid provider payment amount'}); }
      try {
        const result=confirmProviderCollection(ctx,order.id,{
          amountPaise,currency:paymentData.payment_currency,
          bankReference:paymentData.bank_reference||null,
          providerPaymentId:paymentData.cf_payment_id ? String(paymentData.cf_payment_id) : null,
          actorType:'PROVIDER_WEBHOOK',rawResponse:payload
        });
        publishProviderCollection(server,ctx,result);
      } catch(error) {
        console.error('[Provider confirmation]',error.message);
        return HttpServer.json(res,409,{error:'Payment confirmation could not be reconciled. Retry or review the order.'});
      }
    } else if (paymentStatus === 'FAILED') {
      // A failed attempt can precede a successful retry on the same provider order.
      db.transaction(()=>{
        const current=db.queryOne(`SELECT * FROM payment_orders WHERE id=?${db.dialect==='postgres'?' FOR UPDATE':''}`,[order.id]);
        if(current.status==='SUCCESS'||current.status==='FAILED')return;
        poRepo.update(order.id,{status:'FAILED',actorType:'PROVIDER_WEBHOOK',providerResponse:payload});
      });
      server.broadcastSse(`console_${merchantId}`,'activity',{paymentId:order.id});
    }

    return HttpServer.json(res, 200, { received: true });
  });

  // 2. POST /api/v1/webhooks/cashfree/payouts — Ingress for Cashfree Payout Webhooks
  server.post('/api/v1/webhooks/cashfree/payouts', async (req, res) => {
    let rawBody;
    try {
      rawBody = await HttpServer.parseRawBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Failed to read request body' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return HttpServer.json(res, 400, { error: 'Malformed JSON payload' });
    }

    if(!payload || typeof payload!=='object' || Array.isArray(payload)) return HttpServer.json(res,400,{error:'A JSON object is required'});
    const transferId = payload.transferId || payload.data?.transferId || payload.data?.transfer?.transferId;
    if (!transferId) {
      return HttpServer.json(res, 400, { error: 'Missing transferId in webhook' });
    }

    const payout = payoutRepo.findByTransferId(transferId);
    if (!payout) {
      return HttpServer.json(res, 404, { error: `Payout transfer ${transferId} not found` });
    }

    const merchantId = payout.merchant_id;
    const provider = providerRegistry.getProvider(merchantId, 'CASHFREE');

    const isValid = provider.verifyCollectionWebhook({ rawBody, headers: req.headers });
    if (!isValid) {
      return HttpServer.json(res, 401, { error: 'Invalid Cashfree payout webhook signature' });
    }

    const rawStatus = (payload.status || payload.data?.status || '').toUpperCase();
    const utr = payload.utr || payload.data?.utr || null;

    db.transaction(()=>{
    const current=db.queryOne(`SELECT status FROM payouts WHERE id=?${db.dialect==='postgres'?' FOR UPDATE':''}`,[payout.id]);
    if(['SUCCESS','FAILED'].includes(current.status))return;
    if (rawStatus === 'SUCCESS') {
      payoutRepo.update(payout.id, {
        status: 'SUCCESS',
        utr,
        confirmedAt: new Date().toISOString()
      });

      // Ledger: Transfer confirmed at bank. Debit BANK_CASH (or PAYOUTS_SETTLED), Credit PAYOUTS_IN_TRANSIT
      ledgerRepo.recordDoubleEntry(
          merchantId,
          'PAYOUT',
          payout.id,
          `Payout confirmed by bank. UTR: ${utr || 'N/A'}`,
          'BANK_CASH',
          'PAYOUTS_IN_TRANSIT',
          payout.amount_paise
        );

    } else if ((rawStatus === 'FAILED' || rawStatus === 'REJECTED') ) {
      payoutRepo.update(payout.id, {
        status: 'FAILED',
        failureReason: payload.reason || payload.data?.reason || 'Provider declined transfer'
      });
      // Reversal in ledger: Debit PAYOUT_FUNDING, Credit PAYOUTS_IN_TRANSIT
      ledgerRepo.recordDoubleEntry(
          merchantId,
          'REVERSAL',
          payout.id,
          `Payout failed/reversed. Ref: ${transferId}`,
          'PAYOUT_FUNDING',
          'PAYOUTS_IN_TRANSIT',
          payout.amount_paise
        );

    }

    });

    return HttpServer.json(res, 200, { received: true });
  });
}

