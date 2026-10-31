import crypto from 'node:crypto';

export class MerchantUpiConnectionRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || `upi_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const featureFlags = typeof data.featureFlags === 'object' ? JSON.stringify(data.featureFlags) : (data.featureFlags || '{}');

    this.db.execute(`
      INSERT INTO merchant_upi_connections (
        id, merchant_id, vpa, display_name, bank_name, preferred_app,
        connection_state, ownership_verified, verification_level, verification_method,
        observer_device_id, credit_alert_email, webhook_url, webhook_secret,
        health_status, feature_flags, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, data.merchantId, data.vpa, data.displayName, data.bankName || null,
      data.preferredApp || null, data.connectionState || 'REGISTERED',
      data.ownershipVerified ? 1 : 0, data.verificationLevel || 'NONE',
      data.verificationMethod || null, data.observerDeviceId || null,
      data.creditAlertEmail || null, data.webhookUrl || null,
      data.webhookSecret || null, data.healthStatus || 'UNKNOWN',
      featureFlags, now, now
    ]);

    return this.findById(id);
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM merchant_upi_connections WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findByVpa(merchantId, vpa) {
    const row = this.db.queryOne(
      'SELECT * FROM merchant_upi_connections WHERE merchant_id = ? AND LOWER(vpa) = LOWER(?)',
      [merchantId, vpa]
    );
    return row ? this.mapRow(row) : null;
  }

  findByMerchant(merchantId, limit = 50) {
    const rows = this.db.query(
      'SELECT * FROM merchant_upi_connections WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?',
      [merchantId, limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  findByObserverDevice(deviceId) {
    const rows = this.db.query(
      'SELECT * FROM merchant_upi_connections WHERE observer_device_id = ? ORDER BY created_at DESC',
      [deviceId]
    );
    return rows.map(r => this.mapRow(r));
  }

  findByState(state, limit = 100) {
    const rows = this.db.query(
      'SELECT * FROM merchant_upi_connections WHERE connection_state = ? ORDER BY created_at DESC LIMIT ?',
      [state, limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  update(id, data) {
    const fields = [];
    const values = [];

    if (data.vpa !== undefined) { fields.push('vpa = ?'); values.push(data.vpa); }
    if (data.displayName !== undefined) { fields.push('display_name = ?'); values.push(data.displayName); }
    if (data.bankName !== undefined) { fields.push('bank_name = ?'); values.push(data.bankName); }
    if (data.preferredApp !== undefined) { fields.push('preferred_app = ?'); values.push(data.preferredApp); }
    if (data.connectionState !== undefined) { fields.push('connection_state = ?'); values.push(data.connectionState); }
    if (data.ownershipVerified !== undefined) { fields.push('ownership_verified = ?'); values.push(data.ownershipVerified ? 1 : 0); }
    if (data.verificationLevel !== undefined) { fields.push('verification_level = ?'); values.push(data.verificationLevel); }
    if (data.verificationMethod !== undefined) { fields.push('verification_method = ?'); values.push(data.verificationMethod); }
    if (data.observerDeviceId !== undefined) { fields.push('observer_device_id = ?'); values.push(data.observerDeviceId); }
    if (data.creditAlertEmail !== undefined) { fields.push('credit_alert_email = ?'); values.push(data.creditAlertEmail); }
    if (data.webhookUrl !== undefined) { fields.push('webhook_url = ?'); values.push(data.webhookUrl); }
    if (data.webhookSecret !== undefined) { fields.push('webhook_secret = ?'); values.push(data.webhookSecret); }
    if (data.lastObservedAt !== undefined) { fields.push('last_observed_at = ?'); values.push(data.lastObservedAt); }
    if (data.lastHealthAt !== undefined) { fields.push('last_health_at = ?'); values.push(data.lastHealthAt); }
    if (data.healthStatus !== undefined) { fields.push('health_status = ?'); values.push(data.healthStatus); }
    if (data.featureFlags !== undefined) { fields.push('feature_flags = ?'); values.push(typeof data.featureFlags === 'object' ? JSON.stringify(data.featureFlags) : data.featureFlags); }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.execute(`UPDATE merchant_upi_connections SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  delete(id) {
    this.db.execute('DELETE FROM merchant_upi_connections WHERE id = ?', [id]);
  }

  mapRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      vpa: row.vpa,
      displayName: row.display_name,
      bankName: row.bank_name,
      preferredApp: row.preferred_app,
      connectionState: row.connection_state,
      ownershipVerified: Boolean(row.ownership_verified),
      verificationLevel: row.verification_level,
      verificationMethod: row.verification_method,
      observerDeviceId: row.observer_device_id,
      creditAlertEmail: row.credit_alert_email,
      webhookUrl: row.webhook_url,
      webhookSecret: row.webhook_secret,
      lastObservedAt: row.last_observed_at ? new Date(row.last_observed_at) : null,
      lastHealthAt: row.last_health_at ? new Date(row.last_health_at) : null,
      healthStatus: row.health_status,
      featureFlags: JSON.parse(row.feature_flags || '{}'),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
