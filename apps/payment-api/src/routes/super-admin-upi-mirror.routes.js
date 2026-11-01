import { HttpServer } from '../server.js';
import {
  PLATFORM_ACCOUNT_ID,
  UpiConnectionState,
  ObserverDevicePairingState,
  ObservationClassification,
  PaymentEvidenceState,
  UpiMirrorWebhookEvent
} from '@youpi/common';

/**
 * Super Admin UPI Mirror Management Routes.
 * Provides the 7 Super Admin modules:
 * A. Merchant Subscription Manager
 * B. Universal UPI Registry
 * C. Android Device Fleet Manager
 * D. Real-Time Payment Monitor
 * E. Instant Callback Command Centre
 * F. System Performance Centre
 * G. Security & Audit Centre
 *
 * @param {HttpServer} server
 * @param {{
 *   merchantRepo: import('@youpi/db').MerchantRepository,
 *   upiConnectionRepo: import('@youpi/db').MerchantUpiConnectionRepository,
 *   observerDeviceRepo: import('@youpi/db').MerchantObserverDeviceRepository,
 *   pairingChallengeRepo: import('@youpi/db').DevicePairingChallengeRepository,
 *   observerSourceConfigRepo: import('@youpi/db').ObserverSourceConfigRepository,
 *   subscriptionEntitlementRepo: import('@youpi/db').SubscriptionEntitlementRepository,
 *   connectionHealthEventRepo: import('@youpi/db').ConnectionHealthEventRepository,
 *   adminAuditEventRepo: import('@youpi/db').AdminAuditEventRepository,
 *   callbackOutboxRepo: import('@youpi/db').CallbackOutboxRepository,
 *   callbackDeliveryAttemptRepo: import('@youpi/db').CallbackDeliveryAttemptRepository,
 *   upiMirrorObservationRepo: import('@youpi/db').UpiMirrorObservationRepository,
 *   sessionRepo: import('@youpi/db').PaymentSessionRepository,
 *   pricingRepo: import('@youpi/db').PricingRepository,
 *   auditRepo: import('@youpi/db').AuditLogRepository,
 *   platformIdentity: { guard: (req, res, target) => Promise<boolean> }
 * }} ctx
 */
export function registerSuperAdminUpiMirrorRoutes(server, ctx) {
  const base = '/api/platform/v1/upi-mirror';

  function requirePlatform(req, res) {
    return ctx.platformIdentity.guard(req, res, req.url);
  }

  // ============================================================
  // A. Merchant Subscription Manager
  // ============================================================

  // GET /api/platform/v1/upi-mirror/admin/subscriptions — List all merchant subscriptions
  server.get(`${base}/admin/subscriptions`, async (req, res) => {
    if (!(await requirePlatform(req, res))) return;
    const merchants = ctx.merchantRepo.findAll().filter(m=>m.id!==PLATFORM_ACCOUNT_ID);
    const result = [];
    for (const m of merchants) {
      const ent = ctx.subscriptionEntitlementRepo.findByMerchant(m.id);
      const connections = ctx.upiConnectionRepo.findByMerchant(m.id);
      const devices = ctx.observerDeviceRepo.findByMerchant(m.id);
      result.push({
        merchantId: m.id,
        businessName: m.businessName,
        slug: m.slug,
        planId: ent?.planId || null,
        status: ent?.status || 'NONE',
        maxUpiiConnections: ent?.maxUpiiConnections || 0,
        maxObserverDevices: ent?.maxObserverDevices || 0,
        currentUpiConnections: connections.length,
        activeDevices: devices.filter(d => d.isActive).length,
        currentPeriodEnd: ent?.currentPeriodEnd || null,
        gracePeriodEndsAt: ent?.gracePeriodEndsAt || null,
        observationSourcesEnabled: ent?.observationSourcesEnabled || false,
        webhookEndpointsEnabled: ent?.webhookEndpointsEnabled || false
      });
    }
    return HttpServer.json(res, 200, { subscriptions: result });
  });

  // POST /api/platform/v1/upi-mirror/admin/subscriptions/:merchantId/activate — Activate subscription
  server.post(`${base}/admin/subscriptions/:merchantId/activate`, async (req, res, params) => {
    if (!(await requirePlatform(req, res))) return;
    const body = await HttpServer.parseBody(req);
    const { planId, maxUpiiConnections = 1, maxObserverDevices = 1 } = body;

    const plan = ctx.pricingRepo?.findById ? ctx.pricingRepo.findById(planId) : null;
    if (!plan) {
      return HttpServer.json(res, 404, { error: 'Plan not found' });
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    let ent = ctx.subscriptionEntitlementRepo.findByMerchant(params.merchantId);
    if (ent) {
      ent = ctx.subscriptionEntitlementRepo.update(ent.id, {
        planId,
        status: 'ACTIVE',
        maxUpiiConnections,
        maxObserverDevices,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
        gracePeriodEndsAt: null
      });
    } else {
      ent = ctx.subscriptionEntitlementRepo.create({
        merchantId: params.merchantId,
        planId,
        status: 'ACTIVE',
        maxUpiiConnections,
        maxObserverDevices,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString()
      });
    }

    if (ctx.auditRepo) {
      ctx.auditRepo.log({
        merchantId: params.merchantId,
        entityType: 'SUBSCRIPTION',
        entityId: ent.id,
        action: 'SUBSCRIPTION_ACTIVATED',
        actorType: 'ADMIN',
        details: { planId, maxUpiiConnections, maxObserverDevices }
      });
    }

    return HttpServer.json(res, 200, { success: true, entitlement: ent });
  });

  // POST /api/platform/v1/upi-mirror/admin/subscriptions/:merchantId/suspend — Suspend merchant
  server.post(`${base}/admin/subscriptions/:merchantId/suspend`, async (req, res, params) => {
    if (!(await requirePlatform(req, res))) return;
    const ent = ctx.subscriptionEntitlementRepo.findByMerchant(params.merchantId);
    if (!ent) {
      return HttpServer.json(res, 404, { error: 'No subscription found for merchant' });
    }
    ctx.subscriptionEntitlementRepo.update(ent.id, { status: 'SUSPENDED' });

    // Suspend all UPI connections for this merchant
    const connections = ctx.upiConnectionRepo.findByMerchant(params.merchantId);
    for (const c of connections) {
      ctx.upiConnectionRepo.update(c.id, { connectionState: UpiConnectionState.SUSPENDED });
    }

    if (ctx.auditRepo) {
      ctx.auditRepo.log({
        merchantId: params.merchantId,
        entityType: 'SUBSCRIPTION',
        entityId: ent.id,
        action: 'SUBSCRIPTION_SUSPENDED',
        actorType: 'ADMIN'
      });
    }

    return HttpServer.json(res, 200, { success: true, status: 'SUSPENDED' });
  });

  // ============================================================
  // B. Universal UPI Registry
  // ============================================================

  // GET /api/platform/v1/upi-mirror/admin/registry — List all UPI connections across merchants
  server.get(`${base}/admin/registry`, async (req, res) => {
    if (!(await requirePlatform(req, res))) return;
    const merchants = ctx.merchantRepo.findAll();
    const registry = [];
    for (const m of merchants) {
      const connections = ctx.upiConnectionRepo.findByMerchant(m.id);
      for (const c of connections) {
        const device = c.observerDeviceId
          ? ctx.observerDeviceRepo.findById(c.observerDeviceId)
          : null;
        registry.push({
          connectionId: c.id,
          merchantId: m.id,
          merchantName: m.businessName,
          vpa: c.vpa,
          displayName: c.displayName,
          bankName: c.bankName,
          preferredApp: c.preferredApp,
          connectionState: c.connectionState,
          ownershipVerified: c.ownershipVerified,
          verificationLevel: c.verificationLevel,
          observerDeviceId: c.observerDeviceId,
          deviceName: device?.deviceName || null,
          deviceStatus: device?.pairingState || null,
          healthStatus: c.healthStatus,
          lastObservedAt: c.lastObservedAt,
          createdAt: c.createdAt
        });
      }
    }
    return HttpServer.json(res, 200, { registry, total: registry.length });
  });

  // GET /api/platform/v1/upi-mirror/admin/registry/vpa/:vpa — Check VPA duplication
  server.get(`${base}/admin/registry/vpa/:vpa`, async (req, res, params) => {
    if (!(await requirePlatform(req, res))) return;
    const merchants = ctx.merchantRepo.findAll();
    const matches = [];
    for (const m of merchants) {
      const c = ctx.upiConnectionRepo.findByVpa(m.id, params.vpa);
      if (c) {
        matches.push({ merchantId: m.id, merchantName: m.businessName, connectionId: c.id, connectionState: c.connectionState });
      }
    }
    return HttpServer.json(res, 200, { vpa: params.vpa, duplicated: matches.length > 0, matches });
  });

  // ============================================================
  // C. Android Device Fleet Manager
  // ============================================================

  // GET /api/platform/v1/upi-mirror/admin/devices — List all observer devices
  server.get(`${base}/admin/devices`, async (req, res) => {
    if (!(await requirePlatform(req, res))) return;
    const merchants = ctx.merchantRepo.findAll();
    const devices = [];
    for (const m of merchants) {
      for (const d of ctx.observerDeviceRepo.findByMerchant(m.id)) {
        devices.push({
          id: d.id,
          merchantId: m.id,
          merchantName: m.businessName,
          deviceName: d.deviceName,
          deviceModel: d.deviceModel,
          androidVersion: d.androidVersion,
          appVersion: d.appVersion,
          pairingState: d.pairingState,
          listenerStatus: d.listenerStatus,
          notificationPermission: d.notificationPermission,
          lastHeartbeatAt: d.lastHeartbeatAt,
          lastEventAt: d.lastEventAt,
          avgForwardingLatencyMs: d.avgForwardingLatencyMs,
          isActive: d.isActive,
          revokedAt: d.revokedAt,
          revocationReason: d.revocationReason,
          createdAt: d.createdAt
        });
      }
    }
    return HttpServer.json(res, 200, { devices, total: devices.length });
  });

  // POST /api/platform/v1/upi-mirror/admin/devices/:deviceId/revoke — Revoke a device
  server.post(`${base}/admin/devices/:deviceId/revoke`, async (req, res, params) => {
    if (!(await requirePlatform(req, res))) return;
    const body = await HttpServer.parseBody(req);
    const device = ctx.observerDeviceRepo.findById(params.deviceId);
    if (!device) {
      return HttpServer.json(res, 404, { error: 'Device not found' });
    }
    ctx.observerDeviceRepo.revoke(params.deviceId, body.reason || 'ADMIN_REVOCATION');

    // De-link from UPI connections
    const connections = ctx.upiConnectionRepo.findByObserverDevice(params.deviceId);
    for (const c of connections) {
      ctx.upiConnectionRepo.update(c.id, {
        observerDeviceId: null,
        connectionState: UpiConnectionState.OWNERSHIP_PENDING
      });
    }

    if (ctx.auditRepo) {
      ctx.auditRepo.log({
        merchantId: device.merchantId,
        entityType: 'OBSERVER_DEVICE',
        entityId: params.deviceId,
        action: 'DEVICE_REVOKED_BY_ADMIN',
        actorType: 'ADMIN',
        details: { reason: body.reason, deviceName: device.deviceName }
      });
    }

    return HttpServer.json(res, 200, { success: true, deviceId: params.deviceId });
  });

  // ============================================================
  // D. Real-Time Payment Monitor
  // ============================================================

  // GET /api/platform/v1/upi-mirror/admin/monitor — Payment monitor dashboard
  server.get(`${base}/admin/monitor`, async (req, res) => {
    if (!(await requirePlatform(req, res))) return;
    const { merchantId, status, limit = 100 } = req.query || {};

    let observations = ctx.upiMirrorObservationRepo.findByMerchant(merchantId || '', limit);
    if (status) {
      observations = observations.filter(o => o.classification === status);
    }

    // Count by classification
    const allObs = ctx.upiMirrorObservationRepo.findByMerchant(merchantId || '', 10000);
    const counts = {};
    for (const c of Object.values(ObservationClassification)) {
      counts[c] = allObs.filter(o => o.classification === c).length;
    }

    return HttpServer.json(res, 200, {
      observations: observations.map(o => ({
        id: o.id,
        eventId: o.eventId,
        merchantId: o.merchantId,
        upiConnectionId: o.upiConnectionId,
        source: o.source,
        amountPaise: o.amountPaise.toString(),
        currency: o.currency,
        referenceUtr: o.referenceUtr,
        classification: o.classification,
        matchedOrderId: o.matchedOrderId,
        isDuplicate: o.isDuplicate,
        deviceObservedTimestamp: o.deviceObservedTimestamp,
        serverReceivedTimestamp: o.serverReceivedTimestamp,
        createdAt: o.createdAt
      })),
      counts,
      total: allObs.length
    });
  });

  // ============================================================
  // E. Instant Callback Command Centre
  // ============================================================

  // GET /api/platform/v1/upi-mirror/admin/callbacks — Callback delivery status
  server.get(`${base}/admin/callbacks`, async (req, res) => {
    if (!(await requirePlatform(req, res))) return;
    const { merchantId, status = 'PENDING', limit = 100 } = req.query || {};

    let callbacks;
    if (merchantId) {
      callbacks = ctx.callbackOutboxRepo.findByMerchant(merchantId, status, Number(limit));
    } else {
      callbacks = ctx.callbackOutboxRepo.findPending(Number(limit));
    }

    return HttpServer.json(res, 200, {
      callbacks: callbacks.map(c => ({
        id: c.id,
        merchantId: c.merchantId,
        paymentId: c.paymentId,
        eventType: c.eventType,
        endpointUrl: c.endpointUrl,
        idempotencyKey: c.idempotencyKey,
        status: c.status,
        attempts: c.attempts,
        maxAttempts: c.maxAttempts,
        nextRetryAt: c.nextRetryAt,
        deliveredAt: c.deliveredAt,
        lastError: c.last_error,
        createdAt: c.createdAt
      })),
      total: callbacks.length
    });
  });

  // POST /api/platform/v1/upi-mirror/admin/callbacks/:id/replay — Replay a failed callback
  server.post(`${base}/admin/callbacks/:id/replay`, async (req, res, params) => {
    if (!(await requirePlatform(req, res))) return;
    const item = ctx.callbackOutboxRepo.findById(params.id);
    if (!item) {
      return HttpServer.json(res, 404, { error: 'Callback not found' });
    }
    if (item.status !== 'PENDING' && item.status !== 'DEAD_LETTER') {
      return HttpServer.json(res, 409, { error: 'Cannot replay callback in current state' });
    }

    ctx.callbackOutboxRepo.updateStatus(params.id, {
      status: 'PENDING',
      attempts: 0,
      nextRetryAt: new Date().toISOString(),
      lastError: null
    });

    if (ctx.auditRepo) {
      ctx.auditRepo.log({
        merchantId: item.merchantId,
        entityType: 'CALLBACK_OUTBOX',
        entityId: params.id,
        action: 'CALLBACK_REPLAYED',
        actorType: 'ADMIN',
        details: { eventType: item.eventType }
      });
    }

    return HttpServer.json(res, 200, { success: true, callbackId: params.id });
  });

  // ============================================================
  // F. System Performance Centre
  // ============================================================

  // GET /api/platform/v1/upi-mirror/admin/performance — System performance metrics
  server.get(`${base}/admin/performance`, async (req, res) => {
    if (!(await requirePlatform(req, res))) return;

    const observations = ctx.upiMirrorObservationRepo.findByMerchant('', 10000);
    const now = Date.now();

    // Calculate latency metrics from observations
    const latencies = observations
      .filter(o => o.serverReceivedTimestamp && o.deviceObservedTimestamp)
      .map(o => new Date(o.serverReceivedTimestamp).getTime() - new Date(o.deviceObservedTimestamp).getTime());

    latencies.sort((a, b) => a - b);

    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
    const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;
    const p99 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] : 0;

    const devices = ctx.observerDeviceRepo.findActive();
    const staleDevices = ctx.observerDeviceRepo.findStale(5);

    // Callback delivery metrics
    const allCallbacks = ctx.callbackOutboxRepo.findByMerchant('', 'PENDING', 10000);
    const deliveredCallbacks = ctx.callbackOutboxRepo.findByMerchant('', 'DELIVERED', 10000);
    const deadLetterCallbacks = ctx.callbackOutboxRepo.findByMerchant('', 'DEAD_LETTER', 10000);

    return HttpServer.json(res, 200, {
      timestamp: new Date().toISOString(),
      ingestion: {
        totalObservations: observations.length,
        p50LatencyMs: p50,
        p95LatencyMs: p95,
        p99LatencyMs: p99
      },
      devices: {
        active: devices.length,
        stale: staleDevices.length,
        total: devices.length + staleDevices.length
      },
      callbacks: {
        pending: allCallbacks.length,
        delivered: deliveredCallbacks.length,
        deadLetter: deadLetterCallbacks.length
      },
      connections: {
        total: ctx.upiConnectionRepo.findByMerchant('').length,
        connected: ctx.upiConnectionRepo.findByMerchant('').filter(c => c.connectionState === 'OBSERVER_CONNECTED').length,
        degraded: ctx.upiConnectionRepo.findByMerchant('').filter(c => c.connectionState === 'DEGRADED').length,
        offline: ctx.upiConnectionRepo.findByMerchant('').filter(c => c.connectionState === 'OFFLINE').length
      }
    });
  });

  // ============================================================
  // G. Security & Audit Centre
  // ============================================================

  // GET /api/platform/v1/upi-mirror/admin/audit — Admin audit events
  server.get(`${base}/admin/audit`, async (req, res) => {
    if (!(await requirePlatform(req, res))) return;
    const { merchantId, action, limit = 100 } = req.query || {};

    let events;
    if (merchantId) {
      events = ctx.adminAuditEventRepo.findByMerchant(merchantId, Number(limit));
    } else if (action) {
      events = ctx.adminAuditEventRepo.findByAction(action, Number(limit));
    } else {
      events = ctx.adminAuditEventRepo.findByAdmin('', Number(limit));
    }

    return HttpServer.json(res, 200, {
      events: events.map(e => ({
        id: e.id,
        adminId: e.adminId,
        adminType: e.adminType,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        merchantId: e.merchantId,
        details: e.details,
        ipAddress: e.ipAddress,
        createdAt: e.createdAt
      })),
      total: events.length
    });
  });

  // GET /api/platform/v1/upi-mirror/admin/audit/suspicious — Suspicious observations
  server.get(`${base}/admin/audit/suspicious`, async (req, res) => {
    if (!(await requirePlatform(req, res))) return;
    const observations = ctx.upiMirrorObservationRepo.findByMerchant('', 10000);
    const suspicious = observations.filter(o =>
      o.classification === 'DISPUTED' ||
      o.isDuplicate ||
      (o.referenceUtr && ctx.upiMirrorObservationRepo.findByReference(o.referenceUtr).length > 1)
    );

    return HttpServer.json(res, 200, {
      suspicious: suspicious.map(o => ({
        id: o.id,
        eventId: o.eventId,
        merchantId: o.merchantId,
        source: o.source,
        amountPaise: o.amountPaise.toString(),
        classification: o.classification,
        isDuplicate: o.isDuplicate,
        referenceUtr: o.referenceUtr,
        fingerprintHash: o.fingerprintHash,
        createdAt: o.createdAt
      })),
      total: suspicious.length
    });
  });
}
