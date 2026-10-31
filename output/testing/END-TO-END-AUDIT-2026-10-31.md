# Sanbook Pay end-to-end audit — 31 October 2026

What this repo does: Sanbook Pay hosts merchant payment APIs, UPI checkout, owner and merchant consoles, notification observers, provider confirmation, accounting and callbacks. It now also contains a separate superadmin application, routing, gaming-wallet and payment-link APIs. This audit assumes multiple independent merchants and concurrent requests involving real money.

**Verdict: NOT READY for real payment processing.** A fresh deployment succeeded, but isolated probes confirmed unauthenticated payment confirmation and wallet credit. Passing the existing regression suite does not cover these new paths.

## Deployment and source evidence

| Item | Observed result |
|---|---|
| Repository | https://github.com/Tashima-Tarsh/Sanbookpay |
| Local HEAD | `eb03dbdf8f419db8f3e634584e30f96f52cb0954` |
| GitHub main / newly deployed commit | `c5cbae88139240a18a840662408d91af6f6d8fa7` |
| Source comparison | `git diff --stat HEAD origin/main` empty: identical source trees; main adds the merge commit |
| Previous live commit | `d78aa94e119f445359c7bdcc33c4c5ebd09ec5cd` |
| Render service | `dynamo-pay`, `srv-dbioucvb9u1s73c4a7og` |
| Fresh deployment | `dep-dbitaftg1s2s73e6lrsg`; build cache cleared |
| Terminal deployment status | `live`, finished 31 October 2026 at 17:18:21 IST |
| Build | `npm ci --include=dev && npm run typecheck && npm run build` |
| Start | `npm run start:hosted` |
| Render access | Connector repeatedly failed authentication; direct Render REST API succeeded using the supplied key, in the workspace matching the supplied account email |

No application fixes, source pushes, database resets, credential rotations or production payment mutations were performed. Deployment was explicitly requested. API credentials were not saved in audit artifacts. The pre-existing modified regression-results file was backed up before tests and restored afterward; this audit has its own result file.

## Verified public URLs after deployment

| URL | HTTP result | Meaning |
|---|---|---|
| https://dynamo-pay.onrender.com/_ready | 200 | Database readiness query succeeded |
| https://dynamo-pay.onrender.com/health | 200 | API health responds |
| https://dynamo-pay.onrender.com/admin | 200 | Existing owner/legacy Merchant Console shell |
| https://dynamo-pay.onrender.com/platform | 200 | Platform/merchant workspace sign-in shell |
| https://dynamo-pay.onrender.com/super-admin/login | 404 | New dedicated superadmin portal is not hosted |
| https://dynamo-pay.onrender.com/merchant | 404 | No such merchant page; use `/platform` |
| https://dynamo-pay.onrender.com/developers | 200 | Developer documentation |
| `/api/v1/super-admin/verify-session` | 401 | Anonymous request denied |
| `/api/platform/v1/me` | 401 | Anonymous request denied |

HTTP 200 on a page verifies availability, not successful authenticated navigation or correctness of every module. No valid owner/merchant application login was supplied for live authenticated acceptance. The Render account email is not proof of an application login.

## Validation

| Check | Result and limit |
|---|---|
| `npm run typecheck` | Passed |
| `npm run build` | Passed; checks syntax of 182 runtime JavaScript files, not functional correctness |
| `node scripts/scan-secrets.js` | Passed for 465 tracked paths; not a complete Git-history or semantic credential audit |
| `npm test` | Network-enabled rerun: 49/49 suites passed, runner reports 375 tests, 240.01 seconds |
| First sandbox test attempt | Stopped at WhatsApp pairing after blocked outbound connection; network-enabled rerun passed that test |
| PostgreSQL acceptance | Compatibility test ran; real database test is conditional on `DYNAMO_POSTGRES_TEST_URL` and was not configured for this audit |
| `npm audit --omit=dev --json` | Zero reported vulnerabilities in production dependency audit; not proof that application code is secure |
| Isolated security probes | Confirmed failures listed below; in-memory database only |
| UI detector | Ran; output retained. Linked stylesheet resolution warnings make color/custom-property analysis incomplete |
| Visual/browser acceptance | Browser access host unavailable; desktop/mobile screenshots, gestures and live authenticated browser flow not verified |
| Local Node | 24.14.1; configured Render Node is 22.23.4, with the cloud build verified live |

## Must fix

