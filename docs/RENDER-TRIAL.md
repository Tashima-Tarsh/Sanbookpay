# Dynamo Pay: free Render trial

The hosted launcher runs the payment API, checkout, merchant console and Gmail observer in one Node.js service. Only the public gateway binds to Render's public port. The internal services stay on loopback.

## Storage and credentials

Set `DATABASE_URL` to the private connection string of the managed Postgres database. The existing synchronous repository interface uses a dedicated Postgres I/O worker, retaining transaction boundaries. SQLite remains available for existing local installations and tests.

Run `scripts/migrate-to-postgres.js` with a privately supplied `MIGRATION_DATABASE_URL` before first hosted startup. It creates a consistent local SQLite backup, refuses an occupied target, orders foreign-key dependencies, imports rows transactionally and checks every table's row count. Private service configuration is stored in the database's `hosted_files` table and restored before services resolve their secrets. Render API credentials are excluded from migration.

Configure the original encryption key and JWT secret privately in Render. Preserve encryption keys when moving an existing database; generating a different key can make stored credentials unreadable. Do not put keys or connection strings in Git.

## Stable URL and GitHub deployment

Render assigns an `onrender.com` address to the web service. `DYNAMO_PUBLIC_URL` can override it when a custom domain is connected. Otherwise, the launcher uses `RENDER_EXTERNAL_URL` for checkout links and the Gmail OAuth callback. Use `npm run start:hosted` as the start command and `/_ready` for the startup health check. Autodeploy uses passing GitHub checks.

## Limits of the free trial

- The web service sleeps after 15 minutes without inbound traffic. Waking normally takes about a minute. Gmail polling and other in-process work do not run while it sleeps.
- Local files are temporary. Payment records and imported secrets live in Postgres and survive web-service restarts.
- The free Postgres database expires 30 days after creation. Export a backup and upgrade or migrate before expiry. Do not treat it as permanent hosting.
- Free hours and bandwidth are shared with other services in the workspace. No always-on availability, immediate bank confirmation or production SLA is promised.
- Use the 15-day period for controlled pilot testing. Real receipts must be reconciled against the bank. The bank/provider must permit the merchant's activity.

## Observer cutover

Update Android observer pairing to the new hosted HTTPS gateway. Update the Google OAuth redirect URI to `https://<assigned-host>/oauth/callback`, then reconnect and test Gmail. Old laptop URLs do not become permanent server addresses. Confirm one controlled real credit, dashboard update and signed callback after switching observers.

## Verification

Run `npm run typecheck`, `npm run build`, and `npm test`. To exercise the managed database in an isolated temporary schema, privately set `DYNAMO_POSTGRES_TEST_URL` and run `node --test scripts/postgres-acceptance.test.js`. The schema is dropped after the test; it does not overwrite merchant records. Test payment creation, idempotency, queueing, synthetic credit matching, status, wallet and transaction rollback.
