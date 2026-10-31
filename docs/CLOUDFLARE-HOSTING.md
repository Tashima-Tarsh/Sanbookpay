# Dynamo Pay on Cloudflare

The current repository runs Node.js services with an on-disk SQLite database. It is not yet a deployable Cloudflare Worker. Connecting it to Workers Builds alone will not migrate those services or the database.

## Initial public address

A deployed Worker can use its assigned `workers.dev` address before a custom domain is added. The checkout, merchant login, API and manual can share that origin once the backend has been adapted. The existing `trycloudflare.com` address is a tunnel to the running local services; it does not move those services into Workers hosting.

## Automatic deployment from GitHub

Cloudflare Workers Builds can connect to `Tashima-Tarsh/Sanbookpay` and deploy pushes to `main`. Configure that connection only after a tested Worker entry point, Wrangler configuration and required service bindings exist. Store production secrets in the deployment environment, outside Git. CI tests should pass before a production release.

## Work needed for Cloudflare-only hosting

| Current component | Required adaptation |
| --- | --- |
| Node HTTP servers and local reverse proxy | Worker request routing for the console, checkout and API |
| Local SQLite repositories | Durable persistent storage with tested transaction and concurrency semantics; D1 and Durable Objects are candidate services |
| In-memory console sessions and local credential files | Persistent, merchant-scoped authentication and managed secrets |
| Queue locks, payment timers and callback retries | Durable scheduling and idempotent processing across restarts |
| Gmail polling process | A supported scheduled or event-driven worker design, preserving credit deduplication |
| Android observer | Authenticated submission to the deployed HTTPS endpoint with merchant/account isolation |
| Private credential PDF on local disk | Authenticated document generation or private storage, excluded from public assets |
| Owner-only console | Separate merchant onboarding, logins, credentials and data isolation before customer self-service |

Cloudflare Containers can run more Node.js code, but their default disk is ephemeral. Placing the payment SQLite file there without a persistence design would lose state across container replacement. A container deployment also needs storage, scheduling and recovery tests.

## Release verification

Before inviting merchants, verify durable payment records across deployments, isolated merchant access, receiving-account setup, actual Android/Gmail credit matching, signed callback delivery, duplicate handling and delayed-credit reconciliation. A successful frontend build is not sufficient evidence of a working payment service.

## Official references

- [GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)
- [Workers runtime APIs](https://developers.cloudflare.com/workers/runtime-apis/)
- [Cloudflare Containers storage behaviour](https://developers.cloudflare.com/containers/faq/)

The responsive frontend is compatible with normal desktop and mobile browsers. Cloudflare-only backend deployment and customer self-service onboarding remain separate implementation work.
