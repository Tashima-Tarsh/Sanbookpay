# API Management

Every merchant has independent API credentials managed by the Platform Owner.

## Features

- API key issuance with label, scopes, environment (sandbox/production)
- Secret issuance (returned once at creation)
- Key rotation (creates new key, revokes old)
- Key revocation
- Permission scopes (payments.create, payments.read, refunds.create, refunds.read, transactions.read, reports.read, webhooks.manage, credentials.manage, settings.manage, connections.manage, policy.manage)
- Rate limits (1-1000 requests per minute)
- Quotas
- IP allowlist
- Usage logs
- Authentication error logs
- Sandbox/production separation

## Security

- Platform Owner can administer key lifecycles without seeing stored plaintext secrets
- Secrets are hashed (SHA-256) in the database
- IP allowlist enforcement
- Rate limiting per key
- All key operations are audited

## API Endpoints

- `GET /api/platform/v1/api-keys` — List API keys
- `POST /api/platform/v1/api-keys` — Create API key
- `POST /api/platform/v1/api-keys/:id/revoke` — Revoke API key
- `POST /api/platform/v1/api-keys/:id/rotate` — Rotate API key
- `GET /api/platform/v1/api-usage` — View API usage logs