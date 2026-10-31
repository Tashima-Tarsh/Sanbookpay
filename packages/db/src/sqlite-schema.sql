-- SQLite Schema for YOUPI PG
-- Native Local / Zero-Dependency Execution

-- 1. Merchants Table
CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    business_name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    contact_email TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    webhook_url TEXT,
    webhook_secret TEXT NOT NULL,
    branding TEXT NOT NULL DEFAULT '{"primaryColor":"#2563eb","appName":"YOUPI PG","logoUrl":null}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Payment Receiving Accounts
CREATE TABLE IF NOT EXISTS payment_receiving_accounts (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    upi_id TEXT NOT NULL,
    payee_name TEXT NOT NULL,
    is_merchant_enabled INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_slot_busy INTEGER NOT NULL DEFAULT 0,
    current_active_session_id TEXT,
    daily_volume_paise INTEGER NOT NULL DEFAULT 0,
    daily_txn_count INTEGER NOT NULL DEFAULT 0,
    rotation_threshold_paise INTEGER NOT NULL DEFAULT 9000000,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_vpa_per_merchant ON payment_receiving_accounts (merchant_id) WHERE is_active = 1;

-- 3. Customers Table (Gateway-owned Customer Identity with WhatsApp Berry OTP)
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    mobile_number TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    otp_code TEXT,
    otp_expires_at TEXT,
    otp_attempts INTEGER NOT NULL DEFAULT 0,
    is_phone_verified INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email ON customers (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_mobile ON customers (mobile_number);

-- 3b. Customer Sessions Table (Server-authoritative session engine)
CREATE TABLE IF NOT EXISTS customer_sessions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_token ON customer_sessions (token, is_active);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions (customer_id);

-- 4. Payment Sessions Table
CREATE TABLE IF NOT EXISTS payment_sessions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    receiving_account_id TEXT REFERENCES payment_receiving_accounts(id),
    order_id TEXT NOT NULL,
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    paise_offset INTEGER NOT NULL DEFAULT 0 CHECK (paise_offset >= 0 AND paise_offset <= 99),
    base_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (base_amount_paise >= 0),
    currency TEXT NOT NULL DEFAULT 'INR',
    method TEXT NOT NULL DEFAULT 'UPI',
    status TEXT NOT NULL DEFAULT 'INITIATED',
    queue_position INTEGER DEFAULT 0,
    slot_acquired_at TEXT,
    expires_at TEXT,
    processing_started_at TEXT,
    processing_expires_at TEXT,
    completed_at TEXT,
    return_url TEXT,
    attributed_observation_id TEXT,
    idempotency_key TEXT,
    device_id TEXT REFERENCES devices(id),
    verification_level INTEGER DEFAULT 0,
    verification_sources TEXT DEFAULT '[]',
    verification_tag TEXT DEFAULT 'UNVERIFIED',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(merchant_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_active ON payment_sessions (receiving_account_id, status);
-- Slot exclusivity is a database invariant, not an application convention: at most one
-- session per receiving account may occupy the slot (ACTIVE or PROCESSING) at any time.
-- Concurrent writers are rejected by the engine instead of relying on lock contention.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_slot_per_receiving_account
  ON payment_sessions (receiving_account_id)
  WHERE status IN ('ACTIVE', 'PROCESSING') AND receiving_account_id IS NOT NULL;

-- 5. Payment Observations Table
CREATE TABLE IF NOT EXISTS payment_observations (
    id TEXT PRIMARY KEY,
    receiving_account_id TEXT NOT NULL REFERENCES payment_receiving_accounts(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    observed_at TEXT NOT NULL,
    ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
    sender_vpa TEXT,
    bank_reference_number TEXT,
    fingerprint_hash TEXT NOT NULL,
    raw_payload TEXT NOT NULL DEFAULT '{}',
    attribution_status TEXT NOT NULL DEFAULT 'UNATTRIBUTED',
    attributed_payment_id TEXT REFERENCES payment_sessions(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_observations_match ON payment_observations (receiving_account_id, amount_paise, attribution_status);

-- 6. Android Devices Table
CREATE TABLE IF NOT EXISTS android_devices (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    device_model TEXT,
    signing_key_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_heartbeat_at TEXT,
    last_observation_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 7. Webhook Deliveries Table
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    payment_id TEXT NOT NULL REFERENCES payment_sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    endpoint_url TEXT NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 1,
    is_successful INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 8. Support Tickets & Ticket Messages
CREATE TABLE IF NOT EXISTS provider_webhook_deliveries (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    payment_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    endpoint_url TEXT NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    is_successful INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_provider_webhook_retry ON provider_webhook_deliveries(is_successful,next_retry_at);
CREATE TABLE IF NOT EXISTS provider_payment_claims (
    provider_name TEXT NOT NULL,
    provider_payment_id TEXT NOT NULL,
    payment_order_id TEXT NOT NULL REFERENCES payment_orders(id),
    PRIMARY KEY(provider_name,provider_payment_id)
);
CREATE TABLE IF NOT EXISTS payment_receipts (
    payment_id TEXT PRIMARY KEY REFERENCES payment_sessions(id) ON DELETE CASCADE,
    receipt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    payment_id TEXT REFERENCES payment_sessions(id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_messages (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    message TEXT NOT NULL,
    attachments TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 9. Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    merchant_id TEXT REFERENCES merchants(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    details TEXT NOT NULL DEFAULT '{}',
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 10. Security Events Table (Forensic evidence for fraud, automatic and manual bans)
CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    merchant_id TEXT,
    customer_id TEXT,
    payment_session_id TEXT,
    event_type TEXT NOT NULL,
    source TEXT,
    sender TEXT,
    device_info TEXT,
    raw_message TEXT NOT NULL,
    normalized_message TEXT,
    extracted_amount TEXT,
    extracted_reference TEXT,
    parser_results TEXT DEFAULT '{}',
    verification_results TEXT DEFAULT '{}',
    fraud_reason TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_security_events_customer ON security_events (customer_id);
CREATE INDEX IF NOT EXISTS idx_security_events_session ON security_events (payment_session_id);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events (event_type);

-- 11. Devices Table (Cryptographic Device Binding & Hardware Context Fingerprinting)
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

CREATE INDEX IF NOT EXISTS idx_devices_customer ON devices (customer_id);
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices (fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_devices_token ON devices (device_token);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_device ON payment_sessions (device_id);

-- ============================================================
-- SANBOOK PAY PRODUCTION FINANCIAL SCHEMA EXTENSIONS
-- ============================================================

-- 12. Merchant Credentials (Scoped API Keys)
CREATE TABLE IF NOT EXISTS merchant_credentials (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    key_type TEXT NOT NULL DEFAULT 'LIVE',
    api_key TEXT UNIQUE NOT NULL,
    api_secret_hash TEXT NOT NULL,
    permissions TEXT NOT NULL DEFAULT '["collections","payouts","refunds"]',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_key ON merchant_credentials (api_key);

-- 13. Provider Connections (Cashfree, HDFC, ICICI, etc.)
CREATE TABLE IF NOT EXISTS provider_connections (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    provider_name TEXT NOT NULL,
    environment TEXT NOT NULL DEFAULT 'PRODUCTION',
    business_merchant_id TEXT,
    client_id TEXT,
    client_secret_encrypted TEXT,
    approved_account_id TEXT,
    merchant_vpa TEXT,
    corporate_id TEXT,
    terminal_id TEXT,
    public_key_pem TEXT,
    private_key_encrypted TEXT,
    webhook_url TEXT,
    webhook_secret_encrypted TEXT,
    ip_allowlist TEXT DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'NOT CONFIGURED',
    last_tested_at TEXT,
    test_result TEXT,
    diagnostics TEXT DEFAULT '{}',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_provider_connections_merchant ON provider_connections (merchant_id, provider_name);

-- 14. Provider Capabilities
CREATE TABLE IF NOT EXISTS provider_capabilities (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
    capability_code TEXT NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 0,
    verified_at TEXT,
    verification_details TEXT,
    UNIQUE(connection_id, capability_code)
);

-- 15. Payout Accounts (Source bank accounts for payouts)
CREATE TABLE IF NOT EXISTS payout_accounts (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    account_number TEXT NOT NULL,
    ifsc TEXT NOT NULL,
    bank_name TEXT,
    holder_name TEXT NOT NULL,
    balance_paise INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 16. Beneficiaries (Bank accounts & UPI IDs for payouts)
CREATE TABLE IF NOT EXISTS beneficiaries (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    beneficiary_type TEXT NOT NULL DEFAULT 'BANK_ACCOUNT',
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    bank_account TEXT,
    ifsc TEXT,
    upi_id TEXT,
    provider_bene_id TEXT,
    verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
    verified_name TEXT,
    verification_source TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_beneficiaries_merchant ON beneficiaries (merchant_id);

-- 17. Payment Orders (Sanbook Pay Universal Collections)
CREATE TABLE IF NOT EXISTS payment_orders (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    merchant_order_id TEXT NOT NULL,
    provider_order_id TEXT,
    payment_session_id TEXT,
    provider_name TEXT NOT NULL DEFAULT 'CASHFREE',
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'CREATED',
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    checkout_url TEXT,
    payment_method TEXT DEFAULT 'UPI',
    bank_reference TEXT,
    provider_payment_id TEXT,
    provider_response TEXT DEFAULT '{}',
    initiation_time_ms INTEGER DEFAULT 0,
    confirmation_time_ms INTEGER DEFAULT 0,
    webhook_delivery_time_ms INTEGER DEFAULT 0,
    settlement_time_ms INTEGER DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(merchant_id, merchant_order_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_provider ON payment_orders (provider_order_id);

-- 18. Payment Attempts
CREATE TABLE IF NOT EXISTS payment_attempts (
    id TEXT PRIMARY KEY,
    payment_order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    provider_payment_id TEXT,
    method TEXT NOT NULL DEFAULT 'UPI',
    status TEXT NOT NULL DEFAULT 'INITIATED',
    bank_reference TEXT,
    error_code TEXT,
    error_message TEXT,
    raw_details TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 19. Collection Events (Immutable State Audit)
CREATE TABLE IF NOT EXISTS collection_events (
    id TEXT PRIMARY KEY,
    payment_order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    payload TEXT DEFAULT '{}',
    latency_ms INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_collection_events_order ON collection_events (payment_order_id);

-- 20. Payouts (Real Outbound Disbursements)
CREATE TABLE IF NOT EXISTS payouts (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    transfer_id TEXT UNIQUE NOT NULL,
    idempotency_key TEXT UNIQUE NOT NULL,
    beneficiary_id TEXT REFERENCES beneficiaries(id),
    provider_connection_id TEXT REFERENCES provider_connections(id),
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    currency TEXT NOT NULL DEFAULT 'INR',
    payout_rail TEXT NOT NULL DEFAULT 'IMPS',
    fee_paise INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'CREATED',
    provider_transfer_id TEXT,
    provider_name TEXT NOT NULL DEFAULT 'CASHFREE',
    utr TEXT,
    failure_reason TEXT,
    remarks TEXT,
    initiated_by TEXT,
    approved_by TEXT,
    payout_account_id TEXT REFERENCES payout_accounts(id),
    initiation_time_ms INTEGER DEFAULT 0,
    confirmation_time_ms INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    submitted_at TEXT,
    confirmed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payouts_merchant_status ON payouts (merchant_id, status);

-- 21. Payout Approvals (Maker-Checker / Authorization)
CREATE TABLE IF NOT EXISTS payout_approvals (
    id TEXT PRIMARY KEY,
    payout_id TEXT NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
    step TEXT NOT NULL DEFAULT 'MAKER_CHECKER',
    approver_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    comments TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 22. Payout Events (Immutable Audit Trail)
CREATE TABLE IF NOT EXISTS payout_events (
    id TEXT PRIMARY KEY,
    payout_id TEXT NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 23. Refunds
CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    payment_order_id TEXT REFERENCES payment_orders(id),
    refund_id TEXT UNIQUE NOT NULL,
    provider_refund_id TEXT,
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    currency TEXT NOT NULL DEFAULT 'INR',
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    utr TEXT,
    provider_response TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds (payment_order_id);

-- 24. Reversals
CREATE TABLE IF NOT EXISTS reversals (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    payment_order_id TEXT REFERENCES payment_orders(id),
    amount_paise INTEGER NOT NULL,
    reason TEXT NOT NULL,
    bank_reference TEXT,
    status TEXT NOT NULL DEFAULT 'CONFIRMED',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 25. Settlements
CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    provider_connection_id TEXT REFERENCES provider_connections(id),
    settlement_id TEXT UNIQUE NOT NULL,
    provider_settlement_id TEXT,
    gross_amount_paise INTEGER NOT NULL,
    fee_paise INTEGER NOT NULL DEFAULT 0,
    tax_paise INTEGER NOT NULL DEFAULT 0,
    net_amount_paise INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    bank_utr TEXT,
    bank_account_number TEXT,
    settled_at TEXT,
    bank_confirmed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_settlements_merchant ON settlements (merchant_id);

-- 26. Settlement Entries
CREATE TABLE IF NOT EXISTS settlement_entries (
    id TEXT PRIMARY KEY,
    settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
    payment_order_id TEXT REFERENCES payment_orders(id),
    amount_paise INTEGER NOT NULL,
    fee_paise INTEGER NOT NULL DEFAULT 0,
    tax_paise INTEGER NOT NULL DEFAULT 0,
    net_paise INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 27. Double-Entry Financial Ledger: Accounts
CREATE TABLE IF NOT EXISTS ledger_accounts (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    account_code TEXT NOT NULL,
    account_name TEXT NOT NULL,
    account_type TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    balance_paise INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(merchant_id, account_code)
);

-- 28. Ledger Transactions (Atomic Transaction Groups)
CREATE TABLE IF NOT EXISTS ledger_transactions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    reference_type TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    narration TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'POSTED',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 29. Ledger Entries (Debits and Credits)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES ledger_accounts(id),
    direction TEXT NOT NULL,
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries (account_id);

-- 30. Reconciliation Runs
CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    provider_name TEXT NOT NULL DEFAULT 'CASHFREE',
    period_start TEXT,
    period_end TEXT,
    total_orders_checked INTEGER NOT NULL DEFAULT 0,
    total_matched INTEGER NOT NULL DEFAULT 0,
    total_discrepancies INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    details TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 31. Reconciliation Exceptions
CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    payment_order_id TEXT REFERENCES payment_orders(id),
    provider_order_id TEXT,
    exception_type TEXT NOT NULL,
    expected_value TEXT,
    actual_value TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN',
    resolution_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_exceptions_merchant ON reconciliation_exceptions (merchant_id, status);

-- 32. Webhook Endpoints
CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '["payment.success","payment.failed","payout.success","payout.failed","refund.success","settlement.completed"]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 33. Idempotency Keys
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_payload TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

-- 34. Operational Alerts
CREATE TABLE IF NOT EXISTS operational_alerts (
    id TEXT PRIMARY KEY,
    severity TEXT NOT NULL DEFAULT 'INFO',
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    is_acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 35. Split Settlement Rules — Per-merchant platform fee split for gaming/marketplace
CREATE TABLE IF NOT EXISTS split_settlement_rules (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    platform_fee_percent INTEGER NOT NULL DEFAULT 150,
    merchant_share_percent INTEGER NOT NULL DEFAULT 850,
    min_settlement_amount_paise INTEGER NOT NULL DEFAULT 100,
    settlement_day_of_month INTEGER NOT NULL DEFAULT 1,
    auto_settle_enabled INTEGER NOT NULL DEFAULT 0,
    gst_percent INTEGER NOT NULL DEFAULT 18,
    upi_collections_fee_percent INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(merchant_id)
);

-- 36. Split Settlement Entries — Per-transaction split breakdown for audit
CREATE TABLE IF NOT EXISTS split_settlement_entries (
    id TEXT PRIMARY KEY,
    settlement_id TEXT REFERENCES settlements(id) ON DELETE SET NULL,
    payment_order_id TEXT REFERENCES payment_orders(id),
    payment_session_id TEXT REFERENCES payment_sessions(id),
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    gross_amount_paise INTEGER NOT NULL,
    platform_fee_paise INTEGER NOT NULL DEFAULT 0,
    gst_on_fee_paise INTEGER NOT NULL DEFAULT 0,
    merchant_share_paise INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING',
    settled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_split_entries_merchant ON split_settlement_entries (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_split_entries_settlement ON split_settlement_entries (settlement_id);

-- ============================================================
-- SANBOOK PAY SUPER ADMIN & MULTI-TENANT SCHEMA EXTENSIONS
-- ============================================================

-- 37. Super Admin Users (Platform Owner, Admins, Operations, Finance, Security, Support)
CREATE TABLE IF NOT EXISTS super_admin_users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'SUPER_ADMIN',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    mfa_secret_encrypted TEXT,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 38. Super Admin Sessions
CREATE TABLE IF NOT EXISTS super_admin_sessions (
    id TEXT PRIMARY KEY,
    super_admin_id TEXT NOT NULL REFERENCES super_admin_users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_super_admin_sessions_token ON super_admin_sessions (token, is_active);
CREATE INDEX IF NOT EXISTS idx_super_admin_sessions_admin ON super_admin_sessions (super_admin_id);

-- 39. MFA Challenges (TOTP enrollment and verification)
CREATE TABLE IF NOT EXISTS mfa_challenges (
    id TEXT PRIMARY KEY,
    user_type TEXT NOT NULL,
    user_id TEXT NOT NULL,
    secret_encrypted TEXT NOT NULL,
    is_verified INTEGER NOT NULL DEFAULT 0,
    recovery_codes TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 40. Merchant Users (staff accounts per merchant)
CREATE TABLE IF NOT EXISTS merchant_users (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'VIEWER',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    mfa_secret_encrypted TEXT,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT uq_merchant_user_email UNIQUE(merchant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_merchant_users_merchant ON merchant_users (merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_users_email ON merchant_users (email);

-- 41. Merchant User Sessions
CREATE TABLE IF NOT EXISTS merchant_user_sessions (
    id TEXT PRIMARY KEY,
    merchant_user_id TEXT NOT NULL REFERENCES merchant_users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_merchant_user_sessions_token ON merchant_user_sessions (token, is_active);
CREATE INDEX IF NOT EXISTS idx_merchant_user_sessions_user ON merchant_user_sessions (merchant_user_id);

-- 42. Roles
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    scope TEXT NOT NULL DEFAULT 'platform',
    description TEXT,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 43. Permissions
CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    module TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 44. Role Permissions
CREATE TABLE IF NOT EXISTS role_permissions (
    id TEXT PRIMARY KEY,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    UNIQUE(role_id, permission_id)
);

-- 45. Merchant User Roles
CREATE TABLE IF NOT EXISTS merchant_user_roles (
    id TEXT PRIMARY KEY,
    merchant_user_id TEXT NOT NULL REFERENCES merchant_users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    UNIQUE(merchant_user_id, role_id)
);

-- 46. Session Revocations (forced logout / security)
CREATE TABLE IF NOT EXISTS session_revocations (
    id TEXT PRIMARY KEY,
    user_type TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    reason TEXT NOT NULL,
    revoked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 47. Routing Rules (Smart UPI routing per merchant)
CREATE TABLE IF NOT EXISTS routing_rules (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    receiving_account_id TEXT NOT NULL REFERENCES payment_receiving_accounts(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 100,
    weight INTEGER NOT NULL DEFAULT 100,
    min_amount_paise INTEGER,
    max_amount_paise INTEGER,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    is_primary INTEGER NOT NULL DEFAULT 0,
    strategy TEXT NOT NULL DEFAULT 'PRIORITY_BASED',
    health_check_interval_sec INTEGER NOT NULL DEFAULT 60,
    failure_threshold INTEGER NOT NULL DEFAULT 3,
    recovery_probe_interval_sec INTEGER NOT NULL DEFAULT 300,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_routing_rules_merchant ON routing_rules (merchant_id, is_enabled, priority);
CREATE INDEX IF NOT EXISTS idx_routing_rules_account ON routing_rules (receiving_account_id);

-- 48. Route Health (per-route health monitoring)
CREATE TABLE IF NOT EXISTS route_health (
    id TEXT PRIMARY KEY,
    routing_rule_id TEXT NOT NULL REFERENCES routing_rules(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'HEALTHY',
    success_rate TEXT NOT NULL DEFAULT '1.0000',
    timeout_rate TEXT NOT NULL DEFAULT '0.0000',
    error_rate TEXT NOT NULL DEFAULT '0.0000',
    avg_latency_ms INTEGER NOT NULL DEFAULT 0,
    last_success_at TEXT,
    last_failure_at TEXT,
    last_health_check_at TEXT,
    circuit_breaker_state TEXT NOT NULL DEFAULT 'CLOSED',
    circuit_breaker_opens_at TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_route_health_rule ON route_health (routing_rule_id);
CREATE INDEX IF NOT EXISTS idx_route_health_status ON route_health (status, circuit_breaker_state);

-- 49. Failover Events
CREATE TABLE IF NOT EXISTS failover_events (
    id TEXT PRIMARY KEY,
    payment_order_id TEXT REFERENCES payment_orders(id),
    from_route_id TEXT REFERENCES routing_rules(id),
    to_route_id TEXT REFERENCES routing_rules(id),
    reason TEXT NOT NULL,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'RECORDED',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_failover_events_order ON failover_events (payment_order_id);
CREATE INDEX IF NOT EXISTS idx_failover_events_created ON failover_events (created_at);

-- 50. Gaming Wallets
CREATE TABLE IF NOT EXISTS gaming_wallets (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    player_reference TEXT NOT NULL,
    balance_paise INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT uq_gaming_wallet_player UNIQUE(merchant_id, player_reference)
);
CREATE INDEX IF NOT EXISTS idx_gaming_wallets_merchant ON gaming_wallets (merchant_id);
CREATE INDEX IF NOT EXISTS idx_gaming_wallets_player ON gaming_wallets (player_reference);

-- 51. Wallet Transactions
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id TEXT PRIMARY KEY,
    wallet_id TEXT NOT NULL REFERENCES gaming_wallets(id) ON DELETE CASCADE,
    payment_order_id TEXT REFERENCES payment_orders(id),
    direction TEXT NOT NULL,
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    balance_after_paise INTEGER NOT NULL,
    narration TEXT NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet ON wallet_transactions (wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_idempotency ON wallet_transactions (idempotency_key);

-- 52. Pricing Plans
CREATE TABLE IF NOT EXISTS pricing_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    monthly_fee_paise INTEGER NOT NULL DEFAULT 0,
    transaction_fee_percent TEXT NOT NULL DEFAULT '0',
    transaction_fee_fixed_paise INTEGER NOT NULL DEFAULT 0,
    volume_tier_threshold_paise INTEGER NOT NULL DEFAULT 0,
    volume_tier_fee_percent TEXT,
    api_quota_daily INTEGER NOT NULL DEFAULT 1000,
    payment_link_limit INTEGER NOT NULL DEFAULT 1000,
    allowed_payment_methods TEXT NOT NULL DEFAULT '["UPI"]',
    feature_entitlements TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 53. Merchant Subscriptions
CREATE TABLE IF NOT EXISTS merchant_subscriptions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    pricing_plan_id TEXT NOT NULL REFERENCES pricing_plans(id),
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    current_period_start TEXT,
    current_period_end TEXT,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_merchant_subscriptions_merchant ON merchant_subscriptions (merchant_id);

-- 54. Diagnostic Logs
CREATE TABLE IF NOT EXISTS diagnostic_logs (
    id TEXT PRIMARY KEY,
    merchant_id TEXT REFERENCES merchants(id),
    search_key TEXT NOT NULL,
    search_type TEXT NOT NULL,
    order_created INTEGER NOT NULL DEFAULT 0,
    player_associated INTEGER NOT NULL DEFAULT 0,
    route_selected INTEGER NOT NULL DEFAULT 0,
    receiving_bank TEXT,
    receiving_vpa TEXT,
    qr_generated INTEGER NOT NULL DEFAULT 0,
    payment_attempt INTEGER NOT NULL DEFAULT 0,
    provider_confirmation INTEGER NOT NULL DEFAULT 0,
    failover_history TEXT DEFAULT '[]',
    ledger_posted INTEGER NOT NULL DEFAULT 0,
    webhook_delivered INTEGER NOT NULL DEFAULT 0,
    wallet_fulfilled INTEGER NOT NULL DEFAULT 0,
    reconciliation_status TEXT,
    evidence TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_key ON diagnostic_logs (search_key, search_type);
CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_merchant ON diagnostic_logs (merchant_id);

-- 55. Incident Reports
CREATE TABLE IF NOT EXISTS incident_reports (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'MEDIUM',
    status TEXT NOT NULL DEFAULT 'OPEN',
    category TEXT NOT NULL,
    merchant_id TEXT REFERENCES merchants(id),
    assigned_to TEXT,
    created_by TEXT NOT NULL,
    resolved_at TEXT,
    resolution_notes TEXT,
    timeline TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_incident_reports_status ON incident_reports (status, severity);
CREATE INDEX IF NOT EXISTS idx_incident_reports_merchant ON incident_reports (merchant_id);


