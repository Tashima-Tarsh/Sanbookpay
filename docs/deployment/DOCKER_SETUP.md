# Docker Setup

## Prerequisites

- Node.js 22.13+
- PostgreSQL or SQLite
- Redis (optional, for BullMQ queue)

## Build

```bash
npm ci --include=dev
npm run build:typescript
```

## Run

```bash
# Local development (SQLite)
npm run start:local

# Hosted (all services on one port)
npm run start:hosted

# Production API
npm run start:prod:api

# Super Admin
npm run start:super-admin
```

## Environment

Copy `.env.example` to `.env` and configure:
- `DATABASE_URL` — PostgreSQL connection string (optional, uses SQLite if not set)
- `ENCRYPTION_MASTER_KEY` — Encryption key for credentials
- `BASE_CHECKOUT_URL` — Public checkout URL
- `PAYMENT_API_PORT` — API port (default 6100)
- `SUPER_ADMIN_PORT` — Super Admin port (default 9000)