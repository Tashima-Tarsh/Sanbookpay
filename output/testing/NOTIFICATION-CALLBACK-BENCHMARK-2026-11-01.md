# Notification callback acceptance benchmark

Measured: 2026-11-01T07:46:33.014Z
Source: 8edffa388ab9bcc287bf6fddfc17149c464959c5

50 sequential successes and one automatic-retry scenario. Isolated SQLite WAL, HTTP loopback, synthetic signed receiving alerts. No hosted/customer financial data used.

| Metric | p50 (ms) | p95 (ms) | max (ms) |
|---|---:|---:|---:|
| createMs | 12.77 | 14.59 | 24.66 |
| checkoutAndQrMs | 20.5 | 36.01 | 59.32 |
| alertToIngressAckMs | 10.84 | 13.09 | 25.93 |
| alertToCallbackReceivedMs | 11.42 | 13.83 | 27.36 |
| alertToWalletCommittedMs | 12.84 | 15.06 | 28.73 |
| createToWalletCommittedMs | 46.85 | 63.11 | 116.97 |

Automatic retry: 5981.99 ms to wallet credit; 2 callback attempts. First response was synthetic HTTP 503. No retry schedule was manually accelerated.

All signature, Paid/inquiry, ledger/outbox, notification duplicate, consumer duplicate and stable-retry identity assertions passed.

- No real bank transfer, receiving phone, Android app, Gmail consent or bank alert timing
- Not hosted Render/PostgreSQL latency, cold start, concurrent load, owner verification or live settlement acceptance
- Sequential warm-path samples; synthetic notification success is not bank verification
