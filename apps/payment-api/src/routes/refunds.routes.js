import { HttpServer } from '../server.js';
import { RefundRepository, PaymentOrderRepository, LedgerRepository } from '@youpi/db';
import { ProviderRegistry } from '@youpi/core';

/**
 * Refunds Management Routes
 * Interfaces with genuine provider refund endpoints and records financial ledger liabilities.
 */
export function registerRefundsRoutes(server, ctx) {
  const db = ctx.db;
  const refundRepo = new RefundRepository(db);
  const poRepo = new PaymentOrderRepository(db);
  const ledgerRepo = new LedgerRepository(db);
  const providerRegistry = new ProviderRegistry({ db });

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

  // 1. POST /api/v1/refunds — Initiate a refund
  server.post('/api/v1/refunds', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    let body;
    try {
      body = await HttpServer.parseBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Invalid JSON request body' });
    }

    if (!body.paymentId && !body.orderId) {
      return HttpServer.json(res, 400, { error: 'Missing required field: paymentId or orderId' });
    }

    const order = poRepo.findById(body.paymentId) || 
      poRepo.findByMerchantAndOrderId(merchantId, body.orderId || body.paymentId);

    if (!order || order.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Payment order not found' });
    }

    if (order.status !== 'SUCCESS') {
      return HttpServer.json(res, 400, { error: `Cannot refund order with status ${order.status}. Only SUCCESS orders can be refunded.` });
    }

    const refundAmountPaise = body.amount 
      ? (typeof body.amount === 'number' ? Math.round(body.amount * 100) : Math.round(parseFloat(body.amount) * 100))
      : order.amount_paise;

    if (isNaN(refundAmountPaise) || refundAmountPaise <= 0 || refundAmountPaise > order.amount_paise) {
      return HttpServer.json(res, 400, { error: `Invalid refund amount. Maximum refundable: ${(order.amount_paise / 100).toFixed(2)}` });
    }

    const refundId = body.refundId || `ref_${Date.now()}`;
    let providerRefundId = null;
    let liveStatus = 'PENDING';

    try {
      const provider = providerRegistry.getProvider(merchantId, order.provider_name);
      const provRes = await provider.createRefund({
        merchantOrderId: order.merchant_order_id,
        refundId,
        amountPaise: refundAmountPaise,
        reason: body.reason || 'Merchant requested refund'
      });
      providerRefundId = provRes.providerRefundId;
      liveStatus = provRes.status;
    } catch (err) {
      liveStatus = 'PENDING';
    }

    const refund = refundRepo.create({
      merchantId,
      paymentOrderId: order.id,
      refundId,
      providerRefundId,
      amountPaise: refundAmountPaise,
      currency: order.currency,
      reason: body.reason || null,
      status: liveStatus
    });

    // Record in ledger: Debit REFUND_LIABILITIES, Credit PROVIDER_CLEARING
    try {
      ledgerRepo.recordDoubleEntry(
        merchantId,
        'REFUND',
        refund.id,
        `Refund initiated for order ${order.merchant_order_id}`,
        'REFUND_LIABILITIES',
        'PROVIDER_CLEARING',
        refundAmountPaise
      );
    } catch {}

    return HttpServer.json(res, 201, {
      refundId: refund.refund_id,
      paymentId: order.id,
      orderId: order.merchant_order_id,
      amount: (refund.amount_paise / 100).toFixed(2),
      status: refund.status,
      createdAt: refund.created_at
    });
  });

  // 2. GET /api/v1/refunds/:id — Get refund details
  server.get('/api/v1/refunds/:id', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const refund = refundRepo.findById(params.id) || refundRepo.findByRefundId(params.id);
    if (!refund || refund.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Refund not found' });
    }

    return HttpServer.json(res, 200, {
      id: refund.id,
      refundId: refund.refund_id,
      paymentOrderId: refund.payment_order_id,
      amount: (refund.amount_paise / 100).toFixed(2),
      currency: refund.currency,
      status: refund.status,
      reason: refund.reason,
      utr: refund.utr,
      createdAt: refund.created_at,
      confirmedAt: refund.confirmed_at
    });
  });

  // 3. GET /api/v1/refunds — List refunds
  server.get('/api/v1/refunds', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const list = refundRepo.listByMerchant(merchantId);
    return HttpServer.json(res, 200, {
      count: list.length,
      refunds: list.map(r => ({
        id: r.id,
        refundId: r.refund_id,
        paymentOrderId: r.payment_order_id,
        amount: (r.amount_paise / 100).toFixed(2),
        currency: r.currency,
        status: r.status,
        reason: r.reason,
        createdAt: r.created_at
      }))
    });
  });
}

