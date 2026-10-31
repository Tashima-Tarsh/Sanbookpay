import crypto from 'node:crypto';

export class DiagnosticRepository {
  constructor(db) {
    this.db = db;
  }

  createLog(data) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT INTO diagnostic_logs (id, merchant_id, search_key, search_type, order_created, player_associated,
       route_selected, receiving_bank, receiving_vpa, qr_generated, payment_attempt, provider_confirmation,
       failover_history, ledger_posted, webhook_delivered, wallet_fulfilled, reconciliation_status, evidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.merchantId || null, data.searchKey, data.searchType,
       data.orderCreated ? 1 : 0, data.playerAssociated ? 1 : 0, data.routeSelected ? 1 : 0,
       data.receivingBank || null, data.receivingVpa || null, data.qrGenerated ? 1 : 0,
       data.paymentAttempt ? 1 : 0, data.providerConfirmation ? 1 : 0,
       data.failoverHistory || '[]', data.ledgerPosted ? 1 : 0, data.webhookDelivered ? 1 : 0,
       data.walletFulfilled ? 1 : 0, data.reconciliationStatus || null, data.evidence || '{}', now]
    );
    return this.findLogById(id);
  }

  findLogById(id) {
    const row = this.db.queryOne('SELECT * FROM diagnostic_logs WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findBySearchKey(searchKey, searchType) {
    const rows = this.db.query(
      'SELECT * FROM diagnostic_logs WHERE search_key = ? AND search_type = ? ORDER BY created_at DESC',
      [searchKey, searchType]
    );
    return (rows || []).map(r => this.mapRow(r));
  }

  findByMerchant(merchantId, limit = 100) {
    const rows = this.db.query(
      'SELECT * FROM diagnostic_logs WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?',
      [merchantId, limit]
    );
    return (rows || []).map(r => this.mapRow(r));
  }

  findAll(limit = 100) {
    const rows = this.db.query('SELECT * FROM diagnostic_logs ORDER BY created_at DESC LIMIT ?', [limit]);
    return (rows || []).map(r => this.mapRow(r));
  }

  mapRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      searchKey: row.search_key,
      searchType: row.search_type,
      orderCreated: Boolean(row.order_created),
      playerAssociated: Boolean(row.player_associated),
      routeSelected: Boolean(row.route_selected),
      receivingBank: row.receiving_bank,
      receivingVpa: row.receiving_vpa,
      qrGenerated: Boolean(row.qr_generated),
      paymentAttempt: Boolean(row.payment_attempt),
      providerConfirmation: Boolean(row.provider_confirmation),
      failoverHistory: row.failover_history,
      ledgerPosted: Boolean(row.ledger_posted),
      webhookDelivered: Boolean(row.webhook_delivered),
      walletFulfilled: Boolean(row.wallet_fulfilled),
      reconciliationStatus: row.reconciliation_status,
      evidence: row.evidence,
      createdAt: new Date(row.created_at)
    };
  }
}
