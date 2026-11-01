# Sanbook Pay readiness checks — 1 November 2026

Status: local repairs implemented; real-money production acceptance remains incomplete.

## Source and scope

Local HEAD and GitHub default-branch HEAD both resolved to `8aa9fbca4585e74fb0e20f2831dfe3b88f690fe8` before edits. This run reviewed the attached PhonePe/Paytm defect list, current runtime/payment paths, prior audit, and repository engineering requirements. The older audit describes an older revision; several of its original defects already had repairs in this checkout.

Checkout and UPI helper edits, an untracked UPI simulation test, and a modified regression artifact existed before this work. Their source edits were retained. No production database reset, credential rotation, source push, merge, or deployment was performed. Tests used in-memory or temporary SQLite databases. The real deployed commit could not be identified: Render access had no selected workspace, and public `/health` and `/_ready` probes each timed out after 15 seconds. These timeouts alone do not establish an outage.

## Repairs

- Fixed an API startup exception: `IpAllowlist` was incorrectly constructed as a property of `SecurityMiddleware`.
- Corrected legacy PhonePe v1 signing: SHA-256, base64 request envelope, request/path order, retained authentication/idempotency headers, full callback salt-index comparison, nested callback decoding, provider merchant binding and `COMPLETED` normalization. Status requests validate order/merchant ownership and require a real transaction reference for success.
- Replaced Paytm's custom HMAC with the official `paytmchecksum` package. Initiation signs the nested JSON body, sandbox selects staging, status uses POST `/v3/order/status` with response checksum/ownership validation, and callback parsing supports form encoding. Removed the invented hosted checkout URL: Paytm's token requires CheckoutJS integration.
- Bound provider credentials to the selected connection and provider. An unconfigured connection cannot silently borrow another provider's environment credentials. The provider's business merchant ID is separate from the platform tenant ID.
- Provider collection ingress now verifies and commits before sending HTTP 200. It rejects invalid signatures, wrong amounts/currency, ambiguous orders and reused references. State, journal, event and outgoing callback reservation commit transactionally. Signed evidence rejected by confirmation is retained encrypted with an idempotent reconciliation case. Network delivery uses the existing durable outbox.
- IP filtering uses the existing authenticated internal-proxy address resolver instead of trusting arbitrary forwarded headers. Exact addresses and IPv4 CIDR matching were repaired, including `/0`. An empty allowlist disables IP filtering only; provider verification remains required. IPv6 exact addresses are supported; IPv6 CIDR is not implemented.
- Retired `/api/v1/payments/phonepe` and `/api/v1/payments/paytm` with HTTP 410. They used undefined CommonJS `require` in ESM and issued untracked provider orders outside canonical credential/accounting policy. Integrations must use scoped `/v1/payments` with an approved connection. The existing connection-onboarding API currently accepts Cashfree only.
- Disabled the unsafe public paise-offset option with HTTP 503. The allocator remains an experimental in-memory utility; it is not a durable multi-instance allocation service. Standard queued checkout remains available. VPA rotation no longer implicitly allocates an offset and rechecks receiving-route policy.
- Fixed checkout state failing with an undefined deep-link helper.
- Fixed hosted routing of canonical `/v1/*` requests, which previously reached the console and returned 404. A test launches the actual production entry point with temporary ports/database and verifies public readiness, platform page and API authentication routing.
- Removed a test-only bypass that prevented legacy external-banking retries from resolving their original payment after the integration default changed.
- Independent review found a signed-event order-binding gap. Ingress now matches the stored provider order ID exactly; a matching merchant reference cannot substitute for a different issued provider order. The regression reproduced the wrong-order confirmation before the fix.
- Corrected regression result detection to require successful process exit and zero TAP failures. Windows suites exit naturally to avoid the observed Node/libuv force-exit assertion. An idle security cleanup timer no longer keeps Node alive. Ordinary tests explicitly clear inherited `DATABASE_URL`.

## Follow-up: remove the INR 200 floor and clean historical data

The default channel and new connection-policy minimum are now zero, and the settings API/form accepts a zero minimum. Actual payments must still be positive integer paise: INR 0.01 is accepted, INR 0 is rejected. The maximum and other merchant/provider acceptance controls remain enforced. Existing saved database settings need to be updated on the selected installation; changing a source default does not rewrite saved merchant policy.

