# Bank API Configuration

Sanbook Pay integrates with approved bank/PSP providers through the provider connection framework.

## Supported Providers

Cashfree PG is the primary supported provider. Additional providers can be added through the provider adapter framework.

## Connection Fields

- Bank/provider name
- Environment (sandbox/production)
- Client ID
- Client secret (encrypted at rest)
- Webhook URL
- Webhook secret (encrypted at rest)
- Merchant VPA
- Supported capabilities

## Connection Management

1. Platform Owner adds connection via Super Admin
2. Credentials are encrypted at rest
3. Connection is validated with a test call
4. Connection is approved before enabling
5. Health is monitored with circuit breaker

## Security

- Never hardcode merchant credentials
- Never collect retail internet-banking passwords
- Credentials encrypted at rest
- Connection rotation through secure workflow