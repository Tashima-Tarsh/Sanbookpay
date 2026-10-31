import crypto from 'node:crypto';

export class AdminAuditEventRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || `adminaudit_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const details = typeof data.details === 'object' ? JSON.stringify(data.details) : (data.details || '{}');

    this.db.execute(`
      INSERT INTO admin_audit_events (
        id, admin_id, admin_type, action, entity_type, entity_id,
        merchant_id, details, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, data.adminId || null, data.adminType, data.action,
      data.entityType, data.entityId, data.merchantId || null,
      details, data.ipAddress || null, now
    ]);

    return this.findById(id);
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM admin_audit_events WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findByAdmin(adminId, limit = 50) {
    const rows = this.db.query(
      'SELECT * FROM admin_audit_events WHERE admin_id = ? ORDER BY created_at DESC LIMIT ?',
      [adminId, limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  findByMerchant(merchantId, limit = 50) {
    const rows = this.db.query(
      'SELECT * FROM admin_audit_events WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?',
      [merchantId, limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  findByAction(action, limit = 100) {
    const rows = this.db.query(
      'SELECT * FROM admin_audit_events WHERE action = ? ORDER BY created_at DESC LIMIT ?',
      [action, limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  mapRow(row) {
    return {
      id: row.id,
      adminId: row.admin_id,
      adminType: row.admin_type,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      merchantId: row.merchant_id,
      details: JSON.parse(row.details || '{}'),
      ipAddress: row.ip_address,
      createdAt: new Date(row.created_at)
    };
  }
}
