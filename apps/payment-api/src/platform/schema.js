/** Additive platform schema: existing merchant and financial rows are never rewritten. */
export function initializePlatform(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS pp_mfa_recovery(user_id TEXT NOT NULL,code_hash TEXT PRIMARY KEY,created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS pp_merchants (merchant_id TEXT PRIMARY KEY, status TEXT NOT NULL, profile TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS pp_users (id TEXT PRIMARY KEY, merchant_id TEXT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, email_verified INTEGER NOT NULL DEFAULT 0, mobile_verified INTEGER NOT NULL DEFAULT 0, mobile TEXT, mfa_secret TEXT, mfa_pending TEXT, mfa_last_step TEXT, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS pp_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, csrf_token TEXT NOT NULL, mfa_verified INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS pp_tokens (id TEXT PRIMARY KEY, user_id TEXT, merchant_id TEXT, kind TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, payload TEXT NOT NULL DEFAULT '{}', attempts INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS pp_login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS pp_user_permissions (user_id TEXT PRIMARY KEY, permissions TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS pp_audit (id TEXT PRIMARY KEY, merchant_id TEXT, user_id TEXT, action TEXT NOT NULL, entity_id TEXT, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS pp_sessions_user ON pp_sessions(user_id)`,
    `CREATE INDEX IF NOT EXISTS pp_audit_tenant ON pp_audit(merchant_id,created_at)`
  ];
  for (const sql of statements) db.execute(sql);
}
