# Attached master requirements: verified repair matrix

31 October 2026. Baseline GitHub main/Render: `c5cbae88139240a18a840662408d91af6f6d8fa7`. Workspace repair: `21fa4d8`; additional security repairs follow on `fix/merchant-workspace-flow`. This document supersedes blanket readiness claims in earlier manuals. Source existence is not live-provider evidence.

The owner explicitly authorized an **interim deployment on the existing Render Free service for customer testing**. No paid plan, bank credential or live routing configuration is changed. This overrides the attachment's no-Free-deployment gate for this interim release only. Production financial approval remains blocked.

## Critical defect verification

| Finding | Active implementation and evidence | Status |
|---|---|---|
| Unsigned callback success | Generic Cashfree callback delegates to raw-body verified ingress; unknown providers fail closed. Secure-boundary tests reject unsigned events. | IMPLEMENTED_AND_TESTED |
| Public arbitrary wallet credit | Scoped API authentication, exact owned provider success, original player attribution and unique per-payment claim; atomic wallet increment/journal/audit. Cross-tenant, amount, player and duplicate tests. | IMPLEMENTED_AND_TESTED |
| Public default administrator | No default seed; old table/history preserved. Legacy auth aliases use canonical cookie/CSRF/TOTP, never old default bearer sessions. | IMPLEMENTED_AND_TESTED |
| Broken nonstandard MFA | Parallel implementation removed from active runtime; standard TOTP with skew limits, replay protection, hashed one-time recovery codes and session revocation reused. | IMPLEMENTED_AND_TESTED |
| Expired/restricted key bypass | Payment-link creation/status use canonical scopes, expiry, revocation, quota, IP and merchant-state policy. | IMPLEMENTED_AND_TESTED |
| Receiving route overwritten after issue | Manual failover rejects with 409; original session identity remains. Distinct provider attempt captures connection/environment/correlation/snapshot. | IMPLEMENTED_AND_TESTED |
| Blind retry after provider timeout | UNKNOWN/RECONCILIATION_REQUIRED retains original attempt. Replay reuses original order; only preissue open-circuit selection uses an approved healthy backup. | IMPLEMENTED_AND_TESTED |
| Wrong provider account/environment | Registry accepts and resolves the exact connection ID; ambiguity and cross-tenant selection rejected. | IMPLEMENTED_AND_TESTED |
| Permissive money parsing | Canonical strict paise parser reused for links, collections, payouts and split refunds. Malformed, scientific-string, zero, precision and overflow tests cover canonical creation. | IMPLEMENTED_AND_TESTED |
| Merchant owner missing | Canonical transactional provisioning creates owner identity and pending onboarding; invitation is one-time and no plaintext password is emailed. | IMPLEMENTED_AND_TESTED |
| Wrong tenant refund fallback | Authenticated canonical merchant identity takes precedence over legacy credential/default lookup. Cross-tenant refund test added. | IMPLEMENTED_AND_TESTED |
| False standalone superadmin UI | `/super-admin` redirects to the existing working platform; launcher exports a proper lifecycle without import-time listener. Grouped implemented controls replace false 25-screen claims. | IMPLEMENTED_AND_TESTED for shared UI/API behavior; standalone default-port startup not separately exercised |
| Missing module/visual acceptance | Source/DOM checks exercise actual workspace actions. Browser host unavailable; the expanded 28-screen specification is not complete. | IMPLEMENTED_NOT_TESTED for fresh visual acceptance; NOT_IMPLEMENTED for missing expanded surfaces |

## Requirement matrix

“Functional/tested” below means the named local path has executed in isolated tests. **No row is SANDBOX_VERIFIED or LIVE_PROVIDER_VERIFIED.** The owner confirmed that no Cashfree account/credentials were available.

