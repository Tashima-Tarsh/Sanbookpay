# Dynamo Pay documentation

This index follows the product as it runs today. Procedures that require a real bank/provider, Google consent, or the original Android signing toolchain are marked as external activation steps; a passing local test never represents a real payment.

## Merchant owner and staff

- [Operations and integration manual](OPERATIONS-MANUAL.md) — current gateway, checkout, UPI, callbacks, observers, refunds, splits and hosting.
- [Configuration and credential inventory](CONFIGURATION-CREDENTIALS.md) — placeholder names, ownership and rotation rules; secret values remain private.
- [Merchant integration](MERCHANT_INTEGRATION.md) — server-side API and signed callback flow.
- [Observer setup](OBSERVERS_SETUP.md) — Android and Gmail setup, permissions and supplementary-evidence policy.
- [White-label configuration](WHITE_LABEL.md) — checkout branding and merchant settings.
- [Merchant and Super Admin manual](MERCHANT-ADMIN-MANUAL.md) — combined onboarding, access, keys, connections, billing and operations guide.

## Operations and platform administration

- [Current acceptance report](PRODUCTION_ACCEPTANCE_REPORT.md) — tested scope, measured results and external blockers.
- [Deployment](DEPLOYMENT.md) and [production deployment](PRODUCTION_DEPLOYMENT.md) — startup, health, backup and rollback.
- [Reconciliation](SETTLEMENT_RECONCILIATION.md) — provider confirmation, manual bank review and unresolved cases.
- `/platform` — authenticated merchant/Super Admin workspace for onboarding, staff, keys, connections, operations, billing and settings.

## Developers

- `/developers` — current API guide and OpenAPI document.
- [Developer integration](DEVELOPER_INTEGRATION.md) — idempotent requests and raw-body webhook verification.
- [Installation](INSTALLATION.md) — local prerequisites and database selection.

Historical files remain in this directory for reference and are superseded by the documents above. Do not copy credentials from any public document.
