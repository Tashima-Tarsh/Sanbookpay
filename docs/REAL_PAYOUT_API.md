> Historical reference: use the [current operations manual](OPERATIONS-MANUAL.md) and [acceptance report](PRODUCTION_ACCEPTANCE_REPORT.md) for this review candidate. Older capability, hosting and automatic-verification statements below are not the current release contract.

# Sanbook Pay — Real Payout & Disbursement API Guide

## 1. Overview

Sanbook Pay includes a comprehensive **Outbound Payout Engine** for issuing real-money bank transfers (IMPS, NEFT, RTGS) and UPI disbursements to beneficiaries.

Key Security Rules:
- **No Fictitious UTRs**: Status changes to `SUCCESS` only when the upstream banking provider returns an authoritative bank UTR.
- **Two-Step Approval**: Payouts can require explicit administrative authorization before funds are released.
- **Idempotency**: All transfer dispatches require idempotency keys to eliminate double-payment risks.
- **Penny-Drop Verification**: Bank accounts and UPI VPAs can be validated prior to initiating large disbursements.

---

## 2. API Endpoints

### 2.1 Register Payout Beneficiary
Registers a bank account or UPI ID with Sanbook Pay and syncs it with the active banking provider.

**Endpoint**: `POST /api/v1/beneficiaries`  
**Request Payload (Bank Account)**:
```json
{
  "name": "Rohit Kumar",
  "beneficiaryType": "BANK_ACCOUNT",
  "bankAccount": "50100234567890",
  "ifsc": "HDFC0001234",
  "phone": "9876543210",
  "email": "rohit@example.com"
}
```

**Request Payload (UPI VPA)**:
```json
{
  "name": "Rohit Kumar",
  "beneficiaryType": "UPI_ID",
  "upiId": "rohit@upi",
  "phone": "9876543210"
}
```

**Response (HTTP 201 Created)**:
```json
{
  "id": "bene_44a2b9",
  "name": "Rohit Kumar",
  "beneficiaryType": "BANK_ACCOUNT",
  "bankAccount": "50100234567890",
  "ifsc": "HDFC0001234",
  "verificationStatus": "UNVERIFIED",
  "createdAt": "2026-10-19T13:40:00.000Z"
}
```

---

### 2.2 Penny-Drop Beneficiary Verification
Triggers penny-drop account validation with the upstream provider.

**Endpoint**: `POST /api/v1/beneficiaries/verify`  
**Request Payload**:
```json
{
  "beneficiaryId": "bene_44a2b9"
}
```

**Response (HTTP 200 OK)**:
```json
{
  "success": true,
  "verified": true,
  "registeredName": "ROHIT KUMAR",
  "nameMatch": true,
  "message": "Account successfully verified via provider penny-drop"
}
```

---

### 2.3 Create Payout Transfer
Initiates a transfer to a registered beneficiary.

**Endpoint**: `POST /api/v1/payouts`  
**Headers**:
- `Idempotency-Key: payout_idem_8899aabb`

**Request Payload**:
```json
{
  "beneficiaryId": "bene_44a2b9",
  "amount": 1500.00,
  "payoutRail": "IMPS",
  "remarks": "Vendor Payment October",
  "requireApproval": true
}
```

**Response (HTTP 201 Created)**:
```json
{
  "success": true,
  "id": "payout_9f8e7d",
  "transferId": "TRF-1729339200000-001",
  "amount": "1500.00",
  "amountPaise": 150000,
  "status": "APPROVAL_REQUIRED",
  "utr": null,
  "payoutRail": "IMPS"
}
```

---

### 2.4 Approve Payout Transfer
Authorizes and releases a transfer that required operator approval.

**Endpoint**: `POST /api/v1/payouts/:id/approve`  
**Request Payload**:
```json
{
  "decision": "APPROVED",
  "approverId": "ADMIN_OPERATOR_1"
}
```

**Response (HTTP 200 OK)**:
```json
{
  "success": true,
  "status": "SUCCESS",
  "utr": "629817263599",
  "transferId": "TRF-1729339200000-001",
  "processedAt": "2026-10-19T13:42:00.000Z"
}
```

---

### 2.5 Query Payout Status
**Endpoint**: `GET /api/v1/payouts/:id`

### 2.6 Force Status Refresh from Provider
**Endpoint**: `POST /api/v1/payouts/:id/refresh-status`

