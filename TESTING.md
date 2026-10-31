# DYNAMO PAY — UPI Mirror Manual Test Procedure

## Prerequisites

1. Backend running (`npm run start:prod:api` or Docker)
2. Dynamo Bridge APK installed on a physical Android device (Android 8+/API 26+)
3. Merchant account with active subscription
4. Test UPI VPA owned by the merchant

## Test 1: Merchant UPI Connection Registration

1. Log into the merchant dashboard
2. Navigate to "My UPI Connections" → "Connect UPI"
3. Enter: VPA, display name, bank name, preferred app
4. Submit and verify connection state = `REGISTERED`
5. Verify verification level = `NONE` (not yet verified)

**Expected:** Connection created with state REGISTERED, webhook secret generated.

## Test 2: Device Pairing via QR

1. In merchant dashboard, generate pairing QR (Subscription → Device Pairing)
2. Install Dynamo Bridge APK on Android device
3. Open Dynamo Bridge → "Scan Pairing QR"
4. Scan the QR code from the dashboard
5. Verify device pairs successfully
6. Verify connection state = `OBSERVER_CONNECTED`

**Expected:** Device shows CONNECTED status, merchant sees device in fleet.

## Test 3: Notification Observation

1. Grant Notification Access permission to Dynamo Bridge in Android settings
2. Make a real UPI payment to the merchant's registered VPA from a different app
3. Verify Dynamo Bridge receives the notification
4. Check backend: observation accepted with classification PENDING
5. Wait for Flash Matching Engine to process

**Expected:** Observation persists durably, classification progresses to OBSERVED/MATCHED.

## Test 4: Signed Callback Delivery

1. Configure merchant webhook URL in dashboard
2. Trigger a payment observation
3. Verify callback received at webhook endpoint with HMAC-SHA256 signature
4. Verify callback payload includes event type, order ID, amount, classification

**Expected:** Signed callback delivered with idempotency key.

## Test 5: SmartLink Checkout Status

1. Create a payment link for the merchant
2. Open checkout URL in browser
3. Make payment via UPI app
4. Verify checkout shows real-time status via SSE
5. Verify status transitions: ACTIVE → PROCESSING → OBSERVED → MATCHED

**Expected:** Customer sees live status updates without refreshing.

## Test 6: Ambiguity Handling (Same Amount, Multiple Orders)

1. Create two orders for the same merchant with the same amount
2. Make one payment matching order A
3. Verify observation matches order A, not order B
4. Verify order B remains PENDING

**Expected:** No false matches on amount alone.

## Test 7: Device Revocation

1. In merchant dashboard, revoke a paired device
2. Verify device shows REVOKED state
3. Verify UPI connections de-linked (state = OWNERSHIP_PENDING)
4. Verify no new observations accepted from revoked device

**Expected:** Revoked device cannot forward events.

## Test 8: Super Admin Functions

1. Log into Super Admin (port 9000)
2. Navigate to UPI Mirror modules:
   - Merchant Subscription Manager: activate/suspend subscription
   - Universal UPI Registry: view all VPAs, check duplication
   - Android Device Fleet Manager: view all devices, health
   - Real-Time Payment Monitor: view observations by classification
   - Instant Callback Command Centre: view delivery status, replay failed
   - System Performance Centre: view latency p50/p95/p99
   - Security & Audit Centre: view admin audit events, suspicious observations

**Expected:** All modules load and display correct data.

## Known Limitations / BLOCKED Items

| Item | Status | Reason |
|------|--------|--------|
| Physical Android device testing | BLOCKED | No physical device available to coding agent |
| Live bank UPI transactions | BLOCKED | No authorized merchant bank account for testing |
| k6/locust load testing | BLOCKED | Load testing tools not installed in environment |
| Real-device notification parsing | BLOCKED | Requires physical device with UPI apps installed |

## Manual Steps for Blocked Tests

### Physical Android Device Testing
1. Install Dynamo Bridge APK on Android 8+ device
2. Grant Notification Listener permission
3. Pair device via merchant dashboard QR
4. Make real UPI payment to merchant VPA
5. Verify observation received in backend within 1 second
6. Verify callback dispatched to webhook endpoint
7. Reboot device and verify service auto-restarts
8. Test offline: disable network, make payment, re-enable, verify event forwarded

### Load Testing
1. Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
2. Run: `k6 run scripts/load-test-upi-mirror.js`
3. Record: p50/p95/p99 ingestion latency, error rate, duplicate suppression
4. Compare against SLOs: ingestion <100ms p95, end-to-end <750ms p95
