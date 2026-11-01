# Hyperswitch hosted checkout add-on

Direct UPI remains available through its existing receiving accounts and payment flow. Hyperswitch is a separate, optional provider connection for hosted checkout. This integration uses the official v1 cloud sandbox/live APIs; it does not install the Hyperswitch infrastructure or create a processor account.

## Connect a merchant

1. Create a Hyperswitch account and business profile. Connect a supported processor in that profile and enable the payment methods the processor supports for your merchant and currency.
2. Sign in to the merchant's Sanbookpay workspace and open Connections. Choose HYPERSWITCH under Connect a provider.
3. Choose SANDBOX initially. Enter the Hyperswitch merchant ID, that environment's API key, profile ID, and the profile's separate payment_response_hash_key as the webhook signing key. Secrets are encrypted in the database and are not returned in connection listings.
4. Save and use Test connection. This performs a real authenticated read; successful authentication does not certify processor activation or a successful payment.
5. Copy the connection-specific webhook URL shown in the table into the matching Hyperswitch profile's webhook configuration. It has the form https://YOUR-HOST/api/v1/webhooks/hyperswitch/CONNECTION-ID. Configure the same signing key in Hyperswitch. Use a public HTTPS host for provider callbacks. For live cloud webhooks, follow Hyperswitch's endpoint allowlisting instructions.
6. The platform owner reviews and approves the connection, then enables it. Merchants may manage their own connection but cannot approve themselves.

After approval, Create checkout on the connection accepts an INR amount and HTTPS return URL. It opens the actual hosted link returned by Hyperswitch. SANDBOX remains a test flow. The existing amount-only Create payment action continues using direct UPI.

Card details, CVV, OTPs and customer bank login belong on Hyperswitch's or the bank's hosted page. Do not enter those into Sanbookpay. Adding a receiving account or IFSC does not enable card acquiring. Card and bank-redirect availability depends on the connected processor; no universal Indian netbanking coverage is claimed.

## Backend integration

Use your scoped Sanbookpay API key for the same environment. POST /v1/payments with Idempotency-Key and JSON such as:

    {"orderId":"YOUR-STABLE-ORDER","amount":"10.00","currency":"INR","connectionId":"YOUR-CONNECTION-ID","returnUrl":"https://your-site.example/payment-return"}

Store the returned paymentId and open checkoutUrl. Reuse the same request key and order on retries. Omitting connectionId retains direct UPI. A server-generated 30-character Hyperswitch payment_id is persisted before the external creation request so an uncertain response can be reconciled against the original payment.

GET /v1/payments/PAYMENT-ID reads recorded status. POST /v1/payments/PAYMENT-ID/refresh-status performs an authenticated provider inquiry. A timeout or malformed provider response can leave RECONCILIATION_REQUIRED; inquire using the original payment ID instead of generating another order. A recovered pending hosted link is saved on the order and returned by subsequent status reads.

The return URL is navigation only. Fulfill an order only after the server confirms SUCCESS and your signed merchant callback is durably deduplicated. Incoming Hyperswitch webhooks require raw-body HMAC-SHA512, exact merchant/profile/connection/environment, full captured amount and INR currency. Authorization-only and partial-capture states do not mark an order paid. Successful payment state, journal posting and outgoing callback reservation commit together. No bank UTR is invented for a card payment.

## Limits and acceptance

No live or sandbox account credentials were supplied for this implementation. Tests use an isolated HTTP contract server and synthetic payment evidence; this does not establish live processing. Before enabling production, verify actual sandbox checkout, customer return, captured success, failed/declined payments, duplicate webhook handling, refund operations supported by your processor, and a controlled live payment. This add-on does not implement Hyperswitch refunds, payouts or subscriptions; do not advertise those as supported.

Self-hosted endpoints are operator-controlled environment settings, never merchant-entered URLs. Set HYPERSWITCH_SANDBOX_BASE_URL and HYPERSWITCH_SANDBOX_CHECKOUT_ORIGIN to the local instance origin, for example http://localhost:8080. Local HTTP is permitted only for sandbox loopback addresses. Production overrides require HTTPS origins using HYPERSWITCH_PRODUCTION_BASE_URL and HYPERSWITCH_PRODUCTION_CHECKOUT_ORIGIN. Only the exact configured checkout origin is accepted. Restart Sanbookpay after changing these settings. The platform retains its existing approval process. No production deployment was performed.

## Local Docker installation

The official upstream checkout is kept in ignored output/reference/hyperswitch. Its Compose project name is sanbook-hyperswitch. Ports are bound to localhost; the dashboard uses port 19000, PostgreSQL 15432, and Redis 16379 to avoid existing app ports. The API uses 8080 and the SDK web client 9050. This upstream trial setup uses demonstration accounts and is not a production installation. Do not expose it publicly or use real card data.

From that directory, use Docker Compose with `--project-name sanbook-hyperswitch --env-file .oneclick-setup.env`. Start with `up -d`, inspect with `ps`, and stop without deleting volumes using `stop`. The engine executable on this computer is under D:\OSINT-UPSTREAM\containers\DockerDesktop\resources\bin. Installation and runtime health must be checked separately; downloaded images alone do not establish a running service.

## Official contracts

- https://github.com/juspay/hyperswitch/blob/main/api-reference/v1/openapi_spec_v1.json
- https://github.com/juspay/hyperswitch-docs/blob/main/about-hyperswitch/sdk-payment-flows.md
- https://github.com/juspay/hyperswitch-docs/blob/main/integration-guide/webhooks.md
