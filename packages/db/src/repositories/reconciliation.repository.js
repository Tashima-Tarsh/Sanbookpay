import crypto from 'node:crypto';

/**
 * Reconciliation Repository
 * Manages automated reconciliation against provider and bank records, detecting
 * duplicate settlements, missing UTRs, amount discrepancies, and late payments.
 */
export class ReconciliationRepository {
  /**
   * @param {import('../database.js').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  createRun(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO reconciliation_runs (
        id, merchant_id, provider_name, period_start, period_end,
        total_orders_checked, total_matched, total_discrepancies, status, details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;
    const params = [
      id,
      data.merchantId,
      data.providerName || 'CASHFREE',
      data.periodStart || null,
      data.periodEnd || null,
      data.totalOrdersChecked || 0,
      data.totalMatched || 0,
      data.totalDiscrepancies || 0,
      data.status || 'COMPLETED',
      typeof data.details === 'string' ? data.details : JSON.stringify(data.details || {})
    ];
    this.db.execute(sql, params);
    return this.findRunById(id);
  }

  findRunById(id) {
    return this.db.queryOne(`SELECT * FROM reconciliation_runs WHERE id = $1`, [id]);
  }

  recordException(data) {
    const id = data.id || crypto.randomUUID();
    const sql = `
      INSERT INTO reconciliation_exceptions (
        id, run_id, merchant_id, payment_order_id, provider_order_id,
        exception_type, expected_value, actual_value, status, resolution_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;
    const params = [
      id,
      data.runId,
      data.merchantId,
      data.paymentOrderId || null,
      data.providerOrderId || null,
      data.exceptionType,
      data.expectedValue || null,
      data.actualValue || null,
      data.status || 'OPEN',
      data.resolutionNotes || null
    ];
    this.db.execute(sql, params);
    return id;
  }

  listExceptions(merchantId, status = null) {
    let sql = `SELECT * FROM reconciliation_exceptions WHERE merchant_id = $1`;
    const params = [merchantId];
    if (status) {
      sql += ` AND status = $2`;
      params.push(status);
    }
    sql += ` ORDER BY created_at DESC`;
    return this.db.query(sql, params);
  }

  resolveException(id, notes) {
    const sql = `
      UPDATE reconciliation_exceptions
      SET status = 'RESOLVED', resolution_notes = $1, resolved_at = datetime('now')
      WHERE id = $2
    `;
    this.db.execute(sql, [notes, id]);
    return this.db.queryOne(`SELECT * FROM reconciliation_exceptions WHERE id = $1`, [id]);
  }

  listRuns(merchantId) {
    return this.db.query(
      `SELECT * FROM reconciliation_runs WHERE merchant_id = $1 ORDER BY created_at DESC`,
      [merchantId]
    );
  }
}

