> Historical reference: use the [current operations manual](OPERATIONS-MANUAL.md) and [acceptance report](PRODUCTION_ACCEPTANCE_REPORT.md) for this review candidate. Older capability, hosting and automatic-verification statements below are not the current release contract.

# Dynamo Pay merchant console

User approved execution and requested both platform-fee and multiple-recipient splits.

Use the existing Node HTTP services and SQLite repositories. Preserve the SDK names and webhook verification contract. Replace the merchant and checkout presentation, retaining live payment verification as the only source of payment success.

1. Repair missing merchant navigation and show one selected page to the right of the persistent sidebar. Collapse navigation on phones.
2. Replace hardcoded financial claims with actual payment, settlement and observer records. Keep COD orders distinct from collected funds.
3. Support partial refund requests with cumulative balance checks and explicit bank-transfer confirmation.
4. Save platform fee/GST rules and optional recipient shares. Record immutable, idempotent allocations on verified success. Preserve integer-paise totals and record recipient transfer references.
5. Protect the console relay and server credentials with authenticated HttpOnly sessions. Persist only a password hash locally.
6. Rebuild branded checkout with exact-session UPI intents, QR fallback, parent SDK results, cancellation, retry and COD.
7. Verify financial and interaction behavior with automated tests, check HTTP routes through the gateway, and inspect rendered surfaces when browser tooling is available.

Automatic bank refunds and recipient payouts require configured provider capabilities. Recording a manual transfer is not independent bank verification. A missing observer connection must never be shown as a verified payment.

Runtime services import JavaScript directly. `npm run build` validates runtime JavaScript syntax; no transpilation is needed. The historical TypeScript build remains available as `npm run build:typescript`, but its project references are incomplete in the supplied repository. Browser automation was unavailable during this change; mobile app handoff still needs a physical device check.
