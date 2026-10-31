# Safe provider routing and failover

Issued payment route identity is immutable. The former payment-link endpoint that rewrote receiving_account_id is removed. POST /api/v1/payment-links/:id/failover returns 409 and preserves the original attempt.

Before any provider request or payable checkout is issued, a primary connection with an open health circuit can be replaced by a healthy approved enabled connection belonging to the same merchant and environment, within its amount limits. Disabled approval or provider risk restrictions do not trigger a bypass. The exact decision is audited as PREISSUE_ROUTE_SELECTED.

Provider creation persists a separate pp_payment_attempts row with connection ID, environment, provider correlation and the original route snapshot. A lost response or unknown failure leaves UNKNOWN and RECONCILIATION_REQUIRED; the system does not try a second account. Repeat requests reuse the logical order and its stable idempotency key.

Use authenticated POST /v1/payments/:id/refresh-status to inquire using the original provider correlation. Legacy historical Cashfree orders retain their historical merchant-order lookup convention. A late verified success uses the same atomic journal/outbox path. A second distinct successful provider reference creates a reconciliation case and is not credited again.

Automatic post-rejection multi-attempt retry, scheduled recovery probes and complete overpayment settlement are not certified. No real bank failover was exercised. See ../../output/testing/enterprise-capacity-1000-results.json and the requirements matrix for limits.
