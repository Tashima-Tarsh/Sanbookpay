# Failover and recovery evidence

secure-platform-boundaries.test.js verifies that a provider timeout creates exactly one UNKNOWN attempt, preserves its connection and snapshot, returns RECONCILIATION_REQUIRED and reuses the original order on retry. An approved healthy backup is selected only before issue when the primary health circuit is already open. Disabled/restricted approval is not bypassed.

The same suite rejects route rewriting, unsigned generic callbacks, expired/read-only keys, malformed money, wrong player attribution, cross-tenant wallet and refund access, and duplicate wallet fulfillment. Existing provider-confirmation tests exercise raw signatures, duplicate journal/outbox posting, late conflicts and rollback on posting failures.

These are synthetic isolated tests, not Cashfree sandbox or real-bank evidence. PostgreSQL restart, independent concurrent worker processes, database exhaustion, real provider recovery probes, Docker and bank-device acceptance remain unverified. Do not claim zero-loss distributed failover from these results.
