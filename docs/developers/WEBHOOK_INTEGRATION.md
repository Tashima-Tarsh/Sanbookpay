# Webhook Integration

## Registering a Webhook

Merchants register a callback URL through the dashboard or API:

`POST /api/platform/v1/webhooks`
Body: `{ "url": "https://merchant.example.com/webhooks/sanbook" }`

## Incoming Events

Sanbook Pay sends signed POST requests to the merchant's webhook URL with:

```json
{
  "event": "SUCCESS",
  "paymentId": "uuid",
  "orderId": "SBO-...",
  "amount": "₹500.00",
  "amountPaise": 50000,
  "currency": "INR",
  "method": "UPI",
  "status": "SUCCESS",
  "bankReferenceNumber": "123456789012",
  "utr": "123456789012",
  "payeeVpa": "merchant@bank",
  "beneficiary": { "name": "Merchant Name", "upiId": "merchant@bank" },
  "confirmationSource": "PROVIDER",
  "completedAt": "2026-10-31T10:00:00Z"
}
```

## Signature Verification

Headers:
- `X-Gateway-Signature`: `sha256=<hmac>`
- `X-Gateway-Delivery-Id`: unique delivery ID
- `X-Gateway-Timestamp`: timestamp
- `X-Gateway-Event`: event type

Verify HMAC-SHA256 using the merchant's webhook secret.

## Delivery

- At-least-once delivery with retries
- Exponential backoff: 5s, 30s, 2m, 10m, 1h
- Merchants must implement idempotent handling (deduplicate by delivery ID)
- Delivery logs available in Super Admin → Callback & Webhook Control