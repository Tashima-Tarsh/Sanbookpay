# Hyperswitch Add-on Implementation Plan

**Goal:** Optional real Hyperswitch hosted checkout beside direct UPI.
**Spec:** ../specs/2026-11-01-hyperswitch-addon-design.md (approved).
**Execution:** Inline, superpowers:executing-plans and test-driven-development.
**Stack:** Existing Node HTTP services, provider adapters, encrypted connections, canonical financial confirmation.

- [ ] Add failing adapter/HTTP integration tests: payment link creation with stable payment_id; exact merchant/profile/amount; redaction; capture-only success; webhook signature, duplicates, tenant binding, rollback; existing UPI path.
- [ ] Implement HyperswitchProvider using official v1 API; fixed sandbox/live hosts; stable payment ID for uncertain-create recovery; bounded requests and no credential logging.
- [ ] Extend existing merchant connection form and API with merchant ID, profile ID, API key and independent webhook key. Keep approval and environment checks. Add diagnostics and authenticated reconciliation.
- [ ] Add connection-bound raw HMAC-SHA512 webhook and canonical atomic confirmation. Never trust return redirects or authorization-only states. Keep existing UPI independent.
- [ ] Document account setup and absent live credentials. Run focused tests, typecheck, build, secret scan and regression suite; review security independently.

Review focus: cross-tenant/provider/environment mixups, secret-bearing provider responses, success with partial capture, stale/duplicate callbacks, create timeout followed by same-ID recovery. No production deployment or credential/account creation is authorized by this plan.

## Completed implementation and verification

All five implementation tasks above are implemented. Setup instructions are in docs/HYPERSWITCH-ADDON.md. The merchant connection form accepts encrypted Hyperswitch credentials and exposes hosted checkout for approved connections. Direct UPI continues through the existing path.

The full 65-suite regression run passed (output/testing/hyperswitch-regression.log). Final focused run passed 13 tests, including ledger rollback, duplicate callback posting, authorization-only/late failure handling, stable 30-character payment IDs, incorrect pending-inquiry amounts and unknown-create recovery. Typecheck, runtime build (225 files), tracked/new-file secret checks and diff whitespace checks passed. The Impeccable mechanical UI detector returned no findings.

Independent review was attempted but the reviewer failed at its usage limit; a local code review followed and found/fixed pending-inquiry amount checks and concurrent success overwrite risk. Browser inventory reported no native pipe or browser host, so desktop/mobile screenshot comparison remains unverified. No actual Hyperswitch sandbox or live credentials were supplied, no real financial request was submitted, and no production deployment occurred. Real processor checkout acceptance and visual browser review remain external gates.
