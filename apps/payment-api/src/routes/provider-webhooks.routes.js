import crypto from 'node:crypto';
import {encryptAtRest} from '@youpi/common';
import { toPaise } from '@youpi/common';
import { confirmProviderCollection, publishProviderCollection } from '../services/provider-confirmation.js';
import { HttpServer } from '../server.js';
import {
  PaymentOrderRepository,
  PayoutRepository,
  LedgerRepository
} from '@youpi/db';
import { ProviderRegistry } from '@youpi/core';
import { SecurityMiddleware } from '@youpi/core';

/**
 * Provider Webhook Ingress Routes
 * Handles authoritative server-to-server callbacks from Cashfree, PhonePe, and Paytm PG.
 *
 * Security:
 *   • IP allowlisting (PSP documented callback IPs)
 *   • HMAC signature verification over raw body
 *   • Acknowledge-first: respond 200 immediately, then process in background
 *   • Idempotent event dedup via event hash
 */
export function registerProviderWebhooksRoutes(server, ctx) {
  const db = ctx.db;
  const poRepo = new PaymentOrderRepository(db);
  const payoutRepo = new PayoutRepository(db);
  const ledgerRepo = new LedgerRepository(db);
  const providerRegistry = new ProviderRegistry({ db });
  const ipAllowlist = new SecurityMiddleware.IpAllowlist(
    process.env.WEBHOOK_ALLOWED_IPS ? process.env.WEBHOOK_ALLOWED_IPS.split(',').map(s => s.trim()).filter(Boolean) : []
  );
  db.execute(`CREATE TABLE IF NOT EXISTS pp_provider_events(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,payment_order_id TEXT NOT NULL,provider_name TEXT NOT NULL,provider_payment_id TEXT,event_type TEXT NOT NULL,payload_encrypted TEXT NOT NULL,status TEXT NOT NULL,received_at TEXT NOT NULL)`);

  // Helper: acknowledge-first webhook processor shared across PSPs
  async function handleProviderWebhook(req, res, providerName) {
    // 1. IP allowlist check
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                     req.headers['x-real-ip']?.trim() ||
                     req.socket?.remoteAddress ||
                     '';
    if (!ipAllowlist.isAllowed(clientIp)) {
      return HttpServer.json(res, 403, { error: 'Webhook source IP not in allowlist' });
    }

    // 2. Read raw body (do NOT parse before signature check)
    let rawBody;
    try {
      rawBody = await HttpServer.parseRawBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Failed to read request body' });
    }

    // 3. Respond 200 IMMEDIATELY (acknowledge-first), then process in background.
    // PSPs retry on non-2xx; returning 200 stops retry storms and gives real-time callback feel.
    const ackSent = new Promise(resolve => {
      res.on('close', () => resolve());
      res.on('error', () => resolve());
      setTimeout(() => resolve(), 5000);
    });

    // 4. Process in background (fire and forget — does not block the HTTP response)
    (async () => {
      try {
        let payload;
        try { payload = JSON.parse(rawBody); } catch {
          console.error(`[${providerName} webhook] Malformed JSON payload`);
          return;
        }

        let merchantOrderId;
        let paymentData;
        let eventType;

        if (providerName === 'PHONEPE') {
          const provider = providerRegistry.getProvider('x', 'PHONEPE');
          const decoded = provider.decodeWebhookResponse?.(rawBody);
          if (!decoded) { console.error(`[PhonePe webhook] Failed to decode response`); return; }
          merchantOrderId = decoded.merchantTransactionId;
          paymentData = { ...decoded.rawResponse, payment_status: decoded.state, cf_payment_id: decoded.transactionId, bank_reference: decoded.transactionId, payment_amount: decoded.amountPaise / 100, payment_currency: 'INR' };
          eventType = decoded.state;
        } else if (providerName === 'PAYTM') {
          const provider = providerRegistry.getProvider('x', 'PAYTM');
          const decoded = provider.decodeWebhookResponse?.(rawBody);
          if (!decoded) { console.error(`[Paytm webhook] Failed to decode response`); return; }
          merchantOrderId = decoded.merchantTransactionId;
          paymentData = { ...decoded.rawResponse, payment_status: decoded.state, cf_payment_id: decoded.transactionId, bank_reference: decoded.transactionId, payment_amount: decoded.amountPaise / 100, payment_currency: 'INR' };
          eventType = decoded.state;
        } else {
          // Cashfree
          const orderData = payload.data?.order || payload.order || payload.data || {};
          paymentData = payload.data?.payment || payload.payment || {};
          merchantOrderId = orderData.order_id || payload.order_id;
          eventType = payload.type || paymentData.payment_status || 'UNKNOWN';
        }

        if (!merchantOrderId) {
          console.error(`[${providerName} webhook] Missing order_id`);
          return;
        }

        const candidates = db.query("SELECT * FROM payment_orders WHERE (provider_order_id=? OR merchant_order_id=?) AND provider_name=?", [merchantOrderId, merchantOrderId, providerName]);
        if (candidates.length > 1) {
          console.error(`[${providerName} webhook] Ambiguous provider order reference`);
          return;
        }
        const order = candidates[0];
        if (!order) {
          console.error(`[${providerName} webhook] Payment order ${merchantOrderId} not found`);
          return;
        }

        const merchantId = order.merchant_id;
        const connectionId = JSON.parse(order.metadata || '{}').connectionId || null;
        const provider = providerRegistry.getProvider(merchantId, providerName, connectionId);

        // Authoritative HMAC signature verification over raw body
        const isValid = provider.verifyCollectionWebhook({ rawBody, headers: req.headers });
        if (!isValid) {
          console.error(`[${providerName} webhook] Invalid signature for order ${merchantOrderId}`);
          return;
        }

        // Idempotent event dedup
        const eventId = crypto.createHash('sha256').update(rawBody).digest('hex');
        db.execute('INSERT INTO pp_provider_events(id,merchant_id,payment_order_id,provider_name,provider_payment_id,event_type,payload_encrypted,status,received_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
          [eventId, merchantId, order.id, providerName, paymentData?.cf_payment_id ? String(paymentData.cf_payment_id) : null, eventType, encryptAtRest(rawBody.toString()), 'RECEIVED', new Date().toISOString()]);

        const paymentStatus = paymentData.payment_status;
        if (paymentStatus === 'SUCCESS') {
          let amountPaise;
          try { amountPaise = Number(toPaise(paymentData.payment_amount)); } catch { console.error(`[${providerName} webhook] Invalid amount`); return; }
          try {
            const result = confirmProviderCollection(ctx, order.id, {
              amountPaise,
              currency: paymentData.payment_currency || 'INR',
              bankReference: paymentData.bank_reference || null,
              providerPaymentId: paymentData.cf_payment_id ? String(paymentData.cf_payment_id) : null,
              actorType: 'PROVIDER_WEBHOOK',
              rawResponse: payload
            });
            publishProviderCollection(server, ctx, result);
            db.execute('UPDATE pp_provider_events SET status=? WHERE id=?', ['PROCESSED', eventId]);
          } catch (error) {
            db.execute('UPDATE pp_provider_events SET status=? WHERE id=?', ['RECONCILIATION_REQUIRED', eventId]);
            console.error(`[${providerName} webhook] Confirmation failed:`, error.message);
          }
        } else if (paymentStatus === 'FAILED') {
          db.transaction(() => {
            const current = db.queryOne(`SELECT * FROM payment_orders WHERE id=?${db.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, [order.id]);
            if (current.status === 'SUCCESS' || current.status === 'FAILED') return;
            poRepo.update(order.id, { status: 'FAILED', actorType: 'PROVIDER_WEBHOOK', providerResponse: payload });
          });
          server.broadcastSse(`console_${merchantId}`, 'activity', { paymentId: order.id });
        }
      } catch (err) {
        console.error(`[${providerName} webhook] Processing error:`, err.message);
      }
    })();

    // 5. Return 200 immediately — do NOT wait for background processing
    return HttpServer.json(res, 200, { received: true });
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
