# Hyperswitch payment add-on

## Goal

Add real Hyperswitch API integration as an optional merchant-connected payment route. Keep existing direct-UPI routing and receiving accounts intact. Card and bank-redirect methods are available only when enabled on the merchant's actual Hyperswitch processor connection. No simulated payment success outside isolated tests.

## Approaches

Recommended: create Hyperswitch hosted payment links using its v1 payments API. Customers enter card details or follow bank redirects on the provider page. This avoids collecting PAN, CVV, bank passwords or OTPs in Sanbookpay.

Alternative: embed the Hyperswitch SDK. This adds frontend SDK configuration and lifecycle handling without removing the need for merchant/processor credentials. A full replacement of Sanbookpay with the Hyperswitch infrastructure is outside this add-on.

## Merchant setup

Extend the existing provider connection form with HYPERSWITCH and clearly labelled merchant ID, API key, profile ID and webhook signing key. Encrypt secrets, keep tenant ownership and sandbox/production separate, preserve approval controls, and run real authenticated diagnostics. Keys must never reach browser responses. Do not create or claim an activated processor account on the merchant's behalf.

## Payment lifecycle

Add a provider adapter using fixed official sandbox/production endpoints. Submit positive integer INR paise, the exact profile and immutable order/attempt correlation. Use provider-supported idempotency semantics verified from its current API contract. Retain uncertain attempts for reconciliation rather than creating another payment after a timeout. Return only an actual HTTPS hosted link returned by Hyperswitch; do not manufacture checkout URLs or enable test-only local card routes.

Use an exact connection-bound webhook endpoint. Verify X-Webhook-Signature-512 over raw bytes with the stored key, bind the returned payment to its merchant/order/profile and exact amount/currency, and deduplicate events/payment references. Authenticated payment inquiry reconciles the original payment. Reuse canonical atomic payment-state, journal and outgoing merchant-callback confirmation. A customer redirect never confirms payment. Authorization without capture does not count as paid.

## Bank details and UPI

Keep existing encrypted merchant bank-account storage, IFSC lookup and direct-UPI behavior. A bank account/IFSC is a receiving configuration, not card-acquiring credentials. Customer bank login remains on provider/bank pages. No promise that every bank or card scheme is enabled: the connected processor determines availability.

## Verification and external acceptance

Write failing contract and integration tests before implementation. Cover invalid signatures, cross-merchant/environment/profile access, mismatched amounts, duplicate/late events, uncertain creation and recovery, secret redaction and unchanged UPI routing. Exercise real HTTP requests against an isolated contract server, then run typecheck, build, secret checks and regression tests. Capture desktop/mobile before and after the provider-form change.

The owner currently has no Hyperswitch credentials or processor account. Live-card processing cannot be accepted until those accounts are connected and a controlled real payment is verified. Sandbox acceptance also requires sandbox credentials or an explicitly provisioned self-hosted test environment. No production merge/deployment is included.

## Official references

https://github.com/juspay/hyperswitch

https://github.com/juspay/hyperswitch-docs/blob/main/about-hyperswitch/sdk-payment-flows.md

https://github.com/juspay/hyperswitch-docs/blob/main/integration-guide/webhooks.md
