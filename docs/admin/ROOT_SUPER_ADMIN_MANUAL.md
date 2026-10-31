# Root Super Admin Manual

Sanbook Pay Super Admin Control Center is the platform owner's centralized portal for governing all merchants, payments, routing, and financial operations on the platform.

## Navigation

The Super Admin sidebar contains 25 modules:

1. **Command Center** — Platform overview and merchant health summary
2. **Merchant Directory** — Browse and search all merchant accounts
3. **Create Merchant** — Provision a new independent merchant account
4. **Merchant Access & Users** — Manage merchant staff accounts and roles
5. **Receiving Bank Settings** — Manage approved receiving bank/UPI connections
6. **Receiving UPI Management** — Registry of approved receiving VPAs
7. **Smart UPI Routing** — Configure routing strategies, priorities, weights
8. **Automatic Failover** — Monitor route failover events and backup route activation
9. **Global Payment Links** — View all payment links across merchants
10. **Global Transactions** — View every payment across all merchants
11. **Payment Verification** — Monitor provider callbacks and verification
12. **API Management** — Manage merchant API credentials and scopes
13. **Callback & Webhook Control** — Manage merchant webhook endpoints and delivery
14. **Gaming Wallet Integration** — Monitor gaming wallet fulfillment
15. **Settlement & Reconciliation** — Monitor bank settlement and reconciliation
16. **Merchant Pricing & Billing** — Configure pricing plans and subscriptions
17. **Risk & UPI Policies** — Configure acceptance rules, blocks, watchlists
18. **Payment Diagnostic Center** — Search and investigate payment lifecycle events
19. **Operations & Incidents** — Monitor incidents, outages, operational alerts
20. **Platform Analytics** — Platform-wide volume, success rates, trends
21. **Staff & Permissions** — Manage platform staff roles and permissions
22. **Security & Audit Logs** — Review platform audit trails and security events
23. **System Configuration** — Configure platform-wide system settings
24. **Documentation & Support** — Platform manuals and support resources

## Authentication

- Platform Owner login requires email and password
- MFA is required for sensitive operations (merchant state changes, key rotation, connection approval)
- Sessions expire after 8 hours; CSRF protection on all state-changing requests
- All actions are audited with actor, timestamp, and details

## Tenant Isolation

- Platform staff (SUPER_ADMIN, OPERATIONS, FINANCE, SUPPORT, SECURITY, AUDITOR) can access all merchants
- Merchant-scoped roles (OWNER, ADMIN, DEVELOPER, FINANCE, SUPPORT, VIEWER) can only access their own merchant
- Merchant ID submitted by a browser is never trusted as authorization; server-authoritative tenant enforcement applies