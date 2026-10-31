import crypto from 'node:crypto';

export class ObserverSourceConfigRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || `obsrc_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    this.db.execute(`
      INSERT INTO observer_source_configs (
        id, upi_connection_id, source_name, source_category, is_enabled,
        parser_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, data.upiConnectionId, data.sourceName, data.sourceCategory,
      data.isEnabled !== undefined ? (data.isEnabled ? 1 : 0) : 1,
      data.parserVersion || '1.0', now, now
    ]);

    return this.findById(id);
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM observer_source_configs WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findByConnection(upiConnectionId) {
    const rows = this.db.query(
      'SELECT * FROM observer_source_configs WHERE upi_connection_id = ? ORDER BY source_name',
      [upiConnectionId]
    );
    return rows.map(r => this.mapRow(r));
  }

  findEnabledByConnection(upiConnectionId) {
    const rows = this.db.query(
      'SELECT * FROM observer_source_configs WHERE upi_connection_id = ? AND is_enabled = 1 ORDER BY source_name',
      [upiConnectionId]
    );
    return rows.map(r => this.mapRow(r));
  }

  update(id, data) {
    const fields = [];
    const values = [];

    if (data.sourceName !== undefined) { fields.push('source_name = ?'); values.push(data.sourceName); }
    if (data.sourceCategory !== undefined) { fields.push('source_category = ?'); values.push(data.sourceCategory); }
    if (data.isEnabled !== undefined) { fields.push('is_enabled = ?'); values.push(data.isEnabled ? 1 : 0); }
    if (data.parserVersion !== undefined) { fields.push('parser_version = ?'); values.push(data.parserVersion); }
    if (data.lastEventAt !== undefined) { fields.push('last_event_at = ?'); values.push(data.lastEventAt); }
    if (data.eventCount !== undefined) { fields.push('event_count = ?'); values.push(data.eventCount); }
    if (data.duplicateCount !== undefined) { fields.push('duplicate_count = ?'); values.push(data.duplicateCount); }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.execute(`UPDATE observer_source_configs SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  incrementEvent(id, isDuplicate = false) {
    if (isDuplicate) {
      this.db.execute(
        'UPDATE observer_source_configs SET event_count = event_count + 1, duplicate_count = duplicate_count + 1, last_event_at = ?, updated_at = ? WHERE id = ?',
        [new Date().toISOString(), new Date().toISOString(), id]
      );
    } else {
      this.db.execute(
        'UPDATE observer_source_configs SET event_count = event_count + 1, last_event_at = ?, updated_at = ? WHERE id = ?',
        [new Date().toISOString(), new Date().toISOString(), id]
      );
    }
  }

  mapRow(row) {
    return {
      id: row.id,
      upiConnectionId: row.upi_connection_id,
      sourceName: row.source_name,
      sourceCategory: row.source_category,
      isEnabled: Boolean(row.is_enabled),
      parserVersion: row.parser_version,
      lastEventAt: row.last_event_at ? new Date(row.last_event_at) : null,
      eventCount: row.event_count,
      duplicateCount: row.duplicate_count,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