1. **Unsigned provider callbacks mark payments successful — critical** (`apps/payment-api/src/routes/callback-wallet.routes.js:19`; `apps/payment-api/src/auth-guard.js`).
   - **What this is:** The new generic provider callback is public and changes stored payment state.
   - **Problem:** It reads the signature but never verifies it. An isolated unsigned callback without amount or payment reference returned 200 and changed a synthetic payment to SUCCESS, with zero ledger entries. Order lookup is not tenant/provider bound, and the handler bypasses the existing atomic confirmation/outbox path.
   - **Fix:** Disable this handler until it uses the approved provider's raw-body signature verification, exact amount/currency, provider/tenant ownership and unique payment-reference claim, followed by the established atomic journal/outbox service.
   - **If we skip it:** A party who knows an order reference can fabricate paid status; accounting and callback records can disagree with payment state.

2. **Public wallet credit can create money without a payment — critical** (`apps/payment-api/src/routes/callback-wallet.routes.js:137`).
   - **What this is:** The new gaming wallet endpoint writes balances and transaction records.
   - **Problem:** It has no authentication; `paymentId` is optional. An isolated unauthenticated request without a payment credited 5,000 paise. With a payment ID, it also lacks exact amount and merchant-ownership binding. Reading the old balance before the transaction creates a concurrent update risk.
   - **Fix:** Require a tenant-scoped server credential, an authoritative owned payment and exact available credit amount. Atomically claim that payment once and update the balance in the database transaction.
   - **If we skip it:** Attackers can inflate wallet balances; concurrent legitimate credits can overwrite each other.

3. **Clean installations create a publicly known administrator password — critical** (`packages/db/src/migrate.js:285`).
   - **What this is:** Migrations seed a separate superadmin account whenever that table is empty.
   - **Problem:** The email and password are fixed, the account is ACTIVE with MFA off, and the password is printed in logs. An isolated clean database accepted those built-in credentials and issued a session. Existing console `INITIAL_ADMIN_*` settings do not replace this separate seed. Current production credential state was not tested.
   - **Fix:** Remove the fixed credential and credential log. Bootstrap through private owner configuration or a one-time setup mechanism, and require MFA before privileged operations. Rotate any affected deployed account through a separately authorized owner action.
   - **If we skip it:** An unconfigured installation exposes full platform control using credentials present in source.

4. **Amount-only links bypass API-key and merchant policy** (`apps/payment-api/src/routes/payment-link.routes.js:56`).
   - **What this is:** A second payment-creation API accepts `dp_live_` and `dp_test_` credentials.
   - **Problem:** It checks only hash and revocation. It does not enforce expiry, create scope, environment, IP restrictions, persisted quota, canonical `pp_merchants` suspension or standard payment acceptance controls. A handler probe with stubbed expired read-only SANDBOX credentials returned 201 and a receiving intent. The platform payment guard applies to `/v1/...`, not this endpoint.
   - **Fix:** Reuse the existing scoped payment credential/policy validation and canonical payment creation service for this route and its manual-failover/status siblings.
   - **If we skip it:** Expired or restricted keys can continue creating payments and merchant suspension can be inconsistently enforced.

5. **Amount-only links return payable intents while permanently queued** (`apps/payment-api/src/routes/payment-link.routes.js:145`; `packages/core/src/timing-engine.js:59`).
   - **What this is:** The endpoint creates a QUEUED payment and returns an immediate UPI intent.
   - **Problem:** It never calls `queueEngine.enqueueOrActivate`, yet starts the active timer and returns a QR URL and intent. The active timer ignores non-ACTIVE sessions, and `sessionRepo.create` does not persist the supplied response expiry. The handler can therefore issue payable instructions without acquiring the receiving slot.
   - **Fix:** Use the canonical atomic receiving-slot allocation and persist the canonical expiry. Return payable instructions only once activation succeeds.
   - **If we skip it:** Multiple customers can pay against a route that has not allocated capacity; checkout and queue status can remain inconsistent.

6. **Malformed money values are accepted** (`apps/payment-api/src/routes/payment-link.routes.js:80`).
   - **What this is:** Payment amounts are parsed with `parseFloat` and rounded.
   - **Problem:** The isolated request `amount: "12junk"` returned 201 for 1,200 paise. Partial numeric strings and excessive decimal precision are silently interpreted as money instead of rejected.
   - **Fix:** Use the existing exact monetary parser and positive safe integer paise rules; reject malformed strings and unsupported decimal precision.
   - **If we skip it:** Integrations can create payments for a different value from their intended input.

