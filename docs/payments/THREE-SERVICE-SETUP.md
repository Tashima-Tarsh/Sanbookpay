# PayGate, Django/n8n and India Banking setup

These connectors run through the existing Dynamo Pay console and checkout. The three upstream applications remain separate services; they are not silently installed or activated by adding a bank account.

## What works in this source change

- Amount-only payment creation in the existing merchant and platform consoles.
- Bank name, account holder, account number and IFSC on receiving accounts. Account numbers are encrypted with the existing encryption master key and returned masked.
- PayGate and Django/n8n order creation, exact payable amount and destination validation, existing QR checkout, authenticated status reads and signed callback ingestion.
- One selected QR collection service per merchant. Both collection services may be configured, but only one creates a particular payment. Each payment retains its original integration.
- India Banking balance refresh and stored ERPNext statement retrieval for reconciliation. Statement retrieval can enqueue an upstream import; repeat it after the import completes. Responses explicitly say that a cached ERPNext value is not independent proof that its bank refresh succeeded.
- Notification evidence moves a detected payment to VERIFICATION_PENDING and removes the payable QR. It never posts a ledger credit or marks SUCCESS. Use the existing authorized merchant bank-review flow after reviewing the actual bank credit, or an approved provider's verified confirmation flow.

## Reviewed upstream versions

| Project | Commit | Role |
| --- | --- | --- |
| [Phloraxx/payment-api](https://github.com/Phloraxx/payment-api) | d8fa14b987eca508b1918c8aef58a7b49fdaf78d | Go service, UPI instructions, Android evidence |
| [kbssrikar7/n8n-upi-payment-gateway-django](https://github.com/kbssrikar7/n8n-upi-payment-gateway-django) | 577e4caa52c010d5e3828ef970619a7b3a319dea | Django service, Gmail/n8n evidence |
| [aerele/india-banking](https://github.com/aerele/india-banking) | 26f93e05c3d3df2c477bd3f6376ae61cd073fb50 | Frappe/ERPNext app and bank connectors |

The Node connector code implements their HTTP contracts; it does not copy their Go or Python applications into Dynamo Pay. PayGate is AGPL-3.0, India Banking is GPL-3.0, and the Django project is MIT. Review the upstream licensing when deploying or modifying those services. The adapted n8n workflow includes its upstream MIT notice.

## 1. Start the external services

Deploy each application using its upstream installation instructions at the pinned version above. Give each service a separate HTTPS origin, database and secrets.

For PayGate, configure its collection profile with the receiving UPI ID, issue a merchant API key, pair the separate Android relay application and configure the merchant's signed webhook destination. PayGate accepts whole-INR requested amounts and requires a display identifier; Dynamo Pay supplies the actual receiving payee name as that identifier, never a fabricated customer name.

For Django, configure its Django secret, UPI_VPA, UPI_PAYEE_NAME and BANK_ALERT_INGEST_SECRET; run its migrations and create an active Client through its admin. That Client's API key and webhook secret go into Dynamo Pay. Import `integrations/n8n/bank-alert-workflow.json` into your own n8n instance, select your Gmail credentials and create an HTTP Header Auth credential named `X-Ingest-Secret` with the Django ingest secret. Replace the service URL, review the sender filter, and activate the workflow only after checking it. It is shipped inactive with no saved credentials. Use full message text where available; a truncated Gmail snippet may not contain enough information to parse.

For India Banking, install the app in a compatible Frappe/ERPNext bench. Configure its bank-specific server application, the bank-issued API credentials/certificates and allowlisted static IP where required. Create the ERPNext Bank Account and Bank Connector documents. Issue a Frappe API key/secret to a dedicated user with permission to invoke the balance/statement methods and read only the intended Bank Account and Bank Transaction documents. The bank-account document name is not the numeric account number.

Installing these projects does not grant bank API access or link an arbitrary UPI ID to a bank account. The receiving VPA must already route to the intended account through the bank/UPI provider.

## 2. Allow your service addresses in Dynamo Pay

Set these private runtime settings, then restart Dynamo Pay:

```text
BANKING_CONNECTOR_ORIGINS=https://paygate.example.com,https://django.example.com,https://erpnext.example.com
DYNAMO_PUBLIC_URL=https://your-dynamo-domain.example
```

Use only service origins without paths. Secrets are entered through the connection form and encrypted using the existing ENCRYPTION_MASTER_KEY. Preserve that key. Self-hosted private HTTP targets additionally require the existing explicit YOUPI_ALLOW_PRIVATE_WEBHOOKS=true setting; use HTTPS for externally reachable services.

## 3. Configure the console

1. Open `/platform#connections`, selecting the merchant first when signed in as platform owner.
2. Add the receiving UPI account and all four bank fields. Activate that account.
3. Save each external service with its URL, receiving account, API key and relevant secret. India Banking additionally requires its Frappe API secret and ERPNext Bank Account document name.
4. Check credentials. For collection services, the diagnostic requests a deliberately nonexistent payment: an authenticated 404 is expected and creates no financial record. India Banking requests a balance refresh and reads its stored account balance; this is a connectivity check, not live-bank certification.
5. Select either PayGate or Django/n8n using **Use for QR payments**. The other configured collection service remains unused for new orders until selected. No automatic cross-service failover occurs after an uncertain creation.
6. For PayGate, set its webhook destination to `/api/v1/banking-integrations/CONNECTION_ID/events` on your Dynamo public origin and enter the same webhook secret in both services. Django receives this destination automatically on order creation.
7. Create a payment with only Amount. Pay the exact displayed amount, which may include an upstream verification adjustment of up to INR 1.99. Keep that headroom inside the configured channel limit. The current Dynamo slot limit remains one active checkout per receiving account; external requests return a conflict while that slot is occupied.

## 4. Reconcile a payment

An external PAID notification is supplementary evidence. The checkout says payment was detected and bank verification is pending. In Connections, use the India Banking **Bank statements** action with a date range of at most 31 days. The response returns up to 100 stored transactions and `mayHaveMore` when further ERPNext review is required. Review the exact credit, receiving account, amount, currency, date and actual bank reference. Use the existing owner/admin merchant bank-review action to record confirmed receipt with a real reference and reason; it remains labelled MERCHANT.

This release does not automatically turn cached ERPNext rows into bank-authoritative SUCCESS. Unattended bank-authoritative reconciliation still needs a verified bank-specific receipt contract and controlled live acceptance. That limitation is deliberate and visible, rather than treating email or amount matches as settlement proof.

## Error and retry behavior

- Repeat the same Idempotency-Key and request to retrieve the original payment.
- A timeout, rejected QR validation or invalid upstream response leaves the original payment correlated with an UNKNOWN outcome. Its response includes the Dynamo payment ID; checkout disables payment actions and asks for reconciliation. No replacement order is issued automatically.
- An external checkout cannot use the browser's generic replacement-payment action. The merchant must reconcile the old upstream instruction first.
- A signed callback is deduplicated by connection and body hash, then queries the original upstream payment. It cannot set financial success from its payload.
- Status polling is throttled to once per payment every 15 seconds; concurrent polls share one upstream request. Signed callbacks bypass the polling throttle. An unavailable evidence inquiry returns 503 without consuming the callback, so the sender can retry. Email/Android services must be running independently for new evidence to arrive.

## Validation boundary

Connector tests use isolated temporary databases and synthetic loopback HTTP services. They verify protocol mapping, tenant ownership, encrypted storage, idempotency, callback signatures, pending state and ledger non-mutation. They do not certify a real bank account, Gmail inbox, Android relay, deployed external service, native APK or live transfer. No production deployment is part of this change.
