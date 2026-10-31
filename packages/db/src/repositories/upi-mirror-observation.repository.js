import crypto from 'node:crypto';

export class UpiMirrorObservationRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || `upi_obs_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const matchEvidence = typeof data.matchEvidence === 'object' ? JSON.stringify(data.matchEvidence) : (data.matchEvidence || '{}');
    const rawPayload = typeof data.rawPayload === 'object' ? JSON.stringify(data.rawPayload) : (data.rawPayload || '{}');

    this.db.execute(`
      INSERT INTO upi_mirror_observations (
        id, merchant_id, upi_connection_id, observer_device_id, event_id,
        source, direction, amount_paise, currency, reference_utr,
        claiming_receiving_identity, notification_timestamp,
        device_observed_timestamp, server_received_timestamp, parser_version,
        event_signature, fingerprint_hash, classification, matched_order_id,
        match_evidence, raw_payload, is_duplicate, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, data.merchantId, data.upiConnectionId || null, data.observerDeviceId || null,
      data.eventId, data.source, data.direction || 'INBOUND',
      Number(data.amountPaise), data.currency || 'INR', data.referenceUtr || null,
      data.claimingReceivingIdentity || null, data.notificationTimestamp || null,
      data.deviceObservedTimestamp || null, data.serverReceivedTimestamp || now,
      data.parserVersion || null, data.eventSignature || null,
      data.fingerprintHash, data.classification || 'PENDING',
      data.matchedOrderId || null, matchEvidence, rawPayload,
      data.isDuplicate ? 1 : 0, now
    ]);

    return this.findById(id);
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM upi_mirror_observations WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findByEventId(eventId) {
    const row = this.db.queryOne(
      'SELECT * FROM upi_mirror_observations WHERE event_id = ?',
      [eventId]
    );
    return row ? this.mapRow(row) : null;
  }

  findByFingerprint(fingerprintHash) {
    const row = this.db.queryOne(
      'SELECT * FROM upi_mirror_observations WHERE fingerprint_hash = ?',
      [fingerprintHash]
    );
    return row ? this.mapRow(row) : null;
  }

  findByMerchant(merchantId, limit = 50) {
    const rows = this.db.query(
      'SELECT * FROM upi_mirror_observations WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?',
      [merchantId, limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  findByConnection(upiConnectionId, limit = 50) {
    const rows = this.db.query(
      'SELECT * FROM upi_mirror_observations WHERE upi_connection_id = ? ORDER BY created_at DESC LIMIT ?',
      [upiConnectionId, limit]
    );
    return rows.map(r => this.mapRow(row));
  }

  findPendingClassification(limit = 100) {
    const rows = this.db.query(
      'SELECT * FROM upi_mirror_observations WHERE classification = ? ORDER BY created_at ASC LIMIT ?',
      ['PENDING', limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  findByReference(referenceUtr, merchantId = null) {
    let sql = 'SELECT * FROM upi_mirror_observations WHERE reference_utr = ?';
    const params = [referenceUtr];
    if (merchantId) {
      sql += ' AND merchant_id = ?';
      params.push(merchantId);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.query(sql, params);
    return rows.map(r => this.mapRow(r));
  }

  update(id, data) {
    const fields = [];
    const values = [];

    if (data.classification !== undefined) { fields.push('classification = ?'); values.push(data.classification); }
    if (data.matchedOrderId !== undefined) { fields.push('matched_order_id = ?'); values.push(data.matchedOrderId); }
    if (data.matchEvidence !== undefined) { fields.push('match_evidence = ?'); values.push(typeof data.matchEvidence === 'object' ? JSON.stringify(data.matchEvidence) : data.matchEvidence); }
    if (data.isDuplicate !== undefined) { fields.push('is_duplicate = ?'); values.push(data.isDuplicate ? 1 : 0); }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.execute(`UPDATE upi_mirror_observations SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  mapRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      upiConnectionId: row.upi_connection_id,
      observerDeviceId: row.observer_device_id,
      eventId: row.event_id,
      source: row.source,
      direction: row.direction,
      amountPaise: BigInt(row.amount_paise),
      currency: row.currency,
      referenceUtr: row.reference_utr,
      claimingReceivingIdentity: row.claiming_receiving_identity,
      notificationTimestamp: row.notification_timestamp ? new Date(row.notification_timestamp) : null,
      deviceObservedTimestamp: row.device_observed_timestamp ? new Date(row.device_observed_timestamp) : null,
      serverReceivedTimestamp: new Date(row.server_received_timestamp),
      parserVersion: row.parser_version,
      eventSignature: row.event_signature,
      fingerprintHash: row.fingerprint_hash,
      classification: row.classification,
      matchedOrderId: row.matched_order_id,
      matchEvidence: JSON.parse(row.match_evidence || '{}'),
      rawPayload: JSON.parse(row.raw_payload || '{}'),
      isDuplicate: Boolean(row.is_duplicate),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
