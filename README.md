# Sanbook Pay

Sanbook Pay is a multi-merchant payment orchestration application with unresolved production acceptance gates. The Platform Owner (Root Super Admin) operates Sanbook Pay as the central supplier, creating and managing hundreds or thousands of independent merchant accounts.

## Architecture

**Sanbook Pay Platform**
  - Platform Owner / Root Super Admin
    - Platform Administrators, Operations, Finance, Security, Support
  - Merchant N — Independent dashboard, settings, API credentials, bank/UPI routes, payment links, webhooks, staff users

## Core Capabilities

### Platform Owner (Super Admin Control Center)
- Create and manage merchant accounts with unique Merchant IDs
- Assign approved receiving bank accounts and UPI routes
- Configure pricing plans, transaction fees, API quotas
- Smart UPI routing with automatic failover
- Authorized bank/PSP payment verification with signature validation
- Merchant callbacks and webhook management with durable retries
- Gaming wallet integration with idempotent fulfillment
- Settlement and reconciliation with double-entry ledger
- Payment diagnostics and incident management
- Full audit trail for all platform actions

### Merchants
- Independent secure login and dashboard
- Amount-only payment link creation (amount ₹ only — no manual Order ID, customer name, mobile, or UTR)
- Dynamic UPI QR/intent generation
- API key management with scopes and rate limits
- Webhook configuration and delivery monitoring
- Transaction history and reporting
- Staff and role management (Owner, Admin, Developer, Finance, Operations, Viewer)

## Documentation

Complete documentation is in `docs/`:

- `docs/README.md` — Documentation index
- `docs/admin/` — Super Admin workflow and implemented controls
- `docs/merchant/` — Merchant guides (onboarding, dashboard, payment links, etc.)
- `docs/developers/` — API integration, webhook integration, gaming wallet
- `docs/payments/` — Bank API config, UPI intent, automatic verification, reconciliation
- `docs/support/` — Merchant FAQ and troubleshooting
- `docs/security/` — Credential configuration
- `docs/deployment/` — Docker setup, production configuration, backup/recovery

## Runtime and Development

Use Node.js 22.13 or newer. Install with `npm ci --include=dev`. Run `npm run typecheck`, `npm run build`, `npm test`, and `node scripts/scan-secrets.js`.

Start the Super Admin Control Center: `npm run start:super-admin` (port 9000)
Start the Payment API: `npm run start:prod:api` (port 6100)
Start all services hosted: `npm run start:hosted`

Set private configuration from `.env.example`. With `DATABASE_URL`, the app uses PostgreSQL. Without it, local installations use SQLite WAL.

## Security

- Tenant isolation: server-authoritative merchant identity, no cross-tenant access
- MFA required for sensitive operations
- API key secrets SHA-256 hashed, client secrets encrypted at rest
- Never commit plaintext credentials to Git
- Webhook signatures verified with HMAC-SHA256
- No manual UTR entry; automatic capture from authorized provider APIs

## Release Discipline

Work on a review branch; merge/deploy production only with explicit approval. Never commit `data/.secrets`, backups, keystores or private PDFs.
## Current repair status

See [the attached-requirements matrix](docs/audit/ATTACHED_REQUIREMENTS_MATRIX.md), the Cashfree integration contract and the migration/rollback guide. Green source tests do not establish live provider verification, 1,000-concurrent capacity or production readiness.
