import crypto from 'node:crypto';

/**
 * Provider Connection Repository
 * Manages bank and payment provider connections (Cashfree, HDFC, ICICI, etc.)
 */
export class ProviderConnectionRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Creates a provider connection.
   */
  create(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO provider_connections (
        id, merchant_id, provider_name, environment, business_merchant_id,
        client_id, client_secret_encrypted, approved_account_id, merchant_vpa,
        corporate_id, terminal_id, public_key_pem, private_key_encrypted,
        webhook_url, webhook_secret_encrypted, ip_allowlist, status,
        last_tested_at, test_result, diagnostics, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    `;
    const params = [
      id,
      data.merchantId,
      data.providerName.toUpperCase(),
      data.environment || 'PRODUCTION',
      data.businessMerchantId || null,
      data.clientId || null,
      data.clientSecretEncrypted || null,
      data.approvedAccountId || null,
      data.merchantVpa || null,
      data.corporateId || null,
      data.terminalId || null,
      data.publicKeyPem || null,
      data.privateKeyEncrypted || null,
      data.webhookUrl || null,
      data.webhookSecretEncrypted || null,
      typeof data.ipAllowlist === 'string' ? data.ipAllowlist : JSON.stringify(data.ipAllowlist || []),
      data.status || 'NOT CONFIGURED',
      data.lastTestedAt || null,
      data.testResult || null,
      typeof data.diagnostics === 'string' ? data.diagnostics : JSON.stringify(data.diagnostics || {}),
      data.isActive !== undefined ? (data.isActive ? 1 : 0) : 1
    ];
    this.db.execute(sql, params);
    return this.findById(id);
  }

  findById(id) {
    const sql = `SELECT * FROM provider_connections WHERE id = $1`;
    return this.db.queryOne(sql, [id]);
  }

  findByMerchantId(merchantId) {
    const sql = `SELECT * FROM provider_connections WHERE merchant_id = $1 ORDER BY created_at DESC`;
    return this.db.query(sql, [merchantId]);
  }

  findActiveByMerchantAndProvider(merchantId, providerName) {
    const sql = `
      SELECT * FROM provider_connections 
      WHERE merchant_id = $1 AND provider_name = $2 AND is_active = 1 
      LIMIT 1
    `;
    return this.db.queryOne(sql, [merchantId, providerName.toUpperCase()]);
  }

  update(id, data) {
    const fields = [];
    const params = [];
    let idx = 1;

    const map = {
      providerName: 'provider_name',
      environment: 'environment',
      businessMerchantId: 'business_merchant_id',
      clientId: 'client_id',
      clientSecretEncrypted: 'client_secret_encrypted',
      approvedAccountId: 'approved_account_id',
      merchantVpa: 'merchant_vpa',
      corporateId: 'corporate_id',
      terminalId: 'terminal_id',
      publicKeyPem: 'public_key_pem',
      privateKeyEncrypted: 'private_key_encrypted',
      webhookUrl: 'webhook_url',
      webhookSecretEncrypted: 'webhook_secret_encrypted',
      status: 'status',
      lastTestedAt: 'last_tested_at',
      testResult: 'test_result',
      isActive: 'is_active'
    };

    for (const [key, col] of Object.entries(map)) {
      if (data[key] !== undefined) {
        fields.push(`${col} = $${idx++}`);
        params.push(col === 'is_active' ? (data[key] ? 1 : 0) : data[key]);
      }
    }

    if (data.ipAllowlist !== undefined) {
      fields.push(`ip_allowlist = $${idx++}`);
      params.push(typeof data.ipAllowlist === 'string' ? data.ipAllowlist : JSON.stringify(data.ipAllowlist));
    }
    if (data.diagnostics !== undefined) {
      fields.push(`diagnostics = $${idx++}`);
      params.push(typeof data.diagnostics === 'string' ? data.diagnostics : JSON.stringify(data.diagnostics));
    }

    if (fields.length === 0) return this.findById(id);

    fields.push(`updated_at = datetime('now')`);
    params.push(id);
    const sql = `UPDATE provider_connections SET ${fields.join(', ')} WHERE id = $${idx}`;
    this.db.execute(sql, params);
    return this.findById(id);
  }

  updateStatus(id, status, testResult = null, diagnostics = null) {
    const params = [status, new Date().toISOString()];
    let sql = `UPDATE provider_connections SET status = $1, last_tested_at = $2`;
    let idx = 3;

    if (testResult !== null) {
      sql += `, test_result = $${idx++}`;
      params.push(testResult);
    }
    if (diagnostics !== null) {
      sql += `, diagnostics = $${idx++}`;
      params.push(typeof diagnostics === 'string' ? diagnostics : JSON.stringify(diagnostics));
    }

    sql += `, updated_at = datetime('now') WHERE id = $${idx}`;
    params.push(id);
    this.db.execute(sql, params);
    return this.findById(id);
  }

  delete(id) {
    this.db.execute(`DELETE FROM provider_connections WHERE id = $1`, [id]);
    return true;
  }

  setCapability(connectionId, capabilityCode, isEnabled, verifiedAt = null, details = null) {
    const id = crypto.randomUUID();
    const sql = `
      INSERT INTO provider_capabilities (id, connection_id, capability_code, is_enabled, verified_at, verification_details)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT(connection_id, capability_code) DO UPDATE SET
        is_enabled = excluded.is_enabled,
        verified_at = excluded.verified_at,
        verification_details = excluded.verification_details
    `;
    const params = [
      id,
      connectionId,
      capabilityCode.toUpperCase(),
      isEnabled ? 1 : 0,
      verifiedAt || new Date().toISOString(),
      typeof details === 'string' ? details : JSON.stringify(details || {})
    ];
    this.db.execute(sql, params);
  }

  getCapabilities(connectionId) {
    const sql = `SELECT * FROM provider_capabilities WHERE connection_id = $1`;
    return this.db.query(sql, [connectionId]);
  }
}

