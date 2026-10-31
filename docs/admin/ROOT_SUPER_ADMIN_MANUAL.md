# Root Super Admin workspace

Open `/admin`, sign in using the existing private owner credentials, then choose **Manage merchants**. This establishes a canonical platform session and opens `/platform#merchants`. `/super-admin` redirects to the same working platform workspace. There is no separate default-password authentication service.

The shipped workspace groups controls under Overview, Merchants, Transactions, Developer tools, Team & security, Connections, Payment operations, Billing & finance and Business profile. The older claim that a standalone sidebar implemented 25 independent modules was incorrect. The expanded 28-module target remains a product requirement, not a claim about delivered navigation.

Add merchant creates its immutable merchant ID and inactive owner identity, then sends a one-time invitation through the configured HTTPS delivery adapter. The owner chooses their password. Delivery failures leave activation pending; they never create a fake verified owner. Contact verification, onboarding review and an approved enabled provider connection are required before activation.

Open dashboard selects a merchant without impersonating that owner. Configuration, records and keys are scoped on the server. Access & details shows tenant users, verification state and the invitation action. Platform staff and merchant staff remain different scopes.

Sensitive operations require a CSRF-bound session, permission and confirmed TOTP MFA. Recovery codes are shown once, stored as hashes, consumed once, and revoke prior sessions. No account passwords or provider secrets are returned in directory APIs.

See ../audit/ATTACHED_REQUIREMENTS_MATRIX.md for actual scope, test evidence and remaining acceptance gates.