| Attachment section / feature | Source | Implemented / functional / tested | External verification and remaining defect | Classification |
|---|---|---|---|---|
| 1. Safety and preservation | AGENTS.md; additive schema; services/provider-confirmation.js | Existing records/keys preserved; no production financial mutation in tests | Private backup/restore and bank authorization require owner infrastructure | IMPLEMENTED_AND_TESTED / EXTERNAL_ACCESS_REQUIRED |
| 2. Forensic audit | output/testing/END-TO-END-AUDIT-2026-10-31.md; this matrix | Risk-based active-flow audit and source-linked findings | Not a claim to have read every line or all Git history | IMPLEMENTED_AND_TESTED within recorded scope |
| 3. Mandatory prior repairs | routes/payment-link.routes.js, super-admin.routes.js; platform/payments.js | Unsafe active parallel implementations consolidated; targeted security evidence | Full automatic post-failure retry framework remains limited | IMPLEMENTED_AND_TESTED / NOT_IMPLEMENTED for unrestricted multi-attempt retry |
| 4. Root control center | merchant-admin/public/platform.js; platform/identity.js, operations.js | Actual grouped merchant, configuration, finance and operations controls | Not all 28 requested dedicated screens/features exist | IMPLEMENTED_AND_TESTED / NOT_IMPLEMENTED |
| 5. Provision merchants | platform/identity.js; platform.js | MFA/CSRF, owner creation/invitation, IDs, status and isolation tested | Email/mobile delivery adapter and real activation validation needed | IMPLEMENTED_AND_TESTED / EXTERNAL_ACCESS_REQUIRED |
| 6. Independent merchants | platform/identity.js | OWNER/ADMIN/DEVELOPER/FINANCE/OPERATIONS/SUPPORT/VIEWER separation and tenant checks | Full human browser role acceptance not run | IMPLEMENTED_AND_TESTED / IMPLEMENTED_NOT_TESTED |
| 7. Cashfree | providers/cashfree-provider.js; collections.routes.js; provider-webhooks.routes.js | Order/status/signature/SDK flow and contract mocks tested; no invented phone or provider URL | Account/KYC, credentials, product entitlement and real test payment missing; Orders requires genuine backend customer phone | EXTERNAL_ACCESS_REQUIRED |
| 8. Direct corporate bank APIs | providers/direct-bank-provider.js | Unsupported methods/capabilities fail closed | No bank-specific agreement, certificates, API implementation or live acceptance | NOT_IMPLEMENTED / EXTERNAL_ACCESS_REQUIRED |
| 9. Receiving bank settings | platform/payments.js; workspace Connections | Merchant-owned encrypted provider configuration, state/approval and diagnostics | Full requested banking metadata screen and account validation incomplete | IMPLEMENTED_AND_TESTED / NOT_IMPLEMENTED |
| 10. Receiving UPI management | receiving-account.repository.js; platform/payments.js | Owned account configuration, one active direct-UPI slot, limits and policy | Account-scoped provider-linked dynamic QR and scheduled health probes not certified | IMPLEMENTED_AND_TESTED / EXTERNAL_ACCESS_REQUIRED |
| 11. Amount-only links | routes/payment-link.routes.js -> canonical payments | Only amount in UI; stable server-generated IDs when omitted, idempotency and queue | Actual provider's mandatory information cannot be fabricated; provider-only amount-only product not established | IMPLEMENTED_AND_TESTED / EXTERNAL_ACCESS_REQUIRED |
| 12. Player attribution | platform/payments.js; callback-wallet.routes.js | Opaque backend reference persisted/fingerprinted and checked before wallet credit | Real merchant-side player authentication/fulfillment not connected | IMPLEMENTED_AND_TESTED / EXTERNAL_ACCESS_REQUIRED |
| 13. No customer UTR | active checkout-premium.html; dynamo-console.js | Customer reference form/manual review dialog removed; Payment done is UI-only | Exceptional owner reconciliation API preserved and labelled MERCHANT | IMPLEMENTED_AND_TESTED |
| 14. Order/attempt entities | payment_orders; pp_payment_attempts; pp_provider_events | Distinct immutable correlation/snapshot plus state/event evidence | Full multi-attempt retry/overpayment settlement lifecycle not delivered | IMPLEMENTED_AND_TESTED / NOT_IMPLEMENTED |
| 15. Smart routing | platform/payments.js; routing-engine.js | Approved preissue healthy backup selection and audit | All weighted/latency/cost/capacity strategies are not certified operational controls | IMPLEMENTED_AND_TESTED / NOT_IMPLEMENTED |
| 16. Failover | platform/payments.js | Timeout preserves route; original status inquiry; no risk-bypass fallback | Live bank failure/recovery and controlled post-rejection second attempt not certified | IMPLEMENTED_AND_TESTED / EXTERNAL_ACCESS_REQUIRED |
| 17. Confirmation | provider-confirmation.js | Amount/currency/reference, atomic state+journal+outbox and duplicate checks | Live provider credit not exercised | IMPLEMENTED_AND_TESTED |
| 18. Callbacks | core/webhook-engine.js | Durable outbox, retries, HMAC and stable delivery IDs; payload includes attempt/player/reference | External merchant wallet's atomic deduplication remains its responsibility | IMPLEMENTED_AND_TESTED / EXTERNAL_ACCESS_REQUIRED |
| 19. Real-time processing | platform identity stream; provider-confirmation; platform.js | Authenticated invalidation and polling fallback implemented | Fresh browser rendering, real provider latency and fulfillment acknowledgment not verified | IMPLEMENTED_AND_TESTED for backend paths / IMPLEMENTED_NOT_TESTED for fresh visual flow |
| 20. Owner metrics | platform/operations.js analytics/health; workspace | Recorded transaction and operational metrics, no fabricated trend data | Every requested metric/dashboard panel is not implemented | IMPLEMENTED_AND_TESTED / NOT_IMPLEMENTED |
| 21. Diagnostics | operations transactions/cases; pp_provider_events | Actual order timelines and retained verified-conflict cases | Full search by every requested entity and unified attempt UI incomplete | IMPLEMENTED_AND_TESTED / NOT_IMPLEMENTED |
| 22. Support automation | docs/support; existing case APIs | Existing support cases and explanation docs | Fully automated evidence-aware answers for all scenarios incomplete | NOT_IMPLEMENTED in full |
| 23. Ledger | ledger.repository.js; provider-confirmation; refund/payout reservations | Existing double-entry, rollback and deduplication tests; 10,000-call storm | Real settlement/reversal reconciliation and distributed DB acceptance unverified | IMPLEMENTED_AND_TESTED / EXTERNAL_ACCESS_REQUIRED |
| 24. Pricing/finance | platform/operations.js | Plans/subscriptions/invoices/credits and historical snapshots tested | Provider settlement terms/real settlement reporting not certified | IMPLEMENTED_AND_TESTED / EXTERNAL_ACCESS_REQUIRED |
| 25. Security | canonical identity/payment guards; security tests | CSRF, TOTP, recovery, ownership, scoped keys, encryption and signed ingress | Full history audit, penetration test and distributed/IP-proxy acceptance remain open | IMPLEMENTED_AND_TESTED within scope |
| 26. Load | scripts/test-enterprise-capacity.mjs | 100 merchants, 1,000 requests at concurrency 100 passed; 10,000 direct confirmation calls deduplicated | Concurrency 1,000 failed with 768 ECONNREFUSED; steady-rate 50/100/250/500 RPS, provider, hosted and distributed capacity not certified | IMPLEMENTED_AND_TESTED for measured runs; BLOCKED for claimed 1,000-concurrent readiness |
| 27. Infrastructure | render.yaml; hosted launcher; migration/rollback guide | Existing deployment config, readiness and shutdown checks | Free service sleeps; paid durable hosting, private restore drill, PITR/shared limiting/multi-instance/real Docker acceptance missing | EXTERNAL_ACCESS_REQUIRED / NOT_IMPLEMENTED |
| 28. Full acceptance | regression runner and added security tests | JavaScript/synthetic portions exercised | No real Cashfree, bank, native Android, Google consent, distributed restart or complete browser acceptance | EXTERNAL_ACCESS_REQUIRED |
| 29. Documentation | current manuals; audit/security/testing/deployment docs | Updated active contracts, limitations, migration and public manuals | Original historical reports remain evidence of their own baseline only | IMPLEMENTED_AND_TESTED for source; PDF verification recorded separately |
| 30. Phase execution | commits + test artifacts | Reviewed source changes, preservation and actual checks | Phases depending on external accounts or not-implemented features remain open | EXTERNAL_ACCESS_REQUIRED / NOT_IMPLEMENTED |
| 31. Final deliverables | this matrix and linked evidence | Repairs, audit, migration, tests and measured-load artifacts delivered | “Complete enterprise/provider-verified infrastructure” is not a true claim | BLOCKED for final readiness |
| 32. Definition of done | end-to-end pipeline | Local components now reject identified unsafe paths | Actual approved-bank payment -> merchant fulfillment and full recovery/scale acceptance missing | EXTERNAL_ACCESS_REQUIRED |

## Evidence and release gates

- `output/testing/repair-regression-results.json`: final regression snapshot (written after the runner completes).
- `secure-platform-boundaries.test.js`: unsigned callbacks, restricted keys, wallet/refund isolation, timeout and exact-connection tests.
- `platform-identity.test.js`: provisioning, invitations, TOTP replay/recovery, CSRF and transaction rollback.
- `output/testing/enterprise-capacity-100-results.json`: 1,000 requests, concurrency 100, 100 active / 900 queued; 10,000 confirmation calls -> 100 journals and 100 outbox events.
- `output/testing/enterprise-capacity-1000-results.json`: failed burst, 232 accepted and 768 ECONNREFUSED. Do not hide this run or label it passing.
- `docs/deployment/REPAIR_MIGRATION_AND_ROLLBACK.md`: additive schema, legacy API migration, preserved credentials and security-sensitive rollback limits.

Production readiness requires approved Cashfree credentials/product and merchant model, configured verification/invitation delivery, always-on durable hosting, private backup/restore acceptance, real PostgreSQL/distributed failure tests, fresh browser/device testing and resolution of the explicitly NOT_IMPLEMENTED requirements. No credentials, bank references, KYC approval, live provider receipts or performance results are invented.
