# DYNAMO PAY — Complete Production Documentation

**Project**: Dynamo Pay — Self-Hosted UPI Payment Gateway  
**Version**: 1.0.0  
**Date**: October 30, 2026  
**Repository**: `D:\Downloads\Sanbookpay-main\Sanbookpay-main`  
**License**: Commercial (Internal Use)

---

## 1. EXECUTIVE SUMMARY

Dynamo Pay is a complete, production-grade, self-hosted UPI payment gateway built with zero API gateway cost. It enables merchants to collect UPI payments directly from customers using GPay, PhonePe, Paytm, BHIM, CRED, and other UPI apps — without purchasing any payment gateway API license.

The system includes:
- Payment Core API with full UPI payment lifecycle
- Premium glassmorphism checkout portal (customer-facing)
- Merchant admin dashboard (transaction management, analytics)
- UPI QR code generation (dynamic, zero-cost)
- Instant UTR verification (SMS/Gmail/Android observers optional)
- Split settlement (platform fee + GST + merchant share)
- Auto-refund for failed/expired payments
- Rate limiting (1000 req/min/IP)
- Double-entry ledger (integer paise accounting)
- HMAC-SHA256 webhook verification
- AES-256-GCM credential vault
- Fraud detection & auto-banning
- IFSC bank validation (Razorpay API)
- Webhook callbacks to merchants
- Production rate limiting, structured logging, graceful shutdown

**All 35 test suites pass.** The codebase is committed locally with 7 commits.

---

## 2. SYSTEM ARCHITECTURE

### 2.1 Core Components

| Component | Port | Technology | Responsibility |
|-----------|------|------------|----------------|
| Payment Core API | 6100 | Node.js ESM + SQLite WAL | Payment creation, verification, webhooks, API |
| Checkout Portal | 7000 | HTML/CSS/JS + Glassmorphism | Customer UPI QR display, payment initiation |
| Merchant Admin | 6001 | HTML/CSS/JS + Glassmorphism | Transaction dashboard, analytics, management |
| SQLite Database | File | SQLite WAL | Payment sessions, merchants, ledger, refunds |

### 2.2 Payment Flow (State Machine)

```
CREATED → ACTIVE → PROCESSING → SUCCESS/FAILED/EXPIRED/CANCELLED
```

- **ACTIVE**: Payment created, QR displayed, 5-minute timer starts
- **PROCESSING**: Customer paid, waiting for bank confirmation (30-second window)
- **SUCCESS**: Bank credit verified via SMS/Gmail observer OR manual UTR entry
- **FAILED**: Payment failed permanently
- **EXPIRED**: 5-minute window expired without payment
- **CANCELLED**: Payment cancelled by merchant

### 2.3 Database Schema (SQLite WAL)

| Table | Purpose |
|-------|---------|
| `merchants` | Merchant accounts, API keys, webhook URLs |
| `payment_receiving_accounts` | UPI receiving accounts (VPA), slot status |
| `payment_sessions` | Payment sessions, order IDs, amounts, states |
| `customers` | Customer records (phone, name, email) |
| `payment_ledger` | Double-entry ledger (debit/credit entries) |
| `refunds` | Refund records with UTR |
| `split_settlement_rules` | Platform fee split per merchant |
| `split_settlement_entries` | Per-transaction split breakdown |
| `observations` | SMS/Gmail/Android observation records |
| `fraud_events` | Fraud detection events |
| `audit_events` | System audit trail |

---

## 3. API DOCUMENTATION

### 3.1 Base URLs

| Service | Local URL |
|---------|-----------|
| Payment API | `http://127.0.0.1:6100` |
| Checkout Portal | `http://127.0.0.1:7000` |
| Merchant Admin | `http://127.0.0.1:6001` |

### 3.2 Dynamo Pay Native API (`/v1/dynamo/*`)

#### 3.2.1 Create UPI Payment

**Request:**
```http
POST http://127.0.0.1:6100/v1/dynamo/collect/upi
Content-Type: application/json
client-id: dp_client_{merchantId}
client-secret: d6ba609c7573dbc113660467012f3b0f
service-id: {merchantId}

Body:
{
  "orderId": "ORD-001",
  "amount": 499,
  "currency": "INR",
  "customer": {
    "name": "John Doe",
    "phone": "9876543210",
    "email": "john@example.com"
  }
}
```

**Response:**
```json
{
  "transaction": "uuid",
  "uniquetransactionid": "ORD-001",
  "amount": 499,
  "currency": "INR",
  "status": "PENDING",
  "intent": "upi://pay?pa=9082843142@slc&pn=Dynamo+Pay&am=499&tn=ORD-001",
  "checkoutUrl": "http://127.0.0.1:7000/checkout/uuid",
  "payeeVpa": "9082843142@slc",
  "payeeName": "Dynamo Pay",
  "platform": "dynamo-pay"
}
```

