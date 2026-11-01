# Notification callback acceptance benchmark

Measured: 2026-11-01T07:36:32.581Z
Source: 8186e32b70bd4aa90318a490b90d89a373655a9a

50 sequential successes and one automatic-retry scenario. Isolated SQLite WAL, HTTP loopback, synthetic signed receiving alerts. No hosted/customer financial data used.

| Metric | p50 (ms) | p95 (ms) | max (ms) |
|---|---:|---:|---:|
| createMs | 12.72 | 16.24 | 30.36 |
| checkoutAndQrMs | 21.33 | 45.81 | 73.67 |
| alertToIngressAckMs | 10.91 | 21.63 | 30.06 |
| alertToCallbackReceivedMs | 11.55 | 22.45 | 32.48 |
| alertToWalletCommittedMs | 12.71 | 25.39 | 34.33 |
| createToWalletCommittedMs | 46.3 | 84.64 | 140.23 |

Automatic retry: 5685.02 ms to wallet credit; 2 callback attempts. First response was synthetic HTTP 503. No retry schedule was manually accelerated.

All signature, Paid/inquiry, ledger/outbox, notification duplicate, consumer duplicate and stable-retry identity assertions passed.

- No real bank transfer, receiving phone, Android app, Gmail consent or bank alert timing
- Not hosted Render/PostgreSQL latency, cold start, concurrent load, owner verification or live settlement acceptance
- Sequential warm-path samples; synthetic notification success is not bank verification
