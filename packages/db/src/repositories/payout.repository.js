import crypto from 'node:crypto';

/**
 * Payout Repository
 * Manages real money outbound transfers, maker-checker approvals, and immutable lifecycle events.
 */
export class PayoutRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO payouts (
        id, merchant_id, transfer_id, idempotency_key, beneficiary_id,
        provider_connection_id, amount_paise, currency, payout_rail,
        fee_paise, status, provider_transfer_id, provider_name, utr,
        failure_reason, remarks, initiated_by, approved_by, payout_account_id,
        initiation_time_ms, confirmation_time_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    `;
    const params = [
      id,
      data.merchantId,
      data.transferId,
      data.idempotencyKey,
      data.beneficiaryId || null,
      data.providerConnectionId || null,
      data.amountPaise,
      data.currency || 'INR',
      data.payoutRail || 'IMPS',
      data.feePaise || 0,
      data.status || 'CREATED',
      data.providerTransferId || null,
      data.providerName || 'CASHFREE',
      data.utr || null,
      data.failureReason || null,
      data.remarks || null,
      data.initiatedBy || null,
      data.approvedBy || null,
      data.payoutAccountId || null,
      data.initiationTimeMs || 0,
      data.confirmationTimeMs || 0
    ];
    this.db.execute(sql, params);

    this.recordEvent({
      payoutId: id,
      eventType: 'PAYOUT_CREATED',
      previousStatus: null,
      newStatus: data.status || 'CREATED',
      payload: { amountPaise: data.amountPaise, rail: data.payoutRail || 'IMPS' }
    });

    return this.findById(id);
  }

  findById(id) {
    return this.db.queryOne(`SELECT * FROM payouts WHERE id = $1`, [id]);
  }

  findByTransferId(transferId) {
    return this.db.queryOne(`SELECT * FROM payouts WHERE transfer_id = $1`, [transferId]);
  }

  findByIdempotencyKey(key) {
    return this.db.queryOne(`SELECT * FROM payouts WHERE idempotency_key = $1`, [key]);
  }

  update(id, data) {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields = [];
    const params = [];
    let idx = 1;

    const map = {
      status: 'status',
      providerTransferId: 'provider_transfer_id',
      utr: 'utr',
      failureReason: 'failure_reason',
      approvedBy: 'approved_by',
      submittedAt: 'submitted_at',
      confirmedAt: 'confirmed_at',
      initiationTimeMs: 'initiation_time_ms',
      confirmationTimeMs: 'confirmation_time_ms'
    };

    for (const [key, col] of Object.entries(map)) {
      if (data[key] !== undefined) {
        fields.push(`${col} = $${idx++}`);
        params.push(data[key]);
      }
    }

    if (fields.length === 0) return existing;

    fields.push(`updated_at = datetime('now')`);
    params.push(id);
    const sql = `UPDATE payouts SET ${fields.join(', ')} WHERE id = $${idx}`;
    this.db.execute(sql, params);

    if (data.status && data.status !== existing.status) {
      this.recordEvent({
        payoutId: id,
        eventType: `STATUS_CHANGED_TO_${data.status}`,
        previousStatus: existing.status,
        newStatus: data.status,
        payload: { utr: data.utr || existing.utr, failureReason: data.failureReason || existing.failure_reason }
      });
    }

    return this.findById(id);
  }

  recordApproval(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO payout_approvals (
        id, payout_id, step, approver_id, decision, comments, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    const params = [
      id,
      data.payoutId,
      data.step || 'MAKER_CHECKER',
      data.approverId,
      data.decision,
      data.comments || null,
      data.ipAddress || null
    ];
    this.db.execute(sql, params);
    return id;
  }

  getApprovals(payoutId) {
    return this.db.query(
      `SELECT * FROM payout_approvals WHERE payout_id = $1 ORDER BY created_at ASC`,
      [payoutId]
    );
  }

  recordEvent(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO payout_events (
        id, payout_id, event_type, previous_status, new_status, payload
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `;
    const params = [
      id,
      data.payoutId,
      data.eventType,
      data.previousStatus || null,
      data.newStatus,
      typeof data.payload === 'string' ? data.payload : JSON.stringify(data.payload || {})
    ];
    this.db.execute(sql, params);
    return id;
  }

  getEvents(payoutId) {
    return this.db.query(
      `SELECT * FROM payout_events WHERE payout_id = $1 ORDER BY created_at ASC`,
      [payoutId]
    );
  }

  listByMerchant(merchantId, options = {}) {
    let sql = `SELECT * FROM payouts WHERE merchant_id = $1`;
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
}

