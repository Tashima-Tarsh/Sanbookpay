import crypto from 'node:crypto';
import { generateHmac, toRupeesString, validateOutboundWebhookUrl } from '@youpi/common';
import { isTerminalStatus, toPublicOutcome } from './state-machine.js';

export class WebhookEngine {
  /**
   * @param {{
   *   db: import('@youpi/db').Database,
   *   merchantRepo: import('@youpi/db').MerchantRepository,
   *   maxRetries?: number,
   *   deliveryTable?: string
   * }} options
   */
  constructor(options) {
    this.db = options.db;
    this.merchantRepo = options.merchantRepo;
    this.maxRetries = options.maxRetries || 5;
    this.deliveryTable = options.deliveryTable === 'provider_webhook_deliveries' ? 'provider_webhook_deliveries' : 'webhook_deliveries';
    this.inFlight = new Set();
    this.controllers = new Set();
    this.stopped = false;
  }

  stop() { this.stopped=true;for(const controller of this.controllers)controller.abort(); }

  /**
   * Formats and dispatches a signed webhook for a payment event.
   * @param {string} event E.g. 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED'
   * @param {any} session The payment session entity
   * @returns {Promise<{ delivered: boolean, deliveryId: string, status?: number, error?: string }>}
   */
  async dispatch(event, session) {
    const queued = this.enqueue(event, session);
    if (!queued.deliveryId) return queued;
    const result = await this.retryPending(queued.deliveryId);
    const sent = result[0];
    return { delivered:sent?.success || false, deliveryId:queued.deliveryId, status:sent?.status, error:sent?.error };
  }

  enqueue(event, session) {
    if(this.stopped) throw new Error('Webhook engine is stopped');
    const merchant = this.merchantRepo.findById(session.merchantId);
    if (!merchant || !merchant.webhookUrl) {
      return { delivered: false, deliveryId: '', error: 'No webhook URL configured for merchant.' };
    }

    // Re-validate at dispatch time, not only on write: a URL persisted before validation
    // existed must not be usable to reach loopback/private addresses (SSRF).
    const endpointCheck = validateOutboundWebhookUrl(merchant.webhookUrl);
    if (!endpointCheck.valid) {
      return { delivered: false, deliveryId: '', error: `Webhook delivery blocked: ${endpointCheck.error}` };
    }

    const publicOutcome = isTerminalStatus(event) ? toPublicOutcome(event) : event;

    const bank=session.attributedObservationId?this.db.queryOne('SELECT bank_reference_number,sender_vpa FROM payment_observations WHERE id=?',[session.attributedObservationId]):null;
    const snapshot=session.metadata?.receivingAccountSnapshot||{};
    const payloadObj = {
      event: publicOutcome,
      paymentId: session.id,
      orderId: session.orderId,
      amount: toRupeesString(session.amountPaise),
      amountPaise: Number(session.amountPaise),
      currency: session.currency || 'INR',
      method: session.method || 'UPI',
      transaction:session.id,
      uniquetransactionid:session.orderId,
      status:publicOutcome==='SUCCESS'?'SUCCESS':'FAILED',
      bankReferenceNumber:bank?.bank_reference_number||session.bankReference||null,
      utr:bank?.bank_reference_number||session.bankReference||null,
      senderVpa:bank?.sender_vpa||null,
      payeeVpa:snapshot.upiId||null,
      beneficiary:{name:snapshot.payeeName||null,upiId:snapshot.upiId||null},
      confirmationSource:session.confirmationSource||(session.verificationTag==='MERCHANT_CONFIRMED'?'MERCHANT':session.verificationLevel?'BANK_OBSERVER':null),
      completedAt: session.completedAt ? session.completedAt.toISOString() : new Date().toISOString(),
      metadata: session.metadata || {}
    };

    const payloadString = JSON.stringify(payloadObj);
    const deliveryId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    this.db.execute(`
      INSERT INTO ${this.deliveryTable} (
        id, merchant_id, payment_id, event_type, payload, endpoint_url,
        response_status, response_body, attempt_count, is_successful, next_retry_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `, [
      deliveryId,
      merchant.id,
      session.id,
      publicOutcome,
      payloadString,
      merchant.webhookUrl,
      null,
      null,
      0,
      nowIso,
      nowIso
    ]);

    return {
      delivered: false,
      deliveryId
    };
  }

  /**
   * Retries overdue pending webhook deliveries with exponential backoff.
   * Backoff strategy: 5s, 30s, 2m, 10m, 1h
   */
  async retryPending(deliveryId = null) {
    if(this.stopped)return [];
    const nowIso = new Date().toISOString();
    const pending = this.db.query(`
      SELECT * FROM ${this.deliveryTable}
      WHERE is_successful = 0 AND attempt_count < ? AND next_retry_at <= ?
      ${deliveryId ? 'AND id = ?' : ''} ORDER BY created_at ASC LIMIT 20
    `, deliveryId ? [this.maxRetries, nowIso, deliveryId] : [this.maxRetries, nowIso]);

    const results = [];
    const backoffs = [5000, 30000, 120000, 600000, 3600000];

    for (const item of pending) {
      if (this.inFlight.has(item.id)) continue;
      const merchant = this.merchantRepo.findById(item.merchant_id);
      if (!merchant || !item.endpoint_url) continue;

      // Re-validate the stored endpoint before every retry (SSRF guard).
      const retryEndpoint = validateOutboundWebhookUrl(item.endpoint_url);
      if (!retryEndpoint.valid) continue;

      this.inFlight.add(item.id);
      const controller=new AbortController();this.controllers.add(controller);
      try {

      const signature = generateHmac(item.payload, merchant.webhookSecret);
      const timestamp = Date.now().toString();

      let isSuccess = false;
      let respStatus = null;
      let respBody = null;

      try {
        const res = await fetch(retryEndpoint.url.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Event': item.event_type,
            'X-Gateway-Signature': `sha256=${signature}`,
            'X-Gateway-Delivery-Id': item.id,
            'X-Gateway-Timestamp': timestamp
          },
          body: item.payload,
          redirect: 'manual',
          signal: AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])
        });
        respStatus = res.status;
        respBody = (await res.text()).substring(0, 1000);
        isSuccess = res.ok;
      } catch (err) {
        respBody = err.message;
      }

      if(this.stopped)break;
      const nextAttempt = item.attempt_count + 1;
      const nextRetryDelay = backoffs[Math.min(nextAttempt - 1, backoffs.length - 1)];
      const nextRetryAt = isSuccess || nextAttempt >= this.maxRetries
        ? null
        : new Date(Date.now() + nextRetryDelay).toISOString();

      this.db.execute(`
        UPDATE ${this.deliveryTable}
        SET attempt_count = ?, is_successful = ?, response_status = ?,
            response_body = ?, next_retry_at = ?
        WHERE id = ?
      `, [nextAttempt, isSuccess ? 1 : 0, respStatus, respBody, nextRetryAt, item.id]);

      results.push({ id: item.id, success: isSuccess, attempt: nextAttempt, status:respStatus, error:isSuccess?undefined:respBody });
      } finally { this.inFlight.delete(item.id);this.controllers.delete(controller); }
    }

    return results;
  }
}
