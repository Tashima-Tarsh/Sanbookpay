/**
 * Smart UPI Routing Engine
 * Selects the best receiving route based on health, priority, weight, amount limits, and circuit breaker state.
 */
import crypto from 'node:crypto';

export class SmartRoutingEngine {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * Select the best eligible route for a merchant and amount.
   * Returns { route, receivingAccount, health } or null if no route available.
   */
  selectRoute(merchantId, amountPaise) {
    const db = this.ctx.db;
    const routingRepo = this.ctx.routingRepo;

    // Get all enabled routing rules for the merchant
    const rules = routingRepo.findActiveRulesByMerchant(merchantId);
    if (!rules || rules.length === 0) return null;

    // Get health for all rules
    const allHealth = routingRepo.findAllHealth();
    const healthMap = new Map();
    for (const h of allHealth) {
      healthMap.set(h.routingRuleId, h);
    }

    // Filter eligible routes
    const eligible = [];
    for (const rule of rules) {
      const health = healthMap.get(rule.id);

      // Circuit breaker check - skip OPEN circuits
      if (health && health.circuitBreakerState === 'OPEN') {
        // Check if recovery probe interval has passed
        if (health.circuitBreakerOpensAt) {
          const opensAt = new Date(health.circuitBreakerOpensAt).getTime();
          const recoveryInterval = (health.recoveryProbeIntervalSec || 300) * 1000;
          if (Date.now() - opensAt < recoveryInterval) {
            continue; // Still in cooldown
          }
          // Allow probe - half-open state
        }
      }

      // Amount limits check
      if (rule.minAmountPaise && amountPaise < rule.minAmountPaise) continue;
      if (rule.maxAmountPaise && amountPaise > rule.maxAmountPaise) continue;

      eligible.push({ rule, health });
    }

    if (eligible.length === 0) return null;

    // Sort by strategy
    eligible.sort((a, b) => {
      if (a.rule.strategy === 'HEALTH_AWARE' || b.rule.strategy === 'HEALTH_AWARE') {
        const ha = a.health ? a.health.successRate : 1;
        const hb = b.health ? b.health.successRate : 1;
        return hb - ha;
      }
      if (a.rule.strategy === 'LATENCY_AWARE' || b.rule.strategy === 'LATENCY_AWARE') {
        const la = a.health ? a.health.avgLatencyMs : 0;
        const lb = b.health ? b.health.avgLatencyMs : 0;
        return la - lb;
      }
      if (a.rule.strategy === 'SUCCESS_RATE_AWARE' || b.rule.strategy === 'SUCCESS_RATE_AWARE') {
        const sa = a.health ? a.health.successRate : 1;
        const sb = b.health ? b.health.successRate : 1;
        return sb - sa;
      }
      // Default: priority-based
      return a.rule.priority - b.rule.priority;
    });

    // If weighted strategy, do weighted random selection among eligible
    if (eligible[0].rule.strategy === 'WEIGHTED' || eligible.some(e => e.rule.strategy === 'WEIGHTED')) {
      return this._weightedSelect(eligible);
    }

    // Return the best route
    const best = eligible[0];
    const receivingAccount = this.ctx.accountRepo
      ? this.ctx.accountRepo.findById(best.rule.receivingAccountId)
      : null;

    return {
      route: best.rule,
      receivingAccount,
      health: best.health,
      selectionReason: best.rule.strategy === 'PRIORITY_BASED'
        ? `Priority ${best.rule.priority} selected`
        : `Best ${best.rule.strategy.toLowerCase()} route`
    };
  }

  _weightedSelect(eligible) {
    const totalWeight = eligible.reduce((sum, e) => sum + (e.rule.weight || 100), 0);
    let random = Math.random() * totalWeight;
    for (const e of eligible) {
      random -= (e.rule.weight || 100);
      if (random <= 0) {
        const receivingAccount = this.ctx.accountRepo
          ? this.ctx.accountRepo.findById(e.rule.receivingAccountId)
          : null;
        return {
          route: e.rule,
          receivingAccount,
          health: e.health,
          selectionReason: `Weighted random selection (weight ${e.rule.weight})`
        };
      }
    }
    // Fallback to first
    const e = eligible[0];
    const receivingAccount = this.ctx.accountRepo
      ? this.ctx.accountRepo.findById(e.rule.receivingAccountId)
      : null;
    return { route: e.rule, receivingAccount, health: e.health, selectionReason: 'Fallback selection' };
  }

  /**
   * Record a failover event
   */
  recordFailover(paymentOrderId, fromRouteId, toRouteId, reason, trigger) {
    const routingRepo = this.ctx.routingRepo;
    if (!routingRepo) return null;
    return routingRepo.createFailoverEvent({
      paymentOrderId,
      fromRouteId,
      toRouteId,
      reason,
      trigger,
      status: 'RECORDED'
    });
  }

  /**
   * Get all failover events
   */
  getFailoverEvents(limit = 100) {
    const routingRepo = this.ctx.routingRepo;
    if (!routingRepo) return [];
    return routingRepo.findAllFailoverEvents(limit);
  }

  /**
   * Get failover events for a specific order
   */
  getFailoverEventsByOrder(paymentOrderId) {
    const routingRepo = this.ctx.routingRepo;
    if (!routingRepo) return [];
    return routingRepo.findFailoverEventsByOrder(paymentOrderId);
  }
}
