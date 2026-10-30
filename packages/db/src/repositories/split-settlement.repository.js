import crypto from 'node:crypto';

/**
 * Split Settlement Repository
 * Manages per-transaction platform fee split for gaming/marketplace merchants.
 * Split: Gross Amount → Platform Fee + GST on Fee → Merchant Share
 */
export class SplitSettlementRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Create or upsert split settlement rule for a merchant
   */
  createOrUpdateRule(data) {
    const existing = this.db.queryOne(`SELECT id FROM split_settlement_rules WHERE merchant_id = $1`, [data.merchantId]);
    const now = new Date().toISOString();

    if (existing) {
      const sql = `
        UPDATE split_settlement_rules
        SET platform_fee_percent = $1, merchant_share_percent = $2,
            min_settlement_amount_paise = $3, settlement_day_of_month = $4,
            auto_settle_enabled = $5, gst_percent = $6,
            upi_collections_fee_percent = $7, updated_at = $8
        WHERE merchant_id = $9
      `;
      this.db.execute(sql, [
        data.platformFeePercent ?? 150,
        data.merchantSharePercent ?? 850,
        data.minSettlementAmountPaise ?? 100,
        data.settlementDayOfMonth ?? 1,
        data.autoSettleEnabled ?? 0,
        data.gstPercent ?? 18,
        data.upiCollectionsFeePercent ?? 100,
        now,
        data.merchantId
      ]);
      return this.getRule(data.merchantId);
    }

    const id = crypto.randomUUID();
    const sql = `
      INSERT INTO split_settlement_rules (
        id, merchant_id, platform_fee_percent, merchant_share_percent,
        min_settlement_amount_paise, settlement_day_of_month, auto_settle_enabled,
        gst_percent, upi_collections_fee_percent, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;
    this.db.execute(sql, [
      id,
      data.merchantId,
      data.platformFeePercent ?? 150,
      data.merchantSharePercent ?? 850,
      data.minSettlementAmountPaise ?? 100,
      data.settlementDayOfMonth ?? 1,
      data.autoSettleEnabled ?? 0,
      data.gstPercent ?? 18,
      data.upiCollectionsFeePercent ?? 100,
      now,
      now
    ]);
    return this.getRule(data.merchantId);
  }

  getRule(merchantId) {
    return this.db.queryOne(`SELECT * FROM split_settlement_rules WHERE merchant_id = $1`, [merchantId]);
  }

  /**
   * Calculate split for a given gross amount
   */
  calculateSplit(grossAmountPaise, merchantId) {
    const gross = typeof grossAmountPaise === 'bigint' ? Number(grossAmountPaise) : grossAmountPaise;
    const rule = this.getRule(merchantId);
    if (!rule) {
      // Default split: 10% platform fee, 18% GST on fee, 90% merchant
      const platformFeePercent = 100;
      const gstPercent = 18;
      const platformFeePaise = Math.min(Math.round(gross * platformFeePercent / 1000), Math.floor(gross / (1 + gstPercent / 100)));
      const gstOnFeePaise = Math.round(platformFeePaise * gstPercent / 100);
      const merchantSharePaise = gross - platformFeePaise - gstOnFeePaise;
      return {
        rule: null,
        grossAmountPaise: gross,
        platformFeePaise,
        gstOnFeePaise,
        merchantSharePaise,
        platformFeePercent,
        gstPercent,
        merchantSharePercent: 900
      };
    }

    const platformFeePercent = Number(rule.platform_fee_percent);
    const gstPercent = Number(rule.gst_percent);
    const merchantSharePercent = Number(rule.merchant_share_percent);

    // Bound the rounded fee so fee + rounded tax + net always equals the collected amount.
    const platformFeePaise = Math.min(Math.round(gross * platformFeePercent / 1000), Math.floor(gross / (1 + gstPercent / 100)));
    const gstOnFeePaise = Math.round(platformFeePaise * gstPercent / 100);
    const merchantSharePaise = gross - platformFeePaise - gstOnFeePaise;

    return {
      rule,
      grossAmountPaise: gross,
      platformFeePaise,
      gstOnFeePaise,
      merchantSharePaise,
      platformFeePercent,
      gstPercent,
      merchantSharePercent
    };
  }

  /**
   * Create a split settlement entry for a payment
   */
  createEntry(data) {
    const id = crypto.randomUUID();
    const sql = `
      INSERT INTO split_settlement_entries (
        id, settlement_id, payment_order_id, payment_session_id, merchant_id,
        gross_amount_paise, platform_fee_paise, gst_on_fee_paise, merchant_share_paise,
        status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;
    this.db.execute(sql, [
      id,
      data.settlementId || null,
      data.paymentOrderId || null,
      data.paymentSessionId || null,
      data.merchantId,
      data.grossAmountPaise,
      data.platformFeePaise || 0,
      data.gstOnFeePaise || 0,
      data.merchantSharePaise || 0,
      data.status || 'PENDING',
      new Date().toISOString()
    ]);
    return this.findById(id);
  }

  findById(id) {
    return this.db.queryOne(`SELECT * FROM split_settlement_entries WHERE id = $1`, [id]);
  }

  linkToSettlement(entryId, settlementId) {
    this.db.execute(
      `UPDATE split_settlement_entries SET settlement_id = $1, status = 'SETTLED', settled_at = datetime('now') WHERE id = $2`,
      [settlementId, entryId]
    );
    return this.findById(entryId);
  }

  listByMerchant(merchantId, options = {}) {
    let sql = `SELECT * FROM split_settlement_entries WHERE merchant_id = $1`;
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

  listPendingByMerchant(merchantId) {
    return this.db.query(
      `SELECT * FROM split_settlement_entries WHERE merchant_id = $1 AND status = 'PENDING' ORDER BY created_at ASC`,
      [merchantId]
    );
  }

  getOverview(merchantId) {
    const sql = `
      SELECT
        COALESCE(SUM(gross_amount_paise), 0) as total_gross_paise,
        COALESCE(SUM(platform_fee_paise), 0) as total_platform_fee_paise,
        COALESCE(SUM(gst_on_fee_paise), 0) as total_gst_on_fee_paise,
        COALESCE(SUM(merchant_share_paise), 0) as total_merchant_share_paise,
        COALESCE(SUM(CASE WHEN status = 'SETTLED' THEN merchant_share_paise ELSE 0 END), 0) as settled_merchant_share_paise,
        COALESCE(SUM(CASE WHEN status = 'PENDING' THEN merchant_share_paise ELSE 0 END), 0) as pending_merchant_share_paise
      FROM split_settlement_entries
      WHERE merchant_id = $1
    `;
    return this.db.queryOne(sql, [merchantId]);
  }
}
