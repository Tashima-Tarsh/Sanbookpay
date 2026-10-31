# Create Merchant

The Platform Owner provisions a new merchant through the Create Merchant wizard. The wizard has seven steps.

## Step 1 — Merchant Identity

Fields: business name, display name, category, website/domain, contact email, contact mobile, business address, merchant status, internal notes.

## Step 2 — Generate Merchant ID

A unique Merchant ID is auto-generated server-side (format: SBM-XXXXXXXX). The ID is immutable and unique.

## Step 3 — Create Merchant Owner Account

- Unique internal User ID generated
- Associated with the Merchant ID
- Merchant Owner role assigned
- Secure activation invitation sent via one-time link
- MFA enrollment workflow initiated
- Plaintext passwords are never emailed

## Step 4 — Assign Merchant Plan

- Pricing plan selected
- Subscription status set
- Transaction fees configured (percentage and fixed)
- API quotas set
- Payment amount limits set
- Allowed payment methods configured
- Payment link limits set
- Feature entitlements assigned

## Step 5 — Configure Payment Capability

- Bank/PSP connection assigned
- Receiving bank account configured
- Receiving UPI IDs configured
- Dynamic QR capability enabled
- UPI intent capability enabled
- Payment status API configured
- Provider callback integration configured
- Reconciliation capability enabled

## Step 6 — Configure Merchant Controls

- API access configured
- Webhook access configured
- Payment link creation enabled
- Hosted checkout enabled
- Dynamic QR enabled
- UPI routing enabled
- Automatic failover enabled
- Refund permissions set
- Staff permissions set
- Export permissions set
- Transaction limits set

## Step 7 — Activate Merchant

- All mandatory capabilities validated
- Audit entry created
- Merchant receives secure onboarding instructions and dashboard access

## API Endpoint

`POST /api/v1/super-admin/merchants` — Create a new merchant (requires SUPER_ADMIN authentication).