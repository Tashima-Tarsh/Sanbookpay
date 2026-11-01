# Sanbook Pay — Complete UPI Payment Demo Flow

End-to-end demo: platform onboards merchant → merchant creates payment → customer pays to merchant's VPA → real-time callback with UTR to game backend.

No KYC. No aggregator. No fund holding. Money goes straight to merchant's UPI VPA.

---

## Phase 1: Platform Owner Onboards Merchant

### Step 1 — Platform owner creates merchant account
**Request:** `POST /api/platform/v1/merchants`
**Headers:** `Authorization: Bearer <platform-admin-token>`, `X-CSRF-Token: <csrf>`
**Body:**
```json
{
  "email": "owner@gamecompany.com",
  "password": "OwnerPass12345!",
  "businessName": "My Game Studio",
  "contactName": "John Owner",
  "mobile": "+919876543210",
  "category": "gaming",
  "address": "123 Game Street, Mumbai",
  "registrationNumber": "GST123456789",
  "taxId": "PANABCDE1234F"
}
```

**Response:**
```json
{
  "merchantId": "m_abc123",
  "businessName": "My Game Studio",
  "ownerEmail": "owner@gamecompany.com",
  "status": "EMAIL_PENDING",
  "loginPath": "/merchant/m_abc123",
  "verificationRequired": true,
  "invitationRequired": true
}
```

---

### Step 2 — Platform owner sends owner-setup invitation
**Request:** `POST /api/platform/v1/merchants/m_abc123/invite-owner`
**Headers:** `Authorization: Bearer <platform-admin-token>`

**Response:**
```json
{
  "invitationSent": true,
  "invitationPath": "/platform#owner-invitation/<token>"
}
```

The owner receives an **email and SMS** with the one-time setup link. The link expires in 24 hours and is single-use.

**What the merchant receives (email + notification):**
```
Subject: Your Sanbook Pay Merchant Account is Ready

Merchant ID: m_abc123
Business: My Game Studio
Access Link: https://your-domain.com/merchant/m_abc123
Setup Link: https://your-domain.com/platform#owner-invitation/<token>

Use the setup link to create your password and activate your account.
Link expires in 24 hours. Use it only once.
```

---

### Step 3 — Merchant owner accepts invitation & sets password
**Request:** `POST /api/platform/v1/owner-invitations/accept`
**Body:**
```json
{
  "token": "<one-time-token-from-email>",
  "password": "OwnerPass12345!"
}
```

**Response:**
```json
{
  "accepted": true
}
```

Merchant account is now active with status `PROFILE_INCOMPLETE`.

---

### Step 4 — Merchant logs in
**Request:** `POST /api/platform/v1/login`
**Body:**
```json
{
  "email": "owner@gamecompany.com",
  "password": "OwnerPass12345!",
  "merchantId": "m_abc123"
}
```

**Response:**
```json
{
  "mfaRequired": true,
  "challenge": "<mfa-challenge-token>"
}
```

Then MFA verification:
**Request:** `POST /api/platform/v1/login/mfa`
**Body:**
```json
{
  "challenge": "<challenge-token>",
  "code": "123456"
}
```

**Response:**
```json
{
  "user": { "id": "...", "merchantId": "m_abc123", "role": "OWNER", ... },
  "csrfToken": "<csrf-token>"
}
```

Session cookie `dp_platform_session` is set (HttpOnly, SameSite=Strict).

---

### Step 5 — Merchant completes business onboarding
**Request:** `POST /api/platform/v1/onboarding`
**Headers:** `Cookie: dp_platform_session=<session>`, `X-CSRF-Token: <csrf>`
**Body:**
```json
{
  "businessName": "My Game Studio",
  "contactName": "John Owner",
  "mobile": "+919876543210",
  "category": "gaming",
  "address": "123 Game Street, Mumbai",
  "registrationNumber": "GST123456789",
  "taxId": "PANABCDE1234F",
  "submit": true
}
```

**Response:**
```json
{
  "status": "UNDER_REVIEW",
  "profile": { ... }
}
```

---

### Step 6 — Platform owner approves and activates merchant
**Request:** `POST /api/platform/v1/merchants/m_abc123/state`
**Headers:** Platform admin auth
**Body:**
```json
{
  "status": "ACTIVE",
  "reason": "Merchant verified and approved for gaming payments"
}
```

Merchant is now `ACTIVE` and can create payments.

---

