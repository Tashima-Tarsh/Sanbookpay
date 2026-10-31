-- ============================================================
-- DYNAMO PAY UNIVERSAL UPI MIRROR — Phase 1 Migration
-- UPI Connection Registry & Subscription Integration
-- ============================================================

-- 56. Merchant UPI Connections — claimed receiving VPAs per merchant
CREATE TABLE IF NOT EXISTS merchant_upi_connections (
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
);
CREATE INDEX IF NOT EXISTS idx_upi_connections_merchant ON merchant_upi_connections (merchant_id);
CREATE INDEX IF NOT EXISTS idx_upi_connections_state ON merchant_upi_connections (connection_state);
CREATE INDEX IF NOT EXISTS idx_upi_connections_vpa ON merchant_upi_connections (LOWER(vpa));
CREATE INDEX IF NOT EXISTS idx_upi_connections_observer_device ON merchant_upi_connections (observer_device_id);

-- 57. Merchant Observer Devices — paired Android devices per merchant
CREATE TABLE IF NOT EXISTS merchant_observer_devices (
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
);
CREATE INDEX IF NOT EXISTS idx_observer_devices_merchant ON merchant_observer_devices (merchant_id);
CREATE INDEX IF NOT EXISTS idx_observer_devices_state ON merchant_observer_devices (pairing_state);
CREATE INDEX IF NOT EXISTS idx_observer_devices_active ON merchant_observer_devices (is_active, last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_observer_devices_fingerprint ON merchant_observer_devices (fingerprint_hash);

-- 58. Device Pairing Challenges — one-time QR pairing
CREATE TABLE IF NOT EXISTS device_pairing_challenges (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    qr_payload TEXT NOT NULL,
    device_id TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pairing_challenges_merchant ON device_pairing_challenges (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_pairing_challenges_expires ON device_pairing_challenges (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pairing_challenges_challenge ON device_pairing_challenges (challenge);

-- 59. Observer Source Configs — permitted notification sources per connection
CREATE TABLE IF NOT EXISTS observer_source_configs (
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
);
CREATE INDEX IF NOT EXISTS idx_observer_source_configs_connection ON observer_source_configs (upi_connection_id);

-- 60. Subscription Entitlements — plan features per merchant
CREATE TABLE IF NOT EXISTS subscription_entitlements (
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
);
CREATE INDEX IF NOT EXISTS idx_subscription_entitlements_merchant ON subscription_entitlements (merchant_id);

-- 61. Connection Health Events — device/connection health transitions
CREATE TABLE IF NOT EXISTS connection_health_events (
    id TEXT PRIMARY KEY,
    upi_connection_id TEXT NOT NULL REFERENCES merchant_upi_connections(id) ON DELETE CASCADE,
    observer_device_id TEXT,
    previous_state VARCHAR(50),
    new_state VARCHAR(50) NOT NULL,
    trigger VARCHAR(100),
    latency_ms INTEGER,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_connection_health_connection ON connection_health_events (upi_connection_id, created_at);

-- 62. Admin Audit Events — super admin actions
CREATE TABLE IF NOT EXISTS admin_audit_events (
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
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_events (admin_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_merchant ON admin_audit_events (merchant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_events (action);

-- 63. Callback Outbox — transactional outbox for webhook delivery
CREATE TABLE IF NOT EXISTS callback_outbox (
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
);
CREATE INDEX IF NOT EXISTS idx_callback_outbox_status ON callback_outbox (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_callback_outbox_merchant ON callback_outbox (merchant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_callback_outbox_idempotency ON callback_outbox (idempotency_key);

-- 64. Callback Delivery Attempts — per-attempt history
CREATE TABLE IF NOT EXISTS callback_delivery_attempts (
    id TEXT PRIMARY KEY,
    outbox_id TEXT NOT NULL REFERENCES callback_outbox(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    status_code INTEGER,
    response_body TEXT,
    latency_ms INTEGER,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_callback_attempts_outbox ON callback_delivery_attempts (outbox_id);

-- 65. Payment Observations (UPI Mirror extension) — durable observation store
CREATE TABLE IF NOT EXISTS upi_mirror_observations (
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
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_upi_mirror_event_id ON upi_mirror_observations (event_id);
CREATE INDEX IF NOT EXISTS idx_upi_mirror_merchant ON upi_mirror_observations (merchant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_upi_mirror_connection ON upi_mirror_observations (upi_connection_id);
CREATE INDEX IF NOT EXISTS idx_upi_mirror_fingerprint ON upi_mirror_observations (fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_upi_mirror_classification ON upi_mirror_observations (classification);
CREATE INDEX IF NOT EXISTS idx_upi_mirror_reference ON upi_mirror_observations (reference_utr);

-- ============================================================
-- End Phase 1 Migration
-- ============================================================
