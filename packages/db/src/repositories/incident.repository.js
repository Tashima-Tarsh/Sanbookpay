import crypto from 'node:crypto';

export class IncidentRepository {
  constructor(db) {
    this.db = db;
  }

  createIncident(data) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT INTO incident_reports (id, title, description, severity, status, category, merchant_id,
       assigned_to, created_by, resolved_at, resolution_notes, timeline, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.title, data.description, data.severity || 'MEDIUM', data.status || 'OPEN',
       data.category, data.merchantId || null, data.assignedTo || null, data.createdBy,
       data.resolvedAt || null, data.resolutionNotes || null, data.timeline || '[]', now, now]
    );
    return this.findIncidentById(id);
  }

  findIncidentById(id) {
    const row = this.db.queryOne('SELECT * FROM incident_reports WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findAll(limit = 100) {
    const rows = this.db.query('SELECT * FROM incident_reports ORDER BY created_at DESC LIMIT ?', [limit]);
    return (rows || []).map(r => this.mapRow(r));
  }

  findByStatus(status, limit = 100) {
    const rows = this.db.query(
      'SELECT * FROM incident_reports WHERE status = ? ORDER BY created_at DESC LIMIT ?',
      [status, limit]
    );
    return (rows || []).map(r => this.mapRow(r));
  }

  findByMerchant(merchantId, limit = 100) {
    const rows = this.db.query(
      'SELECT * FROM incident_reports WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?',
      [merchantId, limit]
    );
    return (rows || []).map(r => this.mapRow(r));
  }

  updateIncident(id, updates) {
    const fields = [];
    const params = [];
    const allowed = ['title', 'description', 'severity', 'status', 'category', 'merchant_id', 'assigned_to',
      'resolved_at', 'resolution_notes', 'timeline'];
    const colMap = {
      title: 'title', description: 'description', severity: 'severity', status: 'status',
      category: 'category', merchantId: 'merchant_id', assignedTo: 'assigned_to',
      resolvedAt: 'resolved_at', resolutionNotes: 'resolution_notes', timeline: 'timeline'
    };
    for (const key of allowed) {
      const dbKey = colMap[key] || key;
      if (updates[key] !== undefined) {
        fields.push(`${dbKey} = ?`);
        params.push(updates[key]);
      }
    }
    if (fields.length === 0) return this.findIncidentById(id);
    fields.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);
    this.db.execute(`UPDATE incident_reports SET ${fields.join(', ')} WHERE id = ?`, params);
    return this.findIncidentById(id);
  }

  deleteIncident(id) {
    this.db.execute('DELETE FROM incident_reports WHERE id = ?', [id]);
    return { success: true };
  }

  mapRow(row) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      category: row.category,
      merchantId: row.merchant_id,
      assignedTo: row.assigned_to,
      createdBy: row.created_by,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
      resolutionNotes: row.resolution_notes,
      timeline: row.timeline,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
