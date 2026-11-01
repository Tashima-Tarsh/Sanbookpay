> Current implementation note (1 November 2026): see docs/merchant/CURRENT-MERCHANT-LAUNCH-FLOW.md for scoped merchant onboarding, approved notification-source acceptance, callback recovery and current handover steps. Historical verification-only and legacy minimum descriptions below do not override that explicit policy. Pending local fixes are not production deployment proof.

# Sanbook Pay Runtime Architecture

## Active Execution Path

`scripts/start-hosted.js` resolves the canonical public origin, restores private files from PostgreSQL when configured, starts four component HTTP services and routes one public origin to them:

```
Platform Owner -> Super Admin Control Center (port 9000) -> Payment API proxy
Merchant backend -> authenticated create/status API -> payment session/order
Customer browser -> hosted checkout -> QR / UPI intent / payment-done request
Approved provider -> raw-body signature + amount/currency/reference validation
Confirmation -> atomic status + double-entry journal + outgoing callback reservation
Callback worker -> merchant endpoint (HMAC, retry, delivery-ID deduplication)
State invalidation -> authenticated console SSE / checkout SSE -> canonical API refresh
```

## Services and Storage

- **Payment API** (6100): Core payment processing, provider integration, webhooks, Super Admin platform APIs
- **Super Admin Control Center** (9000): Platform owner portal for merchant management, routing, failover, diagnostics
- **Checkout** (7000): Customer-facing hosted UPI checkout portal
- **Merchant Console** (6001): Merchant dashboard for independent operations

SQLite WAL is the local/test adapter. PostgreSQL is selected with `DATABASE_URL` and stores hosted financial records and restored private files. Nested financial work uses transactions/savepoints.

## Platform Schema (`pp_*` tables)

- `pp_merchants` — Merchant accounts with status and profile
- `pp_users` — Platform and merchant users with roles, MFA, verification
- `pp_sessions` — Platform sessions with CSRF, MFA verification
- `pp_tokens` — Verification, invitation, password reset tokens
- `pp_login_limits` — Rate limiting for login attempts
- `pp_user_permissions` — Custom user permission overrides
- `pp_audit` — Immutable audit log for all platform actions
- `pp_cases` / `pp_case_events` — Support, dispute, reconciliation, incident cases
- `pp_pricing_plans` / `pp_subscriptions` / `pp_invoices` — Pricing and billing
- `pp_api_keys` / `pp_api_windows` / `pp_api_requests` — Merchant API credentials and usage
- `pp_connection_policy` — Provider connection approval, enablement, routing policy, circuit breaker
- `pp_rules` / `pp_rule_revisions` — Merchant acceptance rules (allow/block/watch)

## Authentication and RBAC

- Platform staff roles: SUPER_ADMIN, OPERATIONS, FINANCE, SUPPORT, SECURITY, AUDITOR
- Merchant roles: OWNER, ADMIN, DEVELOPER, FINANCE, SUPPORT, VIEWER
- MFA required for sensitive operations (merchant state changes, key rotation, connection approval)
- Sessions expire after 8 hours; CSRF protection on all state-changing requests
- Tenant-scoped queries prevent cross-merchant access

## Smart UPI Routing

Routes are selected based on health, priority, weight, amount limits, and circuit breaker state. Supported strategies: priority-based, weighted, health-aware, latency-aware, success-rate-aware, capacity-aware, cost-aware, and controlled automatic failover.

## Automatic Failover

When a primary provider connection fails, the system automatically attempts backup connections before returning RECONCILIATION_REQUIRED. Failover events are recorded with reason, trigger, and timestamp.

## Payment Verification

Authoritative sources only: verified provider webhook (signature verification), authenticated provider status API, authorized bank transaction feed, provider reconciliation report, bank settlement report. No amount-only matching or customer screenshots as proof of payment.

## Webhooks

- Incoming: Bank/PSP → Sanbook Pay with HMAC-SHA256 signature verification
- Outgoing: Sanbook Pay → Merchant with signed events, durable retries (5s, 30s, 2m, 10m, 1h), delivery logs
- Webhook delivery is at-least-once; merchants must implement idempotent handling

## Ledger

- Integer-paise accounting
- Double-entry ledger
- Immutable financial records
- Atomic posting with idempotency
- Never silently rewrite historical ledger entries

## Observers

SMS/Gmail/Android observations are supplementary evidence only. Production SMS/Gmail/Android notifications do not independently prove bank settlement.

## Verification and Attribution

Production observer messages are supplementary evidence. A matching amount alone cannot mark a customer paid. Provider collection confirmation validates signature, currency, exact paise and provider payment-reference ownership, then atomically posts the state, journal and provider callback.

## Credentials

Credentials stay in hosting secrets, encrypted merchant configuration and ignored private files. No credentials are rotated by the code freeze. Never print or commit real passwords, tokens, private PDFs, keystores or connection strings.
## Security repair architecture

The active owner/merchant workspace is /platform; /super-admin redirects there. Legacy superadmin API aliases use canonical cookie, CSRF, TOTP and recovery-code handling. Payment links reuse the scoped canonical payment engine. pp_payment_attempts preserves the selected connection/environment/provider correlation and route snapshot; an uncertain response never rewrites it or sends a second provider request. Verified provider events are retained encrypted; duplicate success journals and wallet fulfillment are uniquely claimed. See docs/audit/ATTACHED_REQUIREMENTS_MATRIX.md for actual acceptance limits.
