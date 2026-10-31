# Automatic Failover

Automatic UPI failover is mandatory. When the primary route fails, the system safely selects an eligible backup route.

## Scenario 1 — Primary route fails before order issuance

Detect failure, select eligible backup route, create provider-linked attempt, generate new dynamic QR/intent, return valid checkout, record failover event, alert operations.

## Scenario 2 — Payment creation times out

Do not assume timeout means failure. Query provider order status and use idempotency keys before creating a new attempt.

## Scenario 3 — Customer already scanned QR A

Do not silently redirect an uncertain payment. Query original provider, preserve original attempt, prevent uncontrolled duplicate debits, handle late confirmations.

## Scenario 4 — Confirmed failure

Close failed attempt, re-evaluate eligible routes, create new attempt, generate new QR, preserve logical Order ID, record attempt history.

## Scenario 5 — Route recovers

Use controlled recovery probes, cooldowns, and circuit breaker reset. Do not immediately restore full traffic without validation.

## Scenario 6 — Provider restriction

Do not route around bank/PSP fraud, security, or merchant eligibility restrictions. Escalate appropriately.

## API

`POST /api/v1/payment-links/:id/failover` — Trigger manual failover for a payment (requires merchant API key).