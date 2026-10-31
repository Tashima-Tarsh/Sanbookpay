# Merchant Login Control

## Merchant Roles

- **Owner** — Full access to all merchant settings and operations
- **Admin** — Manage settings, staff, keys, webhooks, payments, refunds, reports
- **Developer** — API keys, webhooks, payments, transactions; limited financial access
- **Finance** — Finance read/write, transactions, refunds, reports
- **Operations** — Operations read/write, transactions, payments read
- **Viewer** — Read-only access to transactions, finance, operations, payments, reports

## Granular Permissions

Each role has a defined permission set. Custom permissions can be assigned as a subset of the role's base permissions.

## User Management

- Platform Owner can invite, deactivate, and revoke merchant user sessions
- MFA enrollment is required for sensitive operations
- Password reset uses secure token delivery, never plaintext
- Login activity is tracked and auditable

## Security

- Never view or retrieve passwords
- All authentication is server-authoritative
- Tenant-scoped queries prevent cross-merchant access
- MFA verification required for sensitive state changes