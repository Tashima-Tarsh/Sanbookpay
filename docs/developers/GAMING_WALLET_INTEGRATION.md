# Authenticated player wallet fulfillment

The merchant backend authenticates the player and supplies an opaque playerReference when creating the provider order through POST /v1/payments. This value is included in the idempotency fingerprint and stored with the order. Do not infer a player from amount, browser events, IP address or a submitted UTR.

POST /api/v1/callbacks/wallets/credit requires a scoped dp_live/dp_test server credential with payments.create, an active merchant, paymentId, the exact stored playerReference, and a stable Idempotency-Key (the legacy idempotencyKey body field is also accepted). merchantId is never sufficient authorization. If amountPaise is supplied it must match the stored amount exactly; the credit amount comes from the confirmed order.

Only an owned SUCCESS provider order with a claimed provider payment reference qualifies. Customer notifications, direct-UPI notes, redirects and manual merchant confirmation do not qualify. Shared/unattributed orders cannot be credited to an arbitrary player afterward through this endpoint.

The transaction locks the payment on PostgreSQL, claims it once in pp_wallet_fulfillments, increments the wallet balance atomically, writes its wallet transaction and audit event. Repeated requests, even with different idempotency keys, reuse the fulfillment; a reused key for another payment is rejected. GET /api/v1/callbacks/wallets/:merchantId/:playerReference requires payments.read and matching authenticated merchant ownership.

This is the gateway's recorded wallet. Crediting an external merchant wallet remains the merchant's job: verify the exact raw-body outgoing HMAC and atomically deduplicate the stable delivery ID and owned payment before crediting once. Successful HTTP delivery is not proof of external wallet fulfillment. Real merchant-wallet acceptance remains EXTERNAL_ACCESS_REQUIRED.
