# Reconciliation

## Process

Sanbook Pay reconciles bank/provider transactions with internal records:

1. Receive bank settlement report
2. Match provider transactions to internal payment records
3. Identify unmatched incoming credits
4. Detect overpayments and duplicate payments
5. Handle late confirmations
6. Create reconciliation cases for mismatches
7. Post reconciliation entries to ledger

## Reports

- Settlement reports per merchant
- Reconciliation status per transaction
- Unmatched credit queue
- Financial exception queues

## Principles

- Integer-paise accounting
- Double-entry ledger
- Immutable financial records
- Never silently rewrite historical ledger entries
- Distinguish payment confirmation, funds settlement, and wallet fulfillment