# Connect outgoing push, email and SMS

Run these commands from the repository folder containing package.json, not its parent Downloads folder. This setup is for the main Payment API. The separate historical upi-collector is not used.

## Local preparation

Run `npm run notifications:setup`. It adds missing notification settings to your ignored root `.env`, generates a random ntfy topic, and preserves existing values and encryption keys. It sends nothing. Run `npm run notifications:status` to see which channels need configuration. Restart the Payment API after changing credentials or settings. Keep ENCRYPTION_MASTER_KEY unchanged; it encrypts pending recipients and message content in the database.

## Push

Install ntfy on the receiving phone, or open https://ntfy.sh/app. Subscribe to the exact NTFY_TOPIC in your private root `.env`. Leave NTFY_BASE_URL=https://ntfy.sh for the public service. No topic registration is needed. Public topics can be read or written by others who know the name: never publish customer details, references or financial records there. The app sends a generic alert asking you to sign in. For a private authenticated ntfy server, change NTFY_BASE_URL and NTFY_TOKEN.

## Gmail sending

Use your Google Cloud project, enable Gmail API, configure OAuth consent, and add the sending Gmail account as a test user when the consent app is in Testing. Create a Web application OAuth client and register exactly `http://127.0.0.1:4242/` as an authorized redirect URI. Set GMAIL_SEND_CLIENT_ID, GMAIL_SEND_CLIENT_SECRET and GMAIL_SEND_FROM in the root `.env`. GMAIL_SEND_FROM must be the Gmail mailbox you will authorize, or one of its configured send-as addresses.

Run `npm run gmail-auth` on this computer. Open the printed consent URL and authorize only Gmail sending. The loopback callback validates its state, exchanges the code, and saves the refresh token in ignored `data/.secrets/gmail-send.json`. It never prints the token. The OAuth client should be dedicated to this sending integration; unexpectedly broader granted scopes are rejected. Restart the API after authorization. Alternatively set GMAIL_SEND_REFRESH_TOKEN through your secret manager. These settings are separate from the Gmail inbox observer, which needs different permissions.

Google Testing mode normally expires these refresh tokens after seven days. Repeat gmail-auth when consent expires; Testing is not a permanent unattended connection. Google account and API limits apply. Gmail sending requires internet access even when Sanbookpay runs locally.

## Android SMS

Use the open-source **SMS Gateway for Android** app from https://github.com/capcom6/android-sms-gateway/releases. This is different from the bundled Sanbookpay bank-notification observer APK. Install it on your own Android phone with an active SIM, grant its SMS permissions, enable Local Server and start the service. Connect the phone and computer to the same trusted Wi-Fi. The app displays its local address and Basic authentication credentials.

Copy those values privately into the root `.env`: SMS_GATEWAY_URL is the displayed local base address, such as http://192.168.1.50:8080 (no /message suffix); SMS_GATEWAY_USERNAME and SMS_GATEWAY_PASSWORD are the values shown by the app. Do not forward a router port or expose this API publicly. If your Wi-Fi uses client isolation, allow communication or use a trusted private LAN. Reserve the phone's IP in your router so it stays stable. Allow the gateway's background service in Android battery settings.

This adapter uses authenticated POST /message with textMessage.text, phoneNumbers and a stable job ID. Use international recipient format, for example +91 followed by the actual ten-digit Indian number. Existing canonical ten-digit Indian mobiles starting with 6–9 are converted to +91 for compatibility with the customer database. Other malformed numbers are rejected. Internal customer.youpi.local login placeholders are never emailed. A reachable app is not proof of carrier delivery. The phone must remain online with usable SMS service; your SIM's existing identity requirements, allowance and carrier charges still apply. No new commercial SMS-provider account is required.

## Owner acceptance test

After configuring and subscribing, run `npm run notifications:test -- --email YOUR_OWN_EMAIL --phone YOUR_OWN_INTERNATIONAL_NUMBER`. This explicitly sends tests to the supplied recipients and the configured push topic. Omit email or phone to skip that recipient. It uses isolated in-memory test jobs and never creates a payment or accesses the live queue. SUBMITTED means the receiving API accepted the request; confirm receipt yourself on the phone and inbox. Do not use a customer's details for this test.

## Receipt delivery and recovery

The API reserves one job per receipt/channel in the same transaction as the receipt. Its worker checks every five seconds, submitting at most 20 queued jobs per pass. Failures retry with 30-second exponential backoff, at most five attempts; most HTTP 4xx errors stop immediately. Expired two-minute leases recover after restart. Pending recipient/message payloads are encrypted and cleared at final SUBMITTED or FAILED state. Provider errors are recorded only as redacted codes.

Statuses include NOT_CONFIGURED, NO_RECIPIENT, INVALID_RECIPIENT, PENDING, SENDING (worker claim), SUBMITTED and FAILED. No email or SMS is queued if the payment has no corresponding customer contact. Amount-only links do not invent contact details. Receipts generated before this feature are not mass-mailed retroactively. COD notifications say order placed and cash due; notification sending never changes financial status or proves bank settlement.

Delivery is at least once: a crash or lost response after a provider accepts a message can cause a duplicate on retry. SMS jobs retain a stable request ID and email retains its Message-ID, but no universal provider deduplication guarantee is claimed. FAILED jobs remain available for inspection; operator-controlled replay is not implemented. This initial setup supplies receipt notifications only; merchant invitation and password-reset delivery are separate flows.

## Reference contracts

Gmail API MIME sending: https://developers.google.com/workspace/gmail/api/guides/sending

Google Testing refresh-token expiration: https://developers.google.com/identity/protocols/oauth2

SMSGate Local Server: https://github.com/capcom6/android-sms-gateway#local-server

ntfy publishing and access controls: https://docs.ntfy.sh/publish/ and https://docs.ntfy.sh/config/
