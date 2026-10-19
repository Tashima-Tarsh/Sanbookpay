# Sanbook Pay — Security Architecture & Production Audit Report

## 1. Security Invariants & Compliance

Sanbook Pay enforces stringent financial security controls:

### Invariant 1: No Public Force-Success Endpoint
There is no client-facing or operator endpoint that can arbitrarily mark a payment `SUCCESS`. Status transitions are driven exclusively by:
- Authenticated bank/provider webhooks verified via HMAC-SHA256.
- Direct upstream provider REST status queries.
- Genuine banking notification observations validated by the matching engine.

### Invariant 2: Cryptographic Secrets at Rest (AES-256-GCM)
All banking credentials, client secrets, API tokens, and private keys are encrypted using **AES-256-GCM** before persistence to the database:
- Random 12-byte initialization vector (IV) per entry.
- 16-byte authentication tag ensuring ciphertext integrity.
- Zero plaintext credential leakage in logs or API responses.

### Invariant 3: Unparsed Raw Body Webhook Verification
Webhook signature verification requires exact raw bytes before JSON parsing:
- Re-stringifying JSON mutates whitespace, key order, and float formatting, causing signature mismatches.
- `HttpServer.parseRawBody()` captures the unparsed Buffer directly from the socket.

### Invariant 4: Strong API Key Hashing & Guarding
- Merchant API keys are hashed with `SHA-256` before database lookup.
- Console administrative routes require valid JWT tokens with short expiry.

---

## 2. Automated Security Audit Findings

| Component | Audit Check | Implementation Status | Verification Evidence |
| :--- | :--- | :--- | :--- |
| **Provider Vault** | AES-256-GCM encryption for secrets at rest | ✅ PASSED | `packages/core/src/providers/provider-registry.js` |
| **Webhook Engine** | HMAC-SHA256 signature verification over raw request body | ✅ PASSED | `apps/payment-api/src/routes/provider-webhooks.routes.js` |
| **Financial Ledger** | Balanced double-entry in integer paise | ✅ PASSED | `packages/db/src/repositories/ledger.repository.js` |
| **Idempotency** | Atomic distributed idempotency keys | ✅ PASSED | `packages/db/src/repositories/idempotency.repository.js` |
| **Payout Safety** | Two-step authorization before money movement | ✅ PASSED | `apps/payment-api/src/routes/payouts.routes.js` |
| **Audit Trails** | Append-only financial event ledger | ✅ PASSED | `payment_order_events` table |

---

## 3. Vulnerability Mitigation Summary

- **Injection Attacks (SQL/NoSQL)**: Prevented by parameterized queries in all repository methods.
- **Timing Attacks**: Mitigated by `crypto.timingSafeEqual` in all webhook signature comparisons.
- **Race Conditions**: Prevented by atomic SQL transactions and unique database constraints on idempotency keys and UTRs.
- **DDoS & Scraping**: Rate-limiting and strict Content-Security-Policy headers applied across all public ingress routes.

