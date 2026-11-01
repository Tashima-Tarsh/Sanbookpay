# Current production-readiness repairs

Status: local repair candidate on fix/merchant-production-readiness. Source baseline 8186e32. This document supersedes the earlier audit for the repaired code behavior, not as proof of deployment or genuine bank acceptance.

## Repaired behavior

- Approved phone source: OS-derived Android package and signing-certificate SHA-256, or exact bank SMS sender, must match a Super Admin source policy. Unapproved app identities may be discovered without accepting the payment. Existing paired apps need the new source-aware signed build.
- Combined notification title/body is reparsed on the server; native pre-parsed amount alone cannot settle.
- Pending verification keeps the original payable deadline, not a shortened processing deadline. Shared UPI/amount ambiguity is still rejected; evidence outside the original deadline requires reconciliation.
- Callback events remain durable if the endpoint is missing. Restoring the URL allows retry recovery. DNS is validated inside connection lookup and private/reserved targets are blocked.
- Callback dispatch is bounded and fair across merchants; one slow endpoint does not serialize all merchants, and concurrent sweeps skip in-flight events. Database delivery IDs remain stable.
- Refunds bind merchant plus Idempotency-Key to a canonical request and stable refund ID, including replay after uncertain provider responses.
- Legacy positive-value payments use saved limits, newly created merchant credentials work without restart, and notification clearing has a separate reported balance.
- Merchant name is retained in active and terminal checkout state; branding/logo/accent and HTTPS returnUrl work for the merchant launch flow.
- Canonical bearer API documentation/OpenAPI are published in the repository. Merchant API access includes a readiness checklist and a private integration pack. The pack adds a scoped payment key, includes the merchant webhook secret and preserves existing keys. Provider-only merchants receive a provider-specific request example requiring actual customer details.

## What remains external

A current signed APK must be built with the owner's release identity and accepted on the Vivo phone. No JDK/Gradle/ADB or release signing identity was available in this session. QUERY_ALL_PACKAGES is declared for the owner-installed receiving observer to inspect a chosen notification app signing identity; that does not grant independent bank verification. Device compromise, spoofed SMS/email and genuine bank/app provenance still require operational controls. Notification acceptance remains NOTIFICATION with bankVerified=false.

Real email/mobile delivery and Google consent must be configured and accepted. A merchant must verify raw callback bytes and atomically credit its own wallet once. No actual customer credentials were issued or rotated, no production data was reset, and no live bank money was moved by these tests. Render Free sleep and the audited PostgreSQL expiry on 30 November 2026 remain hosting gates; no paid resource was purchased.

Use CURRENT-MERCHANT-LAUNCH-FLOW.md and the private per-merchant integration download for handover. Old audit PDFs and test outputs are historical evidence and must not be described as the current repair status.
