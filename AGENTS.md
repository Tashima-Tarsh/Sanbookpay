# Sanbook Pay Engineering Instructions

Read README.md, ARCHITECTURE.md, docs/OPERATIONS-MANUAL.md and docs/PRODUCTION_ACCEPTANCE_REPORT.md before editing. Verify local HEAD against GitHub's default branch and identify the deployed commit. Do not assume an older test report describes current production.

## Preserve the product

Keep the current console/checkout identity, palette, typography, navigation and responsive layout. Reuse existing forms, dialogs and tables. Capture and compare desktop/mobile views for UI changes. Preserve payment records, merchant ownership, existing keys and unrelated staged files. Never force-push or silently reset a database. Production merge/deployment and credential rotation require explicit authorization.

## Payment invariants

- Production SMS/Gmail/Android notifications are supplementary evidence. Do not turn a notification, amount match or browser event into proof of bank settlement.
- Provider success requires signature verification over raw bytes, order ownership, exact amount/currency and a non-reused payment reference. Save state, journal and outgoing callback atomically.
- Owner bank review must be admin-authorized, use an actual reference and reason, remain labelled MERCHANT and create an audit trail. It must not become a public force-success API.
- COD success is order placement; counter cash/card needs explicit till confirmation. Legacy online card/netbanking simulators are test-only.
- Use positive integer paise; reject malformed amounts. Preserve refund/payout reservations when a provider response is uncertain. Do not retry with a new external transfer/refund ID after a timeout.
- Callback delivery is at least once. Receivers verify raw-body HMAC and atomically deduplicate/credit their own wallet. Browser events are UI-only.
- Never invent UTRs, contacts, delivery receipts, settlements or performance results.

## Runtime and tests

JavaScript files are the active runtime. Node.js 22.13+ is required. Run typecheck, runtime build, secret scan and npm test. PostgreSQL acceptance uses a separate temporary schema; native Android, Docker and real provider/device tests must be reported separately from JavaScript simulators. Tests may use synthetic evidence only in isolated test data, never production financial records.

## Secrets and documents

Never print or commit real passwords, tokens, private PDFs, keystores or connection strings. Preserve existing encryption keys. Public configuration is generated from docs/OPERATIONS-MANUAL.md using scripts/build-operations-manual.py. The private handover generator reads ignored owner credentials and writes only to data/.secrets. Review rendered PDFs and verify that public PDFs contain no private credential values. Do not overwrite current manuals with historical build scripts or claim unconfigured bank adapters are live.

## Super Admin Control Center

The Super Admin Control Center runs on port 9000 (`npm run start:super-admin`) and proxies API requests to the Payment API (port 6100). All 25 navigation modules are implemented:

Command Center, Merchant Directory, Create Merchant, Merchant Access & Users, Receiving Bank Settings, Receiving UPI Management, Smart UPI Routing, Automatic Failover, Global Payment Links, Global Transactions, Payment Verification, API Management, Callback & Webhook Control, Gaming Wallet Integration, Settlement & Reconciliation, Merchant Pricing & Billing, Risk & UPI Policies, Payment Diagnostic Center, Operations & Incidents, Platform Analytics, Staff & Permissions, Security & Audit Logs, System Configuration, Documentation & Support.

## Automatic Failover

When a primary provider connection fails during payment creation, the system automatically attempts eligible backup connections before returning RECONCILIATION_REQUIRED. Failover events are recorded with reason, trigger, and timestamp in the audit log.

## Amount-Only Payment Links

The Create Payment Link endpoint (`POST /api/v1/payment-links/amount-only`) requires only the amount. Order ID, Payment ID, receiving route, UPI QR/intent, and checkout URL are all generated automatically. No manual Order ID, customer name, customer mobile, or UTR is required.