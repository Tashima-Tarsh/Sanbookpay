import crypto from 'node:crypto';

/**
 * Double-Entry Financial Ledger Repository
 * Strictly uses integer paise to eliminate floating point rounding errors.
 * Enforces debit == credit balance within atomic transactions.
 */
export class LedgerRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Standard accounts for merchant financial ledger
   */
  static STANDARD_ACCOUNTS = [
    { code: 'MERCHANT_RECEIVABLES', name: 'Merchant Receivables', type: 'ASSET' },
    { code: 'PROVIDER_CLEARING', name: 'Provider Clearing Account', type: 'ASSET' },
    { code: 'SETTLEMENT_RECEIVABLE', name: 'Settlement Receivable Account', type: 'ASSET' },
    { code: 'BANK_CASH', name: 'Settled Bank Cash', type: 'ASSET' },
    { code: 'PAYOUT_FUNDING', name: 'Payout Funding Account', type: 'ASSET' },
    { code: 'PAYOUTS_IN_TRANSIT', name: 'Payouts In Transit', type: 'LIABILITY' },
    { code: 'FEES', name: 'Processing & Gateway Fees', type: 'EXPENSE' },
    { code: 'REFUND_LIABILITIES', name: 'Customer Refund Liabilities', type: 'LIABILITY' },
    { code: 'ADJUSTMENTS', name: 'Reconciliation Adjustments', type: 'EQUITY' },
    { code: 'REVERSALS', name: 'Payment Reversals & Chargebacks', type: 'EXPENSE' }
  ];

  /**
   * Ensures standard double-entry ledger accounts exist for the merchant.
   */
  ensureAccounts(merchantId) {
    for (const acc of LedgerRepository.STANDARD_ACCOUNTS) {
      const existing = this.getAccount(merchantId, acc.code);
      if (!existing) {
        const id = crypto.randomUUID();
        const sql = `
          INSERT INTO ledger_accounts (id, merchant_id, account_code, account_name, account_type, currency, balance_paise)
          VALUES ($1, $2, $3, $4, $5, 'INR', 0)
        `;
        this.db.execute(sql, [id, merchantId, acc.code, acc.name, acc.type]);
      }
    }
  }

  getAccount(merchantId, accountCode) {
    return this.db.queryOne(
      `SELECT * FROM ledger_accounts WHERE merchant_id = $1 AND account_code = $2`,
      [merchantId, accountCode]
    );
  }

  listAccounts(merchantId) {
    this.ensureAccounts(merchantId);
    return this.db.query(
      `SELECT * FROM ledger_accounts WHERE merchant_id = $1 ORDER BY account_code ASC`,
      [merchantId]
    );
  }

  /**
   * Records a double-entry transaction atomically: debit one account, credit another account.
   * Debit increases ASSET / EXPENSE, decreases LIABILITY / REVENUE / EQUITY.
   * Credit increases LIABILITY / REVENUE / EQUITY, decreases ASSET / EXPENSE.
   */
  recordDoubleEntry(merchantId, referenceType, referenceId, narration, debitAccountCode, creditAccountCode, amountPaise) {
    if (!amountPaise || amountPaise <= 0) {
      throw new Error(`Invalid ledger entry amount: ${amountPaise}. Must be positive integer paise.`);
    }

    this.ensureAccounts(merchantId);
    const debitAcc = this.getAccount(merchantId, debitAccountCode);
    const creditAcc = this.getAccount(merchantId, creditAccountCode);

    if (!debitAcc) throw new Error(`Debit ledger account ${debitAccountCode} not found for merchant ${merchantId}`);
    if (!creditAcc) throw new Error(`Credit ledger account ${creditAccountCode} not found for merchant ${merchantId}`);

    return this.db.transaction(() => {
      const txId = crypto.randomUUID();
      const insertTxSql = `
        INSERT INTO ledger_transactions (id, merchant_id, reference_type, reference_id, narration, status)
        VALUES ($1, $2, $3, $4, $5, 'POSTED')
      `;
      this.db.execute(insertTxSql, [txId, merchantId, referenceType, referenceId, narration]);

      // 1. Debit entry
      const debitEntryId = crypto.randomUUID();
      this.db.execute(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, direction, amount_paise) VALUES ($1, $2, $3, 'DEBIT', $4)`,
        [debitEntryId, txId, debitAcc.id, amountPaise]
      );

      // Update debit account balance (Asset/Expense increases on debit, others decrease)
      const debitMultiplier = (debitAcc.account_type === 'ASSET' || debitAcc.account_type === 'EXPENSE') ? 1 : -1;
      this.db.execute(
        `UPDATE ledger_accounts SET balance_paise = balance_paise + $1, updated_at = datetime('now') WHERE id = $2`,
        [amountPaise * debitMultiplier, debitAcc.id]
      );

      // 2. Credit entry
      const creditEntryId = crypto.randomUUID();
      this.db.execute(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, direction, amount_paise) VALUES ($1, $2, $3, 'CREDIT', $4)`,
        [creditEntryId, txId, creditAcc.id, amountPaise]
      );

      // Update credit account balance (Liability/Revenue/Equity increases on credit, others decrease)
      const creditMultiplier = (creditAcc.account_type === 'LIABILITY' || creditAcc.account_type === 'REVENUE' || creditAcc.account_type === 'EQUITY') ? 1 : -1;
      this.db.execute(
        `UPDATE ledger_accounts SET balance_paise = balance_paise + $1, updated_at = datetime('now') WHERE id = $2`,
        [amountPaise * creditMultiplier, creditAcc.id]
      );

      return {
        transactionId: txId,
        referenceType,
        referenceId,
        amountPaise,
        debitAccount: debitAccountCode,
        creditAccount: creditAccountCode
      };
    });
  }

  getJournal(merchantId, options = {}) {
    const limit = options.limit || 50;
    const offset = options.offset || 0;
    const txs = this.db.query(
      `SELECT * FROM ledger_transactions WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [merchantId, limit, offset]
    );

    for (const tx of txs) {
      tx.entries = this.db.query(
        `SELECT e.*, a.account_code, a.account_name 
         FROM ledger_entries e 
         JOIN ledger_accounts a ON e.account_id = a.id 
         WHERE e.transaction_id = $1`,
        [tx.id]
      );
    }
    return txs;
  }

  getTrialBalance(merchantId) {
    this.ensureAccounts(merchantId);
    const accounts = this.db.query(
      `SELECT account_code, account_name, account_type, balance_paise FROM ledger_accounts WHERE merchant_id = $1`,
      [merchantId]
    );
    const totalAssets = accounts.filter(a => a.account_type === 'ASSET').reduce((s, a) => s + Number(a.balance_paise), 0);
    const totalLiabilities = accounts.filter(a => a.account_type === 'LIABILITY').reduce((s, a) => s + Number(a.balance_paise), 0);
    const totalExpenses = accounts.filter(a => a.account_type === 'EXPENSE').reduce((s, a) => s + Number(a.balance_paise), 0);

    return {
      accounts,
      summary: {
        totalAssetsPaise: totalAssets,
        totalLiabilitiesPaise: totalLiabilities,
        totalExpensesPaise: totalExpenses
      }
    };
  }
}

