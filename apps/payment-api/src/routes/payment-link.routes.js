import crypto from 'node:crypto';
import { HttpServer } from '../server.js';
import { generateRandomToken, safeEqual } from '@youpi/common';

/**
 * Amount-Only Payment Links & Automatic Failover
 * 
 * Phase 9: Amount-only payment link creation (no manual Order ID, customer name, mobile, or UTR)
 * Phase 8: Automatic failover when primary route is unavailable
 */
export function registerPaymentLinkRoutes(server, ctx) {
  const { merchantRepo, accountRepo, sessionRepo, routingEngine, auditRepo, db } = ctx;
  const PAYMENT_LINK_PREFIX = '/api/v1/payment-links';

  function clientIp(req) {
    return req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  }

  function logAudit(merchantId, action, entityType, entityId, details, req) {
    try {
      auditRepo.log({
        merchantId,
        entityType,
        entityId: entityId || '',
        action,
        actorType: 'MERCHANT',
        actorId: merchantId,
        details: JSON.stringify({ ...details, ip: clientIp(req) }),
        ip_address: clientIp(req)
      });
    } catch {}
  }

  // ============ PHASE 9: AMOUNT-ONLY PAYMENT LINK ============

  // POST /api/v1/payment-links/amount-only
  // Creates a payment link requiring only amount. No manual Order ID, customer details, or UTR.
  server.post(`${PAYMENT_LINK_PREFIX}/amount-only`, async (req, res) => {
    // Merchant authentication via API key
    const authHeader = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    const apiKey = match ? match[1] : '';

    if (!apiKey) {
      HttpServer.json(res, 401, { error: 'API key required', code: 'AUTH_REQUIRED' });
      return;
    }

    // Validate API key format: dp_(live|test)_[...]
    const keyCredential = /^dp_(?:live|test)_[A-Za-z0-9_-]+$/i.exec(apiKey);
    if (!keyCredential) {
      HttpServer.json(res, 401, { error: 'Invalid API key format', code: 'INVALID_API_KEY' });
      return;
    }

    const keyRow = ctx.db.queryOne('SELECT * FROM pp_api_keys WHERE secret_hash = ?', [crypto.createHash('sha256').update(apiKey).digest('hex')]);
    if (!keyRow || keyRow.revoked_at) {
      HttpServer.json(res, 401, { error: 'Invalid or revoked API key', code: 'INVALID_API_KEY' });
      return;
    }

    const merchantId = keyRow.merchant_id;
    const merchant = merchantRepo.findById(merchantId);
    if (!merchant) {
      HttpServer.json(res, 404, { error: 'Merchant not found', code: 'NOT_FOUND' });
      return;
    }

    // Check merchant is active
    const branding = merchant.branding || {};
    if (branding.status !== 'ACTIVE') {
      HttpServer.json(res, 403, { error: 'Merchant is not active', code: 'MERCHANT_NOT_ACTIVE' });
      return;
    }

    const body = await HttpServer.parseBody(req);
    const { amount, currency = 'INR', playerReference, expiryMinutes } = body;

    // Validate amount - required and must be positive
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      HttpServer.json(res, 400, { error: 'Valid amount is required', code: 'INVALID_AMOUNT' });
      return;
    }

    const amountPaise = Math.round(parseFloat(amount) * 100);
    const currencyUpper = (currency || 'INR').toUpperCase();
    if (currencyUpper !== 'INR') {
      HttpServer.json(res, 400, { error: 'Only INR currency is supported', code: 'UNSUPPORTED_CURRENCY' });
      return;
    }

    // Check amount limits from merchant branding
    const maxAmount = branding.maxAmountPaise || 100000000; // Default 10,00,000 INR
    const minAmount = branding.minAmountPaise || 100; // Default 1 INR
    if (amountPaise < minAmount || amountPaise > maxAmount) {
      HttpServer.json(res, 400, { error: `Amount must be between ₹${(minAmount/100).toFixed(2)} and ₹${(maxAmount/100).toFixed(2)}`, code: 'AMOUNT_OUT_OF_RANGE' });
      return;
    }

    // Generate unique Order ID (server-generated, not manual)
    const orderId = `SBO-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    // Generate unique Payment ID
    const paymentId = crypto.randomUUID();

    // Phase 7: Smart route selection
    let selection;
    try {
      selection = routingEngine.selectRoute(merchantId, amountPaise);
    } catch (err) {
      // Routing engine may not be initialized
      selection = null;
    }

    if (!selection) {
      // Phase 8: No eligible route - fail safely
      logAudit(merchantId, 'PAYMENT_LINK_NO_ROUTE', 'PAYMENT_LINK', orderId, {
        amountPaise, currency: currencyUpper, reason: 'No eligible receiving route'
      }, req);

      HttpServer.json(res, 503, {
        error: 'No eligible receiving route available',
        code: 'NO_ROUTE_AVAILABLE',
        orderId,
        message: 'Payment creation failed safely - no receiving route is available'
      });
      return;
    }

    const receivingAccount = selection.receivingAccount;
    if (!receivingAccount) {
      HttpServer.json(res, 503, {
        error: 'No receiving account configured for selected route',
        code: 'NO_RECEIVING_ACCOUNT',
        orderId
      });
      return;
    }

    // Calculate expiry
    const expiryMin = expiryMinutes || 30;
    const expiresAt = new Date(Date.now() + expiryMin * 60000).toISOString();

    // Create payment session (Phase 9: automatic order creation)
    let paymentSession;
    try {
      paymentSession = db.transaction(() => {
        return sessionRepo.create({
          id: paymentId,
          merchantId,
          receivingAccountId: receivingAccount.id,
          orderId,
          amountPaise,
          currency: currencyUpper,
          method: 'UPI',
          status: 'QUEUED',
          metadata: {
            receivingAccountSnapshot: {
              id: receivingAccount.id,
              upiId: receivingAccount.upiId,
              payeeName: receivingAccount.payeeName
            },
            playerReference: playerReference || null,
            amountOnly: true,
            routeSelectionReason: selection.selectionReason,
            routeId: selection.route.id
          }
        });
      });
    } catch (err) {
      HttpServer.json(res, 500, { error: 'Failed to create payment session', code: 'SESSION_CREATION_FAILED' });
      return;
    }

    // Phase 8: Start timing engine for this payment
    if (ctx.timingEngine) {
      try {
        ctx.timingEngine.startActiveTimer(paymentId, expiresAt);
      } catch {}
    }

    // Generate UPI intent URI
    const upiUri = `upi://pay?pa=${encodeURIComponent(receivingAccount.upiId)}&pn=${encodeURIComponent(receivingAccount.payeeName || '')}&am=${(amountPaise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(orderId)}`;

    // Generate checkout URL
    const baseUrl = (process.env.DYNAMO_PUBLIC_URL || ctx.checkoutBaseUrl || 'http://127.0.0.1:6100').replace(/\/$/, '');
    const checkoutUrl = `${baseUrl}/checkout/${paymentId}`;
    const qrUrl = `${baseUrl}/checkout/${paymentId}/qr.svg`;

    // Log audit
    logAudit(merchantId, 'PAYMENT_LINK_CREATED', 'PAYMENT_LINK', paymentId, {
      orderId,
      amountPaise,
      currency: currencyUpper,
      receivingAccountId: receivingAccount.id,
      upiId: receivingAccount.upiId,
      routeId: selection.route.id,
      playerReference: playerReference || null
    }, req);

    // Return response - no manual UTR, no manual Order ID exposed to customer
    HttpServer.json(res, 201, {
      success: true,
      paymentId,
      orderId, // Server-generated, returned for reference
      amount: (amountPaise / 100).toFixed(2),
      amountPaise,
      currency: currencyUpper,
      status: 'QUEUED',
      checkoutUrl,
      qrUrl,
      upiIntent: upiUri,
      receivingVpa: receivingAccount.upiId,
      receivingAccountName: receivingAccount.payeeName,
      routeId: selection.route.id,
      expiresAt,
      message: 'Payment link created successfully. Share the checkout URL with your customer.'
    });
  });

  // ============ PHASE 8: AUTOMATIC FAILOVER ============

  // POST /api/v1/payment-links/:id/failover - Trigger manual failover for a payment
  server.post(`${PAYMENT_LINK_PREFIX}/:id/failover`, async (req, res, params) => {
    const authHeader = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    const apiKey = match ? match[1] : '';

    if (!apiKey) {
      HttpServer.json(res, 401, { error: 'API key required', code: 'AUTH_REQUIRED' });
      return;
    }

    const keyRow = ctx.db.queryOne('SELECT * FROM pp_api_keys WHERE secret_hash = ?', [crypto.createHash('sha256').update(apiKey).digest('hex')]);
    if (!keyRow || keyRow.revoked_at) {
      HttpServer.json(res, 401, { error: 'Invalid or revoked API key', code: 'INVALID_API_KEY' });
      return;
    }

    const merchantId = keyRow.merchant_id;

    const session = sessionRepo.findById(params.id);
    if (!session || session.merchantId !== merchantId) {
      HttpServer.json(res, 404, { error: 'Payment not found', code: 'NOT_FOUND' });
      return;
    }

    const body = await HttpServer.parseBody(req);
    const { reason = 'Manual failover', trigger = 'MERCHANT_REQUEST' } = body;

    // Get current route
    const currentRouteId = session.metadata?.routeId;
    const currentAccountId = session.receivingAccountId;

    // Try to select a new route (excluding current)
    const allRules = ctx.routingRepo ? ctx.routingRepo.findActiveRulesByMerchant(merchantId) : [];
    const alternativeRules = allRules.filter(r => r.receivingAccountId !== currentAccountId);

    if (alternativeRules.length === 0) {
      HttpServer.json(res, 400, {
        error: 'No alternative route available for failover',
        code: 'NO_ALTERNATIVE_ROUTE',
        paymentId: params.id
      });
      return;
    }

    // Select the best alternative
    const allHealth = ctx.routingRepo ? ctx.routingRepo.findAllHealth() : [];
    const healthMap = new Map();
    for (const h of allHealth) healthMap.set(h.routingRuleId, h);

    alternativeRules.sort((a, b) => {
      const ha = healthMap.get(a.id)?.successRate || 1;
      const hb = healthMap.get(b.id)?.successRate || 1;
      return hb - ha;
    });

    const newRule = alternativeRules[0];
    const newAccount = accountRepo.findById(newRule.receivingAccountId);

    if (!newAccount) {
      HttpServer.json(res, 503, {
        error: 'No receiving account for alternative route',
        code: 'NO_RECEIVING_ACCOUNT',
        paymentId: params.id
      });
      return;
    }

    // Record failover event (Phase 8)
    try {
      ctx.routingRepo.createFailoverEvent({
        paymentOrderId: session.orderId,
        fromRouteId: currentRouteId || null,
        toRouteId: newRule.id,
        reason,
        trigger,
        status: 'RECORDED'
      });
    } catch {}

    // Update payment session with new route
    const now = new Date().toISOString();
    ctx.db.execute(
      'UPDATE payment_sessions SET receiving_account_id = ?, updated_at = ? WHERE id = ?',
      [newAccount.id, now, params.id]
    );

    // Update metadata
    const metadata = { ...(session.metadata || {}), routeId: newRule.id, failoverReason: reason, failoverTrigger: trigger, failoverAt: now };
    ctx.db.execute(
      'UPDATE payment_sessions SET metadata = ? WHERE id = ?',
      [JSON.stringify(metadata), params.id]
    );

    logAudit(merchantId, 'PAYMENT_FAILOVER', 'PAYMENT_SESSION', params.id, {
      orderId: session.orderId,
      fromRouteId: currentRouteId,
      toRouteId: newRule.id,
      reason,
      trigger
    }, req);

    // Generate new UPI intent for the new route
    const upiUri = `upi://pay?pa=${encodeURIComponent(newAccount.upiId)}&pn=${encodeURIComponent(newAccount.payeeName || '')}&am=${(Number(session.amountPaise) / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(session.orderId)}`;
    const baseUrl = (process.env.DYNAMO_PUBLIC_URL || ctx.checkoutBaseUrl || 'http://127.0.0.1:6100').replace(/\/$/, '');

    HttpServer.json(res, 200, {
      success: true,
      paymentId: params.id,
      orderId: session.orderId,
      failover: {
        fromRouteId: currentRouteId || null,
        toRouteId: newRule.id,
        reason,
        trigger,
        recordedAt: now
      },
      receivingVpa: newAccount.upiId,
      receivingAccountName: newAccount.payeeName,
      upiIntent: upiUri,
      checkoutUrl: `${baseUrl}/checkout/${params.id}`,
      qrUrl: `${baseUrl}/checkout/${params.id}/qr.svg`,
      message: 'Failover completed. New payment link generated.'
    });
  });

  // GET /api/v1/payment-links/:id/state - Get payment state
  server.get(`${PAYMENT_LINK_PREFIX}/:id/state`, async (req, res, params) => {
    const authHeader = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    const apiKey = match ? match[1] : '';

    if (!apiKey) {
      HttpServer.json(res, 401, { error: 'API key required', code: 'AUTH_REQUIRED' });
      return;
    }

    const keyRow = ctx.db.queryOne('SELECT * FROM pp_api_keys WHERE secret_hash = ?', [crypto.createHash('sha256').update(apiKey).digest('hex')]);
    if (!keyRow || keyRow.revoked_at) {
      HttpServer.json(res, 401, { error: 'Invalid or revoked API key', code: 'INVALID_API_KEY' });
      return;
    }

    const merchantId = keyRow.merchant_id;
    const session = sessionRepo.findById(params.id);

    if (!session || session.merchantId !== merchantId) {
      HttpServer.json(res, 404, { error: 'Payment not found', code: 'NOT_FOUND' });
      return;
    }

    const amountPaise = Number(session.amountPaise || 0);
    const receivingAccount = accountRepo.findById(session.receivingAccountId);
    const failoverEvents = ctx.routingRepo ? ctx.routingRepo.findFailoverEventsByOrder(session.orderId) : [];

    HttpServer.json(res, 200, {
      paymentId: session.id,
      orderId: session.orderId,
      amount: (amountPaise / 100).toFixed(2),
      amountPaise,
      currency: session.currency,
      status: session.status,
      method: session.method,
      receivingVpa: receivingAccount?.upiId || null,
      receivingAccountName: receivingAccount?.payeeName || null,
      routeId: session.metadata?.routeId || null,
      playerReference: session.metadata?.playerReference || null,
      failoverEvents: failoverEvents.map(e => ({
        id: e.id,
        fromRouteId: e.from_route_id,
        toRouteId: e.to_route_id,
        reason: e.reason,
        trigger: e.trigger,
        status: e.status,
        createdAt: e.created_at
      })),
      createdAt: session.created_at,
      updatedAt: session.updated_at
    });
  });
}