#### 3.2.2 Check Payment Status

**Request:**
```http
POST http://127.0.0.1:6100/v1/dynamo/checkstatus
Content-Type: application/json
client-id: dp_client_{merchantId}
client-secret: d6ba609c7573dbc113660467012f3b0f
service-id: {merchantId}

Body: {"transaction": "uuid" OR "uniquetransactionid": "ORD-001"}
```

**Response:**
```json
{
  "transaction": "uuid",
  "uniquetransactionid": "ORD-001",
  "amount": "499.00",
  "currency": "INR",
  "status": "SUCCESS",
  "upiTransactionId": "SBK1793360826XXX",
  "bankReferenceNumber": "SBK1793360826XXX",
  "senderVpa": "9876543210@oksbi",
  "senderName": "John Doe",
  "payeeVpa": "9082843142@slc",
  "payeeName": "Dynamo Pay",
  "datetime": "2026-10-30T18:10:45.XXXZ",
  "platform": "dynamo-pay"
}
```

#### 3.2.3 IFSC Bank Validation

**Request:**
```http
POST http://127.0.0.1:6100/v1/dynamo/ifsc/SBIN0000001
client-id: dp_client_{merchantId}
client-secret: d6ba609c7573dbc113660467012f3b0f
service-id: {merchantId}
```

**Response:**
```json
{
  "ifsc": "SBIN0000001",
  "bank": "State Bank of India",
  "branch": "Kolkata Main",
  "city": "Kolkata",
  "state": "West Bengal",
  "address": "SAMRIDDHI BHAWAN, 1 STRAND ROAD, KOLKATA 700 001",
  "contact": "",
  "upi": true,
  "neft": true,
  "rtgs": true,
  "imps": true,
  "supportedModes": ["UPI", "NEFT", "RTGS", "IMPS"],
  "platform": "dynamo-pay",
  "source": "razorpay-ifsc-api"
}
```

#### 3.2.4 Wallet Balance

**Request:**
```http
POST http://127.0.0.1:6100/v1/dynamo/wallet
client-id: dp_client_{merchantId}
client-secret: d6ba609c7573dbc113660467012f3b0f
service-id: {merchantId}
```

**Response:**
```json
{
  "merchantId": "uuid",
  "currency": "INR",
  "settledwallet": 0,
  "unsettledbalance": 0,
  "lienbalance": 0,
  "loanbalance": 0,
  "datetime": "2026-10-30T18:10:45.XXXZ",
  "platform": "dynamo-pay"
}
```

#### 3.2.5 Webhook Configuration

**Request:**
```http
POST http://127.0.0.1:6100/v1/dynamo/merchant/webhook
Content-Type: application/json
client-id: dp_client_{merchantId}
client-secret: d6ba609c7573dbc113660467012f3b0f
service-id: {merchantId}

Body:
{
  "webhookUrl": "https://merchant.example.com/webhook",
  "ipWhitelist": ["192.168.1.100", "10.0.0.5"]
}
```

**Response:**
```json
{
  "merchantId": "uuid",
  "webhookUrl": "https://merchant.example.com/webhook",
  "ipWhitelist": ["192.168.1.100", "10.0.0.5"],
  "retryPolicy": {
    "maxRetries": 5,
    "initialBackoffMs": 5000,
    "maxBackoffMs": 300000,
    "backoffMultiplier": 2,
    "retryableStatuses": [408, 429, 500, 502, 503, 504],
    "retryableErrors": ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND"]
  },
  "datetime": "2026-10-30T18:10:45.XXXZ",
  "platform": "dynamo-pay"
}
```

#### 3.2.6 Retry Policy

**Request:**
```http
GET http://127.0.0.1:6100/v1/dynamo/merchant/retry-policy
client-id: dp_client_{merchantId}
client-secret: d6ba609c7573dbc113660467012f3b0f
service-id: {merchantId}
```

---

### 3.3 Core Payment API (`/api/v1/*`)

#### Create Payment
```http
POST http://127.0.0.1:6100/api/v1/payments
Content-Type: application/json

Body: {"orderId": "ORD-001", "amount": 499, "currency": "INR", "customer": {"name": "John", "phone": "9876543210"}}
```

#### Get Payment State
```http
GET http://127.0.0.1:6100/api/v1/checkout/{paymentId}/state
```

#### Payment Done (Initiate Processing)
```http
POST http://127.0.0.1:6100/api/v1/checkout/{paymentId}/payment-done
```

#### Verify UTR (Instant Confirmation)
```http
POST http://127.0.0.1:6100/api/v1/checkout/{paymentId}/verify-utr
Content-Type: application/json

Body: {"utr": "SBK1793360826XXX", "senderVpa": "9876543210@oksbi", "senderName": "John"}
```

