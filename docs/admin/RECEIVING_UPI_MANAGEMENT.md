# Receiving UPI Management

A registry of approved receiving VPAs is managed centrally by the Platform Owner.

## VPA Fields

- VPA ID
- Receiving UPI address
- Bank connection
- Provider account
- Merchant ownership
- Dynamic QR capability
- Route priority
- Route weight
- Transaction limits
- Current health
- Recent error rate
- Recent confirmation success rate
- API latency
- Circuit breaker state
- Last successful payment
- Last failed attempt
- Last health check

## Controls

- Super Admin can enable, disable, approve, and configure eligible VPAs
- Merchant can select from its approved routes where permitted
- A receiving VPA without a compatible authorized payment verification integration must not be represented as an automatically verifiable payment route

## Routing

VPAs are linked to routing rules with priority, weight, amount limits, and health monitoring. Circuit breakers prevent routing to unhealthy VPAs.