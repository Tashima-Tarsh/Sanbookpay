import crypto from 'node:crypto';

export class PricingRepository {
  constructor(db) {
    this.db = db;
  }

  // Pricing Plans
  createPlan(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT INTO pricing_plans (id, name, slug, description, monthly_fee_paise, transaction_fee_percent,
       transaction_fee_fixed_paise, volume_tier_threshold_paise, volume_tier_fee_percent, api_quota_daily,
       payment_link_limit, allowed_payment_methods, feature_entitlements, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.name, data.slug, data.description || null, data.monthlyFeePaise || 0,
       data.transactionFeePercent || 0, data.transactionFeeFixedPaise || 0, data.volumeTierThresholdPaise || 0,
       data.volumeTierFeePercent || null, data.apiQuotaDaily || 1000, data.paymentLinkLimit || 1000,
       data.allowedPaymentMethods || '["UPI"]', data.featureEntitlements || '[]',
       data.isActive !== false ? 1 : 0, now, now]
    );
    return this.findPlanById(id);
  }

  findPlanById(id) {
    const row = this.db.queryOne('SELECT * FROM pricing_plans WHERE id = ?', [id]);
    return row ? this.mapPlanRow(row) : null;
  }

  findPlanBySlug(slug) {
    const row = this.db.queryOne('SELECT * FROM pricing_plans WHERE slug = ?', [slug]);
    return row ? this.mapPlanRow(row) : null;
  }

  findAllPlans(activeOnly = false) {
    const sql = activeOnly
      ? 'SELECT * FROM pricing_plans WHERE is_active = 1 ORDER BY monthly_fee_paise ASC'
      : 'SELECT * FROM pricing_plans ORDER BY monthly_fee_paise ASC';
    const rows = this.db.query(sql);
    return (rows || []).map(r => this.mapPlanRow(r));
  }

  updatePlan(id, updates) {
    const fields = [];
    const params = [];
    const allowed = ['name', 'slug', 'description', 'monthly_fee_paise', 'transaction_fee_percent',
      'transaction_fee_fixed_paise', 'volume_tier_threshold_paise', 'volume_tier_fee_percent',
      'api_quota_daily', 'payment_link_limit', 'allowed_payment_methods', 'feature_entitlements', 'is_active'];
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(updates[key]);
      }
    }
    if (fields.length === 0) return this.findPlanById(id);
    fields.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);
    this.db.execute(`UPDATE pricing_plans SET ${fields.join(', ')} WHERE id = ?`, params);
    return this.findPlanById(id);
  }

  deletePlan(id) {
    this.db.execute('DELETE FROM pricing_plans WHERE id = ?', [id]);
    return { success: true };
  }

  mapPlanRow(row) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      monthlyFeePaise: row.monthly_fee_paise,
      transactionFeePercent: row.transaction_fee_percent,
      transactionFeeFixedPaise: row.transaction_fee_fixed_paise,
      volumeTierThresholdPaise: row.volume_tier_threshold_paise,
      volumeTierFeePercent: row.volume_tier_fee_percent,
      apiQuotaDaily: row.api_quota_daily,
      paymentLinkLimit: row.payment_link_limit,
      allowedPaymentMethods: row.allowed_payment_methods,
      featureEntitlements: row.feature_entitlements,
      isActive: Boolean(row.is_active),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  // Merchant Subscriptions
  createSubscription(data) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT INTO merchant_subscriptions (id, merchant_id, pricing_plan_id, status, current_period_start,
       current_period_end, cancel_at_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.merchantId, data.pricingPlanId, data.status || 'ACTIVE',
       data.currentPeriodStart || null, data.currentPeriodEnd || null,
       data.cancelAtPeriodEnd ? 1 : 0, now, now]
    );
    return this.findSubscriptionById(id);
  }

  findSubscriptionById(id) {
    const row = this.db.queryOne('SELECT * FROM merchant_subscriptions WHERE id = ?', [id]);
    return row ? this.mapSubscriptionRow(row) : null;
  }

  findSubscriptionByMerchant(merchantId) {
    const row = this.db.queryOne(
      'SELECT * FROM merchant_subscriptions WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 1',
      [merchantId]
    );
    return row ? this.mapSubscriptionRow(row) : null;
  }

  updateSubscription(id, updates) {
    const fields = [];
    const params = [];
    const allowed = ['pricing_plan_id', 'status', 'current_period_start', 'current_period_end', 'cancel_at_period_end'];
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(updates[key]);
      }
    }
    if (fields.length === 0) return this.findSubscriptionById(id);
    fields.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);
    this.db.execute(`UPDATE merchant_subscriptions SET ${fields.join(', ')} WHERE id = ?`, params);
    return this.findSubscriptionById(id);
  }

  mapSubscriptionRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      pricingPlanId: row.pricing_plan_id,
      status: row.status,
      currentPeriodStart: row.current_period_start ? new Date(row.current_period_start) : null,
      currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}
