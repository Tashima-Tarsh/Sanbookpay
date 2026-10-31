# Payment Troubleshooting

## Common Issues

### Payment not confirming

- Check if the provider callback was received (Super Admin → Payment Verification)
- Check route health (Super Admin → Smart UPI Routing)
- Check for circuit breaker open state
- Verify the payment session hasn't expired

### Webhook not delivered

- Check webhook URL is valid and reachable
- Check webhook secret is configured correctly
- Check delivery logs (Super Admin → Callback & Webhook Control)
- Retry failed delivery

### Route unavailable

- Check route health status
- Verify circuit breaker state
- Check if backup routes are available
- Contact Platform Owner to approve alternative routes

### Wallet not credited

- Verify payment status is SUCCESS
- Check idempotency key was used
- Check wallet is active
- Review diagnostic center for fulfillment status

## Diagnostic Steps

1. Search by Order ID in Payment Diagnostic Center
2. Review timeline: order created → route selected → QR generated → payment attempt → provider confirmation → ledger posted → webhook delivered → wallet fulfilled
3. Identify where the flow broke
4. Take corrective action or escalate to Platform Owner