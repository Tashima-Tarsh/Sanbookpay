> Historical reference: use the [current operations manual](OPERATIONS-MANUAL.md) and [acceptance report](PRODUCTION_ACCEPTANCE_REPORT.md) for this review candidate. Older capability, hosting and automatic-verification statements below are not the current release contract.

# Dynamo Pay local gateway

Run `npm install`, then `npm run start:tunnel` from the repository root. The launcher starts Payment API (6100), checkout (7000), merchant admin (6001), Gmail observer (6003), and the shared gateway (8080). The demo store is disabled. Supply the official Cloudflare `cloudflared.exe` in the repository root; this local executable is intentionally excluded from Git.

The tunnel prints the current public URL. Quick-tunnel URLs change on restart. Keep the laptop and tunnel running while accepting payments. The merchant UI preserves its existing design; Create & open checkout submits the payment and navigates directly to QR/UPI checkout.

## Administrator sign-in

Existing local credentials are stored as a password hash in ignored `data/.secrets/console-login.json`. For another installation, configure `ADMIN_LOGIN_EMAIL` and `ADMIN_LOGIN_PASSWORD_HASH` (the PBKDF2 format returned by `hashPassword` from `@youpi/common`). Secrets and SQLite data are not included in commits.

## Gmail observer

Open Alerts & observers. Enter a Google OAuth client ID and client secret, save, and register the exact redirect URI displayed there in your Google OAuth client. Enable Gmail API in that Google Cloud project, configure its consent screen, and connect the Gmail inbox receiving bank credit emails. Alternatively save an existing refresh token. Test connection after authorization. Account authorization requires the account owner's action; a running observer without credentials is unconfigured.

A fixed HTTPS domain is preferable for ongoing use because a quick-tunnel change also changes the callback URI. `GMAIL_REDIRECT_URI` can specify a fixed callback. Disconnect stops the reader and clears cached access.

## Android bank SMS

Download the APK from Alerts & observers onto the receiving phone. Generate its pairing QR using the current public HTTPS origin, grant SMS/notification permissions in the app, scan the QR, and allow the background service to run. Pair only a phone you control.

## Payment verification and transfers

Payment done starts verification; it does not prove receipt. Missing bank confirmation becomes Awaiting bank verification, never an automatic failure. A supplied UTR remains unverified until matched against a bank observation. Ambiguous same-amount credits are held for reconciliation. Merchant-confirmed receipts remain distinguishable from bank-observer confirmation.

Refund requests and recipient split allocations record liabilities and bank-transfer references. Automatic outgoing transfers require a configured payout/refund provider. Do not interpret recorded allocations as money already transferred.

## Checks

`npm test` runs the regression suites and detects TAP failures even if a test exits with code zero. `npm run build` validates runtime JavaScript syntax; services run JavaScript directly. Historical TypeScript references remain under `npm run build:typescript` and are incomplete in the supplied repository. Physical-phone UPI handoff and rendered browser QA require a usable browser/device session.