## Phase 2: Merchant Sets Up UPI Payment Receiving

### Step 7 — Merchant registers UPI VPA + callback URL (bridge to UPI simple)
**Request:** `POST /api/v1/upi/merchant/setup`
**Headers:** `Cookie: dp_platform_session=<session>` (merchant authenticated)
**Body:**
```json
{
  "merchantId": "m_abc123",
  "upiVpa": "mygame@upi",
  "callbackUrl": "https://gamebackend.example.com/upi-callback",
  "businessName": "My Game Studio",
  "contactEmail": "owner@gamecompany.com",
  "contactPhone": "+919876543210"
}
```

**Response — This is everything the merchant gets:**
```json
{
  "merchantId": "m_abc123",
  "businessName": "My Game Studio",
  "upiVpa": "mygame@upi",
  "callbackUrl": "https://gamebackend.example.com/upi-callback",
  "webhookSecret": "<32-char-base64-secret>",
  "accessToken": "<32-char-base64-token>",
  "accessLink": "/merchant/m_abc123",
  "apiBaseUrl": "https://your-domain.com",
  "createdAt": "2026-11-01T08:45:00.000Z"
}
```

**What the merchant receives (email + SMS + in-app notification):**
```
Subject: UPI Payment Receiving Active — My Game Studio

Merchant ID: m_abc123
UPI VPA (Receive payments here): mygame@upi
Merchant Dashboard: https://your-domain.com/merchant/m_abc123
Callback URL: https://gamebackend.example.com/upi-callback
Webhook Secret: <webhook-secret>
Access Token: <access-token>

Share your UPI VPA (mygame@upi) with customers. They pay directly to this VPA — no funds held by platform.
When payment is received, you get a real-time callback at your callback URL with the UTR.
```

**The merchant also gets an SMS:**
```
Sanbook Pay: UPI active. VPA: mygame@upi. Dashboard: /merchant/m_abc123. Webhook Secret: <secret>. Save it securely.
```

---

## Phase 3: Merchant Creates a Payment Order

### Step 8 — Merchant creates payment order (generates UPI QR)
**Request:** `POST /api/v1/upi/orders`
**Headers:** `X-Merchant-Id: m_abc123`
**Body:**
```json
{
  "orderId": "GAME-ORDER-001",
  "amount": "100.00",
  "currency": "INR",
  "callbackUrl": "https://gamebackend.example.com/upi-callback"
}
```

**Response:**
```json
{
  "id": "<order-uuid>",
  "orderId": "GAME-ORDER-001",
  "amountPaise": 10000,
  "currency": "INR",
  "status": "PENDING",
  "upiVpa": "mygame@upi",
  "qrUri": "upi://pay?pa=mygame%40upi&pn=Merchant&mode=04&tr=GAME-ORDER-001&tn=Payment+GAME-ORDER-001&am=100.00&cu=INR",
  "callbackUrl": "https://gamebackend.example.com/upi-callback"
}
```

**Merchant displays the QR URI to the customer** (or converts to QR code image). The customer scans and pays `₹100.00` to `mygame@upi` from any UPI app (GPay, PhonePe, Paytm, BHIM).

---

## Phase 4: Customer Pays & Real-Time Callback

### Step 9 — Customer pays to merchant's VPA
Customer opens any UPI app, scans QR, pays ₹100.00 to `mygame@upi`. Money goes **directly** to merchant's bank account — platform holds nothing.

### Step 10 — Observer detects credit and posts UTR
The Android observer app (or SMS/Gmail monitor) detects the UPI credit notification and posts:

**Request:** `POST /api/v1/upi/notify`
**Headers:** `X-Merchant-Id: m_abc123`, `X-Merchant-Secret: <webhook-secret>`
**Body:**
```json
{
  "orderId": "GAME-ORDER-001",
  "amountPaise": 10000,
  "utr": "123456789012",
  "senderVpa": "customer@upi",
  "source": "ANDROID_OBSERVER",
  "rawText": "₹100.00 credited to mygame@upi from customer@upi. UTR: 123456789012"
}
```

**Response:**
```json
{
  "matched": true,
  "orderId": "GAME-ORDER-001",
  "status": "SUCCESS",
  "utr": "123456789012",
  "callback": {
    "sent": true,
    "status": 200
  }
}
```

If no `orderId` is provided, the system matches by amount alone (finds pending order with matching amount).

