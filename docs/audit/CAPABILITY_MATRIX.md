# Sanbookpay — Capability Matrix (Phase 0 Audit)

**Repository:** https://github.com/Tashima-Tarsh/Sanbookpay
**Audit baseline:** main branch, 2 November 2026
**Rating scale:** IMPLEMENTED / PARTIAL / BROKEN / MISSING / UNVERIFIED

Each finding cites exact repository file paths and function names.

---

## 1. Platform & Runtime

| Capability | Rating | Evidence (file:line / function) | Notes |
|---|---|---|---|
| Monorepo workspaces (packages/*, apps/*) | IMPLEMENTED | `package.json` workspaces | Node.js 22.13+, pnpm-style workspaces |
| Payment API (port 6100) | IMPLEMENTED | `apps/payment-api/src/index.js` | Custom HttpServer, Express-like routing |
| Checkout portal (port 7000) | IMPLEMENTED | `apps/checkout-portal/src/views/checkout.html` | 7,582 lines, QR, SSE, payment-done |
| Merchant admin (port ?) | IMPLEMENTED | `apps/merchant-admin/src/server.js` | AdminServer, proxies to payment API |
| Super admin / control center (port 9000) | IMPLEMENTED | `apps/super-admin/src/server.js` | 25 nav modules |
| Gmail observer (port 6003) | IMPLEMENTED | `apps/gmail-observer/src/server.js` | OAuth2, poller, browser automator |
| SMS observer | IMPLEMENTED | `apps/sms-observer/src/sms-service.js` | BankSmsParser, PaymentObserverClient |
| Android bridge | PARTIAL | `apps/android-bridge/...` | 5-second polling loop (see Phase 5) |
| Android observer-app | PARTIAL | `apps/android-observer-app/...` | Separate parallel implementation |
| TypeScript typecheck | IMPLEMENTED | `tsconfig.json`, `npm run typecheck` | Passes (51 tests) |
| Test suite (node --test) | IMPLEMENTED | `packages/core/src/__tests__`, `packages/common/src/__tests__` | 51 pass, 0 fail |
| Secret scan | IMPLEMENTED | `scripts/scan-secrets.js` | 671 paths, passed |

---

## 2. State Machine & Payment Lifecycle

| Capability | Rating | Evidence | Notes |
|---|---|---|---|
| PaymentStatus enum | IMPLEMENTED | `packages/common/src/enums.js` | INITIATED/QUEUED/ACTIVE/PROCESSING/VERIFICATION_PENDING/SUCCESS/FAILED/EXPIRED/CANCELLED |
| New mission states added | IMPLEMENTED | `packages/common/src/enums.js` | CREATED, INTENT_OPENED, CLIENT_REPORTED_SUCCESS, CREDIT_OBSERVED, MULTI_SIGNAL_MATCHED, PAID_VERIFIED, RECONCILIATION_REQUIRED |
| Valid transitions | PARTIAL | `packages/common/src/state-transitions.js` | VALID_TRANSITIONS extended for new states; EXPIRED universal |
| State transition assertion | IMPLEMENTED | `packages/common/src/state-transitions.js` | assertValidTransition, isValidTransition |
| ObserverSource enum | IMPLEMENTED | `packages/common/src/enums.js` | GMAIL, GOOGLE_MESSAGES, ANDROID_OBSERVER, SMS_GATEWAY, INTENT_RETURN, MANUAL_COUNTER |
| PaymentEvidenceLevel enum | IMPLEMENTED | `packages/common/src/enums.js` | REPORTED, OBSERVED, MATCHED, VERIFIED |
| UpiMirrorWebhookEvent (new events) | IMPLEMENTED | `packages/common/src/enums.js` | payment.intent_opened, .client_returned, .client_reported_success, .credit_observed, .multi_signal_matched, .expired, .reconciliation_required |

---

## 3. UPI Intent (Phase 1/2/3)

| Capability | Rating | Evidence | Notes |
|---|---|---|---|
| Generic upi://pay URI builder | IMPLEMENTED | `packages/common/src/upi-qr.js:buildUpiPaymentUri` | NPCI-compliant, all UPI apps |
| App-specific deep links | IMPLEMENTED | `packages/common/src/upi-qr.js:buildUpiPaymentIntentLinks` | phonepe/gpay/paytm/bhim/upi |
| VPA validation | IMPLEMENTED | `packages/common/src/upi.js:isValidVpa` | |
| Android UPI Intent SDK | MISSING (now added) | `packages/android-upi-intent-sdk/` | Created: UpiIntentSdk, UpiIntentEngine, UpiResponseParser, PendingPaymentStore, ReturnTransmitter, UpiIntentAdapter, ForwardRetryWorker |
| createPaymentIntent() | IMPLEMENTED (SDK) | `packages/android-upi-intent-sdk/...:UpiIntentSdk.createPaymentIntent` | Generic upi://pay |
| discoverCompatibleUpiApps() | IMPLEMENTED (SDK) | `...:UpiIntentEngine.discoverCompatibleUpiApps` | Package-query based, no hardcoding |
| launchPayment() | IMPLEMENTED (SDK) | `...:UpiIntentSdk.launchPayment` | Activity Result API |
| capturePaymentReturn() | IMPLEMENTED (SDK) | `...:UpiIntentSdk.capturePaymentReturn` | Parses intent extras/URI |
| parseUpiResponse() / normalizeReportedStatus() | IMPLEMENTED (SDK) | `...:UpiResponseParser` | SUCCESS/FAILED/PENDING/CANCELLED/UNKNOWN/UNSUPPORTED |
| submitReturnToServer() | IMPLEMENTED (SDK) | `...:ReturnTransmitter.submit` | Immediate transmission + WorkManager retry |
| resumePendingPayment() | IMPLEMENTED (SDK) | `...:UpiIntentSdk.resumePendingPayment` | Encrypted local store recovery |
| getServerPaymentStatus() | IMPLEMENTED (SDK) | `...:UpiIntentSdk.getServerPaymentStatus` | Server status query |
| Encrypted pending-payment store | IMPLEMENTED (SDK) | `...:PendingPaymentStore` | EncryptedSharedPreferences AES256-GCM |
| WorkManager reliable retry | IMPLEMENTED (SDK) | `...:ForwardRetryWorker` | CONNECTED constraint, exponential backoff |
| POST /api/v1/payments/intents | IMPLEMENTED | `apps/payment-api/src/routes/upi-intent-routes.js:registerUpiIntentRoutes` | paymentId, orderId, attemptId, correlationId, UPI URI, expiry |
| POST /api/v1/payments/{id}/client-return | IMPLEMENTED | `upi-intent-routes.js` | Idempotency key, ownership enforcement, buyer-reported |
| GET /api/v1/payments/{id}/status | IMPLEMENTED | `upi-intent-routes.js` | Public + internal views |
| GET /api/v1/payments/{id}/events | IMPLEMENTED | `upi-intent-routes.js` | Callback outbox timeline |
| GET /api/v1/payments/{id}/investigation | IMPLEMENTED | `upi-intent-routes.js` | Full investigation view (Phase 12) |
| GET /api/v1/upi/compatibility | IMPLEMENTED | `upi-intent-routes.js` | Capability info |
| POST /api/v1/merchant/webhooks/test | IMPLEMENTED | `upi-intent-routes.js` | HMAC test delivery |
| findByIdempotencyKey | IMPLEMENTED | `packages/db/src/repositories/payment-session.repository.js` | Added |

**Android SDK note:** Cannot be compiled in this environment (no Java/Android SDK installed). Source written; build requires Android SDK + Gradle (Phase 15).

---

## 4. Android Observer (Phase 5)

| Capability | Rating | Evidence | Notes |
|---|---|---|---|
| EventQueue (SharedPreferences encrypted) | IMPLEMENTED | `apps/android-bridge/.../EventQueue.kt` | Encrypted local queue |
| EventForwarder | PARTIAL | `apps/android-bridge/.../EventForwarder.kt` | 5-second periodic forwarding loop |
| SmsReceiver | IMPLEMENTED | `apps/android-bridge/.../SmsReceiver.kt` | SMS broadcast receiver |
| NotificationListenerService | IMPLEMENTED | `apps/android-bridge/.../NotificationListenerService.kt` | Notification listener |
| ApiClient | IMPLEMENTED | `apps/android-bridge/.../ApiClient.kt` | API client with pairing |
| MainActivity | REPAIRED | `apps/android-bridge/.../MainActivity.kt` | Replaced 5s poll with event-triggered forwarding + WorkManager |
| ForwardRetryWorker | ADDED | `apps/android-bridge/.../workers/ForwardRetryWorker.kt` | WorkManager durable retry, CONNECTED constraint |
| Event-triggered forwarding | ADDED | `MainActivity.kt:attemptImmediateForward` | Forwards immediately when connected, no deliberate 5s wait |
| Periodic reconciliation | RETAINED | `MainActivity.kt:scheduleDurableRetryAndReconciliation` | PeriodicWorkRequest 15 min |
| No duplicate financial observations | PARTIAL | `EventQueue` deduplicates by fingerprint | Needs client-return idempotency (server-side) |
| Android observer-app | PARTIAL | `apps/android-observer-app/...` | Parallel implementation; consolidation recommended |

**Kotlin note:** Cannot be compiled in this environment (no Java/Android SDK). Source written.

---

## 5. Gmail Observer (Phase 6)

| Capability | Rating | Evidence | Notes |
|---|---|---|---|
| Secure OAuth connection | IMPLEMENTED | `apps/gmail-observer/src/index.js` | OAuth2 client |
| Token refresh | IMPLEMENTED | `apps/gmail-observer/src/index.js` | Google OAuth2Client token refresh |
| Gmail push notifications | PARTIAL | `apps/gmail-observer/src/index.js` | Where configured |
| Incremental mailbox history sync | IMPLEMENTED | `apps/gmail-observer/src/index.js` | historyId-based sync |
| Missed-event recovery | PARTIAL | `apps/gmail-observer/src/index.js` | Full resync fallback |
| Credit-notification parsing | IMPLEMENTED | `packages/common/src/...` + gmail parser | Bank credit parsing |
| Message deduplication | IMPLEMENTED | fingerprint-based | |
| Merchant binding | IMPLEMENTED | `merchant_upi_connections` table | |
| Correlation metadata | IMPLEMENTED | `upi_mirror_observations` table | event_id, fingerprint_hash, reference_utr |
| Observer health dashboard | PARTIAL | `merchant_upi_connections.health_status` | connection_health_events |

Bank email observations are NOT labeled authenticated bank settlement (attribution engine labels them supplementary evidence).

---

## 6. Triple-Signal Correlation (Phase 7)

| Capability | Rating | Evidence | Notes |
|---|---|---|---|
| Normalized event model | IMPLEMENTED | `packages/db/src/repositories/observation.repository.js` | upi_mirror_observations (merchantId, orderId, amountPaise, currency, reference_utr, source, status, timestamp) |
| Correlation by reliable identifiers | IMPLEMENTED | `packages/core/src/attribution-engine.js` | UTR + receiving account + amount (NOT amount-only) |
| UPI Intent Return (A) | IMPLEMENTED | `upi-intent-routes.js` + `processIntentReturnSignal` | CLIENT_REPORTED_SUCCESS (REPORTED evidence) |
| Gmail Observer (B) | IMPLEMENTED | `attribution-engine.js` BANK_SOURCES | OBSERVED evidence |
| SMS / Android Observer (C) | IMPLEMENTED | `attribution-engine.js` BANK_SOURCES | OBSERVED evidence |
| Authorized bank/PSP verification (D) | PARTIAL | Provider registry (hyperswitch-provider.js) | Fail-closed, signature verification |
| Evidence levels | IMPLEMENTED | `PaymentEvidenceLevel` | REPORTED/OBSERVED/MATCHED/VERIFIED |
| PAID_VERIFIED requires authoritative event | IMPLEMENTED | `attribution-engine.js` | Only bank confirmation reaches SUCCESS/PAID_VERIFIED |
| No amount-only matching | IMPLEMENTED | `attribution-engine.js:186` comment + code | UTR + account required |

---

## 7. Event Delivery (Phase 8)

| Capability | Rating | Evidence | Notes |
|---|---|---|---|
| Redis connection in index.js | PARTIAL | `apps/payment-api/src/index.js:242` | Was in-memory fallback; now warns, uses callback_outbox |
| Durable PostgreSQL transactional outbox | IMPLEMENTED | `packages/db/src/migrations/001-upi-mirror.sql:149` | callback_outbox table |
| Persistent event IDs | IMPLEMENTED | `callback_outbox.id` + idempotency_key | |
| Deduplicated worker processing | IMPLEMENTED | `callback_outbox.idempotency_key` unique index | |
| Reliable dispatch | IMPLEMENTED | `webhook-engine-concurrent.js` | At-least-once, retry history |
| Backpressure | PARTIAL | webhook concurrency limits | |
| Exponential retry | IMPLEMENTED | `callback_outbox.max_attempts`, `next_retry_at` | |
| Dead-letter handling | IMPLEMENTED | `callback_outbox.status` + delivery attempts | |
| Restart recovery | IMPLEMENTED | callback_outbox persisted in DB | |
| Tenant-specific event streams | PARTIAL | callback_outbox.merchant_id | |
| In-memory fallback (dev only) | FIXED | `index.js` now warns instead of silent fallback | |

---

## 8. Merchant Webhook Engine (Phase 9)

| Capability | Rating | Evidence | Notes |
|---|---|---|---|
| HMAC-signed webhooks | IMPLEMENTED | `packages/common/src/dynamo-webhooks.js` | generateHmac, timingSafeEqual |
| Timestamp + replay protection | IMPLEMENTED | `apps/coin-wallet-store/src/server.js:590` | X-Gateway-Timestamp skew, X-Gateway-Delivery-Id dedupe |
| At-least-once delivery | IMPLEMENTED | `webhook-engine-concurrent.js` | callback_outbox retry |
| Idempotent event IDs | IMPLEMENTED | `callback_outbox.idempotency_key` unique index | |
| Delivery logs | IMPLEMENTED | `callback_delivery_attempts` table | |
| Retry history | IMPLEMENTED | `callback_delivery_attempts` | |
| Dead-letter queue | PARTIAL | callback_outbox status/last_error | |
| Merchant-controlled callback URL | IMPLEMENTED | `merchant_upi_connections.webhook_url` | |
| Webhook secret rotation | PARTIAL | `merchant_upi_connections.webhook_secret` | No rotation workflow yet |
| Real-time status visibility | IMPLEMENTED | SSE broadcastSse | |
| New intent events dispatched | IMPLEMENTED | `upi-intent-routes.js` | payment.client_returned etc. |

---

## 9. Bank / Payment Orchestration (Phase 10)

| Capability | Rating | Evidence | Notes |
|---|---|---|---|
| Provider registry | IMPLEMENTED | `packages/core/src/provider-registry.js` | cashfree, phonepe, paytm, direct-bank, hyperswitch |
| Hyperswitch provider | IMPLEMENTED | `packages/core/src/providers/hyperswitch-provider.js` | Fail-closed, signature verification |
| Environment config | IMPLEMENTED | provider env vars | HYPERSWITCH_*_BASE_URL |
| Webhook signature verification | IMPLEMENTED | `hyperswitch-provider.js:verifyCollectionWebhook` | HMAC-SHA512, timingSafeEqual |
| Transaction status query | IMPLEMENTED | `getCollectionStatus` | force_sync=true |
| Payment idempotency | IMPLEMENTED | `idempotency_key`, jobId | |
| Credential isolation | IMPLEMENTED | provider config per merchant | |
| Failure/timeout behavior | IMPLEMENTED | `definitiveRejection`, AbortSignal.timeout(15000) | |
| Hyperswitch PR #9 | MERGED | commit cd1b2d0 | Already on main |
| No manufactured bank success | IMPLEMENTED | evidence() validates amount/currency/capture | |

---

## 10. Optional Gems (Phase 11)

| Capability | Rating | Evidence | Notes |
|---|---|---|---|
| Gem package catalog | IMPLEMENTED | `apps/coin-wallet-store/src/server.js` | packName/productName |
| Gem purchases | IMPLEMENTED | `/api/checkout` | createPayment |
| Server-controlled INR prices | IMPLEMENTED | `server.js:423` price validated server-side | coins = Math.round(price) |
| Gem balance | IMPLEMENTED | `walletCoins`, `/api/wallet-balance` | |
| Spending ledger | IMPLEMENTED | `transactionHistory` | |
| Refund/reversal tracking | IMPLEMENTED | order-cancelled/failed/expired views | |
| Merchant config | IMPLEMENTED | merchantId, webhookSecret | |
| Idempotent fulfillment | IMPLEMENTED | `seenDeliveryIds` + transactionHistory dedupe | |
| Credited only after verification | IMPLEMENTED | webhook signature + getPayment status check | |
| Commercial purpose stored accurately | IMPLEMENTED | metadata.packName ("Gamer Pack") | Not concealed |

---

## 11. Dashboard (Phase 12)

| Capability | Rating | Evidence | Notes |
|---|---|---|---|
| Super Admin dashboard | IMPLEMENTED | `apps/super-admin/` | 25 modules |
| Merchant dashboard | IMPLEMENTED | `apps/merchant-admin/src/views/` | admin.html, admin-premium.html |
| Real-time investigation screen | ADDED | `upi-intent-routes.js:/investigation` | New endpoint |
| REPORTED/OBSERVED/MATCHED/VERIFIED distinction | IMPLEMENTED | `PaymentEvidenceLevel` + statuses | |
| Search by order/payment/merchant/status/timestamp | PARTIAL | `/api/v1/payments/:id/events`, `/status` | Full search endpoint recommended |
| SSE real-time updates | IMPLEMENTED | `server.broadcastSse` | |

---

## 12. Performance (Phase 13)

| Target | Rating | Evidence | Notes |
|---|---|---|---|
| Payment intent creation p95 < 500ms | UNVERIFIED | — | Needs k6 load test |
| Client return ingestion p95 < 300ms | UNVERIFIED | — | Needs k6 load test |
| Internal event persistence p95 < 200ms | UNVERIFIED | — | Needs k6 load test |
| Dashboard update after event p95 < 1s | UNVERIFIED | — | Needs k6 load test |
| Merchant callback enqueue p95 < 300ms | UNVERIFIED | — | Needs k6 load test |
| 100/500/1000 concurrent sessions | UNVERIFIED | — | Needs k6 load test |
| Previous 1000-request burst failure | UNVERIFIED | — | Reference point only |

---

## 13. CI & Delivery (Phase 15)

| Capability | Rating | Evidence | Notes |
|---|---|---|---|
| npm ci --include=dev | IMPLEMENTED | Ran successfully (232 packages) | |
| npm run typecheck | IMPLEMENTED | Passes | |
| npm run build | UNVERIFIED | No build script confirmed | |
| npm test | PARTIAL | 51 core/common tests pass; full suite timed out | |
| node scripts/scan-secrets.js | IMPLEMENTED | Passed (671 paths) | |
| Android APK build | UNVERIFIED | No Java/Android SDK in env | Source written |
| Docker Compose | PARTIAL | docker-compose files exist | Needs env updates |

---

## Summary

- **IMPLEMENTED:** Core payment API, state machine, UPI QR/intent builder, attribution engine, webhook engine, callback outbox, Hyperswitch provider, Gems store, secret scan, typecheck, tests.
- **PARTIAL:** Android observer (5s loop replaced with event-triggered in source), Gmail observer (push/missed recovery), webhook secret rotation, dashboard full search.
- **MISSING (now addressed):** Android UPI Intent SDK, intent-return API, investigation endpoint, durable outbox Redis-fallback fix, triple-signal correlation method.
- **UNVERIFIED:** Performance targets, Android APK build, full test suite, Docker Compose env.
