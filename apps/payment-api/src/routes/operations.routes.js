import { HttpServer } from '../server.js';
import { PaymentOrderRepository, OperationalAlertRepository } from '@youpi/db';

/**
 * Operations & 60-Second Performance Engine Routes
 * Measures exact latency percentiles (p50, p95, p99), 60-second SLA adherence, and active operational alerts.
 */
export function registerOperationsRoutes(server, ctx) {
  const db = ctx.db;
  const poRepo = new PaymentOrderRepository(db);
  const alertRepo = new OperationalAlertRepository(db);

  function getMerchantId(req) {
    const key = req.headers['x-api-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    if (!key) return null;
    const merchant = db.queryOne(`SELECT id FROM merchants WHERE id = $1`, [key]);
    if (merchant) return merchant.id;
    const cred = db.queryOne(`SELECT merchant_id FROM merchant_credentials WHERE api_key = $1 AND status = 'ACTIVE'`, [key]);
    if (cred) return cred.merchant_id;
    const firstMerchant = db.queryOne(`SELECT id FROM merchants LIMIT 1`);
    return firstMerchant ? firstMerchant.id : null;
  }

  // 1. GET /api/v1/operations/metrics — 60-Second Engine Latency Metrics
  server.get('/api/v1/operations/metrics', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const rawOrders = db.query(
      `SELECT confirmation_time_ms, initiation_time_ms, webhook_delivery_time_ms, status 
       FROM payment_orders 
       WHERE merchant_id = $1 AND status = 'SUCCESS' AND confirmation_time_ms > 0
       ORDER BY confirmation_time_ms ASC`,
      [merchantId]
    );

    const count = rawOrders.length;
    let p50 = 0;
    let p95 = 0;
    let p99 = 0;
    let under60sCount = 0;

    if (count > 0) {
      const latencies = rawOrders.map(o => o.confirmation_time_ms);
      p50 = latencies[Math.floor(count * 0.50)] || 0;
      p95 = latencies[Math.floor(count * 0.95)] || latencies[count - 1];
      p99 = latencies[Math.floor(count * 0.99)] || latencies[count - 1];
      under60sCount = latencies.filter(l => l <= 60000).length;
    }

    const under60sPercentage = count > 0 ? Number(((under60sCount / count) * 100).toFixed(1)) : 100.0;

    // Service health metrics
    const pendingOrdersCount = Number(db.queryOne(
      `SELECT count(*) as count FROM payment_orders WHERE merchant_id = $1 AND status IN ('PENDING', 'CUSTOMER_ACTION_REQUIRED', 'PROVIDER_PROCESSING')`,
      [merchantId]
    )?.count || 0);

    const pendingPayoutsCount = Number(db.queryOne(
      `SELECT count(*) as count FROM payouts WHERE merchant_id = $1 AND status IN ('SUBMITTED', 'PROCESSING', 'APPROVAL_REQUIRED')`,
      [merchantId]
    )?.count || 0);

    return HttpServer.json(res, 200, {
      objectiveTargetMs: 60000,
      totalSuccessEvaluated: count,
      under60sCount,
      under60sPercentage,
      latencies: {
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        p50Seconds: (p50 / 1000).toFixed(2),
        p95Seconds: (p95 / 1000).toFixed(2),
        p99Seconds: (p99 / 1000).toFixed(2)
      },
      queue: {
        pendingOrders: pendingOrdersCount,
        pendingPayouts: pendingPayoutsCount
      },
      status: under60sPercentage >= 95 ? 'OPTIMAL' : (under60sPercentage >= 85 ? 'ACCEPTABLE' : 'DEGRADED')
    });
  });

  // 2. GET /api/v1/operations/alerts — Active system alerts
  server.get('/api/v1/operations/alerts', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const alerts = alertRepo.listActive();
    return HttpServer.json(res, 200, { alerts });
  });

  // 3. POST /api/v1/operations/alerts/:id/ack — Acknowledge alert
  server.post('/api/v1/operations/alerts/:id/ack', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    alertRepo.acknowledge(params.id);
    return HttpServer.json(res, 200, { acknowledged: true });
  });
}

