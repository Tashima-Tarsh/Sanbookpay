# Payment Diagnostic Center

A searchable diagnostic console for investigating payment lifecycle events.

## Search Fields

- Merchant ID
- Order ID
- Payment ID
- Attempt ID
- Player reference
- UTR/RRN
- Provider reference

## Results Show

- Order created
- Player associated
- Route selected
- Receiving bank
- Receiving VPA
- QR generated
- Payment attempt
- Provider confirmation
- Failover history
- Ledger posting
- Merchant webhook delivery
- Wallet fulfillment acknowledgment
- Reconciliation status

## Evidence

Never invent a missing provider event. All diagnostic results are backed by stored records.

## API

`POST /api/v1/callbacks/diagnostics/search` — Search payment diagnostics.