import {enforcePaymentControls} from '../payment-controls.js';
import { validateUpiChannel } from '../upi-channel.js';
import { HttpServer } from '../server.js';
import { toPaise, toRupeesString, resolveRuntimeUrls, PaymentStatus, safeEqual, hasBearer, getObserverToken, maskPhone, maskEmail, generateCustomerId } from '@youpi/common';
import { isTerminalStatus, toPublicOutcome } from '@youpi/core';
import { isAdminRequest } from '../auth-guard.js';

/**
 * True when the caller may read the merchant-private fields of a payment session.
 *
 * Requires proof of ownership: either the gateway's own admin/observer credential, or the
 * owning merchant's webhook secret presented via `X-Merchant-Key` (which every merchant
 * integration already holds). Without it, only the public view is returned, so a leaked or
 * guessed payment id cannot be used to read internal status, verification internals,
 * merchant metadata or the return URL.
 */
function isPaymentOwner(req, session, ctx) {
  if (isAdminRequest(req)) return true;
  if (hasBearer(req, getObserverToken())) return true;

  const presented = req.headers['x-merchant-key'];
  if (!presented || typeof presented !== 'string' || !presented.trim()) return false;

  const merchant = ctx.merchantRepo?.findById ? ctx.merchantRepo.findById(session.merchantId) : null;
  if (!merchant?.webhookSecret) return false;
  return safeEqual(presented.trim(), merchant.webhookSecret);
}

/**
 * Registers merchant-facing payment routes.
 * @param {HttpServer} server
 * @param {{
 *   merchantRepo: import('@youpi/db').MerchantRepository,
 *   accountRepo: import('@youpi/db').ReceivingAccountRepository,
 *   sessionRepo: import('@youpi/db').PaymentSessionRepository,
 *   queueEngine: import('@youpi/core').QueueEngine,
 *   timingEngine: import('@youpi/core').TimingEngine,
 *   auditRepo: import('@youpi/db').AuditLogRepository,
 *   checkoutBaseUrl: string
 * }} ctx
 */
export function registerPaymentRoutes(server, ctx) {
  function resolveCheckoutBaseUrl(merchant) {
    if (process.env.DYNAMO_PUBLIC_URL) return process.env.DYNAMO_PUBLIC_URL.replace(/\/+$/, '');
    if (process.env.DYNAMO_UNIFIED_GATEWAY === 'true') return '';
    if (merchant?.branding) {
      try {
        const urls = resolveRuntimeUrls(merchant.branding);
        if (urls && urls.checkoutUrl) return urls.checkoutUrl;
      } catch {}
    }
    return ctx.checkoutBaseUrl || 'http://localhost:7000';
  }

  // POST /api/v1/payments
  server.post('/api/v1/payments', async (req, res) => {
    try {
      const body = await HttpServer.parseBody(req);
      const idempotencyKey = req.headers['idempotency-key'] || body.idempotencyKey;

      // Resolve merchant (default to first/demo merchant if none passed in header)
      const merchantId = req.headers['x-merchant-id'] || body.merchantId;
      let merchant;
      if (merchantId) {
        merchant = ctx.merchantRepo.findById(merchantId);
      } else {
        merchant = ctx.merchantRepo.getDefault ? ctx.merchantRepo.getDefault() : (ctx.merchantRepo.findById('00000000-0000-0000-0000-000000000001') || ctx.merchantRepo.findAll()[0]);
      }

      if (!merchant) {
        HttpServer.json(res, 400, { error: 'Merchant not found or not configured.' });
        return;
      }

      if (!body.orderId || !body.amount) {
        HttpServer.json(res, 400, { error: 'Missing required fields: orderId and amount.' });
        return;
      }

      const originalExternal=ctx.sessionRepo.findByOrderId(merchant.id,body.orderId)?.metadata?.externalCollection;
      const useExternalDefault=(!body.method||String(body.method).toUpperCase()==='UPI')&&ctx.externalCollections?.getDefault(merchant.id);
      if(ctx.externalCollections&&(originalExternal||useExternalDefault)){
        if(!isAdminRequest(req)&&!(req.headers['x-merchant-key']&&merchant.webhookSecret&&safeEqual(String(req.headers['x-merchant-key']),merchant.webhookSecret)))return HttpServer.json(res,401,{error:'Merchant authentication required.'});
        return ctx.externalCollections.createFromLegacy(req,res,body,merchant.id);
      }

      const deviceId = body.deviceId || req.headers['x-device-id'] || null;
      if (deviceId && ctx.deviceRepo) {
        let dev = ctx.deviceRepo.findById(deviceId);
        if (!dev) {
          try {
            ctx.deviceRepo.create({
              id: deviceId,
              publicKey: `adhoc_${deviceId}`,
              fingerprintHash: `fp_${deviceId}`
            });
          } catch {}
        }
      }

      // Check idempotency & active session state
      const existing = ctx.sessionRepo.findByOrderId(merchant.id, body.orderId);
      if (existing) {
        // If SUCCESS: order is already paid, return existing completed session
        if (existing.status === PaymentStatus.SUCCESS) {
          HttpServer.json(res, 200, {
            paymentId: existing.id,
            orderId: existing.orderId,
            amount: toRupeesString(existing.amountPaise),
            amountPaise: existing.amountPaise.toString(),
            currency: existing.currency,
            status: existing.status,
          checkoutUrl: `${resolveCheckoutBaseUrl(merchant)}/checkout/${existing.id}`
        });
        return;
      }

      // Check if existing session is stale
      const now = Date.now();
      const isStale = (existing.status === PaymentStatus.ACTIVE && existing.expiresAt && existing.expiresAt.getTime() <= now) ||
        (existing.status === PaymentStatus.PROCESSING && existing.processingExpiresAt && existing.processingExpiresAt.getTime() <= now);
      if (isStale) {
        if(existing.status === PaymentStatus.PROCESSING) ctx.timingEngine.handleProcessingTimerExpiration(existing.id);
        else ctx.sessionRepo.transitionToTerminal(existing.id, PaymentStatus.EXPIRED);
        if (existing.receivingAccountId) {
          ctx.queueEngine.promoteNext(existing.receivingAccountId);
        }
        existing.status = existing.status === PaymentStatus.PROCESSING ? PaymentStatus.VERIFICATION_PENDING : PaymentStatus.EXPIRED;
      }

      // If existing is non-terminal (ACTIVE, PROCESSING, QUEUED, INITIATED):
      if ([PaymentStatus.ACTIVE, PaymentStatus.PROCESSING, PaymentStatus.QUEUED, PaymentStatus.INITIATED, PaymentStatus.VERIFICATION_PENDING].includes(existing.status)) {
        // CASE 3: Active session + Different device -> DUPLICATE_SESSION_DETECTED
        if (deviceId && existing.deviceId && deviceId !== existing.deviceId) {
          HttpServer.json(res, 409, {
            error: 'DUPLICATE_SESSION_DETECTED',
            code: 'DEVICE_SESSION_MISMATCH',
            session_id: existing.id,
            activeSession: {
              paymentId: existing.id,
              orderId: existing.orderId,
              amount: toRupeesString(existing.amountPaise)
            },
            action: 'END_SESSION_AND_CREATE_NEW',
            message: 'This payment session was created on another device. For security reasons, this session cannot be continued from this device.'
          });
          return;
        }

        // CASE 2: Active session + Same device -> CONTINUE ACTIVE SESSION
        HttpServer.json(res, 200, {
          paymentId: existing.id,
          orderId: existing.orderId,
          amount: toRupeesString(existing.amountPaise),
          amountPaise: existing.amountPaise.toString(),
          currency: existing.currency,
          status: existing.status,
          activeSessionDetected: true,
          checkoutUrl: `${resolveCheckoutBaseUrl(merchant)}/checkout/${existing.id}`
        });
        return;
      }

      // CASE 4: Previous session is TERMINAL (FAILED, EXPIRED, CANCELLED) -> RETRY / NEW PAYMENT!
      const cleanOrderId = body.orderId.replace(/-R\d+$/, '');
      const randSuffix = Math.floor(1000 + Math.random() * 9000);
      body.orderId = `${cleanOrderId}-R${randSuffix}`;
    }

    let amountPaise;
    try {
      amountPaise = toPaise(body.amount);
    } catch (err) {
      HttpServer.json(res, 400, { error: err.message });
      return;
    }

    const isCounterPayment = body.method === 'CASH_COUNTER' || body.method === 'CARD_COUNTER';

    let receivingAccountId = null;
    let receivingAccountSnapshot = null;
    if (!isCounterPayment) {
      // Resolve active receiving account for UPI
      const receivingAccount = ctx.accountRepo.findActiveForMerchant(merchant.id);
      if (!receivingAccount) {
        HttpServer.json(res, 500, { error: 'No active UPI receiving account configured for merchant.' });
        return;
      }
      const ruleError=enforcePaymentControls(ctx,merchant.id,{RECEIVING_VPA:receivingAccount.upiId,CUSTOMER_VPA:body.customer?.vpa,CUSTOMER:body.customerId});
      if(ruleError)return HttpServer.json(res,403,ruleError);
      const channelError=validateUpiChannel(merchant,amountPaise,receivingAccount.upiId);
      if(channelError)return HttpServer.json(res,400,channelError);
      receivingAccountId = receivingAccount.id;
      receivingAccountSnapshot = {
        id: receivingAccount.id,
        upiId: receivingAccount.upiId,
        payeeName: receivingAccount.payeeName,
        isMerchantEnabled: receivingAccount.isMerchantEnabled
      };
    }

    // Resolve or auto-generate customer with masked details
    let customer = null;
    let customerId = body.customerId || null;
    const hasCustomerInput = !!(body.customerId || body.customer || body.customerEmail || body.customerPhone || body.customerName);
    const customerName = body.customer?.name || body.customerName || null;
    const customerEmail = body.customer?.email || body.customerEmail || null;
    const customerPhone = body.customer?.mobileNumber || body.customer?.phoneNumber || body.customer?.phone || body.customerPhone || null;

    if (customerId && ctx.customerRepo) {
      customer = ctx.customerRepo.findById(customerId);
    }

    if (!customer && (customerEmail || customerPhone) && ctx.customerRepo) {
      const ident = customerEmail || customerPhone;
      customer = ctx.customerRepo.findByIdentifier(ident);
      if (customer) {
        customerId = customer.id;
      }
    }

    // Auto-generate customer record if customer info was provided by merchant
    if (!customer && hasCustomerInput && ctx.customerRepo) {
      customerId = customerId || generateCustomerId();
      const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      try {
        customer = ctx.customerRepo.create({
          id: customerId,
          name: customerName || 'Customer',
          email: customerEmail || `cust_${uniqueSuffix}@customer.sanbookpay.com`,
          mobileNumber: customerPhone || `98${Math.floor(10000000 + Math.random() * 90000000)}`,
          status: 'ACTIVE'
        });
      } catch {
        customer = ctx.customerRepo.findById(customerId);
      }
      // If customer creation failed (e.g., invalid phone format), don't set customerId
      // to avoid FOREIGN KEY constraint failure on payment_sessions.customer_id
      if (!customer) {
        customerId = null;
      }
    } else if (customer) {
      customerId = customer.id;
    }

    // Server-side Ban Enforcement (Section 3)
    if (customerId && ctx.customerRepo && ctx.customerRepo.isBanned(customerId)) {
      HttpServer.json(res, 403, {
        status: 'BLOCKED',
        error: 'ACCESS BLOCKED: Your account has been temporarily blocked because suspicious payment activity was detected. Our team will review the activity before access can be restored.',
        message: 'Your account has been temporarily blocked because suspicious payment activity was detected. Our team will review the activity before access can be restored.',
        isBanned: true
      });
      return;
    }

    // Check if customer already has an active payment session on another device (CASE 3)
    if (customerId && ctx.sessionRepo) {
      const activeForCust = ctx.sessionRepo.findActiveForCustomer ? ctx.sessionRepo.findActiveForCustomer(customerId) : null;
      if (activeForCust) {
        if (deviceId && activeForCust.deviceId && deviceId !== activeForCust.deviceId) {
          HttpServer.json(res, 409, {
            error: 'DUPLICATE_SESSION_DETECTED',
            code: 'DEVICE_SESSION_MISMATCH',
            session_id: activeForCust.id,
            activeSession: {
              paymentId: activeForCust.id,
              orderId: activeForCust.orderId,
              amount: toRupeesString(activeForCust.amountPaise)
            },
            action: 'END_SESSION_AND_CREATE_NEW',
            message: 'This customer already has an active payment session on another device. For security reasons, this session cannot be continued from this device.'
          });
          return;
        }
      }
    }

    // Auto-activate UPI payments immediately so the dynamic QR is available
    // without requiring customer pre-authentication. This enables the Razorpay-like
    // flow: create order -> instant QR -> customer scans -> pays -> bank observer verifies.
    // Default: ACTIVE (gaming-ready instant collection). Set body.autoActivate === false
    // to defer slot acquisition until customer authentication.
    // Counter payments (CASH_COUNTER/CARD_COUNTER) always start as ACTIVE.
    const isExplicitNoAutoActivate = body.autoActivate === false || body.autoActivate === 'false';
    const shouldActivateNow = isCounterPayment || !isExplicitNoAutoActivate;
    const initialStatus = shouldActivateNow ? PaymentStatus.ACTIVE : PaymentStatus.INITIATED;

    const sessionMetadata = {
      ...(body.metadata || {}),
      ...(receivingAccountSnapshot ? { receivingAccountSnapshot } : {})
    };

    if (deviceId && customerId && ctx.deviceRepo) {
      try { ctx.deviceRepo.associateCustomer(deviceId, customerId); } catch {}
    }

    // Create session in DB
    const session = ctx.sessionRepo.create({
      merchantId: merchant.id,
      customerId,
      receivingAccountId,
      orderId: body.orderId,
      amountPaise,
      currency: body.currency || 'INR',
      method: body.method || 'UPI',
      // Counter payments (CASH_COUNTER/CARD_COUNTER) don't use UPI slots -> insert as ACTIVE.
      // UPI payments insert as QUEUED; enqueueOrActivate promotes to ACTIVE if slot is free.
      status: isCounterPayment ? PaymentStatus.ACTIVE : (shouldActivateNow ? PaymentStatus.QUEUED : initialStatus),
      returnUrl: body.returnUrl || null,
      idempotencyKey: idempotencyKey || null,
      deviceId,
      metadata: sessionMetadata
    });

    // Enqueue or Activate slot via QueueEngine immediately for all payment types
    let queueResult = { status: initialStatus, queuePosition: 0, expiresAt: null };
    if (receivingAccountId && shouldActivateNow) {
      queueResult = ctx.queueEngine.enqueueOrActivate(session.id, receivingAccountId);

      // If activated immediately, start Timer 1 (5 minutes)
      if (queueResult.expiresAt) {
        ctx.timingEngine.startActiveTimer(session.id, queueResult.expiresAt);
      }
      server.broadcastSse('admin_counter_events', 'status_change', {
        status: queueResult.status,
        sessionId: session.id,
        orderId: session.orderId,
        amountPaise: session.amountPaise ? session.amountPaise.toString() : '0'
      });
    }

    HttpServer.json(res, 201, {
      paymentId: session.id,
      orderId: session.orderId,
      amount: toRupeesString(amountPaise),
      amountPaise: amountPaise.toString(),
      currency: session.currency,
      status: queueResult.status,
      queuePosition: queueResult.queuePosition,
      customer: customer ? {
        id: customer.id,
        name: customer.name,
        maskedPhone: maskPhone(customer.mobileNumber),
        maskedEmail: maskEmail(customer.email)
      } : null,
      checkoutUrl: `${resolveCheckoutBaseUrl(merchant)}/checkout/${session.id}`
    });
    } catch (err) {
      console.error('[Payments API] Unhandled error:', err);
      HttpServer.json(res, 500, { error: 'Internal Server Error', detail: err.message });
    }
  });

  // GET /api/v1/payments/:id
  server.get('/api/v1/payments/:id', async (req, res, params) => {
    const session = ctx.sessionRepo.findById(params.id);
    if (!session) {
      HttpServer.json(res, 404, { error: `Payment session not found: ${params.id}` });
      return;
    }

    const publicStatus = isTerminalStatus(session.status)
      ? toPublicOutcome(session.status)
      : session.status;

    // Fields any payment-id holder may read. Everything else is merchant-private: the raw
    // state machine status, verification internals, merchant metadata and the return URL.
    const publicView = {
      paymentId: session.id,
      orderId: session.orderId,
      amount: toRupeesString(session.amountPaise),
      amountPaise: session.amountPaise.toString(),
      currency: session.currency,
      status: publicStatus,
      method: session.method,
      completedAt: session.completedAt ? session.completedAt.toISOString() : null
    };

    if (!isPaymentOwner(req, session, ctx)) {
      HttpServer.json(res, 200, publicView);
      return;
    }

    HttpServer.json(res, 200, {
      ...publicView,
      internalStatus: session.status,
      verificationLevel: session.verificationLevel || 0,
      verificationSources: session.verificationSources || [],
      verificationTag: session.verificationTag || 'UNVERIFIED',
      returnUrl: session.returnUrl,
      metadata: session.metadata
    });
  });

  // GET /api/v1/payments/:id/cod (Developer COD Info Endpoint)
  server.get('/api/v1/payments/:id/cod', async (req, res, params) => {
    const session = ctx.sessionRepo.findById(params.id);
    if (!session) {
      HttpServer.json(res, 404, { error: `Payment session not found: ${params.id}` });
      return;
    }

    let customer = null;
    if (session.customerId && ctx.customerRepo) {
      const c = ctx.customerRepo.findById(session.customerId);
      if (c) {
        customer = {
          id: c.id,
          name: c.name,
          email: c.email,
          mobileNumber: c.mobileNumber
        };
      }
    }

    HttpServer.json(res, 200, {
      paymentId: session.id,
      orderId: session.orderId,
      amount: toRupeesString(session.amountPaise),
      amountPaise: session.amountPaise.toString(),
      currency: session.currency,
      method: session.method,
      status: session.status,
      verificationTag: session.verificationTag,
      isCod: session.method === 'COD',
      customer,
      placedAt: session.completedAt ? (session.completedAt.toISOString ? session.completedAt.toISOString() : session.completedAt) : (session.createdAt?.toISOString ? session.createdAt.toISOString() : session.createdAt),
      metadata: session.metadata
    });
  });

  // GET /api/v1/orders/:orderId/cod (Developer COD Info by Merchant Order ID)
  server.get('/api/v1/orders/:orderId/cod', async (req, res, params) => {
    const merchantId = req.headers['x-merchant-id'] || req.query.merchantId;
    let merchant;
    if (merchantId) {
      merchant = ctx.merchantRepo.findById(merchantId);
    } else {
      merchant = ctx.merchantRepo.getDefault ? ctx.merchantRepo.getDefault() : (ctx.merchantRepo.findById('00000000-0000-0000-0000-000000000001') || ctx.merchantRepo.findAll()[0]);
    }

    if (!merchant) {
      HttpServer.json(res, 404, { error: 'Merchant not found.' });
      return;
    }

    const session = ctx.sessionRepo.findByOrderId(merchant.id, params.orderId);
    if (!session) {
      HttpServer.json(res, 404, { error: `Order not found: ${params.orderId}` });
      return;
    }

    let customer = null;
    if (session.customerId && ctx.customerRepo) {
      const c = ctx.customerRepo.findById(session.customerId);
      if (c) {
        customer = {
          id: c.id,
          name: c.name,
          email: c.email,
          mobileNumber: c.mobileNumber
        };
      }
    }

    HttpServer.json(res, 200, {
      paymentId: session.id,
      orderId: session.orderId,
      amount: toRupeesString(session.amountPaise),
      amountPaise: session.amountPaise.toString(),
      currency: session.currency,
      method: session.method,
      status: session.status,
      verificationTag: session.verificationTag,
      isCod: session.method === 'COD',
      customer,
      placedAt: session.completedAt ? (session.completedAt.toISOString ? session.completedAt.toISOString() : session.completedAt) : (session.createdAt?.toISOString ? session.createdAt.toISOString() : session.createdAt),
      metadata: session.metadata
    });
  });

  // GET /api/v1/payments/:id/receipt (Official Digital Bill Receipt)
  server.get('/api/v1/payments/:id/receipt', async (req, res, params) => {
    const session = ctx.sessionRepo.findById(params.id);
    if (!session) {
      HttpServer.json(res, 404, { error: `Payment session not found: ${params.id}` });
      return;
    }

    if(session.status!=='SUCCESS') return HttpServer.json(res,409,{error:'A receipt is available after payment confirmation or COD order placement.'});

    let customer = null;
    if (session.customerId && ctx.customerRepo) {
      customer = ctx.customerRepo.findById(session.customerId);
    }
    const merchant = (session.merchantId ? ctx.merchantRepo?.findById(session.merchantId) : null) || ctx.defaultMerchant;

    let receipt = null;
    if (ctx.receiptService) {
      receipt = await ctx.receiptService.getOrCreateReceipt(session, customer, merchant);
    }

    const wantsJson = (req.query && req.query.format === 'json') || (req.headers['accept'] || '').includes('application/json');
    if (wantsJson) {
      HttpServer.json(res, 200, {
        success: true,
        receiptId: receipt?.receiptId || `RCPT-${session.id.slice(0, 8).toUpperCase()}`,
        paymentId: session.id,
        orderId: session.orderId,
        amount: toRupeesString(session.amountPaise),
        amountPaise: session.amountPaise.toString(),
        currency: session.currency,
        status: session.status,
        method: session.method,
        utr: receipt?.utr || null,
        customer: customer ? {
          id: customer.id,
          name: customer.name,
          maskedPhone: maskPhone(customer.mobileNumber),
          maskedEmail: maskEmail(customer.email)
        } : null,
        confirmationSource:receipt?.confirmationSource || null,
        generatedAt:receipt?.generatedAt || null,
        smsStatus: receipt?.smsStatus || 'NOT_CONFIGURED',
        emailStatus: receipt?.emailStatus || 'NOT_CONFIGURED',
        dispatchedAt: receipt?.dispatchedAt || null
      });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(receipt?.emailHtml || '<!doctype html><html><body><p>Receipt unavailable. Please try again.</p></body></html>');
  });
}

