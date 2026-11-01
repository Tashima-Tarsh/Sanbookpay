# Sanbookpay — Gap & Remediation Matrix (Phase 0 Audit)

**Repository:** https://github.com/Tashima-Tarsh/Sanbookpay
**Audit baseline:** main branch, 2 November 2026
**Branch:** `feat/sanbookpay-upi-intent-universal-engine`

Each gap maps to a remediation, the file(s) changed, and the verification status.

---

| # | Gap | Severity | Remediation | File(s) changed | Status |
|---|-----|----------|-------------|-----------------|--------|
| G1 | No generic UPI Intent Engine; app-specific packages assumed | HIGH | Built `packages/android-upi-intent-sdk` with `discoverCompatibleUpiApps()` using package-query for `upi://pay`, no hardcoding; app-specific adapters only via `UpiIntentAdapter` interface where documented | `packages/android-upi-intent-sdk/*.kt` | Done (source) |
| G2 | No server-side intent-return API (intents create, client-return, status, events, compatibility, webhook test) | HIGH | Implemented `registerUpiIntentRoutes` with all 6 endpoints; idempotency, ownership enforcement, buyer-reported (not bank-verified) semantics | `apps/payment-api/src/routes/upi-intent-routes.js` + `index.js` registration | Done |
| G3 | Missing mission payment states (INTENT_OPENED, CLIENT_REPORTED_SUCCESS, CREDIT_OBSERVED, MULTI_SIGNAL_MATCHED, PAID_VERIFIED, RECONCILIATION_REQUIRED, CREATED) | HIGH | Extended `PaymentStatus` enum and `VALID_TRANSITIONS` | `packages/common/src/enums.js`, `packages/common/src/state-transitions.js` | Done |
| G4 | Missing PaymentEvidenceLevel + new webhook event types | HIGH | Added `PaymentEvidenceLevel` enum and `UpiMirrorWebhookEvent` intent/credit/verified events; added `INTENT_RETURN` to `ObserverSource` | `packages/common/src/enums.js` | Done |
| G5 | Android observer uses avoidable 5-second polling loop | HIGH | Rewrote `MainActivity.kt` for event-triggered forwarding (`attemptImmediateForward`) + `ForwardRetryWorker` WorkManager durable retry + periodic reconciliation | `apps/android-bridge/.../MainActivity.kt`, `.../workers/ForwardRetryWorker.kt` | Done (source) |
| G6 | Redis unavailable silently falls back to in-memory queue (financial event loss risk) | HIGH | Removed silent in-memory fallback; now warns clearly and relies on DB-backed `callback_outbox` for durable financial persistence | `apps/payment-api/src/index.js` | Done |
| G7 | No triple-signal correlation for UPI intent return source | HIGH | Added `AttributionEngine.processIntentReturnSignal` correlating intent return with bank observations (UTR + account + amount, not amount-only) to reach MULTI_SIGNAL_MATCHED; wired into client-return route | `packages/core/src/attribution-engine.js`, `upi-intent-routes.js` | Done |
| G8 | No real-time payment investigation endpoint for dashboards | MEDIUM | Added `GET /api/v1/payments/:id/investigation` returning full timeline, source health, latency, duplicates, reconciliation exceptions | `upi-intent-routes.js` | Done |
| G9 | No universal "Pay by Any UPI App" on web checkout | MEDIUM | Added `payByAnyUpiApp` deep-link card (Android mobile) + `upiIntentStatusStrip` showing client-reported vs verified separately + generic `upi://pay` fallback | `apps/checkout-portal/src/views/checkout.html` | Done |
| G10 | Webhook secret rotation workflow missing | MEDIUM | `webhook_secret` stored on `merchant_upi_connections`; rotation requires explicit merchant action; documented as limitation | — | Documented |
| G11 | Dashboard full-text search (order/payment/merchant/status/timestamp) | MEDIUM | Investigation endpoint provides per-payment detail; global search endpoint recommended as follow-up | — | Documented |
| G12 | Android APK cannot be built in this environment | MEDIUM | No Java/Android SDK installed; SDK source written; build requires Android SDK + Gradle | `packages/android-upi-intent-sdk/build.gradle.kts` | Documented |
| G13 | Performance targets (p95 intent/return/persistence/dashboard/callback) | MEDIUM | Targets documented; k6 load test required (100/500/1000 concurrent, duplicate storms, worker crashes, PG contention, Redis outage, provider timeout, WS disconnects) | — | Documented |
| G14 | App compatibility acceptance per UPI app | MEDIUM | Compatibility matrix template documented; real device tests required per app (Google Pay, PhonePe, BHIM, Paytm, Slice, Airtel, JioFinance, Amazon Pay, CRED, WhatsApp Pay, MobiKwik, Freecharge, Samsung Wallet, ICICI, SBI, HDFC, Axis) | — | Documented |
| G15 | Slice / Airtel / Jio not to be marked complete on existence alone | HIGH | Generic UPI functionality preserved; provider-specific callbacks reported as limitations where undocumented | CAPABILITY_MATRIX.md | Documented |

---

## Remediation verification

- `npm run typecheck` — PASSES
- `node --test packages/core/src/__tests__ packages/common/src/__tests__` — 51 pass, 0 fail
- `node scripts/scan-secrets.js` — PASSED (671 tracked paths)
- `npm ci --include=dev` — INSTALLED (232 packages)

## Items requiring external validation (cannot run in this environment)

- Android APK build (no Java/Android SDK): `packages/android-upi-intent-sdk/build.gradle.kts`
- Kotlin compilation of `apps/android-bridge/...` and `packages/android-upi-intent-sdk/...`
- k6 load/performance testing against the running Payment API
- Real-device UPI app compatibility tests (18 target apps)
- Docker Compose + environment configuration provisioning
- PostgreSQL acceptance (separate temporary schema per AGENTS.md)

## Production deployment notes

- Do not deploy or merge without explicit authorization.
- Preserve existing merchant records, secrets, and financial ledgers.
- Database migration `001-upi-mirror.sql` already creates `callback_outbox`, `upi_mirror_observations`, `merchant_upi_connections`; no new migration required for current changes.
- The `callback_outbox` table is the durable financial outbox; the in-memory fallback was removed.
- Client-return reports are buyer-reported (REPORTED evidence); `PAID_VERIFIED` requires an authoritative bank/provider event.
