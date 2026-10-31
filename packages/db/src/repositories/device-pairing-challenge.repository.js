import crypto from 'node:crypto';

export class DevicePairingChallengeRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || `pair_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const expiresAt = data.expiresAt || new Date(Date.now() + 10 * 60000).toISOString();

    this.db.execute(`
      INSERT INTO device_pairing_challenges (
        id, merchant_id, challenge, qr_payload, device_id, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, data.merchantId, data.challenge, data.qrPayload,
      data.deviceId || null, data.status || 'PENDING', expiresAt, now
    ]);

    return this.findById(id);
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM device_pairing_challenges WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findByChallenge(challenge) {
    const row = this.db.queryOne(
      'SELECT * FROM device_pairing_challenges WHERE challenge = ?',
      [challenge]
    );
    return row ? this.mapRow(row) : null;
  }

  findPendingByMerchant(merchantId) {
    const rows = this.db.query(
      'SELECT * FROM device_pairing_challenges WHERE merchant_id = ? AND status = ? AND expires_at > ? ORDER BY created_at DESC',
      [merchantId, 'PENDING', new Date().toISOString()]
    );
    return rows.map(r => this.mapRow(r));
  }

  findExpired() {
    const rows = this.db.query(
      'SELECT * FROM device_pairing_challenges WHERE status = ? AND expires_at <= ?',
      ['PENDING', new Date().toISOString()]
    );
    return rows.map(r => this.mapRow(r));
  }

  consume(id, deviceId) {
    return this.db.transaction(() => {
      const challenge = this.findById(id);
      if (!challenge) throw new Error('Pairing challenge not found');
      if (challenge.status !== 'PENDING') throw new Error('Pairing challenge already consumed');
      if (new Date(challenge.expiresAt) <= new Date()) throw new Error('Pairing challenge expired');

      this.db.execute(`
        UPDATE device_pairing_challenges
        SET status = 'CONSUMED', device_id = ?, consumed_at = ?, updated_at = ?
        WHERE id = ?
      `, [deviceId, new Date().toISOString(), new Date().toISOString(), id]);

      return this.findById(id);
    });
  }

  expireAll() {
    const now = new Date().toISOString();
    this.db.execute(
      'UPDATE device_pairing_challenges SET status = \'EXPIRED\' WHERE status = ? AND expires_at <= ?',
      ['PENDING', now]
    );
  }

  mapRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      challenge: row.challenge,
      qrPayload: row.qr_payload,
      deviceId: row.device_id,
      status: row.status,
      expiresAt: new Date(row.expires_at),
      consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
      createdAt: new Date(row.created_at)
    };
  }
}