### Step 11 — Game backend receives real-time callback
**Request:** `POST https://gamebackend.example.com/upi-callback` (from platform)
**Headers:**
```
Content-Type: application/json
X-Gateway-Event: PAYMENT_SUCCESS
X-Gateway-Signature: sha256=<hmac-of-payload-using-webhook-secret>
X-Gateway-Delivery-Id: <order-uuid>
X-Gateway-Timestamp: <timestamp>
```
**Body:**
```json
{
  "event": "PAYMENT_SUCCESS",
  "orderId": "GAME-ORDER-001",
  "paymentId": "<order-uuid>",
  "amount": "100.00",
  "amountPaise": 10000,
  "currency": "INR",
  "status": "SUCCESS",
  "utr": "123456789012",
  "senderVpa": "customer@upi",
  "payeeVpa": "mygame@upi",
  "completedAt": "2026-11-01T08:46:00.000Z",
  "source": "ANDROID_OBSERVER"
}
```

**Game backend verifies:**
1. `X-Gateway-Signature` = HMAC-SHA256(rawBody, webhookSecret) — confirms authenticity
2. `orderId` matches an expected order
3. `amountPaise` matches expected amount
4. `status` is `SUCCESS`
5. `utr` is the 12-digit transaction reference

Then credits the player's game wallet.

---

## Phase 5: Merchant Checks Payment Status

### Step 12 — Merchant queries order status
**Request:** `GET /api/v1/upi/orders/GAME-ORDER-001`
**Headers:** `X-Merchant-Id: m_abc123`
**Response:**
```json
{
  "id": "<order-uuid>",
  "orderId": "GAME-ORDER-001",
  "amountPaise": 10000,
  "currency": "INR",
  "status": "SUCCESS",
  "upiVpa": "mygame@upi",
  "utr": "123456789012",
  "senderVpa": "customer@upi",
  "createdAt": "...",
  "completedAt": "..."
}
```

---

## Summary: What the Merchant Gets

| Item | Value | Source |
|------|-------|--------|
| Merchant ID | `m_abc123` | Platform onboarding |
| Access Link | `/merchant/m_abc123` | UPI setup response |
| UPI VPA (receive here) | `mygame@upi` | UPI setup response |
| Callback URL | `https://gamebackend.example.com/upi-callback` | UPI setup response |
| Webhook Secret | `<32-char-base64>` | UPI setup response (HMAC verification) |
| Access Token | `<32-char-base64>` | UPI setup response (API auth) |
| API Base URL | `https://your-domain.com` | UPI setup response |
| Email + SMS | All credentials above | Sent on setup |
| Real-time callback | `PAYMENT_SUCCESS` with UTR | On each payment |

---

## Test Commands (run locally)

```bash
# 1. Start the Payment API
npm run start:prod:api   # port 6100

# 2. Register merchant via UPI simple
curl -X POST http://localhost:6100/api/v1/upi/merchant/setup \
  -H 'Content-Type: application/json' \
  -d '{"merchantId":"m_demo","upiVpa":"mygame@upi","callbackUrl":"https://game.example.com/callback","businessName":"Demo Game"}'

# 3. Create order
curl -X POST http://localhost:6100/api/v1/upi/orders \
  -H 'Content-Type: application/json' \
  -H 'X-Merchant-Id: m_demo' \
  -d '{"orderId":"GAME-001","amount":"100.00"}'

# 4. Simulate payment received (observer posts UTR)
curl -X POST http://localhost:6100/api/v1/upi/notify \
  -H 'Content-Type: application/json' \
  -H 'X-Merchant-Id: m_demo' \
  -H 'X-Merchant-Secret: <webhook-secret-from-step-2>' \
  -d '{"orderId":"GAME-001","amountPaise":10000,"utr":"123456789012","senderVpa":"customer@upi","source":"ANDROID_OBSERVER"}'

# 5. Check status
curl http://localhost:6100/api/v1/upi/orders/GAME-001 \
  -H 'X-Merchant-Id: m_demo'
```

---

## Git Status

Commit `6ebc35d` pushed to `https://github.com/Tashima-Tarsh/Sanbookpay` — adds:
- `apps/payment-api/src/services/upi-simple.js` — core UPI service
- `apps/payment-api/src/routes/upi-simple.routes.js` — HTTP endpoints
- `apps/payment-api/src/__tests__/upi-simple.test.js` — 10 tests
- `apps/payment-api/src/index.js` — service wiring
