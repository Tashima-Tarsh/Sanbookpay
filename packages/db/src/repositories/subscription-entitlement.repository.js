import crypto from 'node:crypto';

export class SubscriptionEntitlementRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const id = data.id || `subent_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const entitlements = typeof data.featureEntitlements === 'object' ? JSON.stringify(data.featureEntitlements) : (data.featureEntitlements || '[]');

    this.db.execute(`
      INSERT INTO subscription_entitlements (
        id, merchant_id, plan_id, max_upi_connections, max_observer_devices,
        observation_sources_enabled, webhook_endpoints_enabled, callback_concurrency,
        api_quota_daily, payment_link_limit, feature_entitlements, status,
        current_period_start, current_period_end, grace_period_ends_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, data.merchantId, data.planId, data.maxUpiiConnections || 1,
      data.maxObserverDevices || 1,
      data.observationSourcesEnabled !== undefined ? (data.observationSourcesEnabled ? 1 : 0) : 1,
      data.webhookEndpointsEnabled !== undefined ? (data.webhookEndpointsEnabled ? 1 : 0) : 1,
      data.callbackConcurrency || 5,
      data.apiQuotaDaily || 1000,
      data.paymentLinkLimit || 1000,
      entitlements, data.status || 'ACTIVE',
      data.currentPeriodStart || null, data.currentPeriodEnd || null,
      data.gracePeriodEndsAt || null, now, now
    ]);

    return this.findById(id);
  }

  findById(id) {
    const row = this.db.queryOne('SELECT * FROM subscription_entitlements WHERE id = ?', [id]);
    return row ? this.mapRow(row) : null;
  }

  findByMerchant(merchantId) {
    const row = this.db.queryOne(
      'SELECT * FROM subscription_entitlements WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 1',
      [merchantId]
    );
    return row ? this.mapRow(row) : null;
  }

  findByStatus(status, limit = 100) {
    const rows = this.db.query(
      'SELECT * FROM subscription_entitlements WHERE status = ? ORDER BY created_at DESC LIMIT ?',
      [status, limit]
    );
    return rows.map(r => this.mapRow(r));
  }

  findExpiringBefore(date) {
    const rows = this.db.query(
      'SELECT * FROM subscription_entitlements WHERE current_period_end < ? AND status = ?',
      [date.toISOString(), 'ACTIVE']
    );
    return rows.map(r => this.mapRow(r));
  }

  update(id, data) {
    const fields = [];
    const values = [];

    if (data.planId !== undefined) { fields.push('plan_id = ?'); values.push(data.planId); }
    if (data.maxUpiiConnections !== undefined) { fields.push('max_upi_connections = ?'); values.push(data.maxUpiiConnections); }
    if (data.maxObserverDevices !== undefined) { fields.push('max_observer_devices = ?'); values.push(data.maxObserverDevices); }
    if (data.observationSourcesEnabled !== undefined) { fields.push('observation_sources_enabled = ?'); values.push(data.observationSourcesEnabled ? 1 : 0); }
    if (data.webhookEndpointsEnabled !== undefined) { fields.push('webhook_endpoints_enabled = ?'); values.push(data.webhookEndpointsEnabled ? 1 : 0); }
    if (data.callbackConcurrency !== undefined) { fields.push('callback_concurrency = ?'); values.push(data.callbackConcurrency); }
    if (data.apiQuotaDaily !== undefined) { fields.push('api_quota_daily = ?'); values.push(data.apiQuotaDaily); }
    if (data.paymentLinkLimit !== undefined) { fields.push('payment_link_limit = ?'); values.push(data.paymentLinkLimit); }
    if (data.featureEntitlements !== undefined) { fields.push('feature_entitlements = ?'); values.push(typeof data.featureEntitlements === 'object' ? JSON.stringify(data.featureEntitlements) : data.featureEntitlements); }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
    if (data.currentPeriodStart !== undefined) { fields.push('current_period_start = ?'); values.push(data.currentPeriodStart); }
    if (data.currentPeriodEnd !== undefined) { fields.push('current_period_end = ?'); values.push(data.currentPeriodEnd); }
    if (data.gracePeriodEndsAt !== undefined) { fields.push('grace_period_ends_at = ?'); values.push(data.gracePeriodEndsAt); }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.execute(`UPDATE subscription_entitlements SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  mapRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      planId: row.plan_id,
      maxUpiiConnections: row.max_upi_connections,
      maxObserverDevices: row.max_observer_devices,
      observationSourcesEnabled: Boolean(row.observation_sources_enabled),
      webhookEndpointsEnabled: Boolean(row.webhook_endpoints_enabled),
      callbackConcurrency: row.callback_concurrency,
      apiQuotaDaily: row.api_quota_daily,
      paymentLinkLimit: row.payment_link_limit,
      featureEntitlements: JSON.parse(row.feature_entitlements || '[]'),
      status: row.status,
      currentPeriodStart: row.current_period_start ? new Date(row.current_period_start) : null,
      currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
      gracePeriodEndsAt: row.grace_period_ends_at ? new Date(row.grace_period_ends_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
