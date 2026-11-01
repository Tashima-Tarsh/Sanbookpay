# Merchant onboarding, launch and handover checklist

Prepared 1 November 2026. Source baseline: 8186e32. This adds onboarding-specific results to the production-readiness audit; the nine existing findings remain open. No live merchant or credentials were created by this test.

## One payment API, separate merchant identity

The merchant game backend calls POST https://dynamo-pay.onrender.com/v1/payments with its own scoped bearer API key and a stable Idempotency-Key. Dynamo Pay resolves the merchant from that key. The game frontend opens the returned checkoutUrl. Do not put the merchant secret in a browser, embed it in the checkout URL, or send a different merchantId to change the recipient.

Example request body:

```json
{"orderId":"deposit-1001","amount":"100.00","currency":"INR","playerReference":"player-123"}
```

Headers:

```text
Authorization: Bearer <THIS_MERCHANT_PRODUCTION_API_KEY>
Content-Type: application/json
Idempotency-Key: deposit-1001
```

Response includes paymentId, orderId, amount, status and checkoutUrl. A queued order must wait for an active payable QR. GET /v1/payments/{paymentId} reads its status using the same merchant key. Keep an order-to-player mapping in the merchant database.

Flow: player chooses a deposit in game -> game backend creates order -> game opens checkoutUrl -> player pays the assigned UPI -> Dynamo accepts configured evidence -> Dynamo sends signed callback -> game verifies and durably credits that player once.

## What 'in his name' currently means

The active checkout shows Paying <merchant businessName>. Dynamo Pay remains the platform brand and host. Giving each merchant an API key does not install another gateway or create a separate domain/server. A merchant-specific login is https://dynamo-pay.onrender.com/merchant/<MERCHANT_ID>.

The settings API stores appName, logoUrl and primaryColor, but the current premium checkout template does not apply appName/logo placeholders and retains its Dynamo Pay layout. Full merchant-logo/name white-label presentation is not finished. In addition, the SUCCESS/terminal state response omits merchantName, so a terminal-page reload can fall back to Dynamo Pay instead of keeping the business label.

The business label does not change the actual receiving UPI account. Checkout business name, payment platform brand and bank recipient are separate facts. Verify the real recipient before going live; do not promise that changing a checkout name changes the beneficiary displayed or credited by a payment app.

## Information to collect from the merchant

- Business name, owner/contact name, email, mobile, website/domain, category and address.
- Public HTTPS callback endpoint, developer contact and the backend's outbound IPs if IP restrictions are required.
- Game player-reference format, order identifiers and its durable credit-once implementation.
- Desired deposit limits, support contacts, branding expectations and return-to-game page URL.
- Receiving-account arrangement: platform-assigned UPI or another explicitly approved arrangement. Do not silently assume the merchant supplies its own bank feed.

## Super Admin steps

1. Sign in to /platform and verify MFA. Ensure the email/mobile verification delivery adapter works with real destinations.
2. Add the business and owner from Merchant directory. Save merchantId and its loginPath. The owner invitation is single-use and expires after 24 hours.
3. Owner accepts the invitation and sets a password. Complete real email/mobile verification; an invitation path handed over manually does not by itself verify ownership of the email address.
4. Owner completes business profile and submits. Platform reviews UNDER_REVIEW -> APPROVED. Do not set ACTIVE until identity and collection-route checks pass.
5. Select this merchant. Assign/activate its receiving UPI account. Set channel enabled state, positive-payment limits and allowed VPA controls. A configurable floor of 0 does not allow a zero-value payment.
6. Save its public callback URL and arrange its webhook signing secret. The current Developer tools screen can rotate/display a secret; initial secure handover is not automatically packaged. Do not rotate an existing live customer's secret casually.
7. Configure the intended confirmation route. For receiving alerts, explicitly enable the merchant/account notification-acceptance policy with a reason, pair the receiving phone through its one-time QR and verify device/network/source. Provider collections require a separate genuinely approved connection.
8. Activate the merchant after verified contacts and a qualifying route. Notification activation currently requires callback, active account/policy and a paired active phone. Onboarding success is not proof of a real bank/phone test.
9. Issue a PRODUCTION dp_live API key with payments.create and payments.read; only add other scopes when needed. Securely save the one-time secret, limit its access, and set IPs/rate limits. Do not issue refunds.create before the refund-idempotency defect is repaired and accepted.
10. Give the merchant the handover pack below. Have its developer implement raw-body signature verification, order/amount/source checks, delivery deduplication and unique wallet credit in one transaction.
11. Complete a controlled permitted real payment, callback failure/retry, duplicate replay, offline/revoked-phone and delayed-alert tests. Reconcile actual bank credit. The current source defects must be fixed before unrestricted live use.

