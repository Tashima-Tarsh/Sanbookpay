import crypto from 'node:crypto';

export class WalletRepository {
  constructor(db) {
    this.db = db;
  }

  createWallet(data) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT INTO gaming_wallets (id, merchant_id, player_reference, balance_paise, currency, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.merchantId, data.playerReference, data.balancePaise || 0, data.currency || 'INR',
       data.status || 'ACTIVE', now, now]
    );
    return this.findWalletById(id);
  }

  findWalletById(id) {
    const row = this.db.queryOne('SELECT * FROM gaming_wallets WHERE id = ?', [id]);
    return row ? this.mapWalletRow(row) : null;
  }

  findWalletByPlayer(merchantId, playerReference) {
    const row = this.db.queryOne(
      'SELECT * FROM gaming_wallets WHERE merchant_id = ? AND player_reference = ?',
      [merchantId, playerReference]
    );
    return row ? this.mapWalletRow(row) : null;
  }

  findWalletsByMerchant(merchantId) {
    const rows = this.db.query('SELECT * FROM gaming_wallets WHERE merchant_id = ? ORDER BY created_at DESC', [merchantId]);
    return (rows || []).map(r => this.mapWalletRow(r));
  }

  updateBalance(walletId, amountPaise, balanceAfterPaise) {
    const now = new Date().toISOString();
    this.db.execute(
      'UPDATE gaming_wallets SET balance_paise = ?, updated_at = ? WHERE id = ?',
      [balanceAfterPaise, now, walletId]
    );
    return this.findWalletById(walletId);
  }

  mapWalletRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      playerReference: row.player_reference,
      balancePaise: row.balance_paise,
      currency: row.currency,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  // Wallet Transactions
  createTransaction(data) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT INTO wallet_transactions (id, wallet_id, payment_order_id, direction, amount_paise, balance_after_paise,
       narration, reference_type, reference_id, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.walletId, data.paymentOrderId || null, data.direction, data.amountPaise,
       data.balanceAfterPaise, data.narration, data.referenceType || null, data.referenceId || null,
       data.idempotencyKey || null, now]
    );
    return this.findTransactionById(id);
  }

  findTransactionById(id) {
    const row = this.db.queryOne('SELECT * FROM wallet_transactions WHERE id = ?', [id]);
    return row ? this.mapTransactionRow(row) : null;
  }

  findTransactionByIdempotencyKey(idempotencyKey) {
    const row = this.db.queryOne('SELECT * FROM wallet_transactions WHERE idempotency_key = ?', [idempotencyKey]);
    return row ? this.mapTransactionRow(row) : null;
  }

  findTransactionsByWallet(walletId, limit = 50) {
    const rows = this.db.query(
      'SELECT * FROM wallet_transactions WHERE wallet_id = ? ORDER BY created_at DESC LIMIT ?',
      [walletId, limit]
    );
    return (rows || []).map(r => this.mapTransactionRow(r));
  }

  mapTransactionRow(row) {
    return {
      id: row.id,
      walletId: row.wallet_id,
      paymentOrderId: row.payment_order_id,
      direction: row.direction,
      amountPaise: row.amount_paise,
      balanceAfterPaise: row.balance_after_paise,
      narration: row.narration,
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      idempotencyKey: row.idempotency_key,
      createdAt: new Date(row.created_at)
    };
  }
}
