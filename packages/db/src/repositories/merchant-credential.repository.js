import crypto from 'node:crypto';

/**
 * Merchant Credential Repository
 * Manages production API keys (scoped keys, live/test)
 */
export class MerchantCredentialRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO merchant_credentials (
        id, merchant_id, key_type, api_key, api_secret_hash, permissions, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    const params = [
      id,
      data.merchantId,
      data.keyType || 'LIVE',
      data.apiKey,
      data.apiSecretHash || '',
      typeof data.permissions === 'string' ? data.permissions : JSON.stringify(data.permissions || ['collections', 'payouts', 'refunds']),
      data.status || 'ACTIVE'
    ];
    this.db.execute(sql, params);
    return this.findById(id);
  }

  findById(id) {
    return this.db.queryOne(`SELECT * FROM merchant_credentials WHERE id = $1`, [id]);
  }

  findByApiKey(apiKey) {
    return this.db.queryOne(`SELECT * FROM merchant_credentials WHERE api_key = $1 AND status = 'ACTIVE' AND revoked_at IS NULL`, [apiKey]);
  }

  findByMerchantId(merchantId) {
    return this.db.query(`SELECT * FROM merchant_credentials WHERE merchant_id = $1 ORDER BY created_at DESC`, [merchantId]);
  }

  revoke(id) {
    const sql = `UPDATE merchant_credentials SET status = 'REVOKED', revoked_at = datetime('now') WHERE id = $1`;
    this.db.execute(sql, [id]);
    return this.findById(id);
  }
}