The user explicitly authorized local and hosted history cleanup while preserving merchants, logins, API keys and provider settings. Both cleanups completed with verified private backups and protected-table checks. Local cleanup removed 3 sessions; hosted cleanup removed 8 sessions plus related refund/receipt/request history. Identities, configuration and security audit records were preserved. Recorded wallet/ledger balances were reset with transaction history. The active platform receiving VPA is 9082843142@slc and saved minimum policy is zero on both installations. A reset cannot make an unconfigured provider produce callbacks, and automatic success still requires verified provider/bank confirmation. Immediate callback arrival is not guaranteed.

## Verification evidence

The full local regression passed 55/55 suites (403 tests) in `regression-results.json` and `readiness-complete-2026-11-01.log`. The subsequent Gmail connection UI checks passed 8 tests. The cleanup PostgreSQL test additionally passed in an isolated temporary schema on the confirmed instance; it did not run the full PostgreSQL financial acceptance suite. Focused evidence includes `psp-contracts.log`, `provider-ingress.log`, `reconciliation-regressions.log`, and `hosted-routing.log`.

The route smoke exercised 322 distinct registrations with anonymous, empty-body or missing-ID requests. It found no duplicate registrations or transport errors. Its only 5xx was the deliberate HTTP 501 for an unknown legacy callback provider. This is expected unsupported behavior, not evidence of a functional provider. See `readiness-routes-2026-11-01.json` and `readiness-route-smoke.log`.

The two JavaScript test files outside the curated runner also passed (7 tests). The pre-existing UPI “E2E” file simulates observations and mocks an SSE broadcaster; its printed success statements do not prove bank settlement, actual UPI-app handoff, SSE transport or merchant callback receipt.

The production dependency audit reported zero advisories. Typecheck checks the historical TypeScript projects; the runtime build checks JavaScript syntax. Neither substitutes for runtime or provider acceptance tests. Secret scanning covers tracked source patterns, not complete Git history or every credential form.

Reference for the Paytm checksum dependency: https://github.com/paytm/Paytm_Node_Checksum . Paytm status verification: https://www.paytmpayments.com/docs/jscheckout-verify-payment . PhonePe's old v1 documentation URLs were inaccessible during this run; the repaired salt-key adapter must still be checked against the account's enabled API version and genuine provider fixtures. This does not implement PhonePe's newer OAuth checkout API.

## Remaining production gates

1. Configure approved merchant accounts/KYC and genuine sandbox credentials. Complete create → actual sandbox payment → signed callback/status → ledger → delivered merchant callback → one-time wallet fulfillment. PhonePe/Paytm adapter contract tests are local simulations, and their full onboarding/checkout flows are not enabled by these repairs.
2. Run the conditional PostgreSQL acceptance against a dedicated test database/schema, concurrent multi-process financial tests, backup/restore, and production host capacity/failure recovery. SQLite tests do not certify hosted PostgreSQL or throughput. The in-memory paise-offset feature remains disabled until durable allocation is implemented.
3. The user confirmed the Render workspace and authorized merge/deployment. Before this release the latest live deploy was 159ee248444c1d9dbb28743092817432ef9bee02. Verify the release commit and live health/logs after deployment. The authorized cleanup and VPA/minimum configuration changes above were performed; no real payment was submitted.
4. Perform authenticated owner/merchant browser acceptance, desktop/mobile and keyboard/touch review, real Android build/device acceptance, Gmail consent and real notification delivery. JavaScript observer suites do not compile or test the native APK.
5. Verify real provider refunds, payouts, reconciliation/settlements and customer-site fulfillment for the enabled products. Unsupported direct-bank adapters remain unavailable; a QR or matching notification is not bank settlement evidence.

These are release gates, not passing results. This report does not certify that every source line, browser flow or external banking integration is production-ready.

## Gmail and observer setup

Connect Gmail is the primary action; one-time platform OAuth fields are collapsed under Platform Gmail setup. The existing Google consent flow still requires genuine platform client credentials and user consent. Standard Gmail API usage is available at no additional cost within Google quotas. Email/SMS standby is not proof of an active connection. Vivo observer installation/pairing and Gmail consent remain user actions. No connected-status claim is made.

The old customer-reset regression was found to target the real local database. It now uses temporary fixture databases exclusively. Recent backups before this session?s runs contained zero customer identities/sessions and zero support tickets. The new cleanup tests assert protected-table preservation and rollback on unknown cascading dependencies.
