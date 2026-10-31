import crypto from 'node:crypto';

export class MerchantObserverDeviceRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || `obdev_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    this.db.execute(`
      INSERT INTO merchant_observer_devices (
        id, merchant_id, device_name, device_model, android_version, app_version,
        public_key, fingerprint_hash, device_token_hash, pairing_state,
        listener_status, notification_permission, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, data.merchantId, data.deviceName, data.deviceModel || null,
      data.androidVersion || null, data.appVersion || null, data.publicKey,
      data.fingerprintHash, data.deviceTokenHash, data.pairingState || 'PAIRING_REQUIRED',
      data.listenerStatus || 'UNKNOWN', data.notificationPermission ? 1 : 0,
      data.isActive !== undefined ? (data.isActive ? 1 : 0) : 1, now, now
    ]);

    return this.findById(id);
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM merchant_observer_devices WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findByMerchant(merchantId, limit = 50) {
    const rows = this.db.query(
      'SELECT * FROM merchant_observer_devices WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?',
      [merchantId, limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  findByFingerprint(fingerprintHash) {
    const row = this.db.queryOne(
      'SELECT * FROM merchant_observer_devices WHERE fingerprint_hash = ?',
      [fingerprintHash]
    );
    return row ? this.mapRow(row) : null;
  }

  findActive(merchantId = null) {
    let sql = 'SELECT * FROM merchant_observer_devices WHERE is_active = 1';
    const params = [];
    if (merchantId) {
      sql += ' AND merchant_id = ?';
      params.push(merchantId);
    }
    sql += ' ORDER BY last_heartbeat_at DESC';
    const rows = this.db.query(sql, params);
    return rows.map(r => this.mapRow(r));
  }

  findStale(minutes = 5) {
    const since = new Date(Date.now() - minutes * 60000).toISOString();
    const rows = this.db.query(
      'SELECT * FROM merchant_observer_devices WHERE is_active = 1 AND (last_heartbeat_at IS NULL OR last_heartbeat_at < ?)',
      [since]
    );
    return rows.map(r => this.mapRow(r));
  }

  update(id, data) {
    const fields = [];
    const values = [];

    if (data.deviceName !== undefined) { fields.push('device_name = ?'); values.push(data.deviceName); }
    if (data.deviceModel !== undefined) { fields.push('device_model = ?'); values.push(data.deviceModel); }
    if (data.androidVersion !== undefined) { fields.push('android_version = ?'); values.push(data.androidVersion); }
    if (data.appVersion !== undefined) { fields.push('app_version = ?'); values.push(data.appVersion); }
    if (data.publicKey !== undefined) { fields.push('public_key = ?'); values.push(data.publicKey); }
    if (data.fingerprintHash !== undefined) { fields.push('fingerprint_hash = ?'); values.push(data.fingerprintHash); }
    if (data.pairingState !== undefined) { fields.push('pairing_state = ?'); values.push(data.pairingState); }
    if (data.listenerStatus !== undefined) { fields.push('listener_status = ?'); values.push(data.listenerStatus); }
    if (data.notificationPermission !== undefined) { fields.push('notification_permission = ?'); values.push(data.notificationPermission ? 1 : 0); }
    if (data.lastHeartbeatAt !== undefined) { fields.push('last_heartbeat_at = ?'); values.push(data.lastHeartbeatAt); }
    if (data.lastEventAt !== undefined) { fields.push('last_event_at = ?'); values.push(data.lastEventAt); }
    if (data.avgForwardingLatencyMs !== undefined) { fields.push('avg_forwarding_latency_ms = ?'); values.push(data.avgForwardingLatencyMs); }
    if (data.isActive !== undefined) { fields.push('is_active = ?'); values.push(data.isActive ? 1 : 0); }
    if (data.revokedAt !== undefined) { fields.push('revoked_at = ?'); values.push(data.revokedAt); }
    if (data.revocationReason !== undefined) { fields.push('revocation_reason = ?'); values.push(data.revocationReason); }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.execute(`UPDATE merchant_observer_devices SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  touch(id) {
    this.db.execute(
      'UPDATE merchant_observer_devices SET last_heartbeat_at = ?, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), new Date().toISOString(), id]
    );
  }

  revoke(id, reason) {
    this.db.execute(
      'UPDATE merchant_observer_devices SET is_active = 0, revoked_at = ?, revocation_reason = ?, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), reason, new Date().toISOString(), id]
    );
    return this.findById(id);
  }

  mapRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      deviceName: row.device_name,
      deviceModel: row.device_model,
      androidVersion: row.android_version,
      appVersion: row.app_version,
      publicKey: row.public_key,
      fingerprintHash: row.fingerprint_hash,
      deviceTokenHash: row.device_token_hash,
      pairingState: row.pairing_state,
      listenerStatus: row.listener_status,
      notificationPermission: Boolean(row.notification_permission),
      lastHeartbeatAt: row.last_heartbeat_at ? new Date(row.last_heartbeat_at) : null,
      lastEventAt: row.last_event_at ? new Date(row.last_event_at) : null,
      avgForwardingLatencyMs: row.avg_forwarding_latency_ms,
      isActive: Boolean(row.is_active),
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
      revocationReason: row.revocation_reason,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