#### Auto-Refund (Failed/Expired Payments)
```http
POST http://127.0.0.1:6100/api/v1/checkout/{paymentId}/auto-refund
Content-Type: application/json
x-merchant-id: {merchantId}
```

#### UPI QR Generation
```http
GET http://127.0.0.1:7000/checkout/{paymentId}/qr.svg
```

#### Health Check
```http
GET http://127.0.0.1:6100/health
```

---

## 4. FRONTEND: CHECKOUT PORTAL

### 4.1 Features
- Premium glassmorphism UI (dark theme with blurred backdrop)
- Dynamic UPI QR code generation (SVG, real-time)
- UPI app badges (GPay, PhonePe, Paytm, BHIM)
- Real-time payment status polling (3-second intervals)
- Countdown timer (5-minute payment window)
- Status screens: ACTIVE → PROCESSING → SUCCESS/FAILED/EXPIRED
- Payee VPA display (where funds are sent)
- Return URL after payment
- Customer authentication (optional, can be skipped for instant QR)

### 4.2 Customer Flow
1. Customer opens checkout URL
2. Sees premium UPI QR with amount and merchant name
3. Scans QR with GPay/PhonePe/Paytm/BHIM/CRED
4. Pays amount
5. Payment status updates automatically (SMS/Gmail observer OR manual UTR entry)
6. Success/expired/failed screen displayed

---

## 5. FRONTEND: MERCHANT ADMIN

### 5.1 Features
- Premium glassmorphism dashboard
- Statistics cards (total volume, total payments, success rate, pending)
- Recent transactions table with status badges
- Quick actions (create payment, settlements, UPI settings)
- Navigation: Overview, Transactions, Merchants, Settlements, UPI Accounts, API Keys, Alerts
- Real-time data via SSE

### 5.2 Pages
- **Dashboard**: Overview with key metrics
- **Transactions**: All payments with filter and search
- **Merchants**: Merchant management
- **Settlements**: Payout and settlement tracking
- **UPI Accounts**: Receiving account management
- **API Keys**: API credential management
- **Alerts**: System notifications

---

## 6. PRODUCTION INFRASTRUCTURE

### 6.1 Cloned Open Source Projects

| Repository | Location | Purpose |
|------------|----------|---------|
| `caddy` | `D:\Projects\caddy` | HTTPS reverse proxy with auto-TLS |
| `infisical` | `D:\Projects\infisical` | Secret management |
| `android-sms-gateway` | `D:\Projects\android-sms-gateway` | Android SMS payment verification |
| `google-api-nodejs-client` | `D:\Projects\google-api-nodejs-client` | Gmail API payment verification |
| `bullmq` | `D:\Projects\bullmq` | Redis job queue |
| `svix-webhooks` | `D:\Projects\svix-webhooks` | Reliable merchant webhook delivery |
| `headscale` | `D:\Projects\headscale` | VPN/Tailscale secure networking |

### 6.2 Dynamo Pay Modules

| File | Purpose |
|------|---------|
| `packages/common/src/dynamo-queue.js` | BullMQ job queue |
| `packages/common/src/dynamo-webhooks.js` | Svix webhook delivery |
| `packages/common/src/dynamo-gmail.js` | Gmail API verification |
| `packages/common/src/dynamo-sms.js` | Android SMS Gateway |

### 6.3 Production Files

| File | Purpose |
|------|---------|
| `Caddyfile` | HTTPS reverse proxy configuration |
| `docs/INFISICAL_CONFIG.md` | Secret management setup |
| `docs/HYPERSWITCH_AUDIT.md` | Architecture audit (Hyperswitch reference) |
| `docs/PRODUCTION_DEPLOYMENT.md` | Production runbook |
| `.github/workflows/ci.yml` | GitHub Actions CI/CD |

---

## 7. PRODUCTION DEPLOYMENT

### 7.1 Prerequisites

- Node.js 20+
- SQLite WAL (auto-provisioned)
- Redis (for BullMQ job queue — optional, falls back to in-memory)
- Ports: 5000, 6001, 6100, 7000
- ~200 MB disk space

### 7.2 Installation

```powershell
cd "D:\Downloads\Sanbookpay-main\Sanbookpay-main"
npm install
npm run db:setup
```

### 7.3 Environment Configuration (`.env`)

Required secrets (replace placeholders):

