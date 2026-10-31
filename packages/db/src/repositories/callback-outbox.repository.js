import crypto from 'node:crypto';

export class CallbackOutboxRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || `cbout_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const nextRetryAt = data.nextRetryAt || new Date(Date.now() + 5000).toISOString();

    this.db.execute(`
      INSERT INTO callback_outbox (
        id, merchant_id, payment_id, event_type, payload, endpoint_url,
        idempotency_key, status, attempts, max_attempts, next_retry_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, data.merchantId, data.paymentId || null, data.eventType, data.payload,
      data.endpointUrl, data.idempotencyKey, data.status || 'PENDING',
      data.attempts || 0, data.maxAttempts || 5, nextRetryAt, now, now
    ]);

    return this.findById(id);
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM callback_outbox WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findByIdempotencyKey(idempotencyKey) {
    const row = this.db.queryOne(
      'SELECT * FROM callback_outbox WHERE idempotency_key = ?',
      [idempotencyKey]
    );
    return row ? this.mapRow(row) : null;
  }

  findPending(limit = 100) {
    const now = new Date().toISOString();
    const rows = this.db.query(
      'SELECT * FROM callback_outbox WHERE status = ? AND next_retry_at <= ? ORDER BY next_retry_at ASC LIMIT ?',
      ['PENDING', now, limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  findByMerchant(merchantId, status = null, limit = 50) {
    let sql = 'SELECT * FROM callback_outbox WHERE merchant_id = ?';
    const params = [merchantId];
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const rows = this.db.query(sql, params);
    return rows.map(r => this.mapRow(r));
  }

  updateStatus(id, data) {
    const fields = [];
    const values = [];

    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
    if (data.attempts !== undefined) { fields.push('attempts = ?'); values.push(data.attempts); }
    if (data.nextRetryAt !== undefined) { fields.push('next_retry_at = ?'); values.push(data.nextRetryAt); }
    if (data.deliveredAt !== undefined) { fields.push('delivered_at = ?'); values.push(data.deliveredAt); }
    if (data.lastError !== undefined) { fields.push('last_error = ?'); values.push(data.lastError); }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.execute(`UPDATE callback_outbox SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  mapRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      paymentId: row.payment_id,
      eventType: row.event_type,
      payload: row.payload,
      endpointUrl: row.endpoint_url,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at) : null,
      deliveredAt: row.delivered_at ? new Date(row.delivered_at) : null,
      lastError: row.last_error,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
