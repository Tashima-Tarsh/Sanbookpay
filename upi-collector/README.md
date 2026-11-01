# UPI Collector

Free, open-source UPI collection-notification backend. No paid services, no cloud DB, no Firebase, no Twilio.

## Stack

- **Express** + **sqlite3** (SQLite file on disk)
- **Email**: Gmail API OAuth2 via nodemailer, scope `gmail.send` ONLY — works with ANY Gmail ID
- **SMS send**: android-sms-gateway (https://github.com/capcom6/android-sms-gateway) — works with ANY phone, no paid gateway
- **SMS/notification detect on phone**: SmsForwarder (https://github.com/pppscn/SmsForwarder), fallback NotificationForwarder (https://github.com/ItsAzni/NotificationForwarder)
- **Push**: ntfy (https://github.com/binwiederhier/ntfy, public ntfy.sh)
- **Crypto**: Node `crypto` for HMAC. No ORM, no TypeScript, no Docker.

## Repo layout

```
upi-collector/
├── src/server.js        express app, boots on PORT from .env
├── src/db.js            sqlite schema + migrations, WAL mode
├── src/verify.js        device-key + HMAC verification middleware
├── src/parse.js         bank SMS parser (sender allowlist + per-bank regex)
├── src/notify.js        ntfy POST + gmail send + sms send, universal adapters
├── src/reconcile.js     CSV statement import + match job
├── src/routes/upi.js    POST /api/v1/upi/notify
├── src/routes/orders.js POST/GET orders, POST /orders/:id/close
├── src/routes/admin.js  GET unmatched, POST match, GET health
├── scripts/gmail-auth.js    one-time OAuth2 consent -> prints refresh token
├── scripts/gen-secrets.ps1  generate DEVICE_KEY and WH_SECRET
├── scripts/bootstrap.ps1    full install
├── scripts/test-webhook.ps1 curl.exe test battery
├── scripts/heartbeat.ps1    poll /api/v1/health, alert via ntfy if stale >10min
├── test/seed.js             create fake orders for testing
├── .env.example
├── .gitignore
└── README.md
```

## Universal adapters (no per-user code changes)

### Gmail — any Gmail ID works

Each merchant runs `npm run gmail-auth` **once**:

1. Creates a Google Cloud project, enables Gmail API
2. OAuth consent screen in **Testing** mode, adds their own email as test user
3. Runs `npm run gmail-auth` → opens consent URL → signs in → authorizes → prints refresh token
4. Puts `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_FROM` in `.env`

After that, email works for that Gmail forever. No code changes, no per-merchant setup in code.

### SMS — any phone works, no paid gateway

1. Install **android-sms-gateway** APK on your own Android phone
2. The app exposes a local HTTP API on port 9090
3. Set `SMS_GATEWAY_URL=http://<phone-lan-ip>:9090` in `.env`
4. SMS sends through your own SIM — free, no API key, no Twilio

### ntfy push — free, self-hostable later

Set `NTFY_TOPIC=your-topic` in `.env`. Uses public ntfy.sh by default.

## Endpoint contract

### POST /api/v1/upi/notify
Headers: `x-device-key`, `x-sig` (hex HMAC-SHA256 of the RAW body with `WH_SECRET`)
Body: `{ "sender":"HDFCBK", "body":"<raw sms>", "ts":"<iso8601>", "device_id":"..." }`

Order of checks:
1. `x-device-key` constant-time compare → 401
2. HMAC constant-time compare → 401
3. sender against allowlist (`HDFCBK ICICIB AXISBK SBIINB KOTAKB IDBIBK YESBNK`) → 422 `sender_not_allowed`
4. parse amount (decimal, 2dp) + UTR (12-digit) + VPA. Unparseable → store as `unparsed`, 200, no fulfil
5. respond `200 {"status":"accepted"}` in under 3s, then process on async queue
6. queue: UTR unique index → duplicate is dropped and logged, not errored
7. match UTR to open order where amount equals exactly and order created within last 30 min → `paid_sms`. No match → `unmatched`
8. always persist RAW body and raw sender

`paid` requires `statement_verified` set by reconcile job. `paid_sms` and `paid_verified` are separate columns.

### POST /api/v1/orders
Body: `{ order_id, amount, payer_email, payer_phone }`
Returns: `{ id, order_id, amount, currency, upi_note, status, upi_uri }`

### GET /api/v1/admin/unmatched
Returns pending unmatched SMS events with raw bodies.

### POST /api/v1/admin/match
Body: `{ unmatched_id, order_id }` — manual resolve.

### GET /api/v1/health
Returns `{ ok, last_sms_at, queue_depth }`.

## Security

- `crypto.timingSafeEqual` everywhere, never `===` on secrets
- `express.raw({ type: '*/*' })` on notify route so HMAC sees bytes
- helmet, express-rate-limit (60/min notify, 10/min admin), 64KB body cap
- `.env` in `.gitignore`; secrets from `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- HMAC of body only (timestamp not included), but `ts` older than 5 min is rejected

## Phone-side setup (do not execute here)

Sideload APK — Play Store restricts READ_SMS to default-SMS apps:

```
adb install SmsForwarder.apk
adb shell cmd notification allow_listener com.pppscn.smsforwarder/.service.NotificationService
adb shell dumpsys deviceidle whitelist +com.pppscn.smsforwarder
adb shell cmd appops set com.pppscn.smsforwarder RUN_IN_BACKGROUND allow
```

Rule config:
- Match sender allowlist
- Regex for amount: `(?:Rs\.?|INR)\s?([\d,]+\.\d{2})`
- Regex for UTR: `\b(\d{12})\b`
- Forward to Webhook, URL: `http://<LAN-IP>:3000/api/v1/upi/notify`
- POST JSON, custom headers `x-device-key` and `x-sig` (computed by app's JS transform)
- Put phone on charger, battery optimisation off

> A dead phone silently stops all collection.

## Gmail OAuth2

```
npm run gmail-auth
```

Runs a loopback listener on 127.0.0.1:4242, prints consent URL, captures code, exchanges it, prints refresh token. Writes nothing to disk.

Prerequisites:
1. Create a Google Cloud project
2. Enable Gmail API
3. OAuth consent screen in **Testing** mode
4. Add your own address as a **test user** (avoids verification)
5. Scope: `https://www.googleapis.com/auth/gmail.send` only

## Test battery

```
npm run test-webhook
```

Uses `curl.exe` (not Invoke-WebRequest). 7 cases, all must PASS.

## Running

```
npm install
# copy .env.example to .env, fill in DEVICE_KEY, WH_SECRET, NTFY_TOPIC, GMAIL_*, SMS_GATEWAY_URL
npm run dev
```

## Importing a statement CSV

```
POST /api/v1/admin/reconcile
```

Runs the nightly reconcile job manually. Imports CSV from `data/statements/` and matches UTR+amount against open orders.

## Not yet done

- Current-account migration (virtual accounts, bank H2H APIs)
- Virtual accounts (per-merchant VPA assignment)
- 2-hour IMPS sweep
