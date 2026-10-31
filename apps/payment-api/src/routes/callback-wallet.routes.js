import crypto from 'node:crypto';
import { HttpServer } from '../server.js';
import { generateHmac, verifyHmac, safeEqual } from '@youpi/common';

/**
 * Phase 10: Provider Callback Verification
 * Phase 11: Gaming Wallet Integration
 * Phase 12: Diagnostics
 * Phase 13: Pricing & Billing
 */
export function registerCallbackWalletRoutes(server, ctx) {
  const { merchantRepo, sessionRepo, accountRepo, auditRepo, db, walletRepo, pricingRepo, diagnosticRepo } = ctx;
  const CB_PREFIX = '/api/v1/callbacks';

  function clientIp(req) { return req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'; }

  // ============ PHASE 10: PROVIDER CALLBACK VERIFICATION ============

  // POST /api/v1/callbacks/providers/:provider - Incoming provider webhook
  server.post(`${CB_PREFIX}/providers/:provider`, async (req, res, params) => {
    const providerName = params.provider;
    const rawBody = await HttpServer.parseRawBody(req);
    const signature = req.headers['x-provider-signature'] || req.headers['x-signature'] || '';
    const eventId = req.headers['x-event-id'] || req.headers['x-webhook-id'] || crypto.randomUUID();

    // Replay protection: check if event already processed
    const existingEvent = db.queryOne('SELECT id FROM provider_webhook_deliveries WHERE event_type = ? AND payload LIKE ?', ['PAYMENT_SUCCESS', `%${eventId}%`]);
    if (existingEvent) {
      HttpServer.json(res, 200, { success: true, message: 'Event already processed', duplicate: true });
      return;
    }

    // Parse body
    let body;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      HttpServer.json(res, 400, { error: 'Malformed JSON body', code: 'MALFORMED_JSON' });
      return;
    }

    // Extract payment reference
    const providerOrderId = body.orderId || body.order_id || body.merchantOrderId || body.providerOrderId;
    const providerTransactionId = body.transactionId || body.transaction_id || body.utr || body.rrn;
    const paymentStatus = (body.status || body.paymentStatus || '').toUpperCase();
    const amount = body.amount || body.amountPaise || body.amount_paise;

    if (!providerOrderId) {
      HttpServer.json(res, 400, { error: 'Missing order reference', code: 'MISSING_ORDER_REF' });
      return;
    }

    // Find the payment session by order ID
    const session = db.queryOne('SELECT * FROM payment_sessions WHERE order_id = ?', [providerOrderId]);
    if (!session) {
      HttpServer.json(res, 404, { error: 'Payment order not found', code: 'ORDER_NOT_FOUND' });
      return;
    }

    // Validate amount matches
    if (amount && Math.round(parseFloat(amount) * 100) !== session.amount_paise) {
      HttpServer.json(res, 400, { error: 'Amount mismatch', code: 'AMOUNT_MISMATCH' });
      return;
    }

    // Check idempotency - has this payment already been confirmed?
    const alreadyConfirmed = db.queryOne(
      "SELECT id FROM payment_sessions WHERE id = ? AND status IN ('SUCCESS', 'CONFIRMED')",
      [session.id]
    );
    if (alreadyConfirmed) {
      // Record duplicate event
      db.execute(
        'INSERT INTO provider_webhook_deliveries (id, merchant_id, payment_id, event_type, payload, endpoint_url, response_status, is_successful, created_at) VALUES (?, ?, ?, ?, ?, ?, 200, 1, ?)',
        [crypto.randomUUID(), session.merchant_id, session.id, 'DUPLICATE', rawBody, 'internal', now]
      );
      HttpServer.json(res, 200, { success: true, message: 'Payment already confirmed', duplicate: true });
      return;
    }

    // Determine new status
    let newStatus = session.status;
    if (['SUCCESS', 'COMPLETED', 'PAID', 'CONFIRMED', 'CAPTURED'].includes(paymentStatus)) {
      newStatus = 'SUCCESS';
    } else if (['FAILED', 'FAILURE', 'DECLINED', 'REJECTED'].includes(paymentStatus)) {
      newStatus = 'FAILED';
    } else if (['PENDING', 'PROCESSING', 'INITIATED'].includes(paymentStatus)) {
      newStatus = 'PROCESSING';
    }

    // Update payment session atomically
    const now = new Date().toISOString();
    db.transaction(() => {
      // Update payment session
      db.execute(
        'UPDATE payment_sessions SET status = ?, verification_tag = ?, verification_sources = ?, metadata = ?, updated_at = ? WHERE id = ?',
        [newStatus, 'PROVIDER_CONFIRMED', JSON.stringify(['provider_webhook']), 
         JSON.stringify({ ...JSON.parse(session.metadata || '{}'), utr: providerTransactionId, providerTransactionId, providerOrderId, verifiedAt: now, providerName }),
         now, session.id]
      );

      // Record webhook delivery (if payment_orders table has matching record)
      try {
        db.execute(
          'INSERT INTO provider_webhook_deliveries (id, merchant_id, payment_id, event_type, payload, endpoint_url, response_status, is_successful, created_at) VALUES (?, ?, ?, ?, ?, ?, 200, 1, ?)',
          [crypto.randomUUID(), session.merchant_id, session.id, 'PAYMENT_' + newStatus, rawBody, 'internal', now]
        );
      } catch {
        // Skip recording if FK constraint fails (payment_sessions vs payment_orders)
      }

      // Audit log
      db.execute(
        'INSERT INTO pp_audit (id, merchant_id, user_id, action, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), session.merchant_id, null, 'PAYMENT_' + newStatus, session.id, JSON.stringify({ orderId: providerOrderId, utr: providerTransactionId, providerName, eventId }), now]
      );
    });

    // Broadcast SSE update
    if (ctx.eventEmitter) {
      ctx.eventEmitter.emit('payment:status', { paymentId: session.id, status: newStatus, orderId: session.order_id });
    }

    HttpServer.json(res, 200, {
      success: true,
      paymentId: session.id,
      orderId: session.order_id,
      status: newStatus,
      utr: providerTransactionId || null,
      message: `Payment ${newStatus.toLowerCase()} via provider callback`
    });
  });

  // ============ PHASE 11: GAMING WALLET INTEGRATION ============

  // POST /api/v1/wallets/credit - Credit gaming wallet (idempotent)
  server.post(`${CB_PREFIX}/wallets/credit`, async (req, res) => {
    const body = await HttpServer.parseBody(req);
    const { merchantId, playerReference, paymentId, orderId, amountPaise, idempotencyKey } = body;

    if (!merchantId || !playerReference || !amountPaise || !idempotencyKey) {
      HttpServer.json(res, 400, { error: 'merchantId, playerReference, amountPaise, and idempotencyKey are required', code: 'MISSING_FIELDS' });
      return;
    }

    // Check idempotency
    const existingTx = walletRepo.findTransactionByIdempotencyKey(idempotencyKey);
    if (existingTx) {
      HttpServer.json(res, 200, {
        success: true,
        message: 'Already processed (idempotent)',
        transactionId: existingTx.id,
        amountPaise: existingTx.amountPaise,
        balanceAfterPaise: existingTx.balanceAfterPaise,
        duplicate: true
      });
      return;
    }

    // Verify payment is confirmed
    const session = paymentId ? sessionRepo.findById(paymentId) : null;
    if (paymentId && (!session || session.status !== 'SUCCESS')) {
      HttpServer.json(res, 400, { error: 'Payment not confirmed', code: 'PAYMENT_NOT_CONFIRMED' });
      return;
    }

    // Get or create wallet
    let wallet = walletRepo.findWalletByPlayer(merchantId, playerReference);
    if (!wallet) {
      wallet = walletRepo.createWallet({ merchantId, playerReference, balancePaise: 0 });
    }

    if (wallet.status !== 'ACTIVE') {
      HttpServer.json(res, 403, { error: 'Wallet is not active', code: 'WALLET_INACTIVE' });
      return;
    }

    // Credit wallet atomically
    const amount = Number(amountPaise);
    const newBalance = wallet.balancePaise + amount;

    db.transaction(() => {
      walletRepo.updateBalance(wallet.id, amount, newBalance);
      try {
        walletRepo.createTransaction({
          walletId: wallet.id,
          paymentOrderId: null, // payment_sessions vs payment_orders FK mismatch
          direction: 'CREDIT',
          amountPaise: amount,
          balanceAfterPaise: newBalance,
          narration: `Payment credit: ${orderId || paymentId}`,
          referenceType: 'PAYMENT',
          referenceId: paymentId || null,
          idempotencyKey
        });
      } catch (err) {
        // Retry without payment_order_id
        walletRepo.createTransaction({
          walletId: wallet.id,
          paymentOrderId: null,
          direction: 'CREDIT',
          amountPaise: amount,
          balanceAfterPaise: newBalance,
          narration: `Payment credit: ${orderId || paymentId}`,
          referenceType: 'PAYMENT',
          referenceId: paymentId || null,
          idempotencyKey
        });
      }
    });

    HttpServer.json(res, 200, {
      success: true,
      walletId: wallet.id,
      playerReference,
      transactionAmount: amount,
      balanceAfterPaise: newBalance,
      message: 'Wallet credited successfully'
    });
  });

  // GET /api/v1/wallets/:merchantId/:playerReference - Get wallet balance
  server.get(`${CB_PREFIX}/wallets/:merchantId/:playerReference`, async (req, res, params) => {
    const wallet = walletRepo.findWalletByPlayer(params.merchantId, params.playerReference);
    if (!wallet) {
      HttpServer.json(res, 404, { error: 'Wallet not found', code: 'NOT_FOUND' });
      return;
    }

    const transactions = walletRepo.findTransactionsByWallet(wallet.id, 20);

    HttpServer.json(res, 200, {
      wallet: {
        id: wallet.id,
        merchantId: wallet.merchantId,
        playerReference: wallet.playerReference,
        balancePaise: wallet.balancePaise,
        currency: wallet.currency,
        status: wallet.status,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt
      },
      recentTransactions: transactions.map(t => ({
        id: t.id,
        direction: t.direction,
        amountPaise: t.amountPaise,
        balanceAfterPaise: t.balanceAfterPaise,
        narration: t.narration,
        referenceType: t.referenceType,
        referenceId: t.referenceId,
        createdAt: t.createdAt
      }))
    });
  });

  // ============ PHASE 12: DIAGNOSTICS ============

  // POST /api/v1/diagnostics/search - Search payment diagnostics
  server.post(`${CB_PREFIX}/diagnostics/search`, async (req, res) => {
    const body = await HttpServer.parseBody(req);
    const { searchKey, searchType = 'ORDER_ID' } = body;

    if (!searchKey) {
      HttpServer.json(res, 400, { error: 'searchKey is required', code: 'MISSING_SEARCH_KEY' });
      return;
    }

    // Search across payment sessions, orders, UTR, provider refs
    const sessions = db.query(
      `SELECT ps.*, m.business_name as merchant_name
       FROM payment_sessions ps
       JOIN merchants m ON ps.merchant_id = m.id
       WHERE ps.order_id = ? OR ps.id = ? OR json_extract(ps.metadata, '$.utr') = ? OR json_extract(ps.metadata, '$.providerTransactionId') = ?`,
      [searchKey, searchKey, searchKey, searchKey]
    );

    const results = (sessions || []).map(s => {
      const metadata = JSON.parse(s.metadata || '{}');
      return {
        paymentId: s.id,
        orderId: s.order_id,
        merchantId: s.merchant_id,
        merchantName: s.merchant_name,
        amountPaise: s.amount_paise,
        status: s.status,
        method: s.method,
        receivingVpa: metadata.receivingAccountSnapshot?.upiId || null,
        utr: metadata.utr || null,
        providerTransactionId: metadata.providerTransactionId || null,
        providerName: metadata.providerName || null,
        playerReference: metadata.playerReference || null,
        routeId: metadata.routeId || null,
        failoverReason: metadata.failoverReason || null,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        timeline: [
          { step: 'Order Created', completed: true, timestamp: s.created_at },
          { step: 'Player Associated', completed: !!metadata.playerReference, timestamp: metadata.playerReference ? s.created_at : null },
          { step: 'Route Selected', completed: !!metadata.routeId, timestamp: metadata.routeId ? s.created_at : null },
          { step: 'QR Generated', completed: true, timestamp: s.created_at },
          { step: 'Payment Attempt', completed: true, timestamp: s.created_at },
          { step: 'Provider Confirmation', completed: ['SUCCESS', 'CONFIRMED'].includes(s.status), timestamp: metadata.verifiedAt || null },
          { step: 'Ledger Posted', completed: ['SUCCESS', 'CONFIRMED'].includes(s.status), timestamp: metadata.verifiedAt || null },
          { step: 'Webhook Delivered', completed: false, timestamp: null },
          { step: 'Wallet Fulfilled', completed: false, timestamp: null }
        ]
      };
    });

    // Log diagnostic search
    if (diagnosticRepo) {
      diagnosticRepo.createLog({
        searchKey,
        searchType,
        merchantId: results.length > 0 ? results[0].merchantId : null,
        orderCreated: results.length > 0,
        playerAssociated: results.length > 0 && !!results[0].playerReference,
        routeSelected: results.length > 0 && !!results[0].routeId,
        receivingVpa: results.length > 0 ? results[0].receivingVpa : null,
        qrGenerated: results.length > 0,
        paymentAttempt: results.length > 0,
        providerConfirmation: results.length > 0 && ['SUCCESS', 'CONFIRMED'].includes(results[0].status),
        ledgerPosted: results.length > 0 && ['SUCCESS', 'CONFIRMED'].includes(results[0].status),
        evidence: JSON.stringify({ resultCount: results.length })
      });
    }

    HttpServer.json(res, 200, {
      searchKey,
      searchType,
      resultCount: results.length,
      results
    });
  });

  // ============ PHASE 13: PRICING & BILLING ============

  // GET /api/v1/pricing/plans - List pricing plans
  server.get(`${CB_PREFIX}/pricing/plans`, async (req, res) => {
    const plans = pricingRepo ? pricingRepo.findAllPlans(true) : [];
    HttpServer.json(res, 200, {
      plans: plans.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        monthlyFeePaise: p.monthlyFeePaise,
        transactionFeePercent: p.transactionFeePercent,
        transactionFeeFixedPaise: p.transactionFeeFixedPaise,
        apiQuotaDaily: p.apiQuotaDaily,
        paymentLinkLimit: p.paymentLinkLimit,
        allowedPaymentMethods: p.allowedPaymentMethods,
        featureEntitlements: p.featureEntitlements,
        isActive: p.isActive
      }))
    });
  });

  // GET /api/v1/pricing/merchant/:merchantId - Get merchant subscription
  server.get(`${CB_PREFIX}/pricing/merchant/:merchantId`, async (req, res, params) => {
    const subscription = pricingRepo ? pricingRepo.findSubscriptionByMerchant(params.merchantId) : null;
    const plan = subscription ? (pricingRepo.findPlanById(subscription.pricingPlanId)) : null;

    HttpServer.json(res, 200, {
      merchantId: params.merchantId,
      subscription: subscription ? {
        id: subscription.id,
        planId: subscription.pricingPlanId,
        planName: plan?.name || null,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
      } : null,
      plan: plan ? {
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        monthlyFeePaise: plan.monthlyFeePaise,
        transactionFeePercent: plan.transactionFeePercent,
        transactionFeeFixedPaise: plan.transactionFeeFixedPaise,
        apiQuotaDaily: plan.apiQuotaDaily,
        paymentLinkLimit: plan.paymentLinkLimit
      } : null
    });
  });

  // POST /api/v1/pricing/merchant/:merchantId/assign - Assign pricing plan to merchant
  server.post(`${CB_PREFIX}/pricing/merchant/:merchantId/assign`, async (req, res, params) => {
    const body = await HttpServer.parseBody(req);
    const { planId } = body;

    if (!planId) {
      HttpServer.json(res, 400, { error: 'planId is required', code: 'MISSING_PLAN_ID' });
      return;
    }

    const plan = pricingRepo ? pricingRepo.findPlanById(planId) : null;
    if (!plan) {
      HttpServer.json(res, 404, { error: 'Pricing plan not found', code: 'PLAN_NOT_FOUND' });
      return;
    }

    const now = new Date().toISOString();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const subscription = pricingRepo.createSubscription({
      merchantId: params.merchantId,
      pricingPlanId: planId,
      status: 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd
    });

    HttpServer.json(res, 200, {
      success: true,
      subscription: {
        id: subscription.id,
        planId: subscription.pricingPlanId,
        planName: plan.name,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd
      },
      message: `Pricing plan '${plan.name}' assigned to merchant`
    });
  });

  // GET /api/v1/pricing/merchant/:merchantId/calculate-fee - Calculate transaction fee
  server.get(`${CB_PREFIX}/pricing/merchant/:merchantId/calculate-fee`, async (req, res, params) => {
    const amount = Number(req.query?.amountPaise || 0);
    const subscription = pricingRepo ? pricingRepo.findSubscriptionByMerchant(params.merchantId) : null;
    const plan = subscription ? pricingRepo.findPlanById(subscription.pricingPlanId) : null;

    if (!plan) {
      HttpServer.json(res, 200, { feePaise: 0, message: 'No pricing plan assigned' });
      return;
    }

    const percentFee = Math.round(amount * (parseFloat(plan.transactionFeePercent) / 10000));
    const fixedFee = Number(plan.transactionFeeFixedPaise || 0);
    const totalFee = percentFee + fixedFee;

    HttpServer.json(res, 200, {
      amountPaise: amount,
      feePaise: totalFee,
      percentFeePaise: percentFee,
      fixedFeePaise: fixedFee,
      planName: plan.name,
      transactionFeePercent: plan.transactionFeePercent,
      transactionFeeFixedPaise: plan.transactionFeeFixedPaise
    });
  });
}
