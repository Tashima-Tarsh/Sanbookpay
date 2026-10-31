# Credential configuration inventory

Real values belong in the protected owner PDF, existing ignored secret files or the hosting secret manager. This inventory contains names and procedures only. No key is rotated by the release.

| Name | Consumer / configuration | Format / required | Validate |
|---|---|---|---|
| DATABASE_URL | Hosted database adapter; Render secret environment | PostgreSQL URI; required for hosted durability | /_ready plus isolated PostgreSQL acceptance |
| SQLITE_DB_PATH | Local database adapter / private-file directory | Absolute path; local installations only | Migration and foreign-key checks on a copy |
| ENCRYPTION_MASTER_KEY | Merchant/provider encryption | 64 hex characters; preserve the original key | Decrypt an existing encrypted configuration without displaying it |
| JWT_SECRET | Customer/session authentication | Existing random secret; required | Auth/session expiry tests |
| INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD | First console provision | Owner email/password; initial boot only | Console sign-in; persisted hash is authoritative |
| ADMIN_API_TOKEN | Internal operator endpoints and privileged relay | Existing bearer token; secret env or ignored admin_api_token | Authorized 200 and anonymous 401 |
| OBSERVER_API_TOKEN | Gmail/SMS service to API | Existing bearer token; secret env or ignored observer_api_token | Authenticated ingestion with genuine source validation |
| android_enrollment_secret / ANDROID_ENROLLMENT_SECRET | Time-limited device pairing | Random server secret; never a customer API key | Pair a private QR before expiry; reject replay |
| Device signing key | Paired Android device and registered device record | Per-device HMAC key; provisioned at pairing | Sign raw JSON:timestamp for event and heartbeat |
| GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET | Google Web OAuth / selected merchant configuration | Google-issued credentials | Exact callback registration, connect and Test Gmail |
| Gmail refreshToken | Google OAuth; encrypted merchant configuration | Google-issued offline consent token | Refresh access token; reconnect on invalid_grant |
| GMAIL_REDIRECT_URI | Google OAuth callback | Canonical HTTPS origin + /oauth/callback | Exact equality in Google Cloud |
| GMAIL_RECEIVING_ACCOUNT_ID | One inbox's receiving-account binding | Existing receiving-account UUID | Genuine alert attributed only to this account |
| Provider client ID / secret | Approved banking connection, encrypted at rest | Provider-issued; optional until integration activated | Provider sandbox contract and then controlled live confirmation |
| Merchant Client-ID / Client-Secret / Service-Id | Customer backend requests | Existing values from Developer tools | Versioned payment/status request; never expose in frontend |
| Merchant webhook secret | Outgoing callback HMAC | Existing random signing secret | Raw-body HMAC and duplicate delivery tests |
| Internal gateway token | Trusted loopback proxy | Existing ignored internal_service_token or configured secret | External spoofed internal header rejection |
| DYNAMO_ANDROID_KEYSTORE | Native release builder only | Absolute path to original private signing keystore | apksigner verification; install update on test phone |
| DYNAMO_ANDROID_KEYSTORE_PASSWORD / DYNAMO_ANDROID_KEY_ALIAS | Native release signer | Private environment only; never command output | Reuse original identity; test upgrade |
| JAVA_HOME / ANDROID_HOME | Native release compiler | JDK 17 and Android SDK; non-secret | Platform/build tools 34 and native build |
| REDIS credentials | Optional distributed queue deployment | Private URI/password; not required for PostgreSQL callback outbox | Queue reconnect test only if that deployment is enabled |
| SVIX_API_KEY | Optional alternative delivery integration | Provider-issued; not required by native outbox | Separate integration validation before enabling |
| Render API key | Deployment automation only | Hosting-issued private token | Owner/workspace metadata; never app runtime |

## Access and rotation
Only the account owner can download the private credential PDF after signing in. Backups, hosted_files and secret files require the same access restrictions as the database. Public manuals use placeholders. The native Android release manifest contains hashes and build metadata, never its signing password.

Preserve credentials during migration. Rotate merchant API and webhook credentials in coordination with every connected merchant. Encryption-key rotation requires decrypting and re-encrypting stored values in a tested migration; replacing the environment value alone can lock out existing configuration. Revoke a lost device and pair a replacement instead of sharing its signing key. Reconnect Gmail after Google consent revocation. Back up before every rotation and verify rollback on a separate database.

## Validation and evidence
Run node scripts/scan-secrets.js before commit and in CI. Install the versioned local hook with git config core.hooksPath .githooks; this workspace has it enabled. The scan finds common high-confidence credential formats; it is not a historical security certification. A live bank/provider configuration and a signed native Android build remain owner-supplied acceptance gates. Existing published defaults or old history should be investigated before production rotation; do not silently invalidate working credentials.
