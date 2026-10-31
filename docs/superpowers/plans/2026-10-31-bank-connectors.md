# Bank connectors implementation plan

**Goal:** Keep the amount-only Dynamo Pay checkout and connect PayGate, Django/n8n and India Banking through authenticated, merchant-owned services.

**Architecture:** Existing Node runtime remains the system of record. External services run separately. Bank details are encrypted; notification-based results are supplementary evidence, never bank settlement authority.

**Execution:** User requested immediate implementation ("use all three" and "working quick"). Work in the existing feature branch, preserve unrelated audit files, and do not deploy.

## Tasks

- [x] Add bank details validation, encryption and masked account responses to the shared receiving-account repository; test invalid IFSC, partial details and plaintext leakage.
- [x] Add API clients using the actual upstream contracts for PayGate create/status, Django create/status, and India Banking balance/statements; test amount, destination, authentication, timeouts and HTTP failures.
- [x] Add merchant-owned configuration, diagnostics, payment creation and evidence refresh through existing platform controls. Preserve idempotency and prevent email/notification evidence from settling a payment.
- [x] Wire the existing amount-only dialog and QR checkout to configured collection services and add connection controls; preserve existing visual identity.
- [ ] Document separate service setup and credentials, run typecheck/build/secret scan/full regression and review desktop/mobile behavior.

## Review focus

Cross-tenant IDs must fail; upstream QR amount/destination must match; uncertain creation must not be reissued; expired payment instructions must not be reused; no notification can post a ledger credit.

## Ledger

- Baseline local HEAD: 08678a36d38edd22184c24a781ca3e52df475cd7, feature branch fix/merchant-workspace-flow. Remote main: 159ee248444c1d9dbb28743092817432ef9bee02. Production commit not yet reverified.
- Ruling: preserve the current checkout and integrate external APIs rather than transplanting incompatible Go/Django/Frappe runtimes into Node.
- Ruling: real bank/provider/device acceptance is separate from synthetic connector tests.

- Verification: typecheck, runtime build, tracked-file secret scan and diff whitespace checks passed. All 51 curated suites were attempted; 50 passed. WhatsApp pairing-code test failed after its external WebSocket connection closed. Remaining suites and affected payment/counter/checkout suites were run separately.
- Browser visual QA blocked: browser access host unavailable. DOM interaction tests for the new connection form, amount-only form and uncertain checkout passed. No screenshots are claimed.
- Render re-verification blocked: connected tool has no selected workspace. Existing release report identifies main 159ee248444c1d9dbb28743092817432ef9bee02, but it was not treated as a fresh production check.
- Review fixes: preserved old idempotency fingerprints, original external-route snapshots, cash/card-counter routing, unknown request correlation, adjustment headroom, expiry timers, callback retries/deduplication, late evidence and queue promotion.
- Final boundary: connectors and setup artifacts implemented locally. External service installation, bank-authoritative automatic reconciliation, real credentials and live acceptance are not completed or claimed.
