# Refunds and Reversals

## Principles

- Refund reservation before provider call
- Uncertain results require reconciliation, not silent failure
- Never retry with a new external transfer/refund ID after a timeout
- Cumulative reservations include manual requests
- Preserve refund/payout reservations when provider response is uncertain

## Process

1. Merchant requests refund with idempotency key
2. Reserve funds in ledger
3. Submit refund to provider
4. On success: confirm refund, release reservation
5. On failure/uncertainty: mark for reconciliation, preserve reservation
6. On provider failure: reverse reservation, notify merchant

## API

Refund endpoints are available through the merchant API with `refunds.create` scope.