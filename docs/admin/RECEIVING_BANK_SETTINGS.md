# Receiving Bank Settings

The Platform Owner can add and manage approved receiving bank/PSP connections through the Super Admin Control Center.

## Receiving Bank Fields

- Bank connection ID
- Bank/provider name
- Account holder name
- Masked account number
- IFSC
- Account type
- Provider merchant ID
- Authorized merchant assignment
- Supported payment capabilities
- Dynamic QR support
- Status API support
- Signed webhook support
- Transaction feed support
- Balance inquiry support
- Refund support
- Settlement report support
- Reconciliation support
- Connection status
- Last successful API call
- Last successful transaction
- Last transaction synchronization
- Error rate
- Latency
- Credential expiry metadata

## Add Bank Connection Wizard

1. Select bank/PSP
2. Select approved integration method
3. Configure provider-issued credentials or provider-hosted authorization
4. Validate connection
5. Retrieve supported account metadata
6. Configure receiving VPA
7. Configure dynamic QR
8. Configure provider webhook
9. Configure status inquiry
10. Configure reconciliation
11. Assign to authorized merchant
12. Run controlled verification
13. Activate

## Security

- Never collect ordinary retail internet-banking passwords
- Credentials encrypted at rest
- Connection health monitored with circuit breaker
- Unsupported capabilities displayed honestly