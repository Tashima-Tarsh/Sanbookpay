# Dynamo Pay acceptance and code-freeze report

Date: 31 October 2026. Review baseline: GitHub main and Render commit `a4da32493ce3b4b140deb0681b6f548acc15c636`. Local source was checked against both before implementation. This report supersedes the older production approval claims.

## Release status

A source review candidate is prepared on `fix/payment-hardening-and-operations`. Production deployment, bank activation and credential rotation are not performed by this freeze. A passing synthetic test is not a bank settlement certification. No production financial records were reset or amended in this work.

## Repairs and verification

| Area | Implemented result | Evidence |
|---|---|---|
| Payment success | Legacy card/netbanking simulation blocked outside tests; automatic fake settlements removed | production-hardening.test.js |
| Provider confirmation | Existing atomic collection state/journal/callback path retained; payout signature separated from PG contract; payout bearer authorization added | payment-confirmation-regression.test.js; provider signature checks |
| Observer trust | Production notifications retained as supplementary evidence; rejected source/parser results do not fall through | production-hardening.test.js |
| Exact parsing | Rs. currency prefixes no longer let an earlier account number win amount extraction | SMS observer and verification suites |
| Tenant isolation | Gmail credentials no longer copied/cleared across all merchants; inbox explicitly bound, not global latest order | source review and observer suites |
| Android transport | Signed heartbeats, device/account ownership check, persisted retry queue in Java source; synthetic SMS test disabled | API heartbeat/isolation tests; native acceptance still required |
| Android packaging | Java/Kotlin duplicate-class build path resolved by Java Gradle path; owner signing identity required; stale APK downloads rejected using source/APK manifest hashes | runtime helper checks; native compiler/device not available |
| Financial review | Owner-only bank review records actual reference, reason, audit, journal and callback atomically; duplicate review cannot repost | production-hardening.test.js |
| Refunds | Cumulative reservations include manual requests; durable reservation before provider call; uncertain response requires reconciliation | production-hardening.test.js |
| Payouts | Production approval required; atomic approval claim before provider request; journal reserved; uncertain result is not silently failed/retried | financial platform and hardening suites |
| Wallet | Provider clearing is no longer cancelled out by the opposite receivable entry in the unsettled projection | source review; recorded ledger balance only, not live bank balance |
| Acceptance rules | Merchant-scoped allow/block/watch targets, expiry, state control and audited matches; block precedes allow | production-hardening.test.js and browser controls |
| Dashboard | Existing visual identity kept; rules and bank review reuse existing forms/dialogs/tables | desktop/mobile browser review, all ten views |
| Secrets | Known encryption-key fallback removed; decrypt failures fail closed; Compose secrets required; tracked-file scan in CI | typecheck, secret scan and financial tests |
| Manuals | Public setup/API/observer guide and private owner configuration PDF rebuilt; historical generators delegate to current source | rendered PDF review, page bounds and public-secret comparison |

## Recorded tests

The repository regression runner passed all 45 suites and 359 tests as recorded in `output/testing/regression-results.json` (the external PostgreSQL test is skipped unless its private URL is supplied). Managed PostgreSQL acceptance was also run separately in an isolated schema and passed both checks, including nested rollback, collection confirmation/outbox, queueing and synthetic observation matching. Tests create no real bank payment.

The local SQLite capacity test stored 1,001 receiving accounts while enforcing one active account. A burst of 200 requests at concurrency 25 accepted one active checkout and 199 queued requests, with p95 creation 297 ms in that run. Repeated order requests reused one transaction. Ten separate merchants had ten active checkouts. The benchmark used a temporary database, loopback transport, an increased request limiter and synthetic bank observations. It recovered ten transport errors using the same order IDs. This is not a hosted throughput or zero-failure guarantee. Full evidence is in `output/testing/capacity-results.json`.

Desktop/mobile checks cover all ten console views, live stream connection, API loads, overflow and browser exceptions. Added controls were exercised against an isolated copy of the database. Private PDF values remain only in ignored storage; public manuals were checked against the owner's private credentials. No live banking action was submitted.

## Remaining acceptance gates and scope limits

1. A current native Android APK must be compiled, signed with the original owner keystore and installed/tested on the receiving phone. This environment has no Android SDK/JDK/Gradle toolchain or release keystore configured. JavaScript Android tests are not native-device proof. The older bundled APK is deliberately unavailable in production until it matches current source.
2. Google consent and actual inbox credentials must be connected by the owner; validate genuine bank email and offline/reconnect behaviour. Current runtime supports one explicitly bound inbox per observer service, not independent tenant inbox orchestration.
3. Approved bank/provider accounts, permitted merchant category, real credit/payout/refund and bank settlement reconciliation require controlled live acceptance. The direct bank H2H adapter is not activated by entering a VPA. A customer gaming wallet must implement its own durable callback deduplication; the disabled demo wallet is not production accounting.
4. Owner/admin and observer credentials are implemented. A separate multi-operator role system, disputes case management, distributed event replay, provider circuit-breaker control plane, authenticated payer-VPA identity and automatic bank-statement reconciliation are not certified features of this candidate. They require separate implementation/acceptance before selling them as complete.
5. The per-IP limiter is per process. Render edge/client-IP forwarding and any customer IP allowlist must be verified on the target deployment; local spoof-header tests do not certify every external proxy chain. The local benchmark does not prove 1,000 concurrent active payable checkouts, QR p95 100 ms, verified-event-to-UI p95 1 second, or wallet p95 2 seconds on the host. Those remain measured deployment targets, not guarantees.
6. Docker files were inspected and unsafe secret defaults removed; Docker startup was not executed because the engine is unavailable. The optional Redis/Svix paths are not the active durable outbox and were not certified through real service restarts.
7. Render Free can sleep; its database expires on 30 November 2026. No paid hosting or HA change was made. Backup/restore and an always-on hosting decision remain operational gates.

## Freeze procedure

Commit the accepted source and public PDFs, retain private PDFs and secret backups outside Git, and create an annotated review tag pointing to the tested commit. Record PDF SHA-256 hashes in the release manifest. Open a review PR; do not merge to main or deploy production without approval. Recheck GitHub main and live commit before any deployment so new work is not overwritten. An annotated source tag freezes that source snapshot; it does not disable future development or turn untested external integrations into completed features.
