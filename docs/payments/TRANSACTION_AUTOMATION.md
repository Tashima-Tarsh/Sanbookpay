# Transaction Automation

## Payment Flow

Customer Payment → Bank/PSP → Verified Provider Event → Payment State Machine → Database Transaction → Immutable Ledger → Transactional Outbox → Event Queue → Real-Time Dashboard → Merchant Webhook → Wallet Fulfillment Acknowledgment

## Automated Processes

- Automatic payment verification
- Automatic UTR/reference capture
- Automatic order matching
- Automatic ledger posting
- Automatic dashboard updates
- Automatic merchant callbacks
- Automatic retry processing
- Automatic reconciliation
- Automatic route health monitoring
- Automatic safe failover
- Automatic incident alerts

## Infrastructure

- PostgreSQL for financial records
- Redis for caching and session management
- SSE for real-time dashboard updates
- Webhook engine with durable retries

## Restrictions

- Never credit wallets from browser redirects or unverified events
- Integer-paise accounting
- Double-entry ledger
- Immutable financial records
- Atomic posting
- Idempotency