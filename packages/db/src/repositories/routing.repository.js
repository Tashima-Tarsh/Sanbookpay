import crypto from 'node:crypto';

export class RoutingRepository {
  constructor(db) {
    this.db = db;
  }

  // Routing Rules
  createRule(data) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT INTO routing_rules (id, merchant_id, receiving_account_id, priority, weight, min_amount_paise, max_amount_paise,
       is_enabled, is_primary, strategy, health_check_interval_sec, failure_threshold, recovery_probe_interval_sec, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.merchantId, data.receivingAccountId, data.priority || 100, data.weight || 100,
       data.minAmountPaise || null, data.maxAmountPaise || null, data.isEnabled !== false ? 1 : 0,
       data.isPrimary ? 1 : 0, data.strategy || 'PRIORITY_BASED',
       data.healthCheckIntervalSec || 60, data.failureThreshold || 3, data.recoveryProbeIntervalSec || 300,
       now, now]
    );
    return this.findRuleById(id);
  }

  findRuleById(id) {
    const row = this.db.queryOne('SELECT * FROM routing_rules WHERE id = ?', [id]);
    return row ? this.mapRuleRow(row) : null;
  }

  findRulesByMerchant(merchantId, enabledOnly = false) {
    const sql = enabledOnly
      ? 'SELECT * FROM routing_rules WHERE merchant_id = ? AND is_enabled = 1 ORDER BY priority ASC, created_at ASC'
      : 'SELECT * FROM routing_rules WHERE merchant_id = ? ORDER BY priority ASC, created_at ASC';
    const rows = this.db.query(sql, [merchantId]);
    return (rows || []).map(r => this.mapRuleRow(r));
  }

  findActiveRulesByMerchant(merchantId) {
    return this.findRulesByMerchant(merchantId, true);
  }

  updateRule(id, updates) {
    const fields = [];
    const params = [];
    const allowed = ['priority', 'weight', 'min_amount_paise', 'max_amount_paise', 'is_enabled', 'is_primary', 'strategy',
      'health_check_interval_sec', 'failure_threshold', 'recovery_probe_interval_sec', 'receiving_account_id'];
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(updates[key]);
      }
    }
    if (fields.length === 0) return this.findRuleById(id);
    fields.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);
    this.db.execute(`UPDATE routing_rules SET ${fields.join(', ')} WHERE id = ?`, params);
    return this.findRuleById(id);
  }

  deleteRule(id) {
    this.db.execute('DELETE FROM routing_rules WHERE id = ?', [id]);
    return { success: true };
  }

  mapRuleRow(row) {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      receivingAccountId: row.receiving_account_id,
      priority: row.priority,
      weight: row.weight,
      minAmountPaise: row.min_amount_paise,
      maxAmountPaise: row.max_amount_paise,
      isEnabled: Boolean(row.is_enabled),
      isPrimary: Boolean(row.is_primary),
      strategy: row.strategy,
      healthCheckIntervalSec: row.health_check_interval_sec,
      failureThreshold: row.failure_threshold,
      recoveryProbeIntervalSec: row.recovery_probe_interval_sec,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  // Route Health
  upsertHealth(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const existing = this.db.queryOne('SELECT id FROM route_health WHERE routing_rule_id = ?', [data.routingRuleId]);
    if (existing) {
      this.db.execute(
        `UPDATE route_health SET status = ?, success_rate = ?, timeout_rate = ?, error_rate = ?, avg_latency_ms = ?,
         last_success_at = ?, last_failure_at = ?, last_health_check_at = ?, circuit_breaker_state = ?,
         circuit_breaker_opens_at = ?, consecutive_failures = ?, updated_at = ?
         WHERE routing_rule_id = ?`,
        [data.status, data.successRate, data.timeoutRate, data.errorRate, data.avgLatencyMs,
         data.lastSuccessAt || null, data.lastFailureAt || null, data.lastHealthCheckAt || now,
         data.circuitBreakerState || 'CLOSED', data.circuitBreakerOpensAt || null,
         data.consecutiveFailures || 0, now, data.routingRuleId]
      );
    } else {
      this.db.execute(
        `INSERT INTO route_health (id, routing_rule_id, status, success_rate, timeout_rate, error_rate, avg_latency_ms,
         last_success_at, last_failure_at, last_health_check_at, circuit_breaker_state, circuit_breaker_opens_at,
         consecutive_failures, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, data.routingRuleId, data.status || 'HEALTHY', data.successRate || 1, data.timeoutRate || 0,
         data.errorRate || 0, data.avgLatencyMs || 0, data.lastSuccessAt || null, data.lastFailureAt || null,
         data.lastHealthCheckAt || now, data.circuitBreakerState || 'CLOSED', data.circuitBreakerOpensAt || null,
         data.consecutiveFailures || 0, now, now]
      );
    }
    return this.findHealthByRuleId(data.routingRuleId);
  }

  findHealthByRuleId(routingRuleId) {
    const row = this.db.queryOne('SELECT * FROM route_health WHERE routing_rule_id = ?', [routingRuleId]);
    return row ? this.mapHealthRow(row) : null;
  }

  findAllHealth() {
    const rows = this.db.query('SELECT * FROM route_health ORDER BY updated_at DESC');
    return (rows || []).map(r => this.mapHealthRow(r));
  }

  findUnhealthyRoutes() {
    const rows = this.db.query(
      "SELECT * FROM route_health WHERE status != 'HEALTHY' OR circuit_breaker_state != 'CLOSED' ORDER BY updated_at DESC"
    );
    return (rows || []).map(r => this.mapHealthRow(r));
  }

  mapHealthRow(row) {
    return {
      id: row.id,
      routingRuleId: row.routing_rule_id,
      status: row.status,
      successRate: row.success_rate,
      timeoutRate: row.timeout_rate,
      errorRate: row.error_rate,
      avgLatencyMs: row.avg_latency_ms,
      lastSuccessAt: row.last_success_at ? new Date(row.last_success_at) : null,
      lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at) : null,
      lastHealthCheckAt: row.last_health_check_at ? new Date(row.last_health_check_at) : null,
      circuitBreakerState: row.circuit_breaker_state,
      circuitBreakerOpensAt: row.circuit_breaker_opens_at ? new Date(row.circuit_breaker_opens_at) : null,
      consecutiveFailures: row.consecutive_failures,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  // Failover Events
  createFailoverEvent(data) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.execute(
      `INSERT INTO failover_events (id, payment_order_id, from_route_id, to_route_id, reason, trigger, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.paymentOrderId || null, data.fromRouteId || null, data.toRouteId || null,
       data.reason, data.trigger, data.status || 'RECORDED', now]
    );
    return this.findFailoverEventById(id);
  }

  findFailoverEventById(id) {
    const row = this.db.queryOne('SELECT * FROM failover_events WHERE id = ?', [id]);
    return row ? this.mapFailoverRow(row) : null;
  }

  findFailoverEventsByOrder(paymentOrderId) {
    const rows = this.db.query('SELECT * FROM failover_events WHERE payment_order_id = ? ORDER BY created_at DESC', [paymentOrderId]);
    return (rows || []).map(r => this.mapFailoverRow(r));
  }

  findAllFailoverEvents(limit = 100) {
    const rows = this.db.query('SELECT * FROM failover_events ORDER BY created_at DESC LIMIT ?', [limit]);
    return (rows || []).map(r => this.mapFailoverRow(r));
  }

  mapFailoverRow(row) {
    return {
      id: row.id,
      paymentOrderId: row.payment_order_id,
      fromRouteId: row.from_route_id,
      toRouteId: row.to_route_id,
      reason: row.reason,
      trigger: row.trigger,
      status: row.status,
      createdAt: new Date(row.created_at)
    };
  }
}
