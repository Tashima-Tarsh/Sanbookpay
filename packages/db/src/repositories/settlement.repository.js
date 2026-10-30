import crypto from 'node:crypto';

/**
 * Settlement Repository
 * Tracks real bank settlements, provider settlement batches, fees, and bank credit confirmation.
 */
export class SettlementRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO settlements (
        id, merchant_id, provider_connection_id, settlement_id,
        provider_settlement_id, gross_amount_paise, fee_paise, tax_paise,
        net_amount_paise, status, bank_utr, bank_account_number,
        settled_at, bank_confirmed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `;
    const params = [
      id,
      data.merchantId,
      data.providerConnectionId || null,
      data.settlementId,
      data.providerSettlementId || null,
      data.grossAmountPaise,
      data.feePaise || 0,
      data.taxPaise || 0,
      data.netAmountPaise,
      data.status || 'PENDING',
      data.bankUtr || null,
      data.bankAccountNumber || null,
      data.settledAt || null,
      data.bankConfirmedAt || null
    ];
    this.db.execute(sql, params);
    return this.findById(id);
  }

  findById(id) {
    return this.db.queryOne(`SELECT * FROM settlements WHERE id = $1`, [id]);
  }

  findBySettlementId(settlementId) {
    return this.db.queryOne(`SELECT * FROM settlements WHERE settlement_id = $1`, [settlementId]);
  }

  update(id, data) {
    const fields = [];
    const params = [];
    let idx = 1;

    const map = {
      providerSettlementId: 'provider_settlement_id',
      status: 'status',
      bankUtr: 'bank_utr',
      bankAccountNumber: 'bank_account_number',
      settledAt: 'settled_at',
      bankConfirmedAt: 'bank_confirmed_at'
    };

    for (const [key, col] of Object.entries(map)) {
      if (data[key] !== undefined) {
        fields.push(`${col} = $${idx++}`);
        params.push(data[key]);
      }
    }

    if (fields.length === 0) return this.findById(id);

    params.push(id);
    const sql = `UPDATE settlements SET ${fields.join(', ')} WHERE id = $${idx}`;
    this.db.execute(sql, params);
    return this.findById(id);
  }

  addEntry(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO settlement_entries (
        id, settlement_id, payment_order_id, amount_paise, fee_paise, tax_paise, net_paise
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    const params = [
      id,
      data.settlementId,
      data.paymentOrderId || null,
      data.amountPaise,
      data.feePaise || 0,
      data.taxPaise || 0,
      data.netPaise
    ];
    this.db.execute(sql, params);
    return id;
  }

  getEntries(settlementId) {
    return this.db.query(
      `SELECT * FROM settlement_entries WHERE settlement_id = $1`,
      [settlementId]
    );
  }

  listByMerchant(merchantId, options = {}) {
    let sql = `SELECT * FROM settlements WHERE merchant_id = $1`;
    const params = [merchantId];
    let idx = 2;

    if (options.status) {
      sql += ` AND status = $${idx++}`;
      params.push(options.status);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(options.limit || 50, options.offset || 0);

    return this.db.query(sql, params);
  }

  getOverview(merchantId) {
    const sql = `
      SELECT 
        COALESCE(SUM(gross_amount_paise), 0) as total_gross_paise,
        COALESCE(SUM(fee_paise), 0) as total_fee_paise,
        COALESCE(SUM(net_amount_paise), 0) as total_net_paise,
        COALESCE(SUM(CASE WHEN status = 'BANK_CREDIT_CONFIRMED' THEN net_amount_paise ELSE 0 END), 0) as confirmed_bank_credit_paise,
        COALESCE(SUM(CASE WHEN status IN ('PENDING', 'INITIATED') THEN net_amount_paise ELSE 0 END), 0) as pending_settlement_paise
      FROM settlements
      WHERE merchant_id = $1
    `;
    return this.db.queryOne(sql, [merchantId]);
  }
}

