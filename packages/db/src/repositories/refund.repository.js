import crypto from 'node:crypto';

/**
 * Refund Repository
 * Manages provider refunds and reverses payment states.
 */
export class RefundRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO refunds (
        id, merchant_id, payment_order_id, refund_id, provider_refund_id,
        amount_paise, currency, reason, status, utr, provider_response
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;
    const params = [
      id,
      data.merchantId,
      data.paymentOrderId || null,
      data.refundId,
      data.providerRefundId || null,
      data.amountPaise,
      data.currency || 'INR',
      data.reason || null,
      data.status || 'PENDING',
      data.utr || null,
      typeof data.providerResponse === 'string' ? data.providerResponse : JSON.stringify(data.providerResponse || {})
    ];
    this.db.execute(sql, params);
    return this.findById(id);
  }

  findById(id) {
    return this.db.queryOne(`SELECT * FROM refunds WHERE id = $1`, [id]);
  }

  findByRefundId(refundId) {
    return this.db.queryOne(`SELECT * FROM refunds WHERE refund_id = $1`, [refundId]);
  }

  findByPaymentOrderId(orderId) {
    return this.db.query(`SELECT * FROM refunds WHERE payment_order_id = $1 ORDER BY created_at DESC`, [orderId]);
  }

  update(id, data) {
    const fields = [];
    const params = [];
    let idx = 1;

    const map = {
      providerRefundId: 'provider_refund_id',
      status: 'status',
      utr: 'utr',
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

    if (fields.length === 0) return this.findById(id);

    params.push(id);
    const sql = `UPDATE refunds SET ${fields.join(', ')} WHERE id = $${idx}`;
    this.db.execute(sql, params);
    return this.findById(id);
  }

  listByMerchant(merchantId, options = {}) {
    let sql = `SELECT * FROM refunds WHERE merchant_id = $1`;
    const params = [merchantId];
    let idx = 2;

    if (options.status) {
      sql += ` AND status = $${idx++}`;
      params.push(options.status);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(options.limit || 50, options.offset || 0);

    return this.db.query(sql, params);
  }
}

