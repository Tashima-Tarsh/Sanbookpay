import crypto from 'node:crypto';

export class CallbackDeliveryAttemptRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || `cbatt_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    this.db.execute(`
      INSERT INTO callback_delivery_attempts (
        id, outbox_id, attempt_number, status_code, response_body,
        latency_ms, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, data.outboxId, data.attemptNumber, data.statusCode || null,
      data.responseBody || null, data.latencyMs || null,
      data.errorMessage || null, now
    ]);

    return this.findById(id);
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM callback_delivery_attempts WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findByOutbox(outboxId, limit = 50) {
    const rows = this.db.query(
      'SELECT * FROM callback_delivery_attempts WHERE outbox_id = ? ORDER BY attempt_number ASC LIMIT ?',
      [outboxId, limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  mapRow(row) {
    return {
      id: row.id,
      outboxId: row.outbox_id,
      attemptNumber: row.attempt_number,
      statusCode: row.status_code,
      responseBody: row.response_body,
      latencyMs: row.latency_ms,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at)
    };
  }
}
