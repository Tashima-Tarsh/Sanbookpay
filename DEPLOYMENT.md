# DYNAMO PAY UNIVERSAL UPI MIRROR — Deployment Guide

## Deployment Profiles

| Profile | Use Case | PostgreSQL | Redis | API Replicas | Webhook Workers |
|---------|----------|------------|-------|--------------|-----------------|
| local-dev | Developer machine | 1 container | 1 container | 1 | 0 |
| pilot | Small pilot server | 1 container | 1 container | 2 | 2 |
| production | 1,000 merchants | 1 primary + 1 replica | 1 container | 4 | 4 |
| high-scale | 10,000+ merchants | Primary + read replicas | Redis cluster | 10+ | 10+ |

## Prerequisites

- Docker Engine 24+
- Docker Compose v2
- 4GB+ RAM (production)
- Domain with DNS control (for TLS via Caddy ACME)
- PostgreSQL client (for backup/restore)

## Quick Start — Local Development

```bash
# 1. Copy environment template
cp .env.production.template .env
# Edit .env with local values

# 2. Create secrets directory
mkdir -p secrets
echo -n "your_db_password" > secrets/db_password.txt
echo -n "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" > secrets/encryption_key.txt
echo -n "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" > secrets/jwt_secret.txt

# 3. Start with local-dev profile
docker compose -f docker-compose.production.yml --profile local-dev up -d

# 4. Verify health
curl http://localhost:6100/health
```

## Quick Start — Production (1,000 merchants)

```bash
# 1. Set deployment profile
export DEPLOYMENT_PROFILE=production
export PAYMENT_API_REPLICAS=4
export WEBHOOK_WORKER_REPLICAS=4

# 2. Create production secrets
mkdir -p secrets
openssl rand -hex 32 > secrets/db_password.txt
openssl rand -hex 32 > secrets/encryption_key.txt
openssl rand -hex 32 > secrets/jwt_secret.txt

# 3. Configure Caddy with your domain
# Edit Caddyfile to use your actual domains

# 4. Start production stack
docker compose -f docker-compose.production.yml --profile production up -d

# 5. Verify
curl https://api.example.com/health
curl https://admin.example.com/health
```

## Running Load Tests

```bash
# Install k6
# https://grafana.com/docs/k6/latest/set-up/install-k6/

# Run Stage 1 load test (10 merchants, 100 sessions)
export BASE_URL=http://localhost:6100
export MERCHANT_ID=<your_merchant_id>
export DEVICE_ID=<your_device_id>
k6 run scripts/load-test-upi-mirror.js

# Performance acceptance objectives:
# - T2→T3 (device transmit): under 200ms p95
# - T4→T5 (ingestion): under 100ms p95
# - T5→T7 (matching): under 200ms p95
# - T7→T8 (callback first attempt): under 250ms p95
# - T4→T8 (end-to-end): under 750ms p95 under defined load
```

## Rollback Instructions

```bash
# Rollback to previous version
docker compose -f docker-compose.production.yml --profile production pull
docker compose -f docker-compose.production.yml --profile production up -d

# Or rollback specific service
docker compose -f docker-compose.production.yml --profile production up -d --scale payment-api=2 payment-api
```

## Database Migrations

Migrations run automatically on container startup via Docker entrypoint.
Migration files: `packages/db/src/migrations/001-upi-mirror.sql`

To run manually:
```bash
psql "$DATABASE_URL" -f packages/db/src/migrations/001-upi-mirror.sql
```

## Monitoring

- Health endpoints: `GET /health` on each service
- Super Admin performance centre: `https://admin.example.com/api/platform/v1/upi-mirror/admin/performance`
- Callback command centre: `https://admin.example.com/api/platform/v1/upi-mirror/admin/callbacks`
- Security audit: `https://admin.example.com/api/platform/v1/upi-mirror/admin/audit`

## Security Notes

- Never use sleeping serverless instances for the real-time event receiver
- TLS is mandatory for public traffic (Caddy handles ACME)
- Database credentials must be stored as Docker secrets, not in environment variables
- Redis is cache only — PostgreSQL is the durable system of record
- Webhook endpoints must be HTTPS-only in production
