import crypto from 'node:crypto';

/**
 * Payment Order Repository
 * Canonical repository for Sanbook Pay real collections, tracking provider order IDs,
 * payment attempts, immutable lifecycle events, and performance latency.
 */
export class PaymentOrderRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO payment_orders (
        id, merchant_id, merchant_order_id, provider_order_id, payment_session_id,
        provider_name, amount_paise, currency, status, customer_name,
        customer_email, customer_phone, checkout_url, payment_method,
        bank_reference, provider_payment_id, provider_response,
        initiation_time_ms, confirmation_time_ms, webhook_delivery_time_ms,
        settlement_time_ms, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
    `;
    const params = [
      id,
      data.merchantId,
      data.merchantOrderId,
      data.providerOrderId || null,
      data.paymentSessionId || null,
      data.providerName || 'CASHFREE',
      data.amountPaise,
      data.currency || 'INR',
      data.status || 'CREATED',
      data.customerName || null,
      data.customerEmail || null,
      data.customerPhone || null,
      data.checkoutUrl || null,
      data.paymentMethod || 'UPI',
      data.bankReference || null,
      data.providerPaymentId || null,
      typeof data.providerResponse === 'string' ? data.providerResponse : JSON.stringify(data.providerResponse || {}),
      data.initiationTimeMs || 0,
      data.confirmationTimeMs || 0,
      data.webhookDeliveryTimeMs || 0,
      data.settlementTimeMs || 0,
      typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata || {})
    ];
    this.db.execute(sql, params);

    // Record initial event
    this.recordEvent({
      paymentOrderId: id,
      eventType: 'ORDER_CREATED',
      previousStatus: null,
      newStatus: data.status || 'CREATED',
      actorType: 'SYSTEM',
      payload: { amountPaise: data.amountPaise, currency: data.currency || 'INR' }
    });

    return this.findById(id);
  }

  findById(id) {
    return this.db.queryOne(`SELECT * FROM payment_orders WHERE id = $1`, [id]);
  }

  findByMerchantAndOrderId(merchantId, merchantOrderId) {
    return this.db.queryOne(
      `SELECT * FROM payment_orders WHERE merchant_id = $1 AND merchant_order_id = $2`,
      [merchantId, merchantOrderId]
    );
  }

  findByProviderOrderId(providerOrderId) {
    return this.db.queryOne(
      `SELECT * FROM payment_orders WHERE provider_order_id = $1`,
      [providerOrderId]
    );
  }

  findByPaymentSessionId(sessionId) {
    return this.db.queryOne(
      `SELECT * FROM payment_orders WHERE payment_session_id = $1`,
      [sessionId]
    );
  }

  update(id, data) {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields = [];
    const params = [];
    let idx = 1;

    const map = {
      providerOrderId: 'provider_order_id',
      paymentSessionId: 'payment_session_id',
      status: 'status',
      checkoutUrl: 'checkout_url',
      paymentMethod: 'payment_method',
      bankReference: 'bank_reference',
      providerPaymentId: 'provider_payment_id',
      initiationTimeMs: 'initiation_time_ms',
      confirmationTimeMs: 'confirmation_time_ms',
      webhookDeliveryTimeMs: 'webhook_delivery_time_ms',
      settlementTimeMs: 'settlement_time_ms',
      confirmedAt: 'confirmed_at'
    };

    for (const [key, col] of Object.entries(map)) {
      if (data[key] !== undefined) {
        fields.push(`${col} = $${idx++}`);
        params.push(data[key]);
      }
    }

    if (data.providerResponse !== undefined) {
      fields.push(`provider_response = $${idx++}`);
      params.push(typeof data.providerResponse === 'string' ? data.providerResponse : JSON.stringify(data.providerResponse));
    }
    if (data.metadata !== undefined) {
      fields.push(`metadata = $${idx++}`);
      params.push(typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata));
    }

    if (fields.length === 0) return existing;

    fields.push(`updated_at = datetime('now')`);
    params.push(id);
    const sql = `UPDATE payment_orders SET ${fields.join(', ')} WHERE id = $${idx}`;
    this.db.execute(sql, params);

    // If status changed, record immutable collection event
    if (data.status && data.status !== existing.status) {
      this.recordEvent({
        paymentOrderId: id,
        eventType: `STATUS_CHANGED_TO_${data.status}`,
        previousStatus: existing.status,
        newStatus: data.status,
        actorType: data.actorType || 'SYSTEM',
        actorId: data.actorId || null,
        payload: {
          bankReference: data.bankReference || existing.bank_reference,
          providerPaymentId: data.providerPaymentId || existing.provider_payment_id
        },
        latencyMs: data.confirmationTimeMs || 0
      });
    }

    return this.findById(id);
  }

  recordAttempt(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO payment_attempts (
        id, payment_order_id, attempt_number, provider_payment_id,
        method, status, bank_reference, error_code, error_message, raw_details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;
    const params = [
      id,
      data.paymentOrderId,
      data.attemptNumber || 1,
      data.providerPaymentId || null,
      data.method || 'UPI',
      data.status || 'INITIATED',
      data.bankReference || null,
      data.errorCode || null,
      data.errorMessage || null,
      typeof data.rawDetails === 'string' ? data.rawDetails : JSON.stringify(data.rawDetails || {})
    ];
    this.db.execute(sql, params);
    return id;
  }

  recordEvent(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO collection_events (
        id, payment_order_id, event_type, previous_status, new_status,
        actor_type, actor_id, payload, latency_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    const params = [
      id,
      data.paymentOrderId,
      data.eventType,
      data.previousStatus || null,
      data.newStatus,
      data.actorType || 'SYSTEM',
      data.actorId || null,
      typeof data.payload === 'string' ? data.payload : JSON.stringify(data.payload || {}),
      data.latencyMs || 0
    ];
    this.db.execute(sql, params);
    return id;
  }

  getEvents(paymentOrderId) {
    return this.db.query(
      `SELECT * FROM collection_events WHERE payment_order_id = $1 ORDER BY created_at ASC`,
      [paymentOrderId]
    );
  }

  listByMerchant(merchantId, options = {}) {
    let sql = `SELECT * FROM payment_orders WHERE merchant_id = $1`;
    const params = [merchantId];
    let idx = 2;

    if (options.status) {
      sql += ` AND status = $${idx++}`;
      params.push(options.status);
    }
    if (options.provider) {
      sql += ` AND provider_name = $${idx++}`;
      params.push(options.provider);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(options.limit || 50, options.offset || 0);

    return this.db.query(sql, params);
  }

  getLatencyMetrics(merchantId) {
    const sql = `
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) as success_orders,
        COUNT(CASE WHEN status = 'SUCCESS' AND confirmation_time_ms <= 60000 THEN 1 END) as under_60s_count,
        AVG(CASE WHEN status = 'SUCCESS' THEN confirmation_time_ms END) as avg_confirmation_ms,
        AVG(CASE WHEN status = 'SUCCESS' THEN initiation_time_ms END) as avg_initiation_ms,
        AVG(CASE WHEN status = 'SUCCESS' THEN webhook_delivery_time_ms END) as avg_webhook_ms
      FROM payment_orders
      WHERE merchant_id = $1
    `;
    return this.db.queryOne(sql, [merchantId]);
  }

  listUnsettled(merchantId) {
    const sql = `
      SELECT po.* FROM payment_orders po
      LEFT JOIN settlement_entries se ON se.payment_order_id = po.id
      WHERE po.merchant_id = $1 AND po.status = 'SUCCESS' AND se.id IS NULL
      ORDER BY po.created_at ASC
    `;
    return this.db.query(sql, [merchantId]);
  }
}


