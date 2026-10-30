import { HttpServer } from '../server.js';
import {
  PaymentOrderRepository,
  PayoutRepository,
  LedgerRepository,
  MerchantRepository
} from '@youpi/db';
import { ProviderRegistry } from '@youpi/core';
import { WebhookEngine } from '@youpi/core';

/**
 * Provider Webhook Ingress Routes
 * Handles authoritative server-to-server callbacks from Cashfree PG and Payouts.
 */
export function registerProviderWebhooksRoutes(server, ctx) {
  const db = ctx.db;
  const poRepo = new PaymentOrderRepository(db);
  const payoutRepo = new PayoutRepository(db);
  const ledgerRepo = new LedgerRepository(db);
  const merchantRepo = new MerchantRepository(db);
  const providerRegistry = new ProviderRegistry({ db });
  const webhookEngine = new WebhookEngine({ db });

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

    const orderData = payload.data?.order || payload.order || payload.data || {};
    const paymentData = payload.data?.payment || payload.payment || {};
    const merchantOrderId = orderData.order_id || payload.order_id;

    if (!merchantOrderId) {
      return HttpServer.json(res, 400, { error: 'Missing order_id in webhook payload' });
    }

    const order = poRepo.findByProviderOrderId(merchantOrderId) ||
      db.queryOne(`SELECT * FROM payment_orders WHERE merchant_order_id = $1`, [merchantOrderId]);

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

    // Process payment success / failure
    const paymentStatus = paymentData.payment_status || orderData.order_status || payload.event;
    const utr = paymentData.bank_reference || paymentData.payment_gateway_details?.gateway_order_id || null;
    const providerPaymentId = paymentData.cf_payment_id ? String(paymentData.cf_payment_id) : null;
    const isSuccess = paymentStatus === 'SUCCESS' || paymentStatus === 'PAID' || payload.type === 'PAYMENT_SUCCESS_WEBHOOK';

    if (isSuccess && order.status !== 'SUCCESS') {
      const confirmedAt = new Date().toISOString();
      const confirmationTimeMs = Date.now() - new Date(order.created_at).getTime();

      poRepo.update(order.id, {
        status: 'SUCCESS',
        bankReference: utr,
        providerPaymentId,
        confirmedAt,
        confirmationTimeMs,
        actorType: 'PROVIDER_WEBHOOK',
        providerResponse: payload
      });

      // Also update linked legacy payment_sessions if present
      if (order.payment_session_id) {
        try {
          db.execute(
            `UPDATE payment_sessions SET status = 'SUCCESS', completed_at = datetime('now') WHERE id = $1`,
            [order.payment_session_id]
          );
        } catch {}
      }

      // Update financial ledger
      ctx.eventEmitter?.emit('PAYMENT.PROVIDER_SUCCESS', { paymentOrderId:order.id });
      try {
        ledgerRepo.recordDoubleEntry(
          merchantId,
          'COLLECTION',
          order.id,
          `Collection confirmed via Cashfree webhook. UTR: ${utr || 'N/A'}`,
          'PROVIDER_CLEARING',
          'MERCHANT_RECEIVABLES',
          order.amount_paise
        );
      } catch {}

      // Dispatch outgoing merchant webhook
      const merchant = merchantRepo.findById(merchantId);
      if (merchant?.webhook_url) {
        try {
          const startTime = Date.now();
          await webhookEngine.dispatch({
            merchantId,
            paymentId: order.id,
            eventType: 'payment.success',
            payload: {
              event: 'SUCCESS',
              paymentId: order.id,
              orderId: order.merchant_order_id,
              amount: (order.amount_paise / 100).toFixed(2),
              amountPaise: order.amount_paise,
              currency: order.currency,
              method: order.payment_method || 'UPI',
              utr,
              completedAt: confirmedAt,
              metadata: typeof order.metadata === 'string' ? JSON.parse(order.metadata || '{}') : order.metadata
            },
            endpointUrl: merchant.webhook_url,
            secret: merchant.webhook_secret
          });
          poRepo.update(order.id, { webhookDeliveryTimeMs: Date.now() - startTime });
        } catch {}
      }

      // Broadcast SSE event for real-time customer UI
      server.broadcastSse(order.id, 'payment_status', {
        status: 'SUCCESS',
        bankReference: utr,
        orderId: order.merchant_order_id
      });
      if (order.payment_session_id) {
        server.broadcastSse(order.payment_session_id, 'payment_status', {
          status: 'SUCCESS',
          bankReference: utr
        });
      }
    } else if (paymentStatus === 'FAILED' && order.status !== 'FAILED') {
      poRepo.update(order.id, {
        status: 'FAILED',
        actorType: 'PROVIDER_WEBHOOK',
        providerResponse: payload
      });
      server.broadcastSse(order.id, 'payment_status', { status: 'FAILED' });
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

    if (rawStatus === 'SUCCESS' && payout.status !== 'SUCCESS') {
      payoutRepo.update(payout.id, {
        status: 'SUCCESS',
        utr,
        confirmedAt: new Date().toISOString()
      });

      // Ledger: Transfer confirmed at bank. Debit BANK_CASH (or PAYOUTS_SETTLED), Credit PAYOUTS_IN_TRANSIT
      try {
        ledgerRepo.recordDoubleEntry(
          merchantId,
          'PAYOUT',
          payout.id,
          `Payout confirmed by bank. UTR: ${utr || 'N/A'}`,
          'BANK_CASH',
          'PAYOUTS_IN_TRANSIT',
          payout.amount_paise
        );
      } catch {}
    } else if ((rawStatus === 'FAILED' || rawStatus === 'REJECTED') && payout.status !== 'FAILED') {
      payoutRepo.update(payout.id, {
        status: 'FAILED',
        failureReason: payload.reason || payload.data?.reason || 'Provider declined transfer'
      });
      // Reversal in ledger: Debit PAYOUT_FUNDING, Credit PAYOUTS_IN_TRANSIT
      try {
        ledgerRepo.recordDoubleEntry(
          merchantId,
          'REVERSAL',
          payout.id,
          `Payout failed/reversed. Ref: ${transferId}`,
          'PAYOUT_FUNDING',
          'PAYOUTS_IN_TRANSIT',
          payout.amount_paise
        );
      } catch {}
    }

    return HttpServer.json(res, 200, { received: true });
  });
}

