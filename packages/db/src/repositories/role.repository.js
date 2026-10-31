import crypto from 'node:crypto';

export class RoleRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT INTO roles (id, name, scope, description, is_system, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, data.name, data.scope || 'platform', data.description || null, data.isSystem ? 1 : 0, now]
    );
    return this.findById(id);
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM roles WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findByName(name) {
    const row = this.db.queryOne('SELECT * FROM roles WHERE name = ?', [name]);
    return row ? this.mapRow(row) : null;
  }

  findAll() {
    const rows = this.db.query('SELECT * FROM roles ORDER BY scope, name');
    return (rows || []).map(r => this.mapRow(r));
  }

  findByScope(scope) {
    const rows = this.db.query('SELECT * FROM roles WHERE scope = ? ORDER BY name', [scope]);
    return (rows || []).map(r => this.mapRow(r));
  }

  delete(id) {
    this.db.execute('DELETE FROM roles WHERE id = ?', [id]);
    return { success: true };
  }

  mapRow(row) {
    return {
      id: row.id,
      name: row.name,
      scope: row.scope,
      description: row.description,
      isSystem: Boolean(row.is_system),
      createdAt: new Date(row.created_at)
    };
  }

  // Permissions
  createPermission(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT INTO permissions (id, code, name, description, module, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, data.code, data.name, data.description || null, data.module, now]
    );
    return this.findPermissionById(id);
  }

  findPermissionById(id) {
    const row = this.db.queryOne('SELECT * FROM permissions WHERE id = ?', [id]);
    return row ? this.mapPermissionRow(row) : null;
  }

  findPermissionByCode(code) {
    const row = this.db.queryOne('SELECT * FROM permissions WHERE code = ?', [code]);
    return row ? this.mapPermissionRow(row) : null;
  }

  findAllPermissions() {
    const rows = this.db.query('SELECT * FROM permissions ORDER BY module, code');
    return (rows || []).map(r => this.mapPermissionRow(r));
  }

  mapPermissionRow(row) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      module: row.module,
      createdAt: new Date(row.created_at)
    };
  }

  // Role-Permission mapping
  assignPermissionToRole(roleId, permissionId) {
    const id = crypto.randomUUID();
    this.db.execute(
      'INSERT INTO role_permissions (id, role_id, permission_id) VALUES (?, ?, ?)',
      [id, roleId, permissionId]
    );
    return { id, roleId, permissionId };
  }

  removePermissionFromRole(roleId, permissionId) {
    this.db.execute(
      'DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?',
      [roleId, permissionId]
    );
    return { success: true };
  }

  getPermissionsForRole(roleId) {
    const rows = this.db.query(
      `SELECT p.* FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       WHERE rp.role_id = ?`,
      [roleId]
    );
    return (rows || []).map(r => this.mapPermissionRow(r));
  }

  // Merchant User Roles
  assignRoleToMerchantUser(merchantUserId, roleId) {
    const id = crypto.randomUUID();
    this.db.execute(
      'INSERT INTO merchant_user_roles (id, merchant_user_id, role_id) VALUES (?, ?, ?)',
      [id, merchantUserId, roleId]
    );
    return { id, merchantUserId, roleId };
  }

  removeRoleFromMerchantUser(merchantUserId, roleId) {
    this.db.execute(
      'DELETE FROM merchant_user_roles WHERE merchant_user_id = ? AND role_id = ?',
      [merchantUserId, roleId]
    );
    return { success: true };
  }

  getRolesForMerchantUser(merchantUserId) {
    const rows = this.db.query(
      `SELECT r.* FROM roles r
       JOIN merchant_user_roles mur ON r.id = mur.role_id
       WHERE mur.merchant_user_id = ?`,
      [merchantUserId]
    );
    return (rows || []).map(r => this.mapRow(r));
  }

  getPermissionsForMerchantUser(merchantUserId) {
    const rows = this.db.query(
      `SELECT DISTINCT p.* FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       JOIN merchant_user_roles mur ON rp.role_id = mur.role_id
       WHERE mur.merchant_user_id = ?`,
      [merchantUserId]
    );
    return (rows || []).map(r => this.mapPermissionRow(r));
  }

  hasPermission(merchantUserId, permissionCode) {
    const row = this.db.queryOne(
      `SELECT 1 FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       JOIN merchant_user_roles mur ON rp.role_id = mur.role_id
       WHERE mur.merchant_user_id = ? AND p.code = ?
       LIMIT 1`,
      [merchantUserId, permissionCode]
    );
    return Boolean(row);
  }
}
