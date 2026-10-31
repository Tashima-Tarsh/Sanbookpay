# Dynamo Pay

Dynamo Pay is a merchant payment console, hosted UPI checkout and payment observation service. The active hosted entry point is `npm run start:hosted`, which runs the payment API, checkout, merchant console and Gmail observer behind one HTTPS origin. The demo store is disabled on the hosted gateway.

Start with the [configuration and integration manual](docs/OPERATIONS-MANUAL.md), [credential inventory](docs/CONFIGURATION-CREDENTIALS.md) and [current acceptance report](docs/PRODUCTION_ACCEPTANCE_REPORT.md). Public merchant API: `apps/merchant-admin/public/dynamo-openapi.json`. Operator/legacy API: `openapi.yaml`.

## Supported behaviour

- Hosted QR/UPI checkout, authenticated merchant create/status/IFSC/wallet endpoints, order-ID replay and per-account queues.
- Merchant dashboard with mobile navigation, live SSE invalidation and polling recovery.
- UPI channel enable/disable, amount limits and receiving-VPA allowlist.
- Merchant-scoped allow/block/watch acceptance rules with expiry, audit history and reversible state changes.
- Signed provider collection callbacks, amount/currency/reference validation, atomic journal/outbox writes and durable callback retries.
- SMS/Gmail/Android observations stored as supplementary production evidence. They do not independently prove settlement.
- Explicit owner bank-review confirmation with actual reference, reason, audit, journal and callback reservation.
- Refund reservation, manual transfer records, split fee/GST and recipient allocation workflows.
- Public setup PDF and protected owner credential/operations PDF; no real keys in public documentation.

## What requires external activation

Approved provider/bank credentials, bank agreements, OAuth consent, a current signed Android APK and real-device acceptance are separate requirements. Legacy local card/netbanking simulators do not process production money. Unconfigured automatic settlement returns an explicit unavailable response. Direct UPI without an authoritative confirmation feed requires owner bank review. The disabled demo wallet is not a production gaming-wallet service; customer systems implement durable callback deduplication and wallet posting.

## Runtime and development

Use Node.js 22.13 or newer (the Render deployment pins 22.23.4). Install with `npm ci --include=dev`. Run `npm run typecheck`, `npm run build`, `npm test`, and `node scripts/scan-secrets.js`. Build validates native JavaScript; historical TypeScript sources are not the active runtime.

Set private configuration from `.env.example`. With `DATABASE_URL`, the app uses PostgreSQL through a synchronous repository adapter backed by an I/O worker. Without it, local installations use SQLite WAL. Do not run reset/cleanup scripts on a live database. Test PostgreSQL only in an isolated temporary schema with a privately supplied `DYNAMO_POSTGRES_TEST_URL`.

`npm run start:hosted` exposes one public port and keeps component ports on loopback. Render Free sleeps while idle and the free database expires; see `docs/RENDER-TRIAL.md`. No uptime, instant bank notification or thousand-payment concurrency guarantee is claimed.

## Release discipline

Keep the current forest-green console and mobile checkout design. Preserve records, existing encryption keys and unrelated work. Work on a review branch; merge/deploy production only with explicit approval. The acceptance report identifies remaining external and infrastructure gates. Never commit `data/.secrets`, backups, keystores or private PDFs.
