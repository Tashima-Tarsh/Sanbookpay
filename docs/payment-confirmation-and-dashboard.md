> Historical reference: use the [current operations manual](OPERATIONS-MANUAL.md) and [acceptance report](PRODUCTION_ACCEPTANCE_REPORT.md) for this review candidate. Older capability, hosting and automatic-verification statements below are not the current release contract.

# Payment confirmation and dashboard update

## What changed

Provider collection callbacks and provider status recovery now share one confirmation path. Dynamo Pay validates the amount, currency and provider payment reference before saving success. The order, linked checkout status, double-entry journal and outgoing callback queue commit in a single database transaction. An error rolls the whole transaction back so the provider can retry.

Repeated confirmation of the same payment does not create another journal entry or provider callback. Reusing a provider payment reference for another order is rejected. A late failed attempt cannot replace an order that has already succeeded. A different successful provider payment on an already paid order requires reconciliation.

Outgoing merchant callbacks are saved before delivery. Failed requests retain their delivery ID and payload across retries and restarts. Delivery stops after five attempts. Callbacks are delivered at least once; merchants must deduplicate by delivery ID and order ID. Shutdown cancels unfinished callback requests before closing the database.

Receipts use the Dynamo Pay name, escape customer-supplied text and remain available after restart. Missing bank references and contact details stay empty. Email/SMS delivery is shown as **not configured** because this service generates receipts without an external receipt delivery provider. A COD acknowledgement says that cash is due on delivery. Pending and failed payments do not receive a successful-payment receipt.

## Dashboard

The existing desktop and mobile design is preserved. A protected, merchant-scoped event stream prompts the console to fetch current records. Multiple events are combined into one refresh. A reconnect fetches current data, and a 20-second polling fallback remains available. Streams close when the tab is hidden or the merchant signs out. No administrator token is placed in the browser URL.

The overview now shows delivered, retrying and exhausted callbacks, unmatched bank observations, and measured provider confirmation timing. Timing covers order creation to provider confirmation; it includes the customer's time to pay and is not a bank-to-dashboard latency measurement. Transaction details identify provider, bank observer and merchant confirmations separately. Collection charts use confirmation time when available.

## Validation

- Full repository regression runner, including confirmation rollback, duplicate callbacks, signature rejection, amount/currency validation, status recovery, durable receipts and callback shutdown.
- Managed PostgreSQL acceptance checks in a separate temporary schema: nested rollback, journal idempotency, atomic provider confirmation, durable callback creation, direct UPI queueing and synthetic bank-observation matching. The temporary schema is removed afterwards.
- Rendered desktop (1440px) and mobile (390px) checks across all ten console pages: one active view, successful API loads, connected live stream, no horizontal overflow and no browser exceptions. Screenshots and results are in `output/dashboard-review/`.

No real bank transfer is performed by these tests. They do not establish a maximum UPI capacity, a guaranteed confirmation delay, or failure-free operation. Approved live provider credentials, Android device delivery and Gmail delivery require separate end-to-end verification. Observer-based success and merchant-confirmed history retain their existing behaviour; neither is relabelled as provider settlement.

## Deployment

Schema changes add receipt storage, provider reference claims and a provider callback queue. Existing payment rows are retained. The hosted service applies these additions on startup. There is no new paid infrastructure or dependency in this change. Render Free can still sleep while idle; the console stream is open only for a visible signed-in user.
