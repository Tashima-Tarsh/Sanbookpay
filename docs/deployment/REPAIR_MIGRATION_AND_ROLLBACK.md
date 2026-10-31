# Security repair migration and rollback

Baseline: GitHub main c5cbae88139240a18a840662408d91af6f6d8fa7; existing Render service dynamo-pay, Free, Singapore, health path /_ready. Preserve DATABASE_URL, encryption master key, JWT/internal keys and private files. Never reset or reseed financial records.

Schema additions are idempotent CREATE TABLE IF NOT EXISTS: pp_mfa_recovery, pp_payment_attempts, pp_provider_events and pp_wallet_fulfillments. They store hashed recovery codes, original provider-route snapshots, encrypted verified events and unique financial fulfillment claims. Existing orders, attempts, ledger, wallet history and old super_admin tables remain intact. No fixed administrator seed is created.

The standalone superadmin implementation is replaced with aliases to the working platform identity/session/MFA APIs; /super-admin redirects to /platform. Old bearer superadmin sessions and the public default account cannot authorize operations. Preserve the existing private owner console credentials and use Manage merchants to enter the platform workspace. Test owner MFA before rollout.

New collection creation migrates from the legacy administrator /api/v1/collections endpoint to scoped /v1/payments in production. Historical inquiry remains available. Payment-link creation uses the same canonical policy and requires a stable Idempotency-Key. Unsafe per-session receiving-account rewrites are rejected. Unknown generic provider adapters fail closed.

Before production rollout take a consistent private database backup, test restore in a separate database, verify schema/counts/balances/keys, complete PostgreSQL acceptance and ensure always-on callback hosting. None of those external operational steps is implied by a green JavaScript regression run.

An application rollback leaves additive tables intact. Do not drop their evidence or reverse real financial entries. Reverting to c5cbae8 re-exposes known unsigned callback/default-auth/wallet defects; it is not an acceptable unattended security rollback. If a release fails, retain a safe build or restrict traffic while repairing forward. Provider side effects and database state are not rolled back by Render.

Render remains Free. The attached requirement forbids unreliable sleeping callback infrastructure. No paid upgrade or secret/configuration change has been made. The owner explicitly authorized an interim safety/UI deployment to this existing Free service for customer testing. Full financial production approval stays blocked until the hosting and provider gates are met.
