# Smart UPI Routing

A centralized intelligent routing engine evaluates multiple factors to select the best receiving route for each payment.

## Evaluation Factors

- Merchant eligibility
- Approved receiving accounts
- Approved VPAs
- Amount and currency
- Provider capability
- Bank health
- API availability
- Recent success rate
- Recent timeout rate
- Error rate
- Latency
- Route priority
- Route weight
- Transaction limits
- Maintenance windows
- Circuit breaker status
- Provider restrictions

## Routing Strategies

- **Priority-based** — Select by configured priority order
- **Weighted** — Weighted random selection among eligible routes
- **Health-aware** — Prefer routes with highest success rate
- **Latency-aware** — Prefer routes with lowest latency
- **Success-rate-aware** — Prefer routes with highest confirmation success
- **Capacity-aware** — Consider transaction limits
- **Cost-aware** — Consider transaction fees
- **Controlled automatic failover** — Fail over to backup routes on failure

## Audit

Every routing decision is stored with its reason and timestamp.