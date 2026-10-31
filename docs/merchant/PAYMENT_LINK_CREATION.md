# Payment Link Creation

## Amount-Only Mode

The Create Payment Link screen requires only:

- **Amount (₹)** — Required
- **Generate Payment Link** button

No manual Order ID, customer name, customer mobile number, or manual UTR is required.

## Automatic Generation

1. Authenticate merchant via API key
2. Resolve Merchant ID
3. Validate amount and limits
4. Generate unique Order ID (server-generated)
5. Generate Payment ID
6. Create payment session
7. Select eligible receiving route via Smart UPI Routing
8. Create provider-linked payment attempt
9. Generate dynamic UPI QR/intent
10. Generate hosted checkout link
11. Persist payment references
12. Return checkout link and QR
13. Start real-time status monitoring

## API Endpoint

`POST /api/v1/payment-links/amount-only` — Create amount-only payment link (requires merchant API key).