# Merchant FAQ

## General

**Q: How do I create a payment link?**
A: Use the Create Payment Link screen. Enter only the amount and click Generate Payment Link. The Order ID is generated automatically.

**Q: Do I need to collect customer details?**
A: No. Amount-only payment links require only the amount. No customer name, mobile, or UTR is required.

**Q: How do I receive payments?**
A: Customers pay through the hosted checkout link or by scanning the dynamic UPI QR. Payments are verified automatically through the provider.

**Q: What is a Merchant ID?**
A: A unique identifier (SBM-XXXXXXXX) assigned to your merchant account by the Platform Owner.

**Q: How do I get API credentials?**
A: Generate API keys in the Merchant Dashboard → API Credentials section.

## Payments

**Q: How are payments verified?**
A: Payments are verified through authorized bank/PSP APIs and provider callbacks. Manual UTR entry is not required.

**Q: What happens if a payment fails?**
A: The system attempts automatic failover to backup routes. If all routes fail, the payment creation fails safely.

**Q: How do I track payment status?**
A: Use the Merchant Dashboard → Transactions or query the payment state API.

## Wallet

**Q: How does gaming wallet integration work?**
A: Player references are linked to payment orders. When payment is confirmed, the wallet is credited exactly once with idempotency protection.