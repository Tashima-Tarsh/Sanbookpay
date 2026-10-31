> Current setup and confirmation policy: [Operations manual](OPERATIONS-MANUAL.md). Credential names and storage: [Configuration inventory](CONFIGURATION-CREDENTIALS.md). Historical examples below may describe earlier runtimes or unconfigured services.

# PRODUCTION_DEPLOYMENT.md — YOUPI PG / Sanbook Pay

Production deployment guide for the self-hosted UPI payment gateway.

## Supported Stack (actual, verified)

| Layer | Technology |
|---|---|
| Runtime | Node.js >= 20 (ESM native) |
| Database | SQLite WAL (`data/youpi_pg.sqlite`) |
| Web server | Native `node:http` |
| Payment API | Port 6100 |
| Checkout Portal | Port 7000 |
| Merchant Admin | Port 6001 |
| Demo Store | Port 5000 |
| Control Center | Port 8090 |

The README mentions PostgreSQL/Redis/Docker, but the **verified, working stack is Node.js + SQLite WAL**. No external database daemon is required.

---

## 1. Prerequisites

- Node.js 22+
- npm (comes with Node.js)
- ~200 MB disk
- Ports 5000, 6001, 6100, 7000, 8090 free

---

## 2. Install & Configure

```powershell
# Clone / extract the repository
cd D:\Downloads\Sanbookpay-main\Sanbookpay-main

# Install dependencies
npm install

# Apply database schema (zero-config, auto-creates SQLite)
npm run db:setup

# Review .env — replace placeholder secrets with real values
# Required: ENCRYPTION_MASTER_KEY, JWT_SECRET, INITIAL_ADMIN_PASSWORD
notepad .env
```

### Required `.env` values (replace before production)

| Variable | How to generate |
|---|---|
| `ENCRYPTION_MASTER_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `INITIAL_ADMIN_PASSWORD` | Strong password, min 12 chars |
| `INITIAL_ADMIN_EMAIL` | Your admin email |

Never commit `.env`. It contains encryption keys protecting merchant funds.

---

## 3. Start Services

### Local development (recommended for demo)
```powershell
npm run start:local
```

This starts all three core services:
- Payment API: `http://127.0.0.1:6100`
- Checkout Portal: `http://127.0.0.1:7000`
- Merchant Admin: `http://127.0.0.1:6001`

Verify health:
```powershell
curl http://127.0.0.1:6100/health
# {"status":"UP",...}
```

### Production (single host)
```powershell
# Validate environment before boot (refuses unsafe secrets)
node scripts/validate-env.js

# Start payment API
node apps/payment-api/src/index.js &

# Start checkout portal
node apps/checkout-portal/src/index.js &

# Start merchant admin
node apps/merchant-admin/src/index.js &
```

Use a process manager (PM2, systemd, or Windows Service) to keep services running.

---

## 4. Production Health Check

```powershell
node scripts/health-check.js
# Exit 0 = healthy, Exit 1 = unhealthy
```

This verifies: database file, health endpoint, payment creation, split settlement endpoint.

---

## 5. Docker (optional)

A `Dockerfile` exists for the payment API at `apps/payment-api/Dockerfile`. Build:

```powershell
docker build -t youpi-payment-api -f apps/payment-api/Dockerfile .
docker run -p 6100:6100 --env-file .env youpi-payment-api
```

A `docker-compose.production.yml` exists at repo root but is **not verified** — test before production use.

---

## 6. Reverse Proxy (required for public HTTPS)

Never expose `127.0.0.1` services directly to the internet. Put Caddy or Nginx in front with TLS:

### Caddy example (`Caddyfile`)
```
pay.yourdomain.com {
    reverse_proxy localhost:6100
}
```

### Nginx example
```nginx
server {
    listen 443 ssl;
    server_name pay.yourdomain.com;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    location / { proxy_pass http://127.0.0.1:6100; }
}
```

---

## 7. Integration API (merchant-facing)

Create a payment:
```http
POST http://127.0.0.1:6100/api/v1/payments
Content-Type: application/json

{
  "orderId": "ORD-001",
  "amount": 499,
  "currency": "INR",
  "customer": { "name": "John", "phone": "9876543210" },
  "returnUrl": "https://yoursite.com/success"
}
```

Response includes `checkoutUrl` and `payeeVpa` (where funds are sent). Redirect customer to `checkoutUrl` — they scan the UPI QR with GPay/PhonePe/Paytm/BHIM/CRED.

Verify payment:
```http
GET http://127.0.0.1:6100/api/v1/checkout/{paymentId}/state
```
Returns `status`, `utr`, `payeeVpa`, `verifiedAt`.

Instant confirmation (customer submits UTR):
```http
POST http://127.0.0.1:6100/api/v1/checkout/{paymentId}/verify-utr
Body: {"utr": "SBK1234567890", "senderVpa": "customer@upi"}
```
Returns `status: SUCCESS` and fires a signed webhook to the merchant.

Auto-refund for failed payments:
```http
POST http://127.0.0.1:6100/api/v1/checkout/{paymentId}/auto-refund
Headers: x-merchant-id: <merchant-id>
```

Split settlement (platform fee + merchant share):
```http
POST /api/v1/split-settlements/configure
Body: {"platformFeePercent":150, "merchantSharePercent":850, "gstPercent":18}

POST /api/v1/split-settlements/settle
```

---

## 8. Rate Limiting

Default: **1000 requests per minute per IP** (gaming-ready). Configure in `.env`:
```
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=1000
```
Health checks and SSE are exempt.

---

## 9. What Is NOT Included (External Dependencies)

| Item | Status | Notes |
|---|---|---|
| SMS/Gmail observers | Code present, not running | Needed for auto-verification; manual UTR works without them |
| Cashfree / cards / netbanking | Adapter code present, credentials empty | UPI-only works with zero API cost |
| TLS certificate | Not provided | Use Let's Encrypt or your CA |
| CI/CD pipeline | `.github/workflows/ci.yml` added | Not connected to a repo |
| PostgreSQL/Redis | Not used | SQLite WAL is the verified store |

---

## 10. Before Real-Money Activation

- [ ] Replace all placeholder `.env` secrets with real values
- [ ] Run `node scripts/validate-env.js` — must pass
- [ ] Run `npm test` — 35/35 must pass
- [ ] Configure TLS reverse proxy (Caddy/Nginx)
- [ ] Start SMS/Gmail observers OR accept manual UTR verification
- [ ] Test end-to-end with a real UPI transaction (small amount)
- [ ] Configure merchant webhook URL and verify HMAC signatures
- [ ] Set up database backups (`data/youpi_pg.sqlite`)
- [ ] Document merchant onboarding process
