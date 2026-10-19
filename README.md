# SANBOOK PAY

### Sovereign Enterprise Payment Gateway & Disbursement Infrastructure

Sanbook Pay is an institutional-grade, self-hosted payment infrastructure platform engineered for direct-to-bank UPI collections, authorized real-time payouts, double-entry financial ledgering, and automated banking reconciliation.

---

## Key Capabilities

### 1. Payment Collections
- **Unified UPI Ingress**: Dynamic single-use UPI QR generation, universal VPA routing, and deep-link intent triggers for Google Pay, PhonePe, Paytm, BHIM, and CRED.
- **Provider Gateway Integration**: Primary production integration with Cashfree Payment Gateway and an extensible direct bank interface (HDFC, ICICI, Axis, SBI, Kotak).
- **Sub-60s Settlement Loop**: Real-time payment observation engine with millisecond transaction lifecycle tracking.
- **Selling Modes**: Supports Online E-Commerce, Cash on Delivery (COD) state management, and Physical Counter Desk modalities (Cash/Card at POS).

### 2. Outbound Disbursements & Payouts
- **Multi-Rail Transfers**: Instant real-money disbursements across IMPS, NEFT, RTGS, and UPI rails.
- **Penny-Drop Account Verification**: Automated beneficiary account name inquiry and validation prior to disbursement.
- **Two-Step Authorization Controls**: Strict policy controls requiring operator authorization before real funds are released.
- **Idempotency Guarantees**: Cryptographic request deduplication ensuring zero duplicate transfers.

### 3. Financial Ledger & Automated Reconciliation
- **Integer Paise Accounting**: 100% fixed-point integer mathematics preventing floating-point rounding errors.
- **Double-Entry Journal Balancing**: Enforces fundamental accounting invariants (`sum(debits) === sum(credits)`) across all transactions.
- **Standard Chart of Accounts**: Pre-configured accounts for operating cash, undeposited collections, clearing escrows, fees, and liabilities.
- **Three-Way Reconciliation**: Continuous cross-verification of internal orders, provider settlement batches, and banking statement UTRs.
- **Exception Reporting & Auditing**: Automated variance detection with real-time alerts and downloadable reconciliation reports.

### 4. Enterprise Security Architecture
- **No Mock Successes**: Strict architectural invariant prohibiting arbitrary success transitions. Status changes require verified banking observations or signed provider events.
- **AES-256-GCM Credential Vault**: All bank credentials, API secrets, and private tokens are encrypted at rest with authenticated encryption.
- **Raw-Body Webhook Verification**: Constant-time HMAC-SHA256 verification computed strictly over unparsed request bytes to guarantee signature integrity.
- **Audit Event Trail**: Immutable, append-only transaction lifecycle logging with millisecond timestamping.

---

## System Architecture

```
                       ┌────────────────────────────┐
                       │     Merchant Client /      │
                       │    Customer Application    │
                       └─────────────┬──────────────┘
                                     │
                        [ HTTPS / Ingress Proxy ]
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           ▼                         ▼                         ▼
  ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
  │ Checkout Portal │       │   Payment API   │       │ Merchant Admin  │
  │  (Dynamic QR /  │       │  (Core Engine / │       │ (Console UI /   │
  │   One-Script)   │       │ State Machine)  │       │ Bank Wizard)    │
  └────────┬────────┘       └────────┬────────┘       └────────┬────────┘
           │                         │                         │
           └─────────────────────────┼─────────────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
     ┌───────────────────────┐               ┌───────────────────────┐
     │  PostgreSQL 16        │               │  Redis 7              │
     │  (Financial Ledger /  │               │  (Idempotency Locks / │
     │   Audit History)      │               │   Event Broker)       │
     └───────────────────────┘               └───────────────────────┘
                 ▲                                       ▲
                 │                                       │
     ┌───────────┴───────────┐               ┌───────────┴───────────┐
     │ Cashfree PG /         │               │ Cashfree Payouts /    │
     │ Direct Bank Ingress   │               │ Penny-Drop Engine     │
     └───────────────────────┘               └───────────────────────┘
```

---

## Platform Microservices & Port Topology

| Component | Default Port | Protocol | Responsibility |
| :--- | :--- | :--- | :--- |
| **Ingress Proxy (Caddy / Nginx)** | `80`, `443` | HTTP/HTTPS | TLS termination, gzip/zstd compression, security headers |
| **Payment Core REST API** | `6100` | HTTP | Payment orders, state machines, payouts, ledger, provider adapters |
| **Merchant Console** | `6001` | HTTP | Administrative dashboard, bank connection wizard, financial ledger |
| **Checkout Portal** | `7000` | HTTP | Dynamic SVG QR generation, one-script modal delivery, API proxy |
| **PostgreSQL Database** | `5432` | TCP | ACID relational storage, double-entry ledger in integer paise |
| **Redis Cache** | `6379` | TCP | Distributed locking, idempotency cache, queue supervisor |

---

## Universal Integration Methods

### Method 1: Single-Script Modal Integration
Embed the lightweight client script in any web application:

```html
<script src="/youpi.js" data-youpi-key="YOUR_MERCHANT_KEY"></script>

<!-- Tag any button to trigger the payment checkout modal -->
<button 
  data-youpi-pay 
  data-order-id="ORDER-1001" 
  data-amount="499"
  data-currency="INR"
  data-customer-name="Customer Name"
  data-customer-phone="9876543210">
  Pay Now
</button>
```

### Method 2: Programmatic JavaScript API
For React, Vue, Next.js, and Single-Page Applications:

```javascript
Youpi.pay({
  order_id: "ORDER-1001",
  amount: 499.00,
  currency: "INR",
  customer: {
    name: "Customer Name",
    phone: "9876543210",
    email: "customer@example.com"
  },
  handler: function(response) {
    console.log("Payment Confirmed:", response);
    // response: { status: "SUCCESS", order_id, amount_received, utr, payment_mode }
  },
  onClose: function() {
    console.log("Checkout dismissed");
  }
});
```

### Method 3: Backend REST API
Initialize payment collections programmatically via the backend API:

```http
POST /api/v1/collections HTTP/1.1
Host: api.gateway.internal
Content-Type: application/json
X-Merchant-Key: <MERCHANT_API_KEY>
Idempotency-Key: <UNIQUE_IDEMPOTENCY_TOKEN>

{
  "orderId": "ORD-2026-001",
  "amount": 499.00,
  "currency": "INR",
  "customerName": "Customer Name",
  "customerPhone": "9876543210",
  "method": "UPI"
}
```

---

## Webhook Verification Specification

All payment confirmations dispatch an authoritative, signed HTTP POST request to the merchant's configured webhook endpoint.

Merchants must verify the cryptographic signature over the unparsed request body before fulfilling digital goods:

```javascript
import crypto from 'node:crypto';

app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-gateway-signature'] || '';
  const secret = process.env.MERCHANT_WEBHOOK_SECRET;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.body).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Signature mismatch' });
  }

  const payload = JSON.parse(req.body.toString('utf8'));
  if (payload.event === 'SUCCESS' && payload.method === 'UPI') {
    // Authoritatively mark order as paid
    db.orders.markPaid(payload.orderId, { utr: payload.utr });
  }

  res.status(200).json({ received: true });
});
```

---

## Deployment Architectures

### 1. Local Production Execution
```bash
# Install workspace dependencies
npm install

# Apply database schemas and chart of accounts
npm run db:setup

# Execute regression verification suite (34/34 passing)
npm test

# Launch production services
npm start
```

### 2. Containerized Production Stack (Docker Compose)
A production configuration is provided in `docker-compose.production.yml` orchestrating PostgreSQL 16, Redis 7, Payment API, Merchant Admin, Checkout Portal, and Caddy TLS termination.

```bash
docker compose -f docker-compose.production.yml up -d --build
```

### 3. Cloud Deployment (Kubernetes / IBM Cloud Code Engine)
Production manifests are available in `deploy/ibm-cloud/`:
- `code-engine-app.yaml`: Managed serverless container deployment.
- `k8s-sanbook-pay.yaml`: Standard Kubernetes Deployments, Services, ConfigMaps, and Ingress with Let's Encrypt TLS.

---

## Authoritative Documentation Hub

Comprehensive engineering guides are available in the `docs/` directory:

| Document | Purpose |
| :--- | :--- |
| **[docs/PRODUCTION_SETUP.md](docs/PRODUCTION_SETUP.md)** | Infrastructure requirements, port mapping, and production configuration |
| **[docs/BANK_CONNECTION_SETUP.md](docs/BANK_CONNECTION_SETUP.md)** | Bank connection wizard, Cashfree integration, and direct bank interfaces |
| **[docs/REAL_COLLECTION_API.md](docs/REAL_COLLECTION_API.md)** | Authenticated collections, idempotency, order queries, and polling contracts |
| **[docs/REAL_PAYOUT_API.md](docs/REAL_PAYOUT_API.md)** | Outbound disbursements, penny-drop validation, and two-step approvals |
| **[docs/SETTLEMENT_RECONCILIATION.md](docs/SETTLEMENT_RECONCILIATION.md)** | Chart of accounts, double-entry rules, and 3-way automated reconciliation |
| **[docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)** | AES-256-GCM encryption, HMAC verification, and threat mitigation |
| **[docs/LIVE_TRANSACTION_VERIFICATION.md](docs/LIVE_TRANSACTION_VERIFICATION.md)** | Operator runbook for live transaction testing and verification |
| **[docs/PRODUCTION_ACCEPTANCE_REPORT.md](docs/PRODUCTION_ACCEPTANCE_REPORT.md)** | Engineering verification report and 20-point compliance matrix |

---

## License

Commercial Enterprise License. Proprietary and confidential.
All rights reserved.
