# Authoritative automatic verification

Cashfree ingress is POST /api/v1/webhooks/cashfree/collections. The legacy /api/v1/callbacks/providers/cashfree URL delegates to that exact verified handler. Unknown provider aliases fail closed. Signatures cover the raw bytes and timestamp using the actual selected account secret; no generic unsigned success path remains.

The verified event is retained encrypted in pp_provider_events. The order must match the provider reference without ambiguous merchant ownership. Confirmation requires exact integer paise, currency and a non-reused provider payment ID. State, reference claim, double-entry journal and outgoing callback reservation commit atomically. The dashboard is invalidated afterward through authenticated SSE.

A duplicate successful reference does not post again. A second distinct successful reference is retained for reconciliation without changing the original success or crediting twice. Missing, mismatched and conflicting evidence does not become success. FAILED provider attempts do not prove no future successful attempt will arrive.

POST /v1/payments/:id/refresh-status requires an owned payment and payments.read. It uses the original provider order and credentials. It never creates another payment after a timeout. Existing historical Cashfree order correlation remains compatible.

SMS, Gmail and Android evidence remains supplementary in production. Customer Payment done events never prove settlement. The normal checkout no longer requests a UTR. Exceptional back-office credit review remains separately authorized and labelled MERCHANT; it is not provider verification and cannot fund the provider-only wallet credit endpoint.

An approved Cashfree account, product entitlement, credentials and actual sandbox/live acceptance are required. None were supplied for this repair. Do not mark this integration SANDBOX_VERIFIED or LIVE_PROVIDER_VERIFIED.
