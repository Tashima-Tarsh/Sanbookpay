# Merchant Login and Roles

## Roles

- **Owner** — Full merchant access
- **Admin** — Settings, staff, keys, webhooks, payments, refunds
- **Developer** — API keys, webhooks, payments, transactions
- **Finance** — Finance read/write, transactions, refunds, reports
- **Operations** — Operations read/write, transactions
- **Viewer** — Read-only access

## Permissions

Granular permissions are assigned per role. Custom permissions can be assigned as a subset of the role's base permissions.

## Security

- Each merchant has its own secure login
- Merchant logs in using its own user account and sees only its own organization
- MFA enrollment supported for all roles
- Passwords are never viewable by administrators
- Session revocation supported
- Login activity is tracked