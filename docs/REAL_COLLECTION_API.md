> Historical reference: use the [current operations manual](OPERATIONS-MANUAL.md) and [acceptance report](PRODUCTION_ACCEPTANCE_REPORT.md) for this review candidate. Older capability, hosting and automatic-verification statements below are not the current release contract.

# Sanbook Pay — Real Payment Collection API Guide

## 1. Overview

Sanbook Pay provides an authenticated, idempotent, real-money UPI and card/counter collection API.
All collection orders are routed through the active authenticated banking provider (such as Cashfree Payment Gateway) or stored for banking observation matching.

- **Base URL**: `https://pay.yourdomain.com/api/v1` (or local `http://localhost:6100/api/v1`)
- **Format**: JSON (`Content-Type: application/json`)
- **Authentication**: `X-Merchant-Id` (UUID) and `X-Merchant-Key` (Secret API Key)

---

## 2. API Endpoints

### 2.1 Create Collection Order
Creates an immutable financial collection order. Enforces idempotency via the `Idempotency-Key` header.

**Endpoint**: `POST /api/v1/collections`  
**Headers**:
- `Content-Type: application/json`
- `Idempotency-Key: <unique-string>`

**Request Payload**:
```json
{
  "orderId": "ORD-2026-001",
  "amount": 499.00,
  "currency": "INR",
  "customerName": "Rohan Sharma",
  "customerPhone": "9876543210",
  "customerEmail": "rohan@example.com",
  "method": "UPI",
  "metadata": {
    "sku": "PROD-ITEM-99",
    "cartId": "CART-4402"
  }
}
```

**Response (HTTP 201 Created)**:
```json
{
  "success": true,
  "paymentId": "c7942127-14e3-469a-9e4a-9359a16f903a",
  "merchantOrderId": "ORD-2026-001",
  "amount": "499.00",
  "amountPaise": 49900,
  "status": "PENDING",
  "paymentLink": "https://payments.cashfree.com/order/#...",
  "qrString": "upi://pay?pa=sanbookpay@hdfcbank&am=499.00&tr=ORD-2026-001",
  "expiresAt": "2026-10-19T14:00:00.000Z"
}
```

---

### 2.2 Get Collection Details & Audit Trail
Returns full order details, banking provider references, latency statistics, and complete lifecycle audit events.

**Endpoint**: `GET /api/v1/collections/:id`

**Response (HTTP 200 OK)**:
```json
{
  "paymentId": "c7942127-14e3-469a-9e4a-9359a16f903a",
  "merchantOrderId": "ORD-2026-001",
  "amount": "499.00",
  "amountPaise": 49900,
  "currency": "INR",
  "status": "SUCCESS",
  "method": "UPI",
  "bankReference": "629817263541",
  "providerPaymentId": "cf_pay_998877",
  "confirmationTimeMs": 1420,
  "createdAt": "2026-10-19T13:45:00.000Z",
  "confirmedAt": "2026-10-19T13:45:01.420Z",
  "events": [
    {
      "eventType": "ORDER_CREATED",
      "status": "PENDING",
      "timestamp": "2026-10-19T13:45:00.000Z"
    },
    {
      "eventType": "BANK_NOTIFICATION_RECEIVED",
      "status": "PROCESSING",
      "timestamp": "2026-10-19T13:45:01.200Z",
      "latencyMs": 1200
    },
    {
      "eventType": "PAYMENT_CONFIRMED",
      "status": "SUCCESS",
      "timestamp": "2026-10-19T13:45:01.420Z",
      "latencyMs": 1420
    }
  ]
}
```

---

### 2.3 Fast Polling Status
Returns lightweight status and UTR for fast client-side polling loops.

**Endpoint**: `GET /api/v1/collections/:id/status`

**Response (HTTP 200 OK)**:
```json
{
  "paymentId": "c7942127-14e3-469a-9e4a-9359a16f903a",
  "status": "SUCCESS",
  "bankReference": "629817263541",
  "confirmedAt": "2026-10-19T13:45:01.420Z",
  "confirmationTimeMs": 1420
}
```

---

### 2.4 Force Status Refresh from Provider
Forcefully triggers an outbound REST call to the upstream banking provider to synchronize status.

**Endpoint**: `POST /api/v1/collections/:id/refresh-status`

---

## 3. Webhook Delivery & Verification

When a collection reaches `SUCCESS`, Sanbook Pay delivers an authoritative, signed HTTP POST webhook to your merchant endpoint.

### Verification Code (Node.js):
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
    // Fulfill digital goods authoritatively
    db.orders.markPaid(payload.orderId, { utr: payload.utr });
  }
  res.status(200).json({ received: true });
});
```