## What to give the merchant

| Item | Handover value |
|---|---|
| Merchant ID | Their own merchantId |
| Dashboard login URL | https://dynamo-pay.onrender.com/merchant/<MERCHANT_ID> |
| Owner access | One-time invitation; owner chooses password |
| API base | https://dynamo-pay.onrender.com |
| Create endpoint | POST /v1/payments |
| Status endpoint | GET /v1/payments/{paymentId} |
| Authentication | Their own production bearer API key |
| Key scopes | payments.create, payments.read |
| Webhook URL | Their backend HTTPS receiver, saved for this merchant |
| Webhook signing secret | This merchant's own secret, delivered securely |
| Event handling | SUCCESS, exact amount/currency/order/player checks and unique credit |
| Confirmation policy | NOTIFICATION with bankVerified=false where enabled; never mislabelled bank verified |
| Integration material | Current canonical request/response example and tested callback consumer guidance |
| Support and limits | Actual rate/amount limits, queue behavior, support and incident contact |

Never give customers the Super Admin password/token, hosting key, database connection string, encryption key, platform Gmail credentials, phone signing key or another merchant's credentials. Legacy Client-ID/Client-Secret/Service-Id is a different contract; do not mix it with dp_live bearer authentication.

## Callback requirements

Dynamo sends X-Gateway-Signature (sha256=<hex>) over the exact raw body using the merchant webhook secret, plus X-Gateway-Delivery-Id. The receiver verifies the signature in constant time, checks merchant/order/amount/currency/player/source, records the delivery and unique credited payment/order, commits the wallet credit and only then replies 2xx. PAYMENT_DETECTED is PENDING and must not credit the wallet. Browser return navigation is not a payment callback.

## Confirmed onboarding-specific missing items

1. Direct-UPI returnUrl is not persisted by canonical payment creation. The game return link cannot be promised from that field until repaired.
2. Terminal checkout responses omit merchantName. Keep the same business identity for ACTIVE and terminal states.
3. appName/logo settings are not applied by the active premium template; the current settings form also has no branding inputs. Implement/test the intended co-branded presentation if required.
4. Downloadable dynamo-openapi.json describes legacy routes and omits /v1/payments. Publish the current bearer-key contract and matching examples before handover.
5. There is no single generated merchant handover package bundling login URL, key, callback setup, scopes, examples, limits and acceptance status. Current UI actions are separate.
6. Real invitation/email/mobile delivery has not been accepted in this audit. The successful onboarding probe used a mock delivery adapter.
7. Current signed Android APK/native Vivo acceptance is missing; production APK download returned 503 and there are no bound production devices/policies in the audited snapshot.
8. Customer-specific callback/wallet UAT and the production source defects in the earlier audit remain open. In particular: untrusted notification origin, title/body parsing, lost callback reservation, late alerts, unsafe DNS egress, refund idempotency and legacy minimum/cache/balance behavior.

The audited production snapshot had one existing merchant record but zero scoped keys, provider connections, phones and notification policies. It must not be described as a fully configured customer integration.

## Isolated test evidence

scripts/check-merchant-onboarding.test.js creates an in-memory synthetic merchant. It uses a seeded MFA-verified root session, mocked email/mobile delivery, a protocol-level paired phone and a stubbed callback transport. It passed invitation, owner login, mobile verification, profile submission, platform approval, receiving configuration, notification-route activation, scoped key issuance, INR 1 payment creation and ACTIVE merchant display name. It reproduced the first four specific gaps above and reserved a success callback. It did not prove real delivery, actual Google consent, bank settlement, native APK behavior, browser screenshots or customer wallet credit.

Production remains NOT READY for unrestricted customer payments. This check changes no production configuration and creates no customer credentials.