7. **Dedicated superadmin portal is unreachable and its launcher is broken** (`scripts/start-hosted.js:24`; `apps/super-admin/src/index.js:1`; `apps/super-admin/src/server.js:1395`).
   - **What this is:** README and AGENTS describe a separate owner portal with 25 modules.
   - **Problem:** Hosted startup launches no superadmin service and routes its paths to the merchant server: live `/super-admin/login` returns 404. The standalone entry imports `startServer`, but `server.js` exports no such function and instead listens as an import side effect.
   - **Fix:** Export a proper start/close lifecycle, explicitly launch it and route its pages/assets through the hosted gateway. Verify startup and shutdown with the actual production start command.
   - **If we skip it:** A fresh build cannot deliver the advertised owner portal.

8. **Superadmin browser login and navigation cannot maintain a usable session** (`apps/super-admin/src/server.js:26`; `apps/super-admin/src/public/js/app.js:1`, `:97`, `:115`; `apps/super-admin/src/server.js:1375`).
   - **What this is:** The standalone app uses browser localStorage bearer tokens.
   - **Problem:** `app.js` reads `SA_CONFIG` before the inline configuration assignment and defaults to loopback port 6100. Normal page navigation sends no Authorization header, but the page server requires one, causing a redirect back to login. Create Merchant omits authorization entirely. A string containing `Bearer ` passes the page-shell check without token validation.
   - **Fix:** Use same-origin API calls and one validated server session mechanism, initialized before app code. Authenticate mutations and page navigation consistently.
   - **If we skip it:** Login, create-merchant actions and protected navigation still fail after hosting is repaired.

9. **Superadmin MFA is broken; suspending an administrator leaves sessions usable** (`apps/payment-api/src/routes/super-admin.routes.js:77`, `:200`, `:257`; `packages/db/src/repositories/super-admin.repository.js:101`).
   - **What this is:** A separate auth implementation manages superadmin sessions and MFA.
   - **Problem:** MFA uses CommonJS `require` inside an ES module; isolated enrollment returned 500 with `require is not defined`. Its six-character hex HMAC is not standard TOTP. The session lookup/guard does not require an ACTIVE admin; an existing token still listed merchants after the isolated admin was suspended.
   - **Fix:** Reuse the existing working platform MFA/auth implementation, or use proper ESM imports and standard TOTP. Check active administrator state on every request and revoke sessions on suspension. Apply expiry validation to the MFA routes too, which bypass the shared guard.
   - **If we skip it:** Owners cannot enroll working MFA, and a suspended operator retains access until session expiry/revocation.

10. **Failover selects a connection the provider registry ignores** (`apps/payment-api/src/platform/payments.js:131`; `packages/core/src/providers/provider-registry.js:43`).
    - **What this is:** Provider creation attempts alternate approved connections after failure.
    - **Problem:** The caller passes a third connection ID, but `getProvider` takes only merchant and provider name and selects the first active matching row. Two connections for the same provider can retry the failed credentials rather than the backup. SANDBOX/PRODUCTION selection can also disagree with the policy-checked row. All errors trigger failover, including a lost response after a primary accepted an order.
    - **Fix:** Resolve exactly the selected approved connection and persist its identity on the order. Fail over only after a definitive rejection or reconciliation proving the primary did not accept; retain uncertain attempts for reconciliation.
    - **If we skip it:** Automatic failover can use the wrong account/environment or leave multiple payable orders at separate providers.

11. **New merchant creation does not create a usable merchant identity** (`apps/payment-api/src/routes/super-admin.routes.js:363`; `apps/payment-api/src/index.js:555`; `apps/payment-api/src/platform/identity.js`).
    - **What this is:** The new owner route inserts a legacy merchant with ACTIVE status inside branding.
    - **Problem:** It does not create a `pp_users` owner, invitation, onboarding state or `pp_merchants` row. Startup later backfills missing merchants as ACTIVE legacy installations. The existing platform onboarding instead requires verified owner details and approved provider activation.
    - **Fix:** Route owner-created merchants through the same canonical merchant/onboarding and invitation service, with one status source.
    - **If we skip it:** A merchant can appear active in one portal while lacking credentials and expected verification gates in another.

