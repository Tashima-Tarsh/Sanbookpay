import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { getCoinStoreWebhookSecret, LEGACY_DEFAULT_WEBHOOK_SECRET } from '@youpi/common';
import { getDatabase } from './database.js';
import { MerchantRepository } from './repositories/merchant.repository.js';
import { ReceivingAccountRepository } from './repositories/receiving-account.repository.js';
import { CustomerRepository } from './repositories/customer.repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Runs database migrations and applies base seeds.
 * @param {import('./database.js').Database} [targetDb]
 */
export function runMigrations(targetDb) {
  const db = targetDb || getDatabase();
  const schemaPath = path.join(__dirname, 'sqlite-schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  // Detect if customers table has an obsolete schema (phone_number/merchant_id instead of email/mobile_number, or password_hash NOT NULL).
  // The old table is only rebuilt when it holds no customers: a schema mismatch must never destroy customer data.
  try {
    const tableInfo = db.query ? db.query("PRAGMA table_info(customers)") : [];
    const colNames = (tableInfo || []).map(c => c.name);
    const hasOldColumns = colNames.length > 0 && (
      !colNames.includes('email') ||
      colNames.includes('phone_number') ||
      colNames.includes('merchant_id') ||
      !colNames.includes('otp_code') ||
      tableInfo.some(c => c.name === 'password_hash' && c.notnull === 1)
    );
    if (hasOldColumns) {
      const customerCount = Number(db.queryOne('SELECT COUNT(*) AS n FROM customers')?.n || 0);
      if (customerCount === 0) {
        try { db.exec("PRAGMA foreign_keys = OFF;"); } catch {}
        try { db.exec("DROP TABLE IF EXISTS customer_sessions;"); } catch {}
        try { db.exec("DROP TABLE IF EXISTS customers;"); } catch {}
        try { db.exec("PRAGMA foreign_keys = ON;"); } catch {}
      } else {
        console.error(`[migrate] customers table has an obsolete schema but holds ${customerCount} row(s); leaving it untouched. Back up and migrate it manually.`);
      }
    }
  } catch (err) {
    console.error('[migrate] Could not inspect customers table schema; skipping rebuild:', err.message);
  }

  // Fallback alter columns if customers/sessions table exists without new columns
  try { db.exec("ALTER TABLE customers ADD COLUMN email TEXT;"); } catch {}
  try { db.exec("ALTER TABLE customers ADD COLUMN mobile_number TEXT;"); } catch {}
  try { db.exec("ALTER TABLE customers ADD COLUMN otp_code TEXT;"); } catch {}
  try { db.exec("ALTER TABLE customers ADD COLUMN otp_expires_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE customers ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE customers ADD COLUMN is_phone_verified INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE customers ADD COLUMN ban_reason TEXT;"); } catch {}
  try { db.exec("ALTER TABLE customers ADD COLUMN banned_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE customers ADD COLUMN unbanned_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE customers ADD COLUMN last_device TEXT;"); } catch {}
  try { db.exec("ALTER TABLE payment_sessions ADD COLUMN device_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE payment_sessions ADD COLUMN verification_level INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE payment_sessions ADD COLUMN verification_sources TEXT DEFAULT '[]';"); } catch {}
  try { db.exec("ALTER TABLE payment_sessions ADD COLUMN verification_tag TEXT DEFAULT 'UNVERIFIED';"); } catch {}

  // Execute schema DDL
  db.exec(db.dialect==='postgres'?db.prepareSchema(schemaSql):schemaSql);

  // Alter table columns if migrating existing databases
  try { db.exec("ALTER TABLE payment_sessions ADD COLUMN verification_level INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE payment_sessions ADD COLUMN verification_sources TEXT DEFAULT '[]';"); } catch {}
  try { db.exec("ALTER TABLE payment_sessions ADD COLUMN verification_tag TEXT DEFAULT 'UNVERIFIED';"); } catch {}
  try { db.exec("ALTER TABLE payment_receiving_accounts ADD COLUMN is_merchant_enabled INTEGER NOT NULL DEFAULT 1;"); } catch {}
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_vpa_per_merchant ON payment_receiving_accounts (merchant_id) WHERE is_active = 1;"); } catch {}
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email ON customers (email);"); } catch {}
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_mobile ON customers (mobile_number);"); } catch {}
  try { db.exec("ALTER TABLE customers ADD COLUMN ban_reason TEXT;"); } catch {}
  try { db.exec("ALTER TABLE customers ADD COLUMN banned_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE customers ADD COLUMN unbanned_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE customers ADD COLUMN last_device TEXT;"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_customer_sessions_token ON customer_sessions (token, is_active);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions (customer_id);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_security_events_customer ON security_events (customer_id);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_security_events_session ON security_events (payment_session_id);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events (event_type);"); } catch {}
  try { db.exec("ALTER TABLE payment_sessions ADD COLUMN device_id TEXT REFERENCES devices(id);"); } catch {}
  try { db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
      public_key TEXT NOT NULL,
      fingerprint_hash TEXT NOT NULL,
      user_agent TEXT,
      platform TEXT,
      browser TEXT,
      timezone TEXT,
      language TEXT,
      screen_signature TEXT,
      device_token TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_devices_customer ON devices (customer_id);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices (fingerprint_hash);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_devices_token ON devices (device_token);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_payment_sessions_device ON payment_sessions (device_id);"); } catch {}

  // ============================================================
  // DYNAMO PAY UNIVERSAL UPI MIRROR — Phase 1 Migration
  // ============================================================
  try { db.exec(`CREATE TABLE IF NOT EXISTS merchant_upi_connections (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    vpa VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    bank_name VARCHAR(255),
    preferred_app VARCHAR(100),
    connection_state VARCHAR(50) NOT NULL DEFAULT 'REGISTERED',
    ownership_verified INTEGER NOT NULL DEFAULT 0,
    verification_level VARCHAR(50) DEFAULT 'NONE',
    verification_method VARCHAR(100),
    observer_device_id TEXT,
    credit_alert_email VARCHAR(255),
    webhook_url VARCHAR(1024),
    webhook_secret VARCHAR(255),
    last_observed_at TEXT,
    last_health_at TEXT,
    health_status VARCHAR(50) DEFAULT 'UNKNOWN',
    feature_flags TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT uq_merchant_vpa UNIQUE(merchant_id, LOWER(vpa))
  );`); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_upi_connections_merchant ON merchant_upi_connections (merchant_id);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_upi_connections_state ON merchant_upi_connections (connection_state);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_upi_connections_vpa ON merchant_upi_connections (LOWER(vpa));"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_upi_connections_observer_device ON merchant_upi_connections (observer_device_id);"); } catch {}

  try { db.exec(`CREATE TABLE IF NOT EXISTS merchant_observer_devices (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    device_name VARCHAR(255) NOT NULL,
    device_model VARCHAR(255),
    android_version VARCHAR(50),
    app_version VARCHAR(50),
    public_key TEXT NOT NULL,
    fingerprint_hash VARCHAR(64) NOT NULL,
    device_token_hash VARCHAR(255) NOT NULL,
    pairing_state VARCHAR(50) NOT NULL DEFAULT 'PAIRING_REQUIRED',
    listener_status VARCHAR(50) DEFAULT 'UNKNOWN',
    notification_permission INTEGER NOT NULL DEFAULT 0,
    last_heartbeat_at TEXT,
    last_event_at TEXT,
    avg_forwarding_latency_ms INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    revoked_at TEXT,
    revocation_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_observer_devices_merchant ON merchant_observer_devices (merchant_id);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_observer_devices_state ON merchant_observer_devices (pairing_state);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_observer_devices_active ON merchant_observer_devices (is_active, last_heartbeat_at);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_observer_devices_fingerprint ON merchant_observer_devices (fingerprint_hash);"); } catch {}

  try { db.exec(`CREATE TABLE IF NOT EXISTS device_pairing_challenges (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    qr_payload TEXT NOT NULL,
    device_id TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_pairing_challenges_merchant ON device_pairing_challenges (merchant_id, status);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_pairing_challenges_expires ON device_pairing_challenges (expires_at);"); } catch {}
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_pairing_challenges_challenge ON device_pairing_challenges (challenge);"); } catch {}

  try { db.exec(`CREATE TABLE IF NOT EXISTS observer_source_configs (
    id TEXT PRIMARY KEY,
    upi_connection_id TEXT NOT NULL REFERENCES merchant_upi_connections(id) ON DELETE CASCADE,
    source_name VARCHAR(100) NOT NULL,
    source_category VARCHAR(50) NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    parser_version VARCHAR(50) DEFAULT '1.0',
    last_event_at TEXT,
    event_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_observer_source_configs_connection ON observer_source_configs (upi_connection_id);"); } catch {}

  try { db.exec(`CREATE TABLE IF NOT EXISTS subscription_entitlements (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES pricing_plans(id),
    max_upi_connections INTEGER NOT NULL DEFAULT 1,
    max_observer_devices INTEGER NOT NULL DEFAULT 1,
    observation_sources_enabled INTEGER NOT NULL DEFAULT 1,
    webhook_endpoints_enabled INTEGER NOT NULL DEFAULT 1,
    callback_concurrency INTEGER NOT NULL DEFAULT 5,
    api_quota_daily INTEGER NOT NULL DEFAULT 1000,
    payment_link_limit INTEGER NOT NULL DEFAULT 1000,
    feature_entitlements TEXT DEFAULT '[]',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    current_period_start TEXT,
    current_period_end TEXT,
    grace_period_ends_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_subscription_entitlements_merchant ON subscription_entitlements (merchant_id);"); } catch {}

  try { db.exec(`CREATE TABLE IF NOT EXISTS connection_health_events (
    id TEXT PRIMARY KEY,
    upi_connection_id TEXT NOT NULL REFERENCES merchant_upi_connections(id) ON DELETE CASCADE,
    observer_device_id TEXT,
    previous_state VARCHAR(50),
    new_state VARCHAR(50) NOT NULL,
    trigger VARCHAR(100),
    latency_ms INTEGER,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_connection_health_connection ON connection_health_events (upi_connection_id, created_at);"); } catch {}

  try { db.exec(`CREATE TABLE IF NOT EXISTS admin_audit_events (
    id TEXT PRIMARY KEY,
    admin_id TEXT,
    admin_type VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id TEXT NOT NULL,
    merchant_id TEXT,
    details TEXT DEFAULT '{}',
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_events (admin_id, created_at);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_admin_audit_merchant ON admin_audit_events (merchant_id, created_at);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_events (action);"); } catch {}

  try { db.exec(`CREATE TABLE IF NOT EXISTS callback_outbox (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    payment_id TEXT,
    event_type VARCHAR(50) NOT NULL,
    payload TEXT NOT NULL,
    endpoint_url VARCHAR(1024) NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    next_retry_at TEXT,
    delivered_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_callback_outbox_status ON callback_outbox (status, next_retry_at);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_callback_outbox_merchant ON callback_outbox (merchant_id, status);"); } catch {}
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_callback_outbox_idempotency ON callback_outbox (idempotency_key);"); } catch {}

  try { db.exec(`CREATE TABLE IF NOT EXISTS callback_delivery_attempts (
    id TEXT PRIMARY KEY,
    outbox_id TEXT NOT NULL REFERENCES callback_outbox(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    status_code INTEGER,
    response_body TEXT,
    latency_ms INTEGER,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_callback_attempts_outbox ON callback_delivery_attempts (outbox_id);"); } catch {}

  try { db.exec(`CREATE TABLE IF NOT EXISTS upi_mirror_observations (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    upi_connection_id TEXT REFERENCES merchant_upi_connections(id) ON DELETE SET NULL,
    observer_device_id TEXT REFERENCES merchant_observer_devices(id) ON DELETE SET NULL,
    event_id VARCHAR(255) NOT NULL,
    source VARCHAR(100) NOT NULL,
    direction VARCHAR(50) NOT NULL DEFAULT 'INBOUND',
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    reference_utr VARCHAR(255),
    claiming_receiving_identity VARCHAR(255),
    notification_timestamp TEXT,
    device_observed_timestamp TEXT,
    server_received_timestamp TEXT NOT NULL,
    parser_version VARCHAR(50),
    event_signature VARCHAR(512),
    fingerprint_hash VARCHAR(64) NOT NULL,
    classification VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    matched_order_id TEXT,
    match_evidence TEXT DEFAULT '{}',
    raw_payload TEXT DEFAULT '{}',
    is_duplicate INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`); } catch {}
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_upi_mirror_event_id ON upi_mirror_observations (event_id);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_upi_mirror_merchant ON upi_mirror_observations (merchant_id, created_at);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_upi_mirror_connection ON upi_mirror_observations (upi_connection_id);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_upi_mirror_fingerprint ON upi_mirror_observations (fingerprint_hash);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_upi_mirror_classification ON upi_mirror_observations (classification);"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_upi_mirror_reference ON upi_mirror_observations (reference_utr);"); } catch {}

  // End Phase 1 Migration
  // ============================================================

  // Seed default merchant if empty
  const merchantRepo = new MerchantRepository(db);
  const existing = merchantRepo.findAll();

  let defaultMerchant;
  if (existing.length === 0) {
    defaultMerchant = merchantRepo.create({
      id: '00000000-0000-0000-0000-000000000001',
      businessName: 'Sanbook Pay Store',
      slug: 'demo-store',
      contactEmail: 'support@sanbookpay.com',
      contactPhone: '9876543210',
      webhookUrl: process.env.COIN_STORE_WEBHOOK_URL || 'http://localhost:5000/api/webhook',
      webhookSecret: getCoinStoreWebhookSecret(),
      branding: {
        appName: 'Sanbook Pay',
        primaryColor: '#059669',
        logoUrl: null
      }
    });
  } else {
    defaultMerchant = existing[0];
    if (!defaultMerchant.webhookSecret) {
      merchantRepo.update(defaultMerchant.id, {
        webhookUrl: 'http://localhost:5000/api/webhook',
        webhookSecret: getCoinStoreWebhookSecret()
      });
    } else if (defaultMerchant.webhookSecret === LEGACY_DEFAULT_WEBHOOK_SECRET) {
      // Older installs were seeded with a publicly known secret: rotate it.
      merchantRepo.update(defaultMerchant.id, { webhookSecret: getCoinStoreWebhookSecret() });
      console.warn('[migrate] Rotated the default merchant webhook secret away from the legacy public value. Update your merchant webhook verifier.');
    }
  }

  // Seed default UPI receiving account if none
  const accountRepo = new ReceivingAccountRepository(db);
  const accounts = accountRepo.findByMerchantId(defaultMerchant.id);
  if (accounts.length === 0) {
    accountRepo.create({
      id: '00000000-0000-0000-0000-000000000002',
      merchantId: defaultMerchant.id,
      upiId: '9082843142@slc',
      payeeName: 'Dynamo Pay',
      isActive: true
    });
  }

  // Ensure default merchant has an active API key
  try {
    const credRow = db.queryOne("SELECT * FROM merchant_credentials WHERE merchant_id = $1", [defaultMerchant.id]);
    if (!credRow) {
      db.execute(
        "INSERT INTO merchant_credentials (id, merchant_id, key_type, api_key, api_secret_hash, permissions, status) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        ['00000000-0000-0000-0000-000000000003', defaultMerchant.id, 'LIVE', 'sb_live_00000000000000000000000000000001', 'hash_sb_live', '["collections","payouts","refunds"]', 'ACTIVE']
      );
    }
  } catch {}

  // Demo customer seeding is opt-in and never carries real personal data.
  // Previously this unconditionally created a customer with a real name, phone number and
  // email, and flagged the phone as verified — shipping someone's PII (and a pre-authorised
  // OTP login identity) into every merchant deployment.
  if (process.env.YOUPI_SEED_DEMO_CUSTOMER === 'true') {
    const customerRepo = new CustomerRepository(db);
    const demoMobile = '9000000000';
    if (!customerRepo.findByMobile(demoMobile)) {
      customerRepo.create({
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Demo Customer',
        email: 'demo-customer@youpi.local',
        mobileNumber: demoMobile,
        isPhoneVerified: false
      });
    }
  }

  // Seed default system roles
  try {
    const roleRows = db.query('SELECT id FROM roles');
    const existingRoleIds = new Set((roleRows || []).map(r => r.id));
    const defaultRoles = [
      { id: 'role_super_admin', name: 'SUPER_ADMIN', scope: 'platform', description: 'Platform owner with full access', is_system: 1 },
      { id: 'role_platform_admin', name: 'PLATFORM_ADMIN', scope: 'platform', description: 'Platform administrator', is_system: 1 },
      { id: 'role_operations', name: 'OPERATIONS', scope: 'platform', description: 'Operations team', is_system: 1 },
      { id: 'role_finance', name: 'FINANCE', scope: 'platform', description: 'Finance team', is_system: 1 },
      { id: 'role_security', name: 'SECURITY', scope: 'platform', description: 'Security team', is_system: 1 },
      { id: 'role_support', name: 'SUPPORT', scope: 'platform', description: 'Support team', is_system: 1 },
      { id: 'role_merchant_owner', name: 'MERCHANT_OWNER', scope: 'merchant', description: 'Merchant owner', is_system: 1 },
      { id: 'role_merchant_admin', name: 'MERCHANT_ADMIN', scope: 'merchant', description: 'Merchant administrator', is_system: 1 },
      { id: 'role_merchant_developer', name: 'MERCHANT_DEVELOPER', scope: 'merchant', description: 'Merchant developer', is_system: 1 },
      { id: 'role_merchant_finance', name: 'MERCHANT_FINANCE', scope: 'merchant', description: 'Merchant finance', is_system: 1 },
      { id: 'role_merchant_operations', name: 'MERCHANT_OPERATIONS', scope: 'merchant', description: 'Merchant operations', is_system: 1 },
      { id: 'role_merchant_viewer', name: 'MERCHANT_VIEWER', scope: 'merchant', description: 'Merchant viewer (read-only)', is_system: 1 }
    ];
    for (const role of defaultRoles) {
      if (!existingRoleIds.has(role.id)) {
        db.execute(
          'INSERT INTO roles (id, name, scope, description, is_system, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [role.id, role.name, role.scope, role.description, role.is_system, new Date().toISOString()]
        );
      }
    }
  } catch {}

  // Seed default permissions
  try {
    const permRows = db.query('SELECT id FROM permissions');
    const existingPermIds = new Set((permRows || []).map(r => r.id));
    const defaultPermissions = [
      { id: 'perm_merchant_create', code: 'MERCHANT_CREATE', name: 'Create Merchant', module: 'merchant' },
      { id: 'perm_merchant_read', code: 'MERCHANT_READ', name: 'View Merchants', module: 'merchant' },
      { id: 'perm_merchant_update', code: 'MERCHANT_UPDATE', name: 'Update Merchant', module: 'merchant' },
      { id: 'perm_merchant_suspend', code: 'MERCHANT_SUSPEND', name: 'Suspend/Activate Merchant', module: 'merchant' },
      { id: 'perm_merchant_users', code: 'MERCHANT_USERS', name: 'Manage Merchant Users', module: 'merchant' },
      { id: 'perm_bank_manage', code: 'BANK_MANAGE', name: 'Manage Receiving Banks', module: 'bank' },
      { id: 'perm_upi_manage', code: 'UPI_MANAGE', name: 'Manage UPI Routes', module: 'upi' },
      { id: 'perm_routing_manage', code: 'ROUTING_MANAGE', name: 'Manage Smart Routing', module: 'routing' },
      { id: 'perm_failover_manage', code: 'FAILOVER_MANAGE', name: 'Manage Failover', module: 'routing' },
      { id: 'perm_api_keys', code: 'API_KEYS', name: 'Manage API Keys', module: 'api' },
      { id: 'perm_webhooks', code: 'WEBHOOKS', name: 'Manage Webhooks', module: 'webhook' },
      { id: 'perm_transactions_read', code: 'TRANSACTIONS_READ', name: 'View Transactions', module: 'transactions' },
      { id: 'perm_ledger_read', code: 'LEDGER_READ', name: 'View Ledger', module: 'ledger' },
      { id: 'perm_reconciliation', code: 'RECONCILIATION', name: 'Run Reconciliation', module: 'reconciliation' },
      { id: 'perm_pricing', code: 'PRICING', name: 'Manage Pricing', module: 'billing' },
      { id: 'perm_diagnostics', code: 'DIAGNOSTICS', name: 'Run Diagnostics', module: 'diagnostics' },
      { id: 'perm_incidents', code: 'INCIDENTS', name: 'Manage Incidents', module: 'operations' },
      { id: 'perm_audit_read', code: 'AUDIT_READ', name: 'View Audit Logs', module: 'security' },
      { id: 'perm_mfa_manage', code: 'MFA_MANAGE', name: 'Manage MFA', module: 'security' }
    ];
    for (const perm of defaultPermissions) {
      if (!existingPermIds.has(perm.id)) {
        db.execute(
          'INSERT INTO permissions (id, code, name, description, module, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [perm.id, perm.code, perm.name, perm.name, perm.module, new Date().toISOString()]
        );
      }
    }
  } catch {}

  // Seed role-permission mappings (SUPER_ADMIN gets all)
  try {
    const rpRows = db.query('SELECT id FROM role_permissions');
    const existingRP = new Set((rpRows || []).map(r => r.id));
    const superAdminPerms = defaultPermissions.map(p => p.id);
    const mappingCounter = (rpRows || []).length;
    let idx = 0;
    for (const permId of superAdminPerms) {
      const mapId = `rp_super_admin_${idx++}`;
      if (!existingRP.has(mapId)) {
        db.execute(
          'INSERT INTO role_permissions (id, role_id, permission_id) VALUES ($1, $2, $3)',
          [mapId, 'role_super_admin', permId]
        );
      }
    }
    // MERCHANT_OWNER gets merchant-scoped permissions
    const merchantOwnerPerms = [
      'perm_merchant_read', 'perm_bank_manage', 'perm_upi_manage', 'perm_routing_manage',
      'perm_api_keys', 'perm_webhooks', 'perm_transactions_read', 'perm_ledger_read',
      'perm_diagnostics', 'perm_audit_read'
    ];
    let mIdx = 0;
    for (const permId of merchantOwnerPerms) {
      const mapId = `rp_merchant_owner_${mIdx++}`;
      if (!existingRP.has(mapId)) {
        db.execute(
          'INSERT INTO role_permissions (id, role_id, permission_id) VALUES ($1, $2, $3)',
          [mapId, 'role_merchant_owner', permId]
        );
      }
    }
  } catch {}

  // Owner identity is provisioned from private console configuration; never seed a public password.

  // Seed default pricing plans
  try {
    const planRows = db.query('SELECT id FROM pricing_plans');
    const existingPlanIds = new Set((planRows || []).map(r => r.id));
    const defaultPlans = [
      { id: 'plan_starter', name: 'Starter', slug: 'starter', monthlyFee: 0, feePercent: 200, feeFixed: 0, apiQuota: 1000, linkLimit: 100 },
      { id: 'plan_growth', name: 'Growth', slug: 'growth', monthlyFee: 500000, feePercent: 150, feeFixed: 200, apiQuota: 10000, linkLimit: 1000 },
      { id: 'plan_enterprise', name: 'Enterprise', slug: 'enterprise', monthlyFee: 2000000, feePercent: 100, feeFixed: 100, apiQuota: 100000, linkLimit: 10000 }
    ];
    for (const plan of defaultPlans) {
      if (!existingPlanIds.has(plan.id)) {
        db.execute(
          `INSERT INTO pricing_plans (id, name, slug, description, monthly_fee_paise, transaction_fee_percent, transaction_fee_fixed_paise,
           api_quota_daily, payment_link_limit, allowed_payment_methods, feature_entitlements, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [plan.id, plan.name, plan.slug, `${plan.name} plan for growing merchants`, plan.monthlyFee, plan.feePercent, plan.feeFixed,
           plan.apiQuota, plan.linkLimit, '["UPI"]', '["dynamic_qr","upi_intent","webhooks","api_access","settlement_reports"]', 1,
           new Date().toISOString(), new Date().toISOString()]
        );
      }
    }
  } catch {}

  return {
    db,
    defaultMerchant
  };
}

/**
 * Completely wipes all customer identity records and active sessions,
 * reinitializing the customer identity store to a pristine state.
 * @param {import('./database.js').Database} [targetDb]
 */
export function reinitializeCustomerIdentity(targetDb) {
  const db = targetDb || getDatabase();
  try { db.exec("PRAGMA foreign_keys = OFF;"); } catch {}
  try { db.exec("UPDATE payment_sessions SET customer_id = NULL WHERE customer_id IS NOT NULL;"); } catch {}
  try { db.exec("DELETE FROM customer_sessions;"); } catch {}
  try { db.exec("DELETE FROM customers;"); } catch {}
  try { db.exec("PRAGMA foreign_keys = ON;"); } catch {}
  return { success: true, message: 'All old customer identity records wiped and reinitialized.' };
}

// Auto-run if executed directly as script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Running YOUPI PG database migrations...');
  const result = runMigrations();
  console.log(`Migration completed successfully. Default merchant: ${result.defaultMerchant.businessName} (${result.defaultMerchant.id})`);
}
