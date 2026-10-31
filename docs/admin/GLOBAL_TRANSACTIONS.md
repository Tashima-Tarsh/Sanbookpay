# Global Transactions

The Platform Owner can view every payment order, attempt, and transaction across all merchants.

## Features

- View all transactions across the platform
- Filter by merchant, status, amount, date range
- View transaction timeline (order creation, route selection, provider confirmation, failover, ledger posting, webhook delivery, wallet fulfillment)
- Export transaction data
- Drill into individual transaction details

## Tenant Isolation

Platform staff can view all merchants. Merchant-scoped roles can only view their own merchant's transactions.

## API

`GET /api/platform/v1/transactions` — List transactions with tenant-scoped filtering.