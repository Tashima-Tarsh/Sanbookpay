Dynamo Pay

Test report
&amp; merchant FAQ

31 October 2026 • Local verification edition

A practical account of what was checked, what was fixed, and how the payment queue behaves. Read this alongside the Dynamo Pay Integration Manual for request examples and callback signing.

Executed check | Result

42 automated suites / 332 tests | PASS

183 registered API routes; anonymous / invalid-input smoke | PASS — no 5xx or transport failures

Capacity and data-integrity assertions | PASS

Real bank, phone app and external OAuth acceptance | Not executed in this environment

All executed automated checks passed. This is an engineering test result for the stated environment, rather than a bank certification or a production availability guarantee.

Fixes and regression coverage

Financial operations now require administrator access

Legacy ledger, settlement, split-settlement, payout and reconciliation routes accepted anonymous requests. Those internal financial routes now require the administrator token. Missing credentials and observer-only credentials are rejected. Customer integrations use their own credentials on the /v1.0 endpoints; never share the administrator token with a customer.

Rate limiting follows the visitor through the local gateway

The API previously grouped proxied visitors under the loopback address. It now accepts Cloudflare visitor IPs only from a loopback proxy carrying the internal service token. Direct callers cannot choose another IP by adding forwarding headers. Regression tests cover spoofed headers, independent IP windows, 429 responses and Retry-After.

Payment confirmation stays tied to evidence

A customer clicking Payment done or typing a UTR does not prove receipt. Missing confirmation stays pending for reconciliation. A matching saved bank observation can complete the payment later. Tests cover delayed credits, incorrect references, ambiguous equal-amount credits and protecting newer orders from an older merchant-confirmed receipt.

Callbacks recover predictably

The callback failure matrix exercises HTTP 400, 429 and 500 followed by recovery, connection refusal, signature consistency and stopping after five attempts. A background worker retries due deliveries. A timeout or callback failure does not reverse an already confirmed bank credit.

Measured capacity

The measurements below used an isolated SQLite database on this laptop. No money moved and no production transaction was created by these tests.

Question | Observed result

How many receiving UPIs were stored? | 1,001 for one merchant; one selected as active.

How many requests arrived together? | 200 unique orders at concurrency 25; all accepted.

How were they scheduled? | 1 active checkout and 199 queued. Queued orders had no payable QR or intent.

What happened on duplicate requests? | 50 concurrent repeats returned one transaction.

Did the queue complete? | 200 synthetic bank confirmations; no queued orders remained.

Can separate merchants work in parallel? | 10 active checkouts across 10 merchants; 10 matched confirmations and no cross-merchant attribution.

Was the database consistent? | Foreign-key check: PASS.

The short order-creation burst measured 244.79 requests/second, with p50 92 ms, p95 149 ms and p99 157 ms. The benchmark raised its own rate limit to 10,000; that does not change the deployed limit.

Duplicate-request handling and queue completion checks were successful. Capacity figures reflect a local test using simulated bank confirmations. See the saved technical results for the complete test conditions.

Rate limits, callbacks and fallback

How many requests per minute can one IP send?

The configured default is 1,000 API requests per IP in a 60-second fixed window. Request 1,001 receives HTTP 429 and Retry-After. Status polling shares that budget. Health endpoints and paths beginning /events bypass this limiter. Counters are in memory for each process and reset on restart; a multi-process deployment needs a shared limiter.

Does that mean 1,000 successful UPI payments per minute?

No. Request allowance and completed payments measure different things. Real completion depends on the payer, bank, active checkout slot and arrival of a valid receiving-bank observation. The present tests establish scheduling and reconciliation behaviour, not a bank-confirmed payments-per-second maximum.

What should the customer server do when a request fails?

Keep the same unique order ID when retrying an uncertain creation response. Back off on 429 and honour Retry-After. Query status before starting a replacement payment. A repeated ID with a changed amount is rejected. Do not interpret a creation HTTP 200/201 as payment received.

How are webhooks delivered?

Dynamo Pay signs the raw JSON body with HMAC-SHA256. Verify the signature, merchant, order, amount and currency before fulfilling. Return a successful 2xx acknowledgement promptly and deduplicate delivery IDs. Delivery is attempted up to five times in total; retry delays are 5 seconds, 30 seconds, 2 minutes and 10 minutes, with the worker checking due work about every 5 seconds. Exhausted deliveries require operational review and status reconciliation.

What happens when an observer or network is unavailable?

Unverified UPI payments stay pending for reconciliation; they are not automatically counted as paid. The test suite covers queue/timer recovery and observation matching. Redis fallback is covered by infrastructure checks; this single-laptop run does not certify a distributed deployment. Restore the observer, compare the bank reference, amount and receiving account, and reconcile unresolved records.

Merchant questions

Can I add more than one UPI?

Yes. Storage was tested with 1,001 accounts for one merchant. There is no certified maximum from this run. Normal routing selects one active receiving account per merchant and one active session per account. Additional stored accounts do not create automatic round-robin capacity; account switching is not a tested load-balancing strategy.

Can I turn UPI off and set my own limits?

Yes. The saved channel has an enable/disable switch, a ₹200 minimum, a ₹20,000 maximum and a receiving-VPA allowlist. Tests exercise disabled channels, both amount boundaries and a blocked beneficiary. The allowlist controls the receiving UPI address, rather than the customer’s payer app.

Will GPay open immediately?

Checkout exposes a UPI intent and QR. A supported phone can launch an installed payment app from the customer’s action. Browser policies, installed apps and bank support decide whether handoff succeeds. A laptop can display the QR; a physical mobile handoff was not tested here.

Will Gmail or Android SMS mark a payment paid?

A connected observer submits bank-credit evidence for matching. A customer claim alone does not settle it. Gmail requires Google OAuth credentials and consent; the Android observer needs the receiving phone configured and allowed to deliver messages. Local parsers and matching flows passed; actual mailbox consent and phone delivery remain deployment checks.

Does a refund request send money back?

A refund request records an operational request. It must not be described as a bank-completed refund without an actual refund rail and confirmation. Likewise, split rules and accounting entries do not prove bank payouts to beneficiaries.

Is the wallet my bank balance?

No. Wallet fields represent Dynamo Pay accounting balances. Direct UPI credits do not establish a live bank-wallet balance. IFSC directory lookup is bank metadata, not account ownership verification.

Evidence and repeatable checks

Area | Evidence / command

Full automated regression | node scripts/test-all.js

Registered-route inventory | node scripts/test-route-inventory.mjs

Isolated capacity / idempotency / queue | node scripts/test-capacity.mjs

Saved machine-readable results | output/testing/*-results.json

Full route list and response codes | output/testing/route-test-results.csv

Customer request and signature examples | Dynamo-Pay-Integration-Manual.pdf

Environment: v24.14.1, Windows, 11th Gen Intel(R) Core(TM) i5-1145G7 @ 2.60GHz, 8 logical CPUs, 16 GiB RAM. Capacity transport was HTTP loopback with isolated on-disk SQLite WAL. Test execution time: 130.93 seconds for the regression runner.

What the route inventory means

Each of the 183 registered API routes was called once using anonymous credentials, an empty request body or a nonexistent ID. No duplicate registration, server error or timeout was found. Rejections such as 400, 401, 403 and 404 are expected successes for these negative checks. This smoke sweep does not claim a successful business transaction on every endpoint. The separate regression suites exercise supported business paths.

What remains to prove in the deployment

Run a controlled real receiving-bank credit, actual phone-app handoff, Gmail consent and bank-message delivery, and verify signed callback receipt on the customer server. External provider settlement, refund and payout execution need a configured rail. Long-duration load, bank throughput, Cloudflare performance, failover and multi-process scaling were not established by this local run.

Keep the supplied JSON and CSV alongside this report. Re-run the commands after payment-routing or authentication changes; results describe this tested revision and environment only.