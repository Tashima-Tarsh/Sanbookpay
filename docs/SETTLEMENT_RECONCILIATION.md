> Historical reference: use the [current operations manual](OPERATIONS-MANUAL.md) and [acceptance report](PRODUCTION_ACCEPTANCE_REPORT.md) for this review candidate. Older capability, hosting and automatic-verification statements below are not the current release contract.

# Sanbook Pay — Settlement & Double-Entry Reconciliation Guide

## 1. Overview

Sanbook Pay implements strict, production-grade financial accounting:
- **All monetary calculations use integer paise**: Floating point arithmetic is forbidden.
- **Double-Entry Journal Balancing**: Every transaction records balanced debit and credit entries (`sum(debits) === sum(credits)`).
- **Three-Way Automated Reconciliation**:
  1. Internal Sanbook Pay Payment Orders
  2. Upstream Banking / Provider Records (Cashfree Settlement Batches)
  3. Bank Statement Credit UTRs & Timestamps

---

## 2. Standard Chart of Accounts

Sanbook Pay seeds a standard financial chart of accounts for every merchant:

| Account Number | Account Name | Type | Normal Balance | Description |
| :--- | :--- | :--- | :--- | :--- |
| `1010` | Operating Bank Account | Asset | Debit | Merchant's primary current account |
| `1020` | Node Payment Ingress Escrow | Asset | Debit | Funds held in transit by payment provider |
| `1030` | Payout Clearing Escrow | Asset | Debit | Outbound funds reserved for disbursements |
| `1040` | Undeposited UPI Collections | Asset | Debit | Collections confirmed but not yet settled to bank |
| `2010` | Merchant Payable | Liability | Credit | Net funds owed to merchant |
| `2020` | Refund Reserve Payable | Liability | Credit | Funds held to satisfy customer refunds |
| `4010` | Processing Fee Revenue | Revenue | Credit | Gateway markup & platform transaction fees |
| `5010` | Provider Gateway Fees | Expense | Debit | Upstream interchange and provider charges |
| `5020` | Banking Charges & IMPS Fees | Expense | Debit | Bank rail charges for payouts |
| `5030` | Settlement Variances | Expense | Debit | Rounding or discrepancy adjustments |

---

## 3. Double-Entry Lifecycle Examples

### A. Customer Pays ₹1,000 via UPI
When a collection reaches `SUCCESS`:
```
Debit:  1040 Undeposited UPI Collections (Asset)    ₹1,000.00 (100,000 paise)
Credit: 2010 Merchant Payable (Liability)           ₹1,000.00 (100,000 paise)
```

### B. Upstream Provider Deducts 2% Fee (₹20) & Settles ₹980 to Bank
When provider settlement batch completes:
```
Debit:  1010 Operating Bank Account (Asset)           ₹980.00  (98,000 paise)
Debit:  5010 Provider Gateway Fees (Expense)           ₹20.00   (2,000 paise)
Credit: 1040 Undeposited UPI Collections (Asset)    ₹1,000.00 (100,000 paise)
```

### C. Merchant Issues Payout of ₹500
```
Debit:  2010 Merchant Payable (Liability)             ₹500.00  (50,000 paise)
Credit: 1010 Operating Bank Account (Asset)           ₹500.00  (50,000 paise)
```

---

## 4. Automated Reconciliation API & Reporting

- **Summary Endpoint**: `GET /api/v1/settlements/overview`
  - Returns `grossCollections`, `netPayable`, `confirmedBankCredit`, `pendingSettlement`.
- **Reconciliation Runs**: `GET /api/v1/settlements/reconciliation/runs`
  - Lists automated audit passes with matched counts, discrepancies, and status (`BALANCED` / `VARIANCE_DETECTED`).
- **Exceptions List**: `GET /api/v1/settlements/reconciliation/exceptions`
  - Surfaces unmatched bank credits, timing offsets, or amount variances.
- **CSV Download**: `GET /api/v1/settlements/reports/reconciliation.csv`
  - Authoritative financial export for auditors and accountants.

