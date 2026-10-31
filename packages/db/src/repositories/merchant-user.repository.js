import crypto from 'node:crypto';

export class MerchantUserRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT INTO merchant_users (id, merchant_id, email, password_hash, full_name, role, status, mfa_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.merchantId, data.email, data.passwordHash, data.fullName, data.role || 'MERCHANT_VIEWER',
       data.status || 'ACTIVE', data.mfaEnabled ? 1 : 0, now, now]
    );
    return this.findById(id);
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM merchant_users WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findByEmailAndMerchant(email, merchantId) {
    const row = this.db.queryOne('SELECT * FROM merchant_users WHERE email = ? AND merchant_id = ?', [email, merchantId]);
    return row ? this.mapRow(row) : null;
  }

  findByMerchantId(merchantId) {
    const rows = this.db.query('SELECT * FROM merchant_users WHERE merchant_id = ? ORDER BY created_at DESC', [merchantId]);
    return (rows || []).map(r => this.mapRow(r));
  }

  update(id, updates) {
    const fields = [];
    const params = [];
    if (updates.email !== undefined) { fields.push('email = ?'); params.push(updates.email); }
    if (updates.passwordHash !== undefined) { fields.push('password_hash = ?'); params.push(updates.passwordHash); }
    if (updates.fullName !== undefined) { fields.push('full_name = ?'); params.push(updates.fullName); }
    if (updates.role !== undefined) { fields.push('role = ?'); params.push(updates.role); }
    if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
    if (updates.mfaEnabled !== undefined) { fields.push('mfa_enabled = ?'); params.push(updates.mfaEnabled ? 1 : 0); }
    if (updates.lastLoginAt !== undefined) { fields.push('last_login_at = ?'); params.push(updates.lastLoginAt); }
    if (fields.length === 0) return this.findById(id);
    fields.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);
    this.db.execute(`UPDATE merchant_users SET ${fields.join(', ')} WHERE id = ?`, params);
    return this.findById(id);
  }

  delete(id) {
    this.db.execute('DELETE FROM merchant_users WHERE id = ?', [id]);
    return { success: true };
  }

  mapRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      email: row.email,
      passwordHash: row.password_hash,
      fullName: row.full_name,
      role: row.role,
      status: row.status,
      mfaEnabled: Boolean(row.mfa_enabled),
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  // Sessions
  createSession(data) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT INTO merchant_user_sessions (id, merchant_user_id, token, expires_at, is_active, ip_address, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.merchantUserId, data.token, data.expiresAt, 1, data.ipAddress || null, data.userAgent || null, now, now]
    );
    return this.findSessionById(id);
  }

  findSessionByToken(token) {
    const row = this.db.queryOne(
      `SELECT s.*, u.email as user_email, u.full_name as user_name, u.role as user_role, u.merchant_id as merchant_id
       FROM merchant_user_sessions s
       JOIN merchant_users u ON s.merchant_user_id = u.id
       WHERE s.token = ? AND s.is_active = 1`,
      [token]
    );
    if (!row) return null;
    return {
      id: row.id,
      merchantUserId: row.merchant_user_id,
      token: row.token,
      expiresAt: new Date(row.expires_at),
      isActive: Boolean(row.is_active),
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      user: { id: row.merchant_user_id, email: row.user_email, fullName: row.user_name, role: row.user_role, merchantId: row.merchant_id }
    };
  }

  revokeSession(token) {
    this.db.execute('UPDATE merchant_user_sessions SET is_active = 0, updated_at = ? WHERE token = ?',
      [new Date().toISOString(), token]);
  }

  revokeAllSessionsForUser(merchantUserId) {
    this.db.execute('UPDATE merchant_user_sessions SET is_active = 0, updated_at = ? WHERE merchant_user_id = ?',
      [new Date().toISOString(), merchantUserId]);
  }
}
