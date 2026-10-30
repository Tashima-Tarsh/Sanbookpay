# Dynamo Pay API ? Merchant Integration Guide

Base URL: use the HTTPS gateway origin supplied by Dynamo Pay. Examples use `https://pay.example.com`; replace it with your assigned origin. Quick-tunnel origins are temporary and change on restart.

## Endpoints

| Function | Method | Endpoint |
|---|---|---|
| Generate UPI payment | POST | `/v1.0/collect/upi` |
| Check payment status | POST | `/v1.0/payin/checkstatus` |
| IFSC bank lookup | POST | `/v1.0/ifsc/{ifsc}` |
| Wallet balances | POST | `/v1.0/wallet` |
| Webhook and server IP configuration | POST | `/v1.0/merchant/webhook` |

Legacy `/v1/dynamo/collect/upi`, `/v1/dynamo/checkstatus`, `/v1/dynamo/ifsc/{ifsc}`, `/v1/dynamo/wallet` and `/v1/dynamo/merchant/webhook` remain supported.

## Authentication

Send all requests from your backend with `Client-ID`, `Client-Secret`, `Service-Id`, and `Content-Type: application/json`. Get these values from Merchant Console ? API Keys & webhooks. Service-Id is your merchant service ID, not the sample IDs 12345 or 10086. Never expose client secrets or the webhook signing secret in browser code.

An optional server IP allowlist accepts exact IPv4/IPv6 addresses; CIDR ranges are not supported. Empty means no IP restriction. Configure the actual public egress IP of your server. The trusted unified gateway uses Cloudflare's client-IP header only through loopback ingress; direct deployments use the socket address. Proxy deployments must preserve this trusted boundary.

## UPI channel controls

Merchant Console ? UPI Accounts provides Enable UPI payments, minimum amount, maximum amount, and allowed receiving UPI IDs. Requested defaults are INR 200?20,000. Save the settings to apply them to new requests. Existing orders remain queryable and reconcilable. The receiving-UPI allowlist controls the beneficiary account, not the customer's payer UPI ID. With an empty allowlist, configured merchant receiving accounts are allowed.

The versioned API also enforces its INR 100.00 floor. The effective minimum is the greater of that floor and the configured channel minimum. Amounts accept at most two decimals. Do not send paise as the `amount` value.

## Generate a payment

```sh
curl -X POST "$DYNAMO_BASE_URL/v1.0/collect/upi" \
  -H "Client-ID: $DYNAMO_CLIENT_ID" \
  -H "Client-Secret: $DYNAMO_CLIENT_SECRET" \
  -H "Service-Id: $DYNAMO_SERVICE_ID" \
  -H "Content-Type: application/json" \
  -d '{"amount":"201.00","uniquetransactionid":"ORDER-1001","remarks":"Digital service","name":"Customer","emailid":"customer@example.com","mobileno":"9876543210"}'
```

Required: `amount`, `uniquetransactionid` (1?120 letters, digits, hyphens or underscores). Customer fields and remarks are optional. Persist your unique transaction ID before calling.

Illustrative active response (HTTP 201):

```json
{"transaction":"payment-uuid","uniquetransactionid":"ORDER-1001","amount":"201.00","currency":"INR","status":"PENDING","internalStatus":"ACTIVE","intent":"upi://pay?pa=merchant%40bank&pn=Dynamo+Pay&am=201.00&tn=ORDER-1001&cu=INR","qr":"https://pay.example.com/checkout/payment-uuid/qr.svg","checkoutUrl":"https://pay.example.com/checkout/payment-uuid","datetime":"2026-10-31T00:00:00.000Z","expiresAt":"2026-10-31T00:05:00.000Z","platform":"dynamo-pay"}
```

Redirect the customer to `checkoutUrl` for Dynamo Pay's QR and mobile UPI app controls. `qr` is a URL returning SVG, not base64. `intent` is a UPI URI, not a web URL. A queued order has `intent: null` and `qr: null`; open its checkout and wait for activation. Do not ask a customer to pay a queued or expired QR. A payment QR is available only while ACTIVE; otherwise QR requests return 409.

Repeating the same merchant transaction ID and amount returns HTTP 200 with the existing payment; it never creates a second charge. The same ID with a different amount returns 409. Expired/cancelled/failed orders also retain their ID; use a new ID for a customer-approved new attempt. HTTP 200/201 from creation means the order exists, not that money was received.

## Check status

POST `/v1.0/payin/checkstatus` with `{"transaction":"payment-uuid"}` or `{"uniquetransactionid":"ORDER-1001"}` and the same authentication headers.

Public status is `SUCCESS`, `FAILED` or `PENDING`. `internalStatus` explains ACTIVE, QUEUED, PROCESSING, VERIFICATION_PENDING, SUCCESS, FAILED, EXPIRED or CANCELLED. EXPIRED and CANCELLED map to public FAILED; VERIFICATION_PENDING stays PENDING. Poll no faster than once every five seconds and stop at a final result. An unconfirmed payment timeout never proves bank failure.