| Variable | Description | How to Generate |
|----------|-------------|-----------------|
| `ENCRYPTION_MASTER_KEY` | AES-256-GCM master key | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_SECRET` | JWT signing secret | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `INITIAL_ADMIN_PASSWORD` | Admin password | Strong password, min 12 chars |
| `INITIAL_ADMIN_EMAIL` | Admin email | Your email |
| `CASHFREE_CLIENT_ID` | Cashfree API client ID | From Cashfree dashboard |
| `CASHFREE_CLIENT_SECRET` | Cashfree API secret | From Cashfree dashboard |
| `GMAIL_CLIENT_ID` | Gmail OAuth client ID | Google Cloud Console |
| `GMAIL_CLIENT_SECRET` | Gmail OAuth secret | Google Cloud Console |
| `SMS_GATEWAY_URL` | Android SMS Gateway URL | Your Android device |
| `SVIX_API_KEY` | Svix webhook API key | svix.com |
| `RATE_LIMIT_MAX_REQUESTS` | Rate limit per IP per minute | Default: 1000 |

**Never commit `.env` to git.** It is gitignored.

### 7.4 Start Services

```powershell
cd "D:\Downloads\Sanbookpay-main\Sanbookpay-main"
npm run start:local
```

Services start on:
- Payment API: `http://127.0.0.1:6100`
- Checkout Portal: `http://127.0.0.1:7000`
- Merchant Admin: `http://127.0.0.1:6001`

### 7.5 Health Check

```powershell
curl http://127.0.0.1:6100/health
# Returns: {"status":"UP",...}
```

Or run:
```powershell
node scripts/health-check.js
```

---

## 8. TESTING

### 8.1 Test Suite

35 test suites covering:
- Authentication & authorization
- Payment creation and state transitions
- Queue engine and concurrency
- Webhook verification
- Fraud detection
- Refund processing
- Split settlement
- Payout processing
- SMS/Gmail observers
- WhatsApp Berry integration
- Rate limiting
- Database integrity
- Checkout portal rendering
- Merchant admin rendering

### 8.2 Run Tests

```powershell
cd "D:\Downloads\Sanbookpay-main\Sanbookpay-main"
npm test
```

All 35 test suites pass.

### 8.3 Manual Testing Flow

1. Create payment: `POST /api/v1/payments`
2. Open checkout URL in browser
3. Scan UPI QR with any UPI app
4. Pay amount
5. Verify via UTR: `POST /api/v1/checkout/{id}/verify-utr`
6. Check status: `GET /api/v1/checkout/{id}/state`
7. View in Merchant Admin: `http://127.0.0.1:6001`

---

## 9. SECURITY

### 9.1 Authentication
- Merchant API keys for all API endpoints
- Client-ID/Client-Secret/Service-Id for Dynamo Pay API
- HMAC-SHA256 webhook signature verification
- JWT for session management

### 9.2 Rate Limiting
- 1000 requests per minute per IP (configurable)
- Health checks exempt from rate limiting

### 9.3 Data Protection
- AES-256-GCM encryption for sensitive data
- Integer paise accounting (no floating-point errors)
- Double-entry ledger for audit trail
- Customer data masking

### 9.4 Network Security
- TLS via Caddy reverse proxy (production)
- IP whitelisting per merchant
- Strict security headers (X-XSS-Protection, HSTS, etc.)
- Loopback-only binding by default (`127.0.0.1`)

---

## 10. WHAT'S IMPLEMENTED VS WHAT'S NEEDED FOR PUBLIC LAUNCH

### ✅ Implemented & Verified

| Feature | Status |
|---------|--------|
| UPI payment creation | ✅ |
| Dynamic QR generation | ✅ |
| Instant UTR verification | ✅ |
| Auto-refund for failed/expired | ✅ |
| Split settlement (platform fee + GST + merchant share) | ✅ |
| Double-entry ledger | ✅ |
| HMAC webhook verification | ✅ |
| Rate limiting | ✅ |
| Fraud detection | ✅ |
| SMS/Gmail observers | ✅ Code ready |
| Premium frontend (checkout + admin) | ✅ |
| IFSC validation (Razorpay API) | ✅ |
| Wallet balance | ✅ |
| Webhook configuration | ✅ |
| Retry policy | ✅ |
| All 35 test suites | ✅ Pass |

### ⚠️ Needed for Real-Money Production

| Item | Status | Action Required |
|------|--------|-----------------|
| RBI payment aggregator license | ❌ | Apply for license |
| TLS certificate | ❌ | Configure Caddy with Let's Encrypt |
| SMS Gateway APK | ❌ | Install on Android device |
| Gmail OAuth credentials | ❌ | Google Cloud Console setup |
| Real `.env` secrets | ❌ | Replace placeholders |
| Cashfree credentials (cards/netbanking) | ❌ | Optional, only for non-UPI |
| Database backups | ❌ | Set up SQLite backup strategy |
| Load testing | ❌ | Run k6 or similar |
| Playwright E2E tests | ❌ | Add browser tests |

---

## 11. CONTACT & SUPPORT

**Product**: Dynamo Pay  
**Repository**: `D:\Downloads\Sanbookpay-main\Sanbookpay-main`  
**Documentation**: `docs/` directory  
**Support**: admin@dynamopay.local

---

**End of Document**
