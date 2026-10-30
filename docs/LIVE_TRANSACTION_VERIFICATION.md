# Sanbook Pay — Live Transaction Verification Runbook

## 1. Objective

This runbook guides operators through the authoritative verification of **live real-money payments, payouts, and settlements** using production credentials.

> **CRITICAL RULE**: Do not initiate live transactions with real funds until explicit written authorization is received from the merchant business owner.

---

## 2. Pre-Flight Verification Checklist

Before issuing live transactions:
- [ ] Production SSL/TLS certificate installed on domain `pay.yourdomain.com`.
- [ ] Reverse proxy (Caddy / Nginx) routing traffic with valid HTTPS.
- [ ] Database migrated with PostgreSQL schema: `packages/db/src/schema.sql`.
- [ ] Cashfree Production Account approved and activated (KYC complete).
- [ ] Static server IP whitelisted in Cashfree dashboard (for Payouts).
- [ ] Production Webhooks configured and verified with test ping.

---

## 3. End-to-End Live Payment Verification (Collections)

1. **Create Live Order (₹1.00)**:
   ```bash
   curl -X POST https://pay.yourdomain.com/api/v1/collections \
     -H "Content-Type: application/json" \
     -H "Idempotency-Key: live_verif_$(date +%s)" \
     -d '{
       "orderId": "LIVE-VERIFY-001",
       "amount": 1.00,
       "customerName": "Operator Test",
       "customerPhone": "9876543210"
     }'
   ```
2. **Execute Payment**:
   - Open returned `paymentLink` or scan the dynamic UPI QR code with a genuine UPI app (GPay, PhonePe, BHIM).
   - Authorize ₹1.00 UPI debit with your bank PIN.
3. **Verify Confirmation**:
   - Webhook received at `POST /api/v1/provider-webhooks/cashfree`.
   - Query status: `GET /api/v1/collections/<paymentId>/status`.
   - Ensure `status: "SUCCESS"` and genuine 12-digit bank UTR is present.
   - Verify ledger balance: Undeposited UPI collections credited with `100` paise.

---

## 4. End-to-End Live Payout Verification (Outbound Transfer)

1. **Register Operator Beneficiary**:
   - In console (`http://localhost:6001#payouts`), add operator bank account or UPI ID.
2. **Run Penny-Drop Verification**:
   - Click "Verify" next to the beneficiary.
   - Validate that the registered account holder name returned by the bank matches the account holder.
3. **Initiate Transfer (₹1.00)**:
   - Issue a ₹1.00 payout transfer via IMPS or UPI rail.
4. **Authorize Transfer**:
   - In Console, click "Approve" to authorize real-money disbursement.
5. **Verify Bank Receipt**:
   - Check recipient bank account for ₹1.00 incoming IMPS credit with matching bank UTR.

---

## 5. Settlement & Reconciliation Verification

1. On `T+1` business day, retrieve Cashfree settlement batch report:
   ```bash
   curl -X GET https://pay.yourdomain.com/api/v1/settlements/reconciliation/runs
   ```
2. Check that the net funds (`₹1.00 - fees`) are matched to the merchant's current account credit.
3. Confirm that the status in `reconciliation_runs` is `BALANCED`.

