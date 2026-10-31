# Multi-merchant platform implementation plan

**Goal:** Extend the accepted Dynamo Pay runtime into an isolated merchant platform without replacing the console or changing existing financial records.

**Architecture:** Keep the native HTTP server, synchronous SQLite/PostgreSQL repository adapter and authoritative payment pipeline. Add a separately authenticated `/api/platform/v1` surface, persisted identity/permissions and an additive `/platform` experience. Existing owner access bridges into Super Admin; public registration never grants platform privileges.

**Tech stack:** Node.js 22.13+, existing JavaScript runtime, PostgreSQL/SQLite, existing browser styles and ReportLab PDF tooling.

**Specification:** User-supplied master multi-merchant implementation and Phase 13 manuals, accepted by “do it” after the proposed staged implementation.

## Constraints

- Preserve existing design, records, credentials and unrelated staged files.
- Production observations remain supplementary; no synthetic production data or invented provider references.
- Tenant ownership comes from server authentication. Platform administration is separate from merchant API keys.
- Use additive tables and exact integer accounting; payment status, journal and callback remain atomic.
- Merge/deploy authorized by the user after checks; live bank actions and credential rotation are excluded.

## Tasks and verification

- [ ] Identity: persistent sessions, tenant roles, registration/verification, onboarding, invitations, MFA and audited lifecycle. Test cross-tenant access, role denial, token expiry/replay and restart recovery.
- [ ] Merchant API: hashed scoped keys, one-time secret issuance, revocation, IP/rate controls; versioned payment/status/refund/balance/webhook interfaces. Test idempotency, suspended-account rejection, unknown provider and tenant boundaries.
- [ ] Operations: real transaction search/timeline, cases/incidents, observer health, pricing/invoices/credits. Test integer fee calculation, period replay, ownership and audited state transitions.
- [ ] Frontend: additive responsive platform pages using the accepted palette/components. Wire every exposed action to persisted APIs; test empty/error states, escaping and desktop/mobile flow.
- [ ] Integration: route ingress/proxies, owner bridge and existing credential compatibility; reject fabricated provider fallback and unauthorized legacy payment creation.
- [ ] Manuals: role-based documentation index, onboarding/config/API/observers/provider/security/deployment guides, public and private PDFs; endpoint/link/environment/secret checks.
- [ ] Acceptance: typecheck, runtime build, secret scan, complete regression, isolated PostgreSQL, browser regression and measured load. Native Android/provider/Google/Docker gates remain separately identified where external access is absent.
- [ ] Release: review diff and remote HEAD; commit explicit owned paths, push, check CI, merge and deploy accepted SHA; verify readiness/authentication/public docs without creating real money movements.

## Review focus

Cross-merchant IDs must return no foreign data. Revoked keys and suspended merchants cannot initiate payments. Timeout retries must preserve external IDs/reservations. Privileged changes require permissions and CSRF/MFA controls. Missing delivery/provider/device configuration must return an explicit blocked state rather than fake verification.

## Execution record

- Baseline: remote main `7a3b626`, merged hardening PR, GitHub CI success. Render still `a4da324` at audit. Branch `feat/multi-merchant-platform`; three unrelated staged tmp files preserved.
- User supplied detailed specifications and explicitly instructed execution; routine implementation choices use the existing architecture rather than adding a new service/framework.