12. **Several advertised superadmin modules do not operate on real module data** (`apps/super-admin/src/public/js/app.js:24`, `:57`; `apps/super-admin/src/server.js`).
    - **What this is:** The new UI presents a merchant directory and operational modules.
    - **Problem:** Merchant rows are manufactured from payment records, use the order ID as the merchant name and a fixed example email. Only login, create merchant, statistics and activity have basic handlers; many other pages remain table shells or descriptive cards. Statistics label payment counts as merchant counts.
    - **Fix:** Bind each module to the actual authorized tenant/platform API and implement its actions and errors; remove unavailable modules/claims until acceptance passes.
    - **If we skip it:** Operators receive false merchant information and nonfunctional controls under a claimed complete portal.

## Should fix

13. **Regression coverage excludes the new high-risk routes** (`scripts/test-all.js:20`).
    - **What this is:** The curated regression runner passed all 49 listed suites.
    - **Problem:** There are no suites for `super-admin.routes.js`, `payment-link.routes.js`, `callback-wallet.routes.js` or the dedicated superadmin app. The passing build is syntax validation and does not catch undefined `require`, missing exports, authentication or accounting failures. Audit probes found failures despite the green baseline.
    - **Fix:** Add focused tests that reject unsigned callbacks, unauthenticated wallet writes, restricted keys and suspended admin sessions; verify ledger/outbox atomicity, queue activation, actual hosted routing and a complete owner-to-merchant flow.
    - **If we skip it:** The same release-blocking defects can pass CI again.

14. **The separate superadmin interface lacks a functioning mobile navigation path** (`apps/super-admin/src/server.js:63`, `:91`; `apps/super-admin/src/public/css/app.css`; `apps/super-admin/src/public/js/app.js`).
    - **What this is:** The sidebar is fixed at 256px and content retains left padding, while a mobile menu button is shown.
    - **Problem:** The menu button has no handler and CSS contains no responsive sidebar rules or reduced-motion alternative. At a narrow viewport, the fixed sidebar consumes most of the content width; the long navigation also has no explicit scrolling container. This is source evidence, not a fresh screenshot measurement.
    - **Fix:** Reuse the existing merchant console's accessible responsive drawer behavior, with scrolling, focus handling, Escape and labeled controls. Test at 360px, tablet and desktop widths.
    - **If we skip it:** Owners on phones cannot reliably navigate or use the console.

## Architecture and professional-readiness assessment

The existing platform identity/payment path has stronger controls than the new parallel implementation: hashed scoped API keys, CSRF-bound sessions, standard TOTP, tenant checks, and atomic provider accounting/outbox logic. The smallest safe architecture is to reuse that path for the new features, rather than maintain independent auth, merchant status, payment creation, callback and wallet implementations with different rules.

First secure/disable the public financial mutation paths and remove default administrator bootstrap. Next consolidate auth, key policy, merchant lifecycle and queue allocation. Then repair hosting/navigation, bind real module data and perform authenticated browser acceptance. This report is an audit and did not implement these repairs.

UI detector results are mechanical candidates, not confirmed defects or a redesign specification. Existing visual identity is protected by AGENTS.md; generic style suggestions such as sidebar accents or heading ratios were not treated as bugs. A numerical accessibility/performance score would imply measurements not available here and is deliberately not certified.

## Evidence files

- `audit-regression-results.json`: this run's 49-suite summary.
- `audit-regression-run.log`: network-enabled regression run output (ignored by Git).
- `audit-probes.mjs`: reproducible isolated route checks. It does not contact the live site; default credentials in this script are the existing source default used only in memory.
- `audit-probes-results.json`: observed security probe results. Payment-link credential/route/session dependencies are explicitly stubbed; callback/admin/wallet probes use a real in-memory database and repositories with admin guards registered.
- `audit-dependencies.json`: npm production dependency advisory result.
- `audit-ui-detector.json`: raw mechanical UI findings, with the stylesheet-resolution limits above.

Not checked: every source line, complete Git history, live authenticated owner and merchant workflows, current production default-password state, runtime log review after release, real PostgreSQL acceptance/backup restore, real bank/provider pay-in/refund/payout/settlement, customer-site wallet fulfillment, Gmail consent/delivery, WhatsApp phone pairing on a real phone, native Android compilation/signing/device behavior, Docker execution, hosted load/latency, browser keyboard/touch/accessibility and desktop/mobile visual acceptance. Historical reports do not substitute for these checks. Public readiness succeeds but does not certify all internal services or real banking integrations.
