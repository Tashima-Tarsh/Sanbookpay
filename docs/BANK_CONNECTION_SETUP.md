# Sanbook Pay — Bank & Provider Connection Setup Guide

## 1. Overview

Sanbook Pay features a dynamic **Provider Connection Wizard** accessible in the Merchant Console under:
**BANKING → CONNECTIONS** (`http://localhost:6001#banking`).

The platform supports:
1. **Cashfree Payments (Primary Implemented Provider)**:
   - Payment Gateway Collections (PG)
   - Real-Time Payouts (IMPS, NEFT, RTGS, UPI)
   - Beneficiary Penny-Drop Account Validation
   - Settlement Tracking & Webhook Verification
2. **Direct Bank Connections (Interface Architecture)**:
   - HDFC Bank, ICICI Bank, Axis Bank, State Bank of India, Kotak Mahindra Bank
   - Strictly enforces documented API contracts and mutual TLS / corporate banking agreements. Direct bank connections without implemented API contracts return explicit capability errors (`CAPABILITY_NOT_CONFIGURED`).

---

## 2. Setting Up Cashfree PG (Collections)

### Step 1: Obtain API Credentials
1. Log in to the [Cashfree Merchant Dashboard](https://merchant.cashfree.com).
2. For testing, switch to the **Sandbox Environment**.
3. Navigate to **Payment Gateway → Developers → API Keys**.
4. Generate or copy your **App ID / Client ID** and **Secret Key**.
5. Navigate to **Webhooks** and note your **Webhook Signing Secret**.

### Step 2: Configure in Sanbook Pay Console
1. Open Merchant Console: `http://localhost:6001#banking`.
2. In the **Configure Bank / Provider Connection** form:
   - **Provider Name**: Select `Cashfree Payments`.
   - **Environment**: Choose `SANDBOX` (or `PRODUCTION`).
   - **Client ID / App ID**: Enter your Cashfree Client ID.
   - **Client Secret**: Enter your Secret Key (encrypted at rest with AES-256-GCM).
   - **Webhook Secret**: Enter your Webhook Signing Secret.
   - **Merchant VPA (UPI ID)**: Enter your approved UPI VPA (e.g., `sanbookpay@hdfcbank`).
3. Click **"Test Connection"** to verify credential authenticity.
4. Click **"Save Connection"**.
5. Click **"Activate for Collections"**.

---

## 3. Setting Up Cashfree Payouts (Outbound Disbursements)

### Step 1: Payout Credentials
Cashfree Payouts requires activation of the Payouts product on your Cashfree merchant account.
1. Obtain separate or shared Payouts credentials under **Payouts → Developers → API Keys**.
2. If using IP Whitelisting, add your server's static egress IP addresses in the Cashfree dashboard.

### Step 2: Activation in Console
1. In the Sanbook Pay Console under **BANKING → CONNECTIONS**, locate the saved Cashfree connection.
2. Click **"Activate for Payouts"**.
3. Verify live balance retrieval by checking the **Available Banking Balance** KPI widget.

---

## 4. Configuring Webhook Ingestion URL

Set the Webhook endpoint in your Cashfree Developer Dashboard:

| Event Type | Production Webhook URL | Local Tunnel URL |
| :--- | :--- | :--- |
| **Payment Gateway (PG)** | `https://pay.yourdomain.com/api/v1/provider-webhooks/cashfree` | `https://<tunnel>/api/v1/provider-webhooks/cashfree` |
| **Payouts (Transfers)** | `https://pay.yourdomain.com/api/v1/provider-webhooks/cashfree-payouts` | `https://<tunnel>/api/v1/provider-webhooks/cashfree-payouts` |

### Webhook Signature Verification Rule:
Cashfree computes signatures by HMAC-SHA256 over `${timestamp}${rawBody}` using the base64-encoded secret key:
```javascript
const signature = crypto.createHmac('sha256', secretKey)
  .update(`${timestamp}${rawBody}`)
  .digest('base64');
```
Sanbook Pay automatically enforces raw-body signature verification on all incoming webhook dispatches.

---

## 5. Direct Bank Connections (Future Integration Path)

For direct acquiring bank connectivity (e.g. HDFC SmartHub, ICICI Eazypay, Axis Bank):
1. Execute Corporate Banking and Merchant Aggregator agreements with the bank.
2. Receive bank-specific API documentation, mutual TLS certificates (PKCS#12 / PEM), and corporate IP whitelisting.
3. Configure the bank connection under `DIRECT_HDFC`, `DIRECT_ICICI`, etc.
4. The system securely encrypts the client certificates and routes transfers through the bank's host-to-host (H2H) or SFTP gateway.

