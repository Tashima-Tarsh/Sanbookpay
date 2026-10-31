# Measured local capacity report ? 31 October 2026

Isolated in-memory SQLite, Node v24.14.1, loopback HTTP and synthetic accounts. No real provider or bank traffic. The benchmark explicitly overrides the global IP limiter to 20,000; per-key limits remain recorded. The receiving-slot policy allows one active checkout per account.

| Workload | Accepted | Errors | Active | Queued | Result |
|---|---:|---:|---:|---:|---|
| 100 merchants, 1,000 requests, concurrency 100 | 1000 | 0 | 100 | 900 | PASS |
| 100 merchants, 1,000 requests, concurrency 1,000 | 232 | 768 | 100 | 132 | FAIL |

At concurrency 100, p50=157 ms, p95=297 ms and p99=307 ms; elapsed 1773 ms. Unique IDs: 1000; wrong merchant/player attributions: 0. These figures do not measure bank confirmation or Render throughput.

The failed burst recorded {'ECONNREFUSED': 768}. It reproduced with network escalation; increasing the test listener backlog did not make it pass. The application served only the accepted requests. This does not prove a database corruption or explain all host transport behavior, and is not a 1,000-concurrent readiness certification.

A separate direct confirmation-service storm ran 10000 calls across 100 synthetic provider orders: 100 journal transactions, 100 durable outbox events and 9900 duplicates suppressed. No webhook was sent to a real merchant, and no external wallet fulfillment is claimed.

Reproduce: `node scripts/test-enterprise-capacity.mjs` (concurrency 1,000); set SANBOOK_LOAD_CONCURRENCY=100 for the bounded test. Each run uses a new isolated in-memory database. JSON evidence retains both concurrency levels. Steady-rate 50/100/250/500 RPS, real PostgreSQL, multi-process workers, provider network and hosted scale remain unverified. A larger host/proxy transport test is required before diagnosing or claiming the 1,000-concurrent target.
