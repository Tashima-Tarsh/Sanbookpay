# Gaming Wallet Integration

## Overview

Gaming merchants can link player references to payment orders. When a payment is confirmed, the player's wallet is credited exactly once.

## Flow

1. Merchant backend authenticates the player and sends an opaque player reference
2. Sanbook Pay generates Order ID
3. Sanbook Pay creates the provider-linked payment attempt
4. Bank/PSP confirms payment
5. Sanbook Pay identifies the correct order and merchant
6. Merchant receives the player reference in a signed webhook
7. Merchant credits the correct player once

## Wallet Credit

`POST /api/v1/callbacks/wallets/credit`
Body: `{ "merchantId": "...", "playerReference": "...", "paymentId": "...", "orderId": "...", "amountPaise": 50000, "idempotencyKey": "..." }`

Idempotency ensures a wallet is never credited twice for the same payment.

## Wallet Balance

`GET /api/v1/callbacks/wallets/:merchantId/:playerReference`

## Security

- Never credit wallets from browser redirects or unverified events
- Wallet fulfillment is idempotent
- Player reference is opaque; no sensitive player details in public Order IDs