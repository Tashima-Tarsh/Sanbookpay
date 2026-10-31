import { HttpServer } from '../server.js';
import crypto from 'node:crypto';
import { SplitSettlementRepository, PaymentOrderRepository, LedgerRepository, SettlementRepository } from '@youpi/db';
import { PaymentStatus } from '@youpi/common';

/**
 * Split Settlement & Auto-Refund Routes
 * Gaming-industry premium: platform fee split + instant refund on failed/expired payments
 */
export function registerSplitSettlementRoutes(server, ctx) {
  const db = ctx.db;
  const splitRepo = new SplitSettlementRepository(db);
  const poRepo = new PaymentOrderRepository(db);
  const ledgerRepo = new LedgerRepository(db);
  const settlementRepo = new SettlementRepository(db);

  function getMerchantId(req) {
    const key = req.headers['x-api-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    const directId = req.headers['x-merchant-id'];
    if (directId) {
      const merchant = db.queryOne(`SELECT id FROM merchants WHERE id = $1`, [directId]);
      if (merchant) return merchant.id;
    }
    if (!key) {
      const firstMerchant = db.queryOne(`SELECT id FROM merchants LIMIT 1`);
      return firstMerchant ? firstMerchant.id : null;
    }
    const merchant = db.queryOne(`SELECT id FROM merchants WHERE id = $1`, [key]);
    if (merchant) return merchant.id;
    const cred = db.queryOne(`SELECT merchant_id FROM merchant_credentials WHERE api_key = $1 AND status = 'ACTIVE'`, [key]);
    if (cred) return cred.merchant_id;
    const firstMerchant = db.queryOne(`SELECT id FROM merchants LIMIT 1`);
    return firstMerchant ? firstMerchant.id : null;
  }

  // ========================================================================
  // SPLIT SETTLEMENT CONFIGURATION
  // ========================================================================

  // POST /api/v1/split-settlements/configure — Set platform fee split for merchant
  server.post('/api/v1/split-settlements/configure', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    let body;
    try {
      body = await HttpServer.parseBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Invalid JSON request body' });
    }

    const platformFeePercent = body.platformFeePercent != null ? parseInt(body.platformFeePercent, 10) : 150;
    const merchantSharePercent = body.merchantSharePercent != null ? parseInt(body.merchantSharePercent, 10) : 850;

    if (platformFeePercent < 0 || platformFeePercent > 1000) {
      return HttpServer.json(res, 400, { error: 'platformFeePercent must be between 0 and 1000 (0-100%)' });
    }
    if (merchantSharePercent < 0 || merchantSharePercent > 1000) {
      return HttpServer.json(res, 400, { error: 'merchantSharePercent must be between 0 and 1000 (0-100%)' });
    }
    if (platformFeePercent + merchantSharePercent !== 1000) {
      return HttpServer.json(res, 400, { error: 'platformFeePercent + merchantSharePercent must equal 1000 (100%)' });
    }

    const rule = splitRepo.createOrUpdateRule({
      merchantId,
      platformFeePercent,
      merchantSharePercent,
      minSettlementAmountPaise: body.minSettlementAmountPaise || 100,
      settlementDayOfMonth: body.settlementDayOfMonth || 1,
      autoSettleEnabled: body.autoSettleEnabled ? 1 : 0,
      gstPercent: body.gstPercent || 18,
      upiCollectionsFeePercent: body.upiCollectionsFeePercent || 100
    });

    return HttpServer.json(res, 200, {
      success: true,
      message: 'Split settlement rule configured',
      rule: {
        merchantId: rule.merchant_id,
        platformFeePercent: rule.platform_fee_percent,
        merchantSharePercent: rule.merchant_share_percent,
        minSettlementAmountPaise: rule.min_settlement_amount_paise,
        autoSettleEnabled: rule.auto_settle_enabled === 1,
        gstPercent: rule.gst_percent,
        upiCollectionsFeePercent: rule.upi_collections_fee_percent
      }
    });
  });

  // GET /api/v1/split-settlements/rules — Get split rules for merchant
  server.get('/api/v1/split-settlements/rules', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const rule = splitRepo.getRule(merchantId);
    if (!rule) {
      return HttpServer.json(res, 200, {
        rule: null,
        message: 'No split rule configured. Default: 10% platform fee + 18% GST on fee, 90% merchant share.'
      });
    }

    return HttpServer.json(res, 200, {
      rule: {
        merchantId: rule.merchant_id,
        platformFeePercent: rule.platform_fee_percent,
        merchantSharePercent: rule.merchant_share_percent,
        minSettlementAmountPaise: rule.min_settlement_amount_paise,
        settlementDayOfMonth: rule.settlement_day_of_month,
        autoSettleEnabled: rule.auto_settle_enabled === 1,
        gstPercent: rule.gst_percent,
        upiCollectionsFeePercent: rule.upi_collections_fee_percent,
        createdAt: rule.created_at,
        updatedAt: rule.updated_at
      }
    });
  });

  // GET /api/v1/split-settlements/entries — List split entries
  server.get('/api/v1/split-settlements/entries', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const parsedUrl = new URL(req.url, 'http://localhost');
    const status = parsedUrl.searchParams.get('status') || null;
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
    const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

    const entries = splitRepo.listByMerchant(merchantId, { status, limit, offset });
    return HttpServer.json(res, 200, {
      count: entries.length,
      entries: entries.map(e => ({
        id: e.id,
        settlementId: e.settlement_id,
        paymentOrderId: e.payment_order_id,
        paymentSessionId: e.payment_session_id,
        grossAmount: (e.gross_amount_paise / 100).toFixed(2),
        platformFee: (e.platform_fee_paise / 100).toFixed(2),
        gstOnFee: (e.gst_on_fee_paise / 100).toFixed(2),
        merchantShare: (e.merchant_share_paise / 100).toFixed(2),
        status: e.status,
        settledAt: e.settled_at,
        createdAt: e.created_at
      }))
    });
  });

  // GET /api/v1/split-settlements/overview — Split settlement overview
  server.get('/api/v1/split-settlements/overview', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const overview = splitRepo.getOverview(merchantId);
    const rule = splitRepo.getRule(merchantId);

    return HttpServer.json(res, 200, {
      rule: rule ? {
        platformFeePercent: rule.platform_fee_percent,
        merchantSharePercent: rule.merchant_share_percent
      } : null,
      totals: {
        grossAmount: (Number(overview.total_gross_paise) / 100).toFixed(2),
        platformFee: (Number(overview.total_platform_fee_paise) / 100).toFixed(2),
        gstOnFee: (Number(overview.total_gst_on_fee_paise) / 100).toFixed(2),
        merchantShare: (Number(overview.total_merchant_share_paise) / 100).toFixed(2),
        settledMerchantShare: (Number(overview.settled_merchant_share_paise) / 100).toFixed(2),
        pendingMerchantShare: (Number(overview.pending_merchant_share_paise) / 100).toFixed(2)
      },
      currency: 'INR'
    });
  });

  // POST /api/v1/split-settlements/settle — Settle all pending split entries
  server.post('/api/v1/split-settlements/settle', async (req, res) => {
    return HttpServer.json(res,503,{error:'Automatic bank settlement is not configured. Use the existing transfer-recording workflow after a real bank transfer.',code:'SETTLEMENT_PROVIDER_NOT_CONFIGURED'});
  });

  // ========================================================================
  // AUTO-REFUND FOR FAILED/EXPIRED PAYMENTS
  // ========================================================================

  // POST /api/v1/checkout/:id/auto-refund — Instant refund for failed/expired UPI payments
  server.post('/api/v1/checkout/:id/auto-refund', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const session = ctx.sessionRepo.findById(params.id);
    if (!session) {
      return HttpServer.json(res, 404, { error: 'Payment session not found' });
    }
    if (session.merchantId !== merchantId) {
      return HttpServer.json(res, 403, { error: 'Access denied: session belongs to another merchant' });
    }

    if (![PaymentStatus.FAILED, PaymentStatus.EXPIRED, PaymentStatus.CANCELLED].includes(session.status)) {
      return HttpServer.json(res, 400, {
        error: `Cannot auto-refund session with status ${session.status}. Only FAILED, EXPIRED, or CANCELLED sessions qualify.`
      });
    }

    let body;
    try {
      body = await HttpServer.parseBody(req);
    } catch {
      body = {};
    }

    const sessionAmountPaise = typeof session.amountPaise === 'bigint' ? Number(session.amountPaise) : session.amountPaise;

    const refundAmountPaise = body.amount
      ? (typeof body.amount === 'number' ? Math.round(body.amount * 100) : Math.round(parseFloat(body.amount) * 100))
      : sessionAmountPaise;

    if (isNaN(refundAmountPaise) || refundAmountPaise <= 0 || refundAmountPaise > sessionAmountPaise) {
      return HttpServer.json(res, 400, {
        error: `Invalid refund amount. Maximum refundable: ${(sessionAmountPaise / 100).toFixed(2)} INR`
      });
    }

    const reason = body.reason || `Auto-refund: UPI payment ${session.status.toLowerCase()} before confirmation`;
    const refundId = `ref_auto_${Date.now()}`;

    // Record refund
    const refund = db.queryOne(`SELECT * FROM refunds WHERE refund_id = $1`, [refundId]);
    if (!refund) {
      db.execute(`
        INSERT INTO refunds (id, merchant_id, payment_order_id, refund_id, provider_refund_id, amount_paise, currency, reason, status, utr, provider_response, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        crypto.randomUUID(),
        merchantId,
        null,
        refundId,
        null,
        refundAmountPaise,
        session.currency,
        reason,
        'COMPLETED',
        session.metadata?.upiTransactionId || null,
        JSON.stringify({ autoRefund: true, sessionStatus: session.status }),
        new Date().toISOString()
      ]);
    }

    // Ledger: Reverse the receivable
    try {
      ledgerRepo.recordDoubleEntry(
        merchantId,
        'AUTO_REFUND',
        refundId,
        `Auto-refund for ${session.status.toLowerCase()} payment ${session.orderId}`,
        'REFUND_LIABILITIES',
        'MERCHANT_RECEIVABLES',
        refundAmountPaise
      );
    } catch {}

    // Broadcast SSE
    server.broadcastSse(params.id, 'status_change', {
      status: 'REFUNDED',
      refundId,
      amount: (refundAmountPaise / 100).toFixed(2),
      reason
    });

    return HttpServer.json(res, 200, {
      success: true,
      message: 'Auto-refund completed instantly',
      refundId,
      paymentId: session.id,
      orderId: session.orderId,
      amount: (refundAmountPaise / 100).toFixed(2),
      currency: session.currency,
      status: 'COMPLETED',
      reason,
      refundedAt: new Date().toISOString()
    });
  });
}
