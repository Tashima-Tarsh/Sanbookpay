# Merchant workspace fixes — 31 October 2026

Review branch: `fix/merchant-workspace-flow`. Production remains at `c5cbae88139240a18a840662408d91af6f6d8fa7`, matching GitHub main when checked. These fixes are not deployed yet.

## Owner and merchant workflow

1. Sign in to the existing owner console at `/admin`, then choose **Manage merchants**. This uses the existing authenticated owner-session bridge and opens `/platform#merchants`.
2. Set up the platform owner's authenticator under **Team & security** if required. Merchant creation requires a verified MFA session.
3. Choose **Add merchant**. Enter the business and merchant owner's details and a separate owner password of at least 12 characters. These are business-owner contact details, not customer payment fields.
4. The merchant receives an independent OWNER account and signs in at `/platform` using that email and password. Share these privately. No email is automatically sent by merchant creation. A separate browser profile is needed to test their sign-in while preserving the current platform-owner browser session.
5. Contact verification, completed onboarding, review and approved provider activation remain required. Creation does not silently activate payments or mark contacts verified.
6. Under **Merchants**, choose **Open dashboard**. Overview, transaction lists, operations, billing, developer settings, receiving accounts and provider configuration use the selected merchant. **All merchants** returns to the directory. This does not impersonate the merchant or change the administrator's role.
7. **Access & details** lists that merchant's owner/staff sign-in emails, roles and verification flags, without password hashes. **Team & security** in the platform view manages platform staff; merchant owners manage their own tenant's team.

## Payment and interface changes

- Payment creation asks only for the amount, both in the existing console and merchant workspace. Order IDs are generated automatically and retained for retries while the form is open.
- Merchant workspace creation uses the canonical payment service with session permissions, CSRF, MFA, tenant ownership, idempotency, active-merchant checks, acceptance policy and receiving-slot allocation. Existing server API-key access is preserved.
- Customer name and phone entry are removed from the active console's payment-creation dialog. Merchant business/owner contact details remain where needed for account administration.
- Checkout no longer requests a manual UTR or offers a reference correction form. The manual bank-review action/dialog is removed from the console UI. Existing financial history and backend audit/review records are preserved.
- Payment completion remains dependent on authoritative bank/provider confirmation. A customer clicking Payment done does not mark an order paid. Removing a field does not configure a bank feed. Previously recorded references remain visible as financial history.
- Sign-in forms use one column. Form labels use separate text elements and unique input IDs. Navigation uses short labels. Dialog width, form spacing, wrapping, mobile workspace controls and touch targets are adjusted within the existing visual system.
- Platform owner can approve reviewed provider connections using the existing protected API; provider creation still requires private legitimate provider credentials.
- Changed console/platform assets have updated version query strings to refresh stale browser assets after deployment.

## Validation

- Full regression: 49 suites passed. The exact count and timing are recorded in `workspace-fix-regression-results.json`.
- Typecheck, runtime build (182 JavaScript files), tracked secret scan and whitespace checks passed.
- Targeted tests exercise merchant provisioning, MFA and CSRF rejection, separate-owner login, tenant isolation, duplicate accounts, transactional rollback, amount-only payment request payloads, stable idempotency and selected-merchant request scoping.
- UI detector ran; linked-stylesheet resolution makes some color analysis incomplete. No broad redesign was performed.
- Browser/native UI access is unavailable in this environment. Fresh desktop/mobile screenshots, actual rendered overflow, keyboard/touch and visual approval remain unverified. DOM interaction tests do not replace that visual acceptance.
- Real PostgreSQL acceptance is conditional on a separate test connection; real bank/provider/device tests were not performed. No production merchant, payment, credential or database records were changed during testing.

The earlier audit's unrelated critical generic-callback, wallet, default-admin and alternate-auth findings remain open. This change is not a production-security certification and does not claim those issues are fixed.
