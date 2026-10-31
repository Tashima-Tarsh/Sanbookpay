# Sanbook Pay

Sanbook Pay is a production-ready, multi-merchant payment orchestration SaaS platform. The Platform Owner operates Sanbook Pay as the central supplier, creating and managing hundreds or thousands of independent merchant accounts.

## Features

### Platform Owner (Super Admin)
- Create and manage merchant accounts
- Assign receiving bank/UPI routes
- Configure pricing and API credentials
- Monitor all transactions across merchants
- Smart UPI routing with automatic failover
- Payment verification through authorized bank/PSP APIs
- Merchant callbacks and webhook management
- Gaming wallet integration
- Settlement and reconciliation
- Diagnostics and incident management

### Merchants
- Independent login and dashboard
- Amount-only payment link creation (no manual Order ID, customer details, or UTR)
- Dynamic UPI QR/intent generation
- API key management
- Webhook configuration
- Transaction history and reporting
- Staff and role management

## Documentation

See `docs/` for complete documentation:
- `docs/admin/` — Super Admin manuals
- `docs/merchant/` — Merchant guides
- `docs/developers/` — API and integration references
- `docs/payments/` — Payment processing documentation
- `docs/support/` — FAQ and troubleshooting
- `docs/security/` — Credential and security configuration
- `docs/deployment/` — Deployment and operations

## Runtime

Node.js 22.13+. Run `npm run typecheck`, `npm run build`, `npm test` to validate.