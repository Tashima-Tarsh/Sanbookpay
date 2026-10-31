# Cashfree integration contract and access gates

The adapter implements authenticated order creation, payment inquiry and raw-body HMAC verification. Official contract references checked on 31 October 2026:

- https://www.cashfree.com/docs/api-reference/payments/latest/orders/create-order
- https://www.cashfree.com/docs/payments/online/web/redirect
- https://www.cashfree.com/docs/payments/online/webhooks/webhook-indempotency

Order creation uses the actual provider-returned payment_session_id. The application serves /api/v1/provider-checkout/:paymentId and opens the official Cashfree JavaScript v3 checkout. It does not invent a payments.cashfree.com URL or treat a local VPA deep link as a Cashfree dynamic QR.

The current Orders product requires a genuine customer phone from the authenticated merchant backend. It is never substituted with a dummy contact, the merchant's contact or a fabricated customer. Amount-only UI support therefore does not certify that this Cashfree product can create a collection with no customer information. A compatible approved product/contract or trusted backend customer information is required.

Use a separate approved merchant connection or an explicitly authorized partner/platform arrangement. Approving one account does not establish permission to collect for unrelated merchants. Connection ID, merchant, environment and credentials stay bound together. Capability declarations do not prove bank or provider entitlement.

No Cashfree account, KYC approval, sandbox keys or live keys were supplied. Source and synthetic contract tests are IMPLEMENTED_AND_TESTED. Actual provider acceptance is EXTERNAL_ACCESS_REQUIRED. No real collection, refund, payout, verification debit or credential rotation was performed.