The response includes amount, currency, IDs, bankReferenceNumber/upiTransactionId, payer VPA when available, payee details, creation and completion timestamps. Missing bank data is null. `reportedUtr` is an unverified claim; `confirmationSource` distinguishes BANK_OBSERVER from MERCHANT confirmation. Never treat a typed UTR, Payment done button or browser callback as proof of receipt.

## Signed callbacks

Configure a public HTTPS receiver in Merchant Console or POST `/v1.0/merchant/webhook` with `{"webhookUrl":"https://merchant.example.com/payment-callback","ipWhitelist":["203.0.113.10"]}`. Example IP is illustrative: replace it with your real egress IP. This saves your callback destination and the server IP addresses allowed to call your API.

Callbacks are POST JSON. Fields include `event`, `status`, `transaction`, `paymentId`, `uniquetransactionid`, `orderId`, `amount` (rupees), `amountPaise`, `currency`, `method`, `bankReferenceNumber`, `utr`, `senderVpa`, `payeeVpa`, `beneficiary`, `confirmationSource`, `completedAt`, and `metadata`. Bank reference or beneficiary fields may be null when not independently observed.

Headers: `X-Gateway-Signature: sha256=<hex>`, `X-Gateway-Delivery-Id`, `X-Gateway-Timestamp`, `X-Gateway-Event`. Compute HMAC-SHA256 of the **exact raw request bytes** using the webhook signing secret. Compare in constant time. Verify before parsing or processing. Reject invalid signatures. Only fulfil when verified SUCCESS, expected order/merchant, INR currency, exact amountPaise and eligible payment method match your stored order. COD success means order placement, not prepaid collection.

```js
import crypto from 'node:crypto';
// rawBody must be the original bytes, before JSON middleware.
const expected = 'sha256=' + crypto.createHmac('sha256', process.env.DYNAMO_WEBHOOK_SECRET).update(rawBody).digest('hex');
const signature = String(req.headers['x-gateway-signature'] || '');
const valid = signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
if (!valid) { res.statusCode = 401; res.end(); return; }
const event = JSON.parse(rawBody.toString('utf8'));
// Deduplicate X-Gateway-Delivery-Id and persist the result atomically with fulfilment.
// Validate event.orderId, event.amountPaise, currency and method against your database.
res.statusCode = 200; res.end('OK');
```

Return HTTP 200 after durably storing/processing a valid event. All 2xx responses acknowledge delivery. Ten-second delivery timeout; up to five total attempts. Retry delays after the initial attempt are 5 seconds, 30 seconds, 2 minutes and 10 minutes, plus scheduler delay. Every non-2xx response or network error is retried. Delivery ID and raw payload remain stable across retries. Signatures cover the payload, not the timestamp header; use durable delivery-ID/order deduplication, not timestamp checks alone. Failed deliveries beyond the limit require reconciliation with the status API and merchant operations.

## IFSC

POST `/v1.0/ifsc/SBIN0000001` with `{}`. IFSC format is four letters, zero, six alphanumeric characters. Returns bank, branch, city, state, address, contact, supportedModes and UPI/NEFT/RTGS/IMPS booleans. This uses an external public bank directory; it is not bank-account ownership or penny-drop verification. Do not interpret a lookup as an available payout rail. Unavailable or unknown entries can return 404; do not assert an account invalid solely because the directory is unavailable.

## Wallet

POST `/v1.0/wallet` with `{}`. Returns `settledwallet`, `unsettledbalance`, `lienbalance`, `loanbalance` as decimal INR strings, plus merchantId, currency and timestamp. These are Dynamo Pay accounting-ledger balances, not a live bank-balance API. Direct UPI payments reaching the receiving bank do not automatically increase a provider wallet or prove settlement.

## Errors and operating limits

400 invalid amount, disabled channel, non-allowlisted receiving VPA, malformed input or invalid IFSC. 401 missing/invalid credentials. 403 blocked IP or merchant mismatch. 404 unknown transaction/IFSC. 409 repeated order with a changed amount or inactive QR. 429 service rate limiting. 5xx infrastructure/configuration failure. Inspect `code` and `error`; preserve your transaction ID when retrying an uncertain creation response. Exact rate limits are deployment-specific; honour 429 and back off.

Default checkout active window is five minutes; activation can be queued. Payment done starts a short verification window, followed by pending reconciliation if confirmation is missing. SMS/Gmail observers must be connected for automatic direct-UPI verification. Reconcile bank records by receiving account, amount and UTR; ambiguous credits require review. App launch depends on installed apps/device/browser and bank acceptance. No callback IP ranges or automatic payouts are promised by these endpoints. Use a stable HTTPS domain for customer integrations.
