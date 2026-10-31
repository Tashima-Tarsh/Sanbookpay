# API Integration

## Authentication

Merchants authenticate using API keys issued through the Super Admin Control Center or merchant dashboard.

Format: `dp_live_<secret>` or `dp_test_<secret>`

Send as: `Authorization: Bearer dp_live_...`

## Endpoints

### Create Payment (Amount-Only)
`POST /api/v1/payment-links/amount-only`
Headers: `Authorization: Bearer <api-key>`, `Idempotency-Key: <unique-key>`
Body: `{ "amount": "500.00", "currency": "INR", "playerReference": "optional" }`

### Get Payment State
`GET /api/v1/payment-links/:id/state`
Headers: `Authorization: Bearer <api-key>`

### Webhook Configuration
`GET /api/v1/webhooks` — Get webhook config
`POST /api/v1/webhooks` — Set webhook URL
`POST /api/webhook-secret/rotate` — Rotate webhook secret

## Scopes

- `payments.create` — Create payments
- `payments.read` — Read payments
- `refunds.create` — Create refunds
- `refunds.read` — Read refunds
- `transactions.read` — Read transactions
- `reports.read` — Read reports
- `webhooks.manage` — Manage webhooks
- `credentials.manage` — Manage API keys
- `settings.manage` — Manage settings
- `connections.manage` — Manage connections
- `policy.manage` — Manage policies

## Rate Limits

Configurable per key (1-1000 requests per minute). IP allowlist supported.