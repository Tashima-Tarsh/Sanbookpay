-- PostgreSQL Schema for YOUPI PG
-- Canonical Production Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Merchants Table
CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    business_name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(20) NOT NULL,
    webhook_url VARCHAR(1024),
    webhook_secret VARCHAR(255) NOT NULL,
    branding TEXT NOT NULL DEFAULT '{"primaryColor":"#2563eb","appName":"YOUPI PG","logoUrl":null}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Payment Receiving Accounts
CREATE TABLE IF NOT EXISTS payment_receiving_accounts (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    upi_id VARCHAR(255) NOT NULL,
    payee_name VARCHAR(255) NOT NULL,
    is_merchant_enabled BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_slot_busy BOOLEAN NOT NULL DEFAULT false,
    current_active_session_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_vpa_per_merchant ON payment_receiving_accounts (merchant_id) WHERE is_active = true;

-- 3. Customers Table (Gateway-owned Customer Identity with WhatsApp Berry OTP)
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    mobile_number VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    otp_code VARCHAR(10),
    otp_expires_at TIMESTAMPTZ,
    is_phone_verified BOOLEAN DEFAULT false,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email ON customers (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_mobile ON customers (mobile_number);

-- 3b. Customer Sessions Table (Server-authoritative session engine)
CREATE TABLE IF NOT EXISTS customer_sessions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_token ON customer_sessions (token, is_active);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions (customer_id);

-- 4. Payment Sessions Table
CREATE TABLE IF NOT EXISTS payment_sessions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    receiving_account_id TEXT REFERENCES payment_receiving_accounts(id),
    order_id VARCHAR(255) NOT NULL,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    method VARCHAR(50) NOT NULL DEFAULT 'UPI',
    status VARCHAR(50) NOT NULL DEFAULT 'INITIATED',
    queue_position INT DEFAULT 0,
    slot_acquired_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    processing_started_at TIMESTAMPTZ,
    processing_expires_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    return_url VARCHAR(1024),
    attributed_observation_id TEXT,
    idempotency_key VARCHAR(255),
    device_id TEXT REFERENCES devices(id),
    verification_level INT DEFAULT 0,
    verification_sources TEXT DEFAULT '[]',
    verification_tag VARCHAR(100) DEFAULT 'UNVERIFIED',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_merchant_order UNIQUE (merchant_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_active ON payment_sessions (receiving_account_id, status);

-- 5. Payment Observations Table
CREATE TABLE IF NOT EXISTS payment_observations (
    id TEXT PRIMARY KEY,
    receiving_account_id TEXT NOT NULL REFERENCES payment_receiving_accounts(id) ON DELETE CASCADE,
    source VARCHAR(50) NOT NULL,
    amount_paise BIGINT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sender_vpa VARCHAR(255),
    bank_reference_number VARCHAR(255),
    fingerprint_hash VARCHAR(64) NOT NULL,
    raw_payload TEXT NOT NULL DEFAULT '{}',
    attribution_status VARCHAR(50) NOT NULL DEFAULT 'UNATTRIBUTED',
    attributed_payment_id TEXT REFERENCES payment_sessions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_observations_match ON payment_observations (receiving_account_id, amount_paise, attribution_status);

-- 6. Android Devices Table
CREATE TABLE IF NOT EXISTS android_devices (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    device_name VARCHAR(255) NOT NULL,
    device_model VARCHAR(255),
    signing_key_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_heartbeat_at TIMESTAMPTZ,
    last_observation_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Webhook Deliveries Table
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    payment_id TEXT NOT NULL REFERENCES payment_sessions(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    payload TEXT NOT NULL,
    endpoint_url VARCHAR(1024) NOT NULL,
    response_status INT,
    response_body TEXT,
    attempt_count INT NOT NULL DEFAULT 1,
    is_successful BOOLEAN NOT NULL DEFAULT false,
    next_retry_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Support Tickets & Ticket Messages
CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    payment_id TEXT REFERENCES payment_sessions(id) ON DELETE SET NULL,
    subject VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_messages (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_type VARCHAR(20) NOT NULL,
    sender_id TEXT NOT NULL,
    message TEXT NOT NULL,
    attachments TEXT DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    merchant_id TEXT REFERENCES merchants(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL,
    entity_id TEXT NOT NULL,
    action VARCHAR(100) NOT NULL,
    actor_type VARCHAR(50) NOT NULL,
    actor_id VARCHAR(255),
    details TEXT NOT NULL DEFAULT '{}',
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Security Events Table
CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    merchant_id TEXT,
    customer_id TEXT,
    payment_session_id TEXT,
    event_type VARCHAR(100) NOT NULL,
    source VARCHAR(50),
    sender VARCHAR(255),
    device_info TEXT,
    raw_message TEXT NOT NULL,
    normalized_message TEXT,
    extracted_amount VARCHAR(50),
    extracted_reference VARCHAR(100),
    parser_results TEXT DEFAULT '{}',
    verification_results TEXT DEFAULT '{}',
    fraud_reason VARCHAR(255) NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Devices Table (Cryptographic Device Binding & Hardware Context Fingerprinting)
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    public_key TEXT NOT NULL,
    fingerprint_hash VARCHAR(64) NOT NULL,
    user_agent TEXT,
    platform VARCHAR(100),
    browser VARCHAR(100),
    timezone VARCHAR(100),
    language VARCHAR(50),
    screen_signature VARCHAR(100),
    device_token VARCHAR(255) UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_customer ON devices (customer_id);
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices (fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_devices_token ON devices (device_token);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_device ON payment_sessions (device_id);

-- ============================================================
-- SANBOOK PAY PRODUCTION FINANCIAL SCHEMA EXTENSIONS (PostgreSQL)
-- ============================================================

-- 12. Merchant Credentials (Scoped API Keys)
CREATE TABLE IF NOT EXISTS merchant_credentials (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    key_type VARCHAR(20) NOT NULL DEFAULT 'LIVE',
    api_key VARCHAR(255) UNIQUE NOT NULL,
    api_secret_hash VARCHAR(255) NOT NULL,
    permissions TEXT NOT NULL DEFAULT '["collections","payouts","refunds"]',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_key ON merchant_credentials (api_key);

-- 13. Provider Connections (Cashfree, HDFC, ICICI, etc.)
CREATE TABLE IF NOT EXISTS provider_connections (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    provider_name VARCHAR(50) NOT NULL,
    environment VARCHAR(20) NOT NULL DEFAULT 'PRODUCTION',
    business_merchant_id VARCHAR(255),
    client_id VARCHAR(255),
    client_secret_encrypted TEXT,
    approved_account_id VARCHAR(255),
    merchant_vpa VARCHAR(255),
    corporate_id VARCHAR(255),
    terminal_id VARCHAR(255),
    public_key_pem TEXT,
    private_key_encrypted TEXT,
    webhook_url VARCHAR(1024),
    webhook_secret_encrypted TEXT,
    ip_allowlist TEXT DEFAULT '[]',
    status VARCHAR(50) NOT NULL DEFAULT 'NOT CONFIGURED',
    last_tested_at TIMESTAMPTZ,
    test_result TEXT,
    diagnostics TEXT DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_provider_connections_merchant ON provider_connections (merchant_id, provider_name);

-- 14. Provider Capabilities
CREATE TABLE IF NOT EXISTS provider_capabilities (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
    capability_code VARCHAR(100) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    verified_at TIMESTAMPTZ,
    verification_details TEXT,
    UNIQUE(connection_id, capability_code)
);

-- 15. Payout Accounts (Source bank accounts for payouts)
CREATE TABLE IF NOT EXISTS payout_accounts (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    account_number VARCHAR(100) NOT NULL,
    ifsc VARCHAR(20) NOT NULL,
    bank_name VARCHAR(255),
    holder_name VARCHAR(255) NOT NULL,
    balance_paise BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. Beneficiaries (Bank accounts & UPI IDs for payouts)
CREATE TABLE IF NOT EXISTS beneficiaries (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    beneficiary_type VARCHAR(50) NOT NULL DEFAULT 'BANK_ACCOUNT',
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    bank_account VARCHAR(100),
    ifsc VARCHAR(20),
    upi_id VARCHAR(255),
    provider_bene_id VARCHAR(255),
    verification_status VARCHAR(50) NOT NULL DEFAULT 'UNVERIFIED',
    verified_name VARCHAR(255),
    verification_source VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_beneficiaries_merchant ON beneficiaries (merchant_id);

-- 17. Payment Orders (Sanbook Pay Universal Collections)
CREATE TABLE IF NOT EXISTS payment_orders (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    merchant_order_id VARCHAR(255) NOT NULL,
    provider_order_id VARCHAR(255),
    payment_session_id VARCHAR(255),
    provider_name VARCHAR(50) NOT NULL DEFAULT 'CASHFREE',
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(50) NOT NULL DEFAULT 'CREATED',
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(20),
    checkout_url VARCHAR(1024),
    payment_method VARCHAR(50) DEFAULT 'UPI',
    bank_reference VARCHAR(255),
    provider_payment_id VARCHAR(255),
    provider_response TEXT DEFAULT '{}',
    initiation_time_ms INT DEFAULT 0,
    confirmation_time_ms INT DEFAULT 0,
    webhook_delivery_time_ms INT DEFAULT 0,
    settlement_time_ms INT DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_po_merchant_order UNIQUE(merchant_id, merchant_order_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_provider ON payment_orders (provider_order_id);

-- 18. Payment Attempts
CREATE TABLE IF NOT EXISTS payment_attempts (
    id TEXT PRIMARY KEY,
    payment_order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL DEFAULT 1,
    provider_payment_id VARCHAR(255),
    method VARCHAR(50) NOT NULL DEFAULT 'UPI',
    status VARCHAR(50) NOT NULL DEFAULT 'INITIATED',
    bank_reference VARCHAR(255),
    error_code VARCHAR(100),
    error_message TEXT,
    raw_details TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19. Collection Events (Immutable State Audit)
CREATE TABLE IF NOT EXISTS collection_events (
    id TEXT PRIMARY KEY,
    payment_order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    previous_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    actor_type VARCHAR(50) NOT NULL,
    actor_id VARCHAR(255),
    payload TEXT DEFAULT '{}',
    latency_ms INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_collection_events_order ON collection_events (payment_order_id);

-- 20. Payouts (Real Outbound Disbursements)
CREATE TABLE IF NOT EXISTS payouts (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    transfer_id VARCHAR(255) UNIQUE NOT NULL,
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    beneficiary_id TEXT REFERENCES beneficiaries(id),
    provider_connection_id TEXT REFERENCES provider_connections(id),
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    payout_rail VARCHAR(20) NOT NULL DEFAULT 'IMPS',
    fee_paise BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'CREATED',
    provider_transfer_id VARCHAR(255),
    provider_name VARCHAR(50) NOT NULL DEFAULT 'CASHFREE',
    utr VARCHAR(255),
    failure_reason TEXT,
    remarks TEXT,
    initiated_by VARCHAR(255),
    approved_by VARCHAR(255),
    payout_account_id TEXT REFERENCES payout_accounts(id),
    initiation_time_ms INT DEFAULT 0,
    confirmation_time_ms INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payouts_merchant_status ON payouts (merchant_id, status);

-- 21. Payout Approvals (Maker-Checker / Authorization)
CREATE TABLE IF NOT EXISTS payout_approvals (
    id TEXT PRIMARY KEY,
    payout_id TEXT NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
    step VARCHAR(50) NOT NULL DEFAULT 'MAKER_CHECKER',
    approver_id VARCHAR(255) NOT NULL,
    decision VARCHAR(50) NOT NULL,
    comments TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 22. Payout Events (Immutable Audit Trail)
CREATE TABLE IF NOT EXISTS payout_events (
    id TEXT PRIMARY KEY,
    payout_id TEXT NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    previous_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    payload TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 23. Refunds
CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    payment_order_id TEXT REFERENCES payment_orders(id),
    refund_id VARCHAR(255) UNIQUE NOT NULL,
    provider_refund_id VARCHAR(255),
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    reason TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    utr VARCHAR(255),
    provider_response TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds (payment_order_id);

-- 24. Reversals
CREATE TABLE IF NOT EXISTS reversals (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    payment_order_id TEXT REFERENCES payment_orders(id),
    amount_paise BIGINT NOT NULL,
    reason TEXT NOT NULL,
    bank_reference VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'CONFIRMED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 25. Settlements
CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    provider_connection_id TEXT REFERENCES provider_connections(id),
    settlement_id VARCHAR(255) UNIQUE NOT NULL,
    provider_settlement_id VARCHAR(255),
    gross_amount_paise BIGINT NOT NULL,
    fee_paise BIGINT NOT NULL DEFAULT 0,
    tax_paise BIGINT NOT NULL DEFAULT 0,
    net_amount_paise BIGINT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    bank_utr VARCHAR(255),
    bank_account_number VARCHAR(100),
    settled_at TIMESTAMPTZ,
    bank_confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_settlements_merchant ON settlements (merchant_id);

-- 26. Settlement Entries
CREATE TABLE IF NOT EXISTS settlement_entries (
    id TEXT PRIMARY KEY,
    settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
    payment_order_id TEXT REFERENCES payment_orders(id),
    amount_paise BIGINT NOT NULL,
    fee_paise BIGINT NOT NULL DEFAULT 0,
    tax_paise BIGINT NOT NULL DEFAULT 0,
    net_paise BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 27. Double-Entry Financial Ledger: Accounts
CREATE TABLE IF NOT EXISTS ledger_accounts (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    account_code VARCHAR(100) NOT NULL,
    account_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(50) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    balance_paise BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_la_merchant_code UNIQUE(merchant_id, account_code)
);

-- 28. Ledger Transactions (Atomic Transaction Groups)
CREATE TABLE IF NOT EXISTS ledger_transactions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    reference_type VARCHAR(50) NOT NULL,
    reference_id VARCHAR(255) NOT NULL,
    narration TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'POSTED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 29. Ledger Entries (Debits and Credits)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES ledger_accounts(id),
    direction VARCHAR(10) NOT NULL,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries (account_id);

-- 30. Reconciliation Runs
CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    provider_name VARCHAR(50) NOT NULL DEFAULT 'CASHFREE',
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    total_orders_checked INT NOT NULL DEFAULT 0,
    total_matched INT NOT NULL DEFAULT 0,
    total_discrepancies INT NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
    details TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 31. Reconciliation Exceptions
CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    payment_order_id TEXT REFERENCES payment_orders(id),
    provider_order_id VARCHAR(255),
    exception_type VARCHAR(100) NOT NULL,
    expected_value TEXT,
    actual_value TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    resolution_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_exceptions_merchant ON reconciliation_exceptions (merchant_id, status);

-- 32. Webhook Endpoints
CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    url VARCHAR(1024) NOT NULL,
    secret VARCHAR(255) NOT NULL,
    events TEXT NOT NULL DEFAULT '["payment.success","payment.failed","payout.success","payout.failed","refund.success","settlement.completed"]',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 33. Idempotency Keys
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key VARCHAR(255) PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    scope VARCHAR(50) NOT NULL,
    request_hash VARCHAR(255) NOT NULL,
    response_payload TEXT NOT NULL,
    status_code INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- 34. Operational Alerts
CREATE TABLE IF NOT EXISTS operational_alerts (
    id TEXT PRIMARY KEY,
    severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
    category VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    is_acknowledged BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SANBOOK PAY SUPER ADMIN & MULTI-TENANT SCHEMA EXTENSIONS
-- ============================================================

-- 35. Super Admin Users (Platform Owner, Admins, Operations, Finance, Security, Support)
CREATE TABLE IF NOT EXISTS super_admin_users (
    id TEXT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'SUPER_ADMIN',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    mfa_secret_encrypted TEXT,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 36. Super Admin Sessions
CREATE TABLE IF NOT EXISTS super_admin_sessions (
    id TEXT PRIMARY KEY,
    super_admin_id TEXT NOT NULL REFERENCES super_admin_users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_super_admin_sessions_token ON super_admin_sessions (token, is_active);
CREATE INDEX IF NOT EXISTS idx_super_admin_sessions_admin ON super_admin_sessions (super_admin_id);

-- 37. MFA Challenges (TOTP enrollment and verification)
CREATE TABLE IF NOT EXISTS mfa_challenges (
    id TEXT PRIMARY KEY,
    user_type VARCHAR(20) NOT NULL,
    user_id TEXT NOT NULL,
    secret_encrypted TEXT NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    recovery_codes TEXT DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 38. Merchant Users (staff accounts per merchant)
CREATE TABLE IF NOT EXISTS merchant_users (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'VIEWER',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    mfa_secret_encrypted TEXT,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_merchant_user_email UNIQUE(merchant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_merchant_users_merchant ON merchant_users (merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_users_email ON merchant_users (email);

-- 39. Merchant User Sessions
CREATE TABLE IF NOT EXISTS merchant_user_sessions (
    id TEXT PRIMARY KEY,
    merchant_user_id TEXT NOT NULL REFERENCES merchant_users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchant_user_sessions_token ON merchant_user_sessions (token, is_active);
CREATE INDEX IF NOT EXISTS idx_merchant_user_sessions_user ON merchant_user_sessions (merchant_user_id);

-- 40. Roles
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    scope VARCHAR(20) NOT NULL DEFAULT 'platform',
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 41. Permissions
CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    module VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 42. Role Permissions
CREATE TABLE IF NOT EXISTS role_permissions (
    id TEXT PRIMARY KEY,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    UNIQUE(role_id, permission_id)
);

-- 43. Merchant User Roles
CREATE TABLE IF NOT EXISTS merchant_user_roles (
    id TEXT PRIMARY KEY,
    merchant_user_id TEXT NOT NULL REFERENCES merchant_users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    UNIQUE(merchant_user_id, role_id)
);

-- 44. Session Revocations (forced logout / security)
CREATE TABLE IF NOT EXISTS session_revocations (
    id TEXT PRIMARY KEY,
    user_type VARCHAR(20) NOT NULL,
    user_id TEXT NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 45. Routing Rules (Smart UPI routing per merchant)
CREATE TABLE IF NOT EXISTS routing_rules (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    receiving_account_id TEXT NOT NULL REFERENCES payment_receiving_accounts(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 100,
    weight INTEGER NOT NULL DEFAULT 100,
    min_amount_paise BIGINT,
    max_amount_paise BIGINT,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    strategy VARCHAR(50) NOT NULL DEFAULT 'PRIORITY_BASED',
    health_check_interval_sec INTEGER NOT NULL DEFAULT 60,
    failure_threshold INTEGER NOT NULL DEFAULT 3,
    recovery_probe_interval_sec INTEGER NOT NULL DEFAULT 300,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routing_rules_merchant ON routing_rules (merchant_id, is_enabled, priority);
CREATE INDEX IF NOT EXISTS idx_routing_rules_account ON routing_rules (receiving_account_id);

-- 46. Route Health (per-route health monitoring)
CREATE TABLE IF NOT EXISTS route_health (
    id TEXT PRIMARY KEY,
    routing_rule_id TEXT NOT NULL REFERENCES routing_rules(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'HEALTHY',
    success_rate DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
    timeout_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0000,
    error_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0000,
    avg_latency_ms INTEGER NOT NULL DEFAULT 0,
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    last_health_check_at TIMESTAMPTZ,
    circuit_breaker_state VARCHAR(20) NOT NULL DEFAULT 'CLOSED',
    circuit_breaker_opens_at TIMESTAMPTZ,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_health_rule ON route_health (routing_rule_id);
CREATE INDEX IF NOT EXISTS idx_route_health_status ON route_health (status, circuit_breaker_state);

-- 47. Failover Events
CREATE TABLE IF NOT EXISTS failover_events (
    id TEXT PRIMARY KEY,
    payment_order_id TEXT REFERENCES payment_orders(id),
    from_route_id TEXT REFERENCES routing_rules(id),
    to_route_id TEXT REFERENCES routing_rules(id),
    reason VARCHAR(255) NOT NULL,
    trigger VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'RECORDED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failover_events_order ON failover_events (payment_order_id);
CREATE INDEX IF NOT EXISTS idx_failover_events_created ON failover_events (created_at);

-- 48. Gaming Wallets
CREATE TABLE IF NOT EXISTS gaming_wallets (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    player_reference VARCHAR(255) NOT NULL,
    balance_paise BIGINT NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_gaming_wallet_player UNIQUE(merchant_id, player_reference)
);

CREATE INDEX IF NOT EXISTS idx_gaming_wallets_merchant ON gaming_wallets (merchant_id);
CREATE INDEX IF NOT EXISTS idx_gaming_wallets_player ON gaming_wallets (player_reference);

-- 49. Wallet Transactions
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id TEXT PRIMARY KEY,
    wallet_id TEXT NOT NULL REFERENCES gaming_wallets(id) ON DELETE CASCADE,
    payment_order_id TEXT REFERENCES payment_orders(id),
    direction VARCHAR(10) NOT NULL,
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
    balance_after_paise BIGINT NOT NULL,
    narration TEXT NOT NULL,
    reference_type VARCHAR(50),
    reference_id TEXT,
    idempotency_key VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet ON wallet_transactions (wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_idempotency ON wallet_transactions (idempotency_key);

-- 50. Pricing Plans
CREATE TABLE IF NOT EXISTS pricing_plans (
    id TEXT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    monthly_fee_paise BIGINT NOT NULL DEFAULT 0,
    transaction_fee_percent DECIMAL(5,4) NOT NULL DEFAULT 0,
    transaction_fee_fixed_paise BIGINT NOT NULL DEFAULT 0,
    volume_tier_threshold_paise BIGINT NOT NULL DEFAULT 0,
    volume_tier_fee_percent DECIMAL(5,4),
    api_quota_daily INTEGER NOT NULL DEFAULT 1000,
    payment_link_limit INTEGER NOT NULL DEFAULT 1000,
    allowed_payment_methods TEXT NOT NULL DEFAULT '["UPI"]',
    feature_entitlements TEXT NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 51. Merchant Subscriptions
CREATE TABLE IF NOT EXISTS merchant_subscriptions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    pricing_plan_id TEXT NOT NULL REFERENCES pricing_plans(id),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchant_subscriptions_merchant ON merchant_subscriptions (merchant_id);

-- 52. Diagnostic Logs
CREATE TABLE IF NOT EXISTS diagnostic_logs (
    id TEXT PRIMARY KEY,
    merchant_id TEXT REFERENCES merchants(id),
    search_key VARCHAR(255) NOT NULL,
    search_type VARCHAR(50) NOT NULL,
    order_created BOOLEAN NOT NULL DEFAULT false,
    player_associated BOOLEAN NOT NULL DEFAULT false,
    route_selected BOOLEAN NOT NULL DEFAULT false,
    receiving_bank TEXT,
    receiving_vpa TEXT,
    qr_generated BOOLEAN NOT NULL DEFAULT false,
    payment_attempt BOOLEAN NOT NULL DEFAULT false,
    provider_confirmation BOOLEAN NOT NULL DEFAULT false,
    failover_history TEXT DEFAULT '[]',
    ledger_posted BOOLEAN NOT NULL DEFAULT false,
    webhook_delivered BOOLEAN NOT NULL DEFAULT false,
    wallet_fulfilled BOOLEAN NOT NULL DEFAULT false,
    reconciliation_status VARCHAR(50),
    evidence TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_key ON diagnostic_logs (search_key, search_type);
CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_merchant ON diagnostic_logs (merchant_id);

-- 53. Incident Reports
CREATE TABLE IF NOT EXISTS incident_reports (
    id TEXT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    category VARCHAR(50) NOT NULL,
    merchant_id TEXT REFERENCES merchants(id),
    assigned_to TEXT,
    created_by TEXT NOT NULL,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    timeline TEXT DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_reports_status ON incident_reports (status, severity);
CREATE INDEX IF NOT EXISTS idx_incident_reports_merchant ON incident_reports (merchant_id);


