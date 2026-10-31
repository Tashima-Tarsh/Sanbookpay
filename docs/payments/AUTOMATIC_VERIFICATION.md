# Automatic Verification

Payment verification uses authoritative sources:

- Verified provider webhook (with signature verification)
- Authenticated provider status API
- Authorized bank transaction feed
- Provider reconciliation report
- Bank settlement report

## Process

1. Receive provider event
2. Authenticate and verify it (signature verification over raw bytes)
3. Apply replay protection (deduplication by fingerprint)
4. Persist event
5. Match provider reference to payment attempt
6. Validate merchant, amount, and currency
7. Update payment state atomically
8. Post ledger entries (double-entry, integer paise)
9. Publish real-time update (SSE)
10. Enqueue merchant callback (signed webhook)
11. Track wallet fulfillment
12. Reconcile records

## Restrictions

- Never use amount-only matching or customer screenshots as proof of payment
- Never force-success a payment without authoritative provider evidence
- Never switch an already potentially paid UPI attempt without safe status handling
- Manual UTR entry is removed from all customer-facing screens