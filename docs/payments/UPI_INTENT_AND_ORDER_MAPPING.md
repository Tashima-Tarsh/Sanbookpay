# UPI Intent and Order Mapping

## Order ID Mapping

The Order ID uniquely identifies a logical Sanbook Pay payment order. The system maintains a secure mapping:

Merchant ID → Player Reference → Order ID → Payment ID → Attempt ID → Receiving Bank → Receiving VPA → Provider Reference → Verified Payment → Merchant Callback → Wallet Fulfillment

## Player Reference

For gaming deposits:
- Merchant backend authenticates the player
- Merchant backend sends an opaque player reference
- Sanbook Pay generates Order ID
- Player reference is included in metadata and webhook
- Merchant credits the correct player once

## UPI Intent

Dynamic UPI QR/intent is generated for each payment:
- `upi://pay?pa=<VPA>&pn=<Name>&am=<Amount>&cu=INR&tn=<OrderID>`
- QR code generated for scanning
- Intent URI for mobile UPI apps

## Restrictions

- Do not embed sensitive player details into public Order IDs
- Amount-only links cannot automatically identify a player without trusted association
- Do not use amount alone to identify payer or player