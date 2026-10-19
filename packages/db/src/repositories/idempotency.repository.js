/**
 * Idempotency Repository
 * Prevents double-debit and duplicate processing of financial instructions.
 */
export class IdempotencyRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  get(key, merchantId) {
    const sql = `
      SELECT * FROM idempotency_keys 
      WHERE key = $1 AND merchant_id = $2 AND datetime(expires_at) > datetime('now')
    `;
    const record = this.db.queryOne(sql, [key, merchantId]);
    if (!record) return null;
    return {
      key: record.key,
      merchantId: record.merchant_id,
      scope: record.scope,
      requestHash: record.request_hash,
      responsePayload: JSON.parse(record.response_payload),
      statusCode: record.status_code
    };
  }

  set(key, merchantId, scope, requestHash, responsePayload, statusCode = 200, ttlSeconds = 86400) {
    const sql = `
      INSERT INTO idempotency_keys (key, merchant_id, scope, request_hash, response_payload, status_code, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, datetime('now', '+' || $7 || ' seconds'))
      ON CONFLICT(key) DO UPDATE SET
        response_payload = excluded.response_payload,
        status_code = excluded.status_code,
        expires_at = excluded.expires_at
    `;
    const payloadStr = typeof responsePayload === 'string' ? responsePayload : JSON.stringify(responsePayload);
    this.db.execute(sql, [key, merchantId, scope, requestHash, payloadStr, statusCode, ttlSeconds]);
  }
}

