> Current setup and confirmation policy: [Operations manual](OPERATIONS-MANUAL.md). Credential names and storage: [Configuration inventory](CONFIGURATION-CREDENTIALS.md). Historical examples below may describe earlier runtimes or unconfigured services.

# Sanbook Pay — Production Setup & Architecture Guide

## 1. Overview

**Sanbook Pay** is a high-performance, sovereign payment infrastructure platform designed for genuine real-money UPI collections, automated bank confirmations, authorized payouts, refunds, and double-entry financial ledgering.

### Architecture Topology

```
                          ┌────────────────────────┐
                          │   Internet / Ingress   │
                          │   (Caddy / Nginx TLS)  │
                          └───────────┬────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            │ :7000                   │ :6100                   │ :6001
            ▼                         ▼                         ▼
   ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
   │ Checkout Portal │       │ Payment API     │       │ Merchant Admin  │
   │ (youpi.js / QR) │       │ (Core Engine)   │       │ (Console UI)    │
   └────────┬────────┘       └────────┬────────┘       └────────┬────────┘
            │                         │                         │
            └─────────────────────────┼─────────────────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
      ┌─────────────────────┐                   ┌─────────────────────┐
      │ PostgreSQL 16       │                   │ Redis 7             │
      │ (Financial Ledger)  │                   │ (Distributed Cache) │
      └─────────────────────┘                   └─────────────────────┘
                 ▲                                         ▲
                 │                                         │
      ┌──────────┴──────────┐                   ┌──────────┴──────────┐
      │ Cashfree PG (Real)  │                   │ Cashfree Payouts    │
      │ & Direct Bank APIs  │                   │ & Penny-Drop Engine │
      └─────────────────────┘                   └─────────────────────┘
```

---

## 2. System Requirements & Port Allocation

| Component | Default Port | Internal / External | Description |
| :--- | :--- | :--- | :--- |
| **Reverse Proxy (Caddy)** | `80`, `443` | External | TLS termination, gzip/zstd, security headers |
| **Checkout Portal** | `7000` | Internal / Reverse Proxy | Dynamic QR, UPI intent routing, one-script SDK |
| **Payment Core API** | `6100` | Internal / Reverse Proxy | State machine, collections, payouts, ledger |
| **Merchant Console** | `6001` | Internal / Reverse Proxy | Admin management, banking wizard, reports |
| **PostgreSQL 16** | `5432` | Internal | ACID double-entry ledger in integer paise |
| **Redis 7** | `6379` | Internal | Idempotency locks, token caches, queue broker |

---

## 3. Environment Configuration (`.env`)

```ini
# Node Environment
NODE_ENV=production
PORT=6100
ADMIN_PORT=6001
CHECKOUT_PORT=7000

# Canonical Domain & URLs
BASE_PAYMENT_API_URL=https://pay.yourdomain.com
CHECKOUT_PORTAL_URL=https://pay.yourdomain.com
DOMAIN=pay.yourdomain.com

# Database Connection (PostgreSQL Canonical)
DATABASE_URL=postgresql://sanbook_admin:YourStrongPassword@localhost:5432/sanbook_pay

# Redis Cache & Lock Broker
REDIS_URL=redis://:YourRedisPassword@localhost:6379/0

# Security Cryptography
# 64 hex characters (32 bytes) for AES-256-GCM vault encryption
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
INTERNAL_TOKEN=sanbook_super_secure_internal_cluster_token_2026
ADMIN_API_TOKEN=sanbook_admin_jwt_session_secret_2026
MERCHANT_WEBHOOK_SECRET=sanbook_whsec_production_key_2026

# Cashfree Primary Provider (Sandbox or Production)
CASHFREE_APP_ID=TEST1034...
CASHFREE_SECRET_KEY=cfsk_ma_test_...
CASHFREE_ENV=SANDBOX # or PRODUCTION
```

---

## 4. Local Windows Execution

To run Sanbook Pay locally in production mode on Windows:

1. **Verify Prerequisites**:
   - Node.js `v20+` or `v22+`
   - Native SQLite or PostgreSQL
2. **Install Workspace Dependencies**:
   ```powershell
   npm install
   ```
3. **Initialize Database Tables & Seed Accounts**:
   ```powershell
   node scripts/init-db.cjs
   ```
4. **Launch Platform Services**:
   ```powershell
   node scripts/start.js
   ```
5. **Access Endpoints**:
   - Merchant Admin: `http://localhost:6001`
   - Checkout Portal: `http://localhost:7000`
   - Core API Health: `http://localhost:6100/health`

---

## 5. Dockerized Production Stack

To start the full containerized stack:

```bash
# 1. Inspect environment variables
cp .env.example .env

# 2. Build and launch all 6 services with Docker Compose
docker compose -f docker-compose.production.yml up -d --build

# 3. Check service health
docker compose -f docker-compose.production.yml ps

# 4. View container logs
docker compose -f docker-compose.production.yml logs -f payment-api
```

