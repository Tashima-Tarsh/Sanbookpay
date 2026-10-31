import crypto from 'node:crypto';

export class ConnectionHealthEventRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || `chealth_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    this.db.execute(`
      INSERT INTO connection_health_events (
        id, upi_connection_id, observer_device_id, previous_state, new_state,
        trigger, latency_ms, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, data.upiConnectionId, data.observerDeviceId || null,
      data.previousState || null, data.newState, data.trigger || null,
      data.latencyMs || null, data.errorMessage || null, now
    ]);

    return this.findById(id);
  }

  findByConnection(upiConnectionId, limit = 50) {
    const rows = this.db.query(
      'SELECT * FROM connection_health_events WHERE upi_connection_id = ? ORDER BY created_at DESC LIMIT ?',
      [upiConnectionId, limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  findRecent(minutes = 60, limit = 200) {
    const since = new Date(Date.now() - minutes * 60000).toISOString();
    const rows = this.db.query(
      'SELECT * FROM connection_health_events WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?',
      [since, limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  mapRow(row) {
    return {
      id: row.id,
      upiConnectionId: row.upi_connection_id,
      observerDeviceId: row.observer_device_id,
      previousState: row.previous_state,
      newState: row.new_state,
      trigger: row.trigger,
      latencyMs: row.latency_ms,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at)
    };
  }
}
