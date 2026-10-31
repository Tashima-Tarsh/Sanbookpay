# Operations Center

The Platform Owner monitors platform health, incidents, and operational alerts.

## Monitored Areas

- Bank/PSP outages
- Receiving VPA failures
- Routing failovers
- API timeouts
- Pending confirmations
- Duplicate provider events
- Failed merchant callbacks
- Ledger posting failures
- Reconciliation mismatches
- Queue failures
- Database health
- Security anomalies

## Incident Management

- Incident timelines
- Alerts with severity levels
- Assignments
- Resolution records

## Cases

Support, dispute, reconciliation, and incident cases can be created, tracked, and resolved with full audit trail.

## API

`GET /api/platform/v1/operations/health` — Provider connections, observers, and callback health.
`GET /api/platform/v1/cases` — List cases.
`POST /api/platform/v1/cases` — Create a case.