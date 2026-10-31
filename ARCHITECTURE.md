# Dynamo Pay runtime architecture

## Active execution path

`scripts/start-hosted.js` resolves the canonical public origin, restores private files from PostgreSQL when configured, starts four component HTTP services and routes one public origin to them:

```
Merchant backend -> authenticated create/status API -> payment session/order
Customer browser -> hosted checkout -> QR / UPI intent / payment-done request
Android / Gmail -> source validation -> normalized observation -> supplementary evidence
Approved provider -> raw-body signature + amount/currency/reference validation
Owner bank review -> authenticated explicit review + actual bank reference
Confirmation -> atomic status + double-entry journal + outgoing callback reservation
Callback worker -> merchant endpoint (HMAC, retry, delivery-ID deduplication)
State invalidation -> authenticated console SSE / checkout SSE -> canonical API refresh
```

## Services and storage

Payment API (6100), checkout (7000), merchant console (6001) and Gmail observer (6003) run in the hosted process; only the ingress binds Render's public PORT. SQLite WAL is the local/test adapter. PostgreSQL is selected with DATABASE_URL and stores hosted financial records and restored private files. Nested financial work uses transactions/savepoints. Redis/BullMQ and alternative webhook adapters exist but are not the authoritative native callback outbox or proof that distributed workers are running.

## Verification and attribution

Production observer messages are supplementary evidence. A matching amount alone cannot mark a customer paid. Provider collection confirmation validates signature, currency, exact paise and provider payment-reference ownership, then atomically posts the state, journal and provider callback. Owner-reviewed bank credit remains labelled MERCHANT_CONFIRMED. Card/netbanking local simulation is test-only; automatic settlement is unavailable without a real bank integration. Historical records retain their existing labels.

Direct UPI permits one active receiving VPA per merchant and one ACTIVE/PROCESSING session per receiving account. Other sessions queue. Acceptance rules and channel limits apply to new payment requests; they do not redirect an already initiated payment. Submitted customer VPAs are request metadata, not verified payer identity.

## Delivery and recovery

Callbacks persist before network delivery and retry up to five attempts, with stable payload and delivery ID. Merchants must implement at-least-once delivery handling with unique order/delivery constraints and atomic wallet updates. SSE carries invalidation, not durable replay: reconnect fetches current records and the console polls every 20 seconds as fallback. Database adapter connection failure is fail-closed and may require restarting the service; always-on HA and distributed replay are not implemented by the free trial.

## Observers and private configuration

Gmail polling is explicitly bound to an account, paginates a seven-day lookback and prevents overlapping polls. Android Java source signs events and heartbeat, persists pending delivery and retries in the foreground service. The current native source must be rebuilt using the original private signing identity; production download checks reject stale source/APK manifests. Native installation, permissions, battery behaviour and reboot recovery require a real device test.

Credentials stay in hosting secrets, encrypted merchant configuration and ignored private files. hosted_files and backups require database-level access protection; they are not a separate encrypted vault. See [credential inventory](docs/CONFIGURATION-CREDENTIALS.md). No credentials are rotated by the code freeze.
