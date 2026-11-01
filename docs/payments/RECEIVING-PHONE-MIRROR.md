# Receiving phone mirror and notification payment acceptance

Dynamo Pay is the platform. Each onboarded merchant has its own API keys, orders and callback endpoint. Super Admin assigns the receiving UPI account and pairs its Android phone.

## One-time setup

1. Create/select the merchant, open Connections and assign its active receiving UPI account.
2. Save the merchant callback URL and provide its webhook signing secret securely.
3. With Super Admin MFA verified, save **Automatic notification payment acceptance** for that receiving account, with a reason. Enabling this policy authorizes eligible receiving alerts to mark orders Paid and send SUCCESS. The policy is disabled until explicitly saved.
4. Generate a receiving-phone pairing QR and scan it in the compatible Android observer. The QR expires after ten minutes, is single-use, and binds the device to the selected merchant/account. Grant the required notification/SMS permissions and background operation on the phone.
5. Open Payment mirror to see receiving UPI, phone heartbeat, extracted UTR, matched order, payment state and callback delivery. Revoking a device blocks further requests.

Gmail uses the existing OAuth connection and receiving-account binding. Google consent and platform OAuth credentials remain required. Phone pairing does not connect Gmail automatically.

Merchant activation still requires owner verification and its normal identity checks. Its collection route can be an approved provider, or an explicitly enabled notification policy with an active receiving account, configured callback and paired active phone for that UPI.

## When an alert marks Paid

An authenticated Gmail observer or signed paired-phone alert must identify an incoming credit, contain an actual 12-digit UTR, and match exactly one eligible order using the assigned receiving UPI, exact amount and order time window. Notification acceptance must be enabled for that order's merchant and receiving account.

The transaction atomically claims the UTR, marks the payment SUCCESS, releases its payment slot, records a notification-clearing journal, and queues the merchant SUCCESS callback. Delivery is attempted immediately after commit and retried durably on failure. Duplicate alerts do not credit or notify twice. Reused references, shared-UPI ambiguity, expired/stale alerts and missing references cannot trigger this success path.

This is the platform's acceptance of receiving-notification evidence. It is labelled `NOTIFICATION_CONFIRMED`, verification level 0, with `confirmationSource: NOTIFICATION` and `bankVerified: false`. It does not independently query the bank or provider. Funds are recorded in notification clearing pending reconciliation rather than bank cash.

## Merchant callback

The existing raw-body HMAC signature and stable delivery ID apply. The SUCCESS payload includes the actual extracted UTR and these fields:

```json
{
  "event": "SUCCESS",
  "status": "SUCCESS",
  "confirmationSource": "NOTIFICATION",
  "bankVerified": false,
  "utr": "123456789012"
}
```

Merchants must verify signatures and deduplicate delivery IDs. With automatic acceptance disabled, alerts remain evidence only; optional PAYMENT_DETECTED callbacks have status PENDING and do not credit the payment.

## Timing and acceptance limits

The mirror refreshes through authenticated SSE with polling recovery. Phone requests require the device HMAC and a current timestamp; account binding is enforced server-side. The portal displays parsed payment fields, not personal message bodies or signing keys.

Callback speed depends on when the bank/app sends its alert, phone background execution, network availability and the merchant endpoint. Gmail polling is not instant push. A notification alone cannot independently establish bank settlement.

Automated tests cover pairing, tenant isolation, signatures, account tampering, MFA/CSRF, matching, notification success, duplicate/reference reuse, transaction rollback, pending mode and durable callback retries. Real Vivo/Slice/GPay/PhonePe capture, Android build/signing, Gmail consent and live payment acceptance remain untested. Browser automation was unavailable, so screenshot acceptance is outstanding. Earlier isolated PostgreSQL checks covered pairing and pending-mode matching; the new automatic-success path has been tested locally with SQLite.

Source branch: feature/receiving-phone-mirror. These changes have not been merged or deployed. Existing devices must be paired through the scoped QR flow to appear in the new mirror.
