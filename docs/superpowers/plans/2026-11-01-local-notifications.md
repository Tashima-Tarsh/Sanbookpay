# Local Notifications Implementation Plan

> Execute inline using superpowers:executing-plans, with failing tests before implementation.

**Goal:** Durable outgoing receipt notifications through ntfy, Gmail API and a local Android SMS gateway.
**Architecture:** Receipt generation atomically reserves encrypted channel jobs. A leased worker submits them independently of payment processing. OAuth credentials remain in ignored private storage.
**Tech Stack:** Node.js 22.13+, existing googleapis, SQLite/PostgreSQL adapter, node:test.
**Spec:** ../specs/2026-11-01-local-notifications-design.md

## Constraints and review focus

Preserve current data, credentials, UI and financial verification. No production deployment. No invented delivery receipts. Test missing recipients, permanent HTTP failures, restart/lease recovery, duplicate receipt generation and OAuth state rejection. External account/device acceptance is separate.

## Tasks

- [x] Add failing isolated notification tests for channel contracts, durable retries, encrypted recipients and receipt integration; run them and confirm failure.
- [x] Add `notification-delivery.service.js`: configured channels, encrypted job reservation, leased bounded retries, redacted errors, Gmail MIME send, ntfy generic alert, authenticated SMSGate local POST /message. Connect receipt creation and API worker lifecycle. Run tests.
- [x] Add root `gmail-auth` and `notifications:setup`/`notifications:test` commands, private OAuth storage, state-checked loopback consent and owner-only explicit test delivery. Test OAuth callbacks and setup without external sends.
- [x] Document environment variables, Android installation/local server and Gmail consent. Prepare missing local configuration without replacing secrets. Run typecheck, build, secret scan and npm test; report actual external blockers.

User approved implementation in the current IDE checkout; execution stays inline and preserves unrelated changes.

## Verification

All 62 suites in the full regression run passed (output/testing/local-notifications-regression.log). Subsequent focused coverage passed all 12 tests, including the newly added CLI suite (output/testing/local-notifications-focused.log). Typecheck and runtime build passed; tracked and new feature files passed secret-pattern checks. The public operations PDF was regenerated, rendered for review, and checked against configured private values.

Independent review findings were fixed and covered: canonical Indian phone numbers, internal placeholder email addresses, missing CLI receipt schema, and falsely successful CLI output when a requested channel was skipped. Shutdown, lease recovery, retry bounds and transaction rollback have isolated coverage.

Local setup added only missing notification settings and generated a random topic; existing keys were preserved. Gmail consent and actual phone configuration are still required. No real messages, native phone acceptance, production deployment or new live PostgreSQL acceptance were performed. Current hosted commit could not be revalidated through the public health endpoints; existing hosted evidence remains historical.
