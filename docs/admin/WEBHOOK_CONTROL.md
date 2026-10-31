# Callback & Webhook Control

Merchant webhook endpoints are managed by the Platform Owner.

## Callback Directions

### Incoming callback (Bank/PSP → Sanbook Pay)

`POST /v1/webhooks/providers/{provider}` — Receives provider webhooks with signature verification.

### Outgoing callback (Sanbook Pay → Merchant)

Merchant registers a webhook URL. Signed events are sent containing:
- Event ID
- Merchant ID
- Order ID
- Payment ID
- Attempt ID
- Player reference (where available)
- Amount
- Currency
- Verified payment status
- Provider transaction reference
- UTR/RRN (where available)
- Timestamp

## Delivery

- Durable retries with exponential backoff (5s, 30s, 2m, 10m, 1h)
- Dead-letter queue for failed deliveries
- Authorized replay
- Delivery logs tracked separately from wallet fulfillment
- Webhook delivery is at least-once; merchants must implement idempotent handling

## API Endpoints

- `GET /api/platform/v1/webhooks` — Get webhook configuration
- `POST /api/platform/v1/webhooks` — Update webhook URL
- `POST /api/platform/v1/webhook-secret/rotate` — Rotate webhook secret
- `GET /api/platform/v1/webhook-deliveries` — View delivery history
- `POST /api/platform/v1/webhook-deliveries/:id/retry` — Retry failed delivery