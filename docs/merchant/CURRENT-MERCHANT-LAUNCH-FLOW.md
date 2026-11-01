# Dynamo Pay merchant launch and integration

Dynamo Pay is the platform, never an onboarded customer. The reserved bootstrap account is internal storage only: it is excluded from customer listings/counts, cannot receive a customer integration pack, and its former merchant URL redirects to /platform. Only newly onboarded independent businesses receive merchant workspaces. Historical internal records are preserved.

## One-time setup by Super Admin

1. Create the independent merchant and send its owner invitation (24-hour single-use link).
2. Owner accepts, sets a password, verifies real email/mobile and submits its profile. Platform reviews and approves.
3. Assign the receiving UPI, callback HTTPS endpoint and amount limits. A zero configured floor still requires a positive payment.
4. Pair the receiving Android phone with its one-time QR. A current signed observer build must be installed.
5. Capture a genuine bank/payment-app notification, inspect its OS-derived package and SHA-256 certificate in Payment mirror, independently confirm the installed official app identity, and approve the exact source in Connections. Alternatively approve an exact bank SMS sender. Never approve arbitrary/personal message apps.
6. Enable the account notification-acceptance policy with a reason, or configure an approved provider. Activate the merchant after the setup checks pass.
7. In Merchant API access, review Merchant integration setup and choose Create merchant integration pack. Save the private JSON download. It issues a fresh production payments.create/payments.read key and includes this merchant's webhook signing secret, login URL, endpoints and flow. Existing API keys are preserved. Server-side secrets must never go in frontend/mobile code or public Git.
8. Complete a real permitted payment, actual bank-credit reconciliation and customer game-wallet/callback acceptance. Configuration ready is not a bank/device certification.

## Give the customer

The private merchant integration JSON, their own invitation/login URL, this guide, their configured callback URL, actual limits and support contact. Do not share Super Admin, database, hosting, encryption, Gmail or receiving-device keys. API secrets cannot be recovered after creation; a newly issued key must be saved securely.

## Payment launch

Merchant backend calls POST https://dynamo-pay.onrender.com/v1/payments.

Headers:

```text
Authorization: Bearer <THIS_MERCHANT_API_SECRET>
Content-Type: application/json
Idempotency-Key: deposit-1001
```

Body (amount in INR, at most two decimals):

```json
{"orderId":"deposit-1001","amount":"100.00","currency":"INR","playerReference":"player-123","returnUrl":"https://YOUR-GAME-BACKEND/deposit/result"}
```

The key determines the merchant. Open the returned checkoutUrl directly. A queued order has no payable QR until activated. Checkout shows the merchant business name, configured brand/logo/accent and Powered by Dynamo Pay; it does not change the actual bank recipient. The return URL must be absolute HTTPS. Browser return/Payment done does not credit a wallet.

GET /v1/payments/{paymentId} with the same bearer key reads status. Retry create with the SAME idempotency key and identical request after a timeout. A changed request returns a conflict. /developers/openapi.json is the downloadable contract. Legacy /v1.0 APIs use separate Client-ID/Client-Secret/Service-Id headers; do not mix contracts.

## Signed callback and game-wallet credit

Dynamo sends JSON with paymentId, merchantId, orderId, playerReference, amountPaise, INR currency, event/status and actual UTR where supplied. It signs the exact raw bytes with this merchant's webhook secret in X-Gateway-Signature: sha256=<hex>; X-Gateway-Delivery-Id stays stable across retries. Verify with constant-time HMAC comparison before parsing/processing. Check expected merchant/order/player, exact integer-paise amount, currency and permitted confirmation source.

In one durable game-database transaction, record the delivery ID and enforce a unique credited payment/order, then credit the mapped player once. Return 2xx only after committing. Both duplicate delivery IDs and a second delivery referring to an already credited payment must be harmless.

Approved receiving-alert SUCCESS is NOTIFICATION with the actual captured UTR. The platform accepts that source under its explicit policy; it is not independent bank verification. Optional PAYMENT_DETECTED is PENDING and must not credit. Provider success remains PROVIDER; authorized bank review remains MERCHANT.

Callbacks are reserved with state/ledger updates, attempted immediately after commit and retried from the database. A missing callback URL retains a pending event; restoring a valid URL lets the worker recover it. A slow merchant no longer serializes all other merchants: callback concurrency is bounded at 20 overall and 5 per merchant within this process. Default: five total attempts, 10-second attempt timeout, retry delays 5 seconds, 30 seconds, 2 minutes, 10 minutes plus sweep/network time. No instant bank-alert or hosted SLA is promised.

## Late alerts and matching

Short processing timeout does not discard eligibility before the original payable deadline. A credit must match the exact UPI, amount and a unique eligible order within the original payable window and ten-minute creation cap. Shared UPI/amount collisions remain ambiguous rather than guessing a player. Evidence arriving after that deadline requires reconciliation. Offline phone queues preserve original observation timestamps; the app re-signs upload timestamps on retry.

## Refunds and balances

Supported provider refunds use POST /v1/refunds, refunds.create scope and a stable Idempotency-Key. The same request returns its original refund ID; changed requests conflict. Do not create another refund after uncertainty. Notification collections do not enable provider refunds/payouts. The legacy wallet exposes notificationclearingbalance separately from provider unsettledbalance and bank settledwallet; none is an independent live bank-balance query.

## Operational acceptance still needed

Current signed APK/native toolchain and real Vivo acceptance, real email/mobile delivery, Google consent, approved provider credentials where applicable, customer callback/wallet tests, restore/recovery and always-on hosting are external gates. Do not use a stale APK or historical audit as current sign-off. Never fabricate certificate fingerprints or delivery success.
