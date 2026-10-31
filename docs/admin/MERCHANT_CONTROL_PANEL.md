# Merchant Control Panel

When the Platform Owner opens a merchant profile, a comprehensive control panel is displayed with the following tabs.

## A. Overview

Shows: Merchant ID, name, owner, account status, registration date, active users, enabled features, payment volume, success rate, pending payments, failed payments, connected banks, approved VPAs, webhook health, risk flags, pricing plan.

## B. Account Control

Authorized actions: activate, suspend, reactivate merchant; disable new payment creation; disable API access; revoke active sessions; require MFA enrollment; restrict payment methods; apply transaction limits; change feature entitlements.

All sensitive actions require reason codes and audit logs.

## C. User & Login Control

View merchant users, invite users, deactivate users, reset authentication enrollment, revoke sessions, assign roles, review login activity, enforce MFA. Passwords are never viewable.

## D. Bank & UPI Control

Review connected receiving accounts, approve new bank connections, approve receiving VPAs, enable/disable routes, configure primary/backup routes, set route limits, review connection health, review route failover events.

## E. Payment Control

View merchant payment links, orders and attempts; configure amount limits, expiry, payment methods; pause new checkout creation; investigate payment status. Arbitrary force-success is not permitted.

## F. API Control

View API key metadata, revoke keys, rotate keys, configure scopes, configure quotas, review API logs, control production access.

## G. Webhook Control

View registered callback URLs, review signing configuration, inspect deliveries, retry failed events, review delivery failures, suspend unsafe endpoints.

## H. Financial Control

View transaction ledger, reconciliation, settlement reports, refunds, reversals, merchant fees, approve controlled financial adjustments.

## I. Security Control

View audit logs, review suspicious activity, review access events, enforce account restrictions, manage security incidents.

All access is authorized, logged, and tenant-aware.