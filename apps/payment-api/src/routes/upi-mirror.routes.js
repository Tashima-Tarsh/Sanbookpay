import { HttpServer } from '../server.js';
import { generateHmac, generateRandomToken, toPaise, UpiConnectionState, ObserverDevicePairingState, ObservationClassification, UpisourceCategory, PaymentEvidenceState, getAdminToken, safeEqual } from '@youpi/common';
import { SecurityMiddleware } from '@youpi/core';

/**
 * Registers UPI Mirror routes for merchant UPI connection management,
 * Android device pairing, and observation ingestion.
 * @param {HttpServer} server
 * @param {{
 *   merchantRepo: import('@youpi/db').MerchantRepository,
 *   upiConnectionRepo: import('@youpi/db').MerchantUpiConnectionRepository,
 *   observerDeviceRepo: import('@youpi/db').MerchantObserverDeviceRepository,
 *   pairingChallengeRepo: import('@youpi/db').DevicePairingChallengeRepository,
 *   observerSourceConfigRepo: import('@youpi/db').ObserverSourceConfigRepository,
 *   subscriptionEntitlementRepo: import('@youpi/db').SubscriptionEntitlementRepository,
 *   connectionHealthEventRepo: import('@youpi/db').ConnectionHealthEventRepository,
 *   upiMirrorObservationRepo: import('@youpi/db').UpiMirrorObservationRepository,
 *   callbackOutboxRepo: import('@youpi/db').CallbackOutboxRepository,
 *   auditRepo: import('@youpi/db').AuditLogRepository,
 *   featureFlags: Map
 * }} ctx
 */
export function registerUpiMirrorRoutes(server, ctx) {
  const base = '/api/v1/upi-mirror';

  // Helper: resolve and authenticate merchant from request (server-side).
  // Prevents IDOR: X-Merchant-Id alone is never trusted.
  // Accepted credentials: admin bearer token, or merchant webhook-secret
  // presented as `Authorization: Bearer <secret>` (or X-Merchant-Secret).
  // Returns null on failure; callers respond with 401/404 themselves.
  function resolveMerchant(req) {
    const merchantId = req.headers['x-merchant-id'];
    const presented = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    const headerSecret = req.headers['x-merchant-secret'] || '';

    if (!merchantId) return null;
    const merchant = ctx.merchantRepo.findById(merchantId);
    if (!merchant) return null;

    const adminOk = Boolean(presented) && safeEqual(presented, getAdminToken());
    if (adminOk) return merchant;

    const secretOk = (Boolean(presented) && merchant.webhookSecret && safeEqual(presented, merchant.webhookSecret)) ||
                     (headerSecret && merchant.webhookSecret && safeEqual(headerSecret, merchant.webhookSecret));
    if (secretOk) return merchant;

    return null;
  }

  // Helper: check feature flag
  function isFeatureEnabled(merchantId, flag) {
    if (!ctx.featureFlags) return true;
    const key = `${merchantId}:${flag}`;
    return ctx.featureFlags.get(key) !== false;
  }

  // ============================================================
  // UPI Connection Management (Phase 1)
  // ============================================================

  // POST /api/v1/upi-mirror/connections — Register a UPI receiving account
  server.post(`${base}/connections`, async (req, res) => {
    try {
      const body = await HttpServer.parseBody(req);
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      if (!isFeatureEnabled(merchant.id, 'upi-connections')) {
        return HttpServer.json(res, 403, { error: 'UPI connections not enabled for this merchant.' });
      }

      const { vpa, displayName, bankName, preferredApp, creditAlertEmail, webhookUrl } = body;
      if (!vpa || !displayName) {
        return HttpServer.json(res, 400, { error: 'VPA and display name are required.' });
      }

      // Check subscription entitlement
      const entitlement = ctx.subscriptionEntitlementRepo.findByMerchant(merchant.id);
      if (entitlement && entitlement.status === 'ACTIVE') {
        const existing = ctx.upiConnectionRepo.findByMerchant(merchant.id);
        if (existing.length >= entitlement.maxUpiiConnections) {
          return HttpServer.json(res, 403, {
            error: `Maximum UPI connections (${entitlement.maxUpiiConnections}) reached for this plan.`
          });
        }
      }

      // Check for duplicate VPA within merchant
      const existing = ctx.upiConnectionRepo.findByVpa(merchant.id, vpa);
      if (existing) {
        return HttpServer.json(res, 409, {
          error: 'This UPI VPA is already registered for this merchant.',
          connectionId: existing.id,
          connectionState: existing.connectionState
        });
      }

      const connection = ctx.upiConnectionRepo.create({
        merchantId: merchant.id,
        vpa,
        displayName,
        bankName,
        preferredApp,
        connectionState: UpiConnectionState.REGISTERED,
        creditAlertEmail,
        webhookUrl,
        webhookSecret: generateRandomToken(32),
        featureFlags: JSON.stringify({ observationEnabled: true })
      });

      if (ctx.auditRepo) {
        ctx.auditRepo.log({
          merchantId: merchant.id,
          entityType: 'UPI_CONNECTION',
          entityId: connection.id,
          action: 'UPI_CONNECTION_REGISTERED',
          actorType: 'MERCHANT',
          actorId: merchant.id,
          details: { vpa, displayName, bankName, preferredApp }
        });
      }

      return HttpServer.json(res, 201, {
        connectionId: connection.id,
        vpa: connection.vpa,
        displayName: connection.displayName,
        connectionState: connection.connectionState,
        verificationLevel: connection.verificationLevel,
        webhookSecret: connection.webhookSecret,
        nextStep: 'OWNERSHIP_PENDING',
        message: 'UPI connection registered. Ownership verification required.'
      });
    } catch (err) {
      console.error('[UPI Mirror] Register connection error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // GET /api/v1/upi-mirror/connections — List merchant's UPI connections
  server.get(`${base}/connections`, async (req, res) => {
    try {
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      const connections = ctx.upiConnectionRepo.findByMerchant(merchant.id);

      return HttpServer.json(res, 200, {
        connections: connections.map(c => ({
          id: c.id,
          vpa: c.vpa,
          displayName: c.displayName,
          bankName: c.bankName,
          preferredApp: c.preferredApp,
          connectionState: c.connectionState,
          ownershipVerified: c.ownershipVerified,
          verificationLevel: c.verificationLevel,
          observerDeviceId: c.observerDeviceId,
          healthStatus: c.healthStatus,
          lastObservedAt: c.lastObservedAt,
          createdAt: c.createdAt
        }))
      });
    } catch (err) {
      console.error('[UPI Mirror] List connections error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // GET /api/v1/upi-mirror/connections/:id — Get a specific UPI connection
  server.get(`${base}/connections/:id`, async (req, res, params) => {
    try {
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      const connection = ctx.upiConnectionRepo.findById(params.id);
      if (!connection || connection.merchantId !== merchant.id) {
        return HttpServer.json(res, 404, { error: 'UPI connection not found.' });
      }

      const sources = ctx.observerSourceConfigRepo.findByConnection(connection.id);

      return HttpServer.json(res, 200, {
        id: connection.id,
        vpa: connection.vpa,
        displayName: connection.displayName,
        bankName: connection.bankName,
        preferredApp: connection.preferredApp,
        connectionState: connection.connectionState,
        ownershipVerified: connection.ownershipVerified,
        verificationLevel: connection.verificationLevel,
        verificationMethod: connection.verificationMethod,
        observerDeviceId: connection.observerDeviceId,
        creditAlertEmail: connection.creditAlertEmail,
        webhookUrl: connection.webhookUrl,
        healthStatus: connection.healthStatus,
        lastObservedAt: connection.lastObservedAt,
        lastHealthAt: connection.lastHealthAt,
        sources: sources.map(s => ({
          id: s.id,
          sourceName: s.sourceName,
          sourceCategory: s.sourceCategory,
          isEnabled: s.isEnabled,
          eventCount: s.eventCount,
          duplicateCount: s.duplicateCount
        })),
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt
      });
    } catch (err) {
      console.error('[UPI Mirror] Get connection error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // PATCH /api/v1/upi-mirror/connections/:id — Update a UPI connection
  server.patch(`${base}/connections/:id`, async (req, res, params) => {
    try {
      const body = await HttpServer.parseBody(req);
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      const connection = ctx.upiConnectionRepo.findById(params.id);
      if (!connection || connection.merchantId !== merchant.id) {
        return HttpServer.json(res, 404, { error: 'UPI connection not found.' });
      }

      const updated = ctx.upiConnectionRepo.update(params.id, {
        displayName: body.displayName,
        bankName: body.bankName,
        preferredApp: body.preferredApp,
        creditAlertEmail: body.creditAlertEmail,
        webhookUrl: body.webhookUrl,
        connectionState: body.connectionState
      });

      if (ctx.auditRepo) {
        ctx.auditRepo.log({
          merchantId: merchant.id,
          entityType: 'UPI_CONNECTION',
          entityId: connection.id,
          action: 'UPI_CONNECTION_UPDATED',
          actorType: 'MERCHANT',
          actorId: merchant.id,
          details: body
        });
      }

      return HttpServer.json(res, 200, {
        id: updated.id,
        vpa: updated.vpa,
        connectionState: updated.connectionState,
        verificationLevel: updated.verificationLevel,
        healthStatus: updated.healthStatus
      });
    } catch (err) {
      console.error('[UPI Mirror] Update connection error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // DELETE /api/v1/upi-mirror/connections/:id — Revoke a UPI connection
  server.delete(`${base}/connections/:id`, async (req, res, params) => {
    try {
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      const connection = ctx.upiConnectionRepo.findById(params.id);
      if (!connection || connection.merchantId !== merchant.id) {
        return HttpServer.json(res, 404, { error: 'UPI connection not found.' });
      }

      ctx.upiConnectionRepo.update(params.id, {
        connectionState: UpiConnectionState.REVOKED
      });

      if (ctx.auditRepo) {
        ctx.auditRepo.log({
          merchantId: merchant.id,
          entityType: 'UPI_CONNECTION',
          entityId: connection.id,
          action: 'UPI_CONNECTION_REVOKED',
          actorType: 'MERCHANT',
          actorId: merchant.id,
          details: { vpa: connection.vpa }
        });
      }

      return HttpServer.json(res, 200, { success: true, connectionId: connection.id });
    } catch (err) {
      console.error('[UPI Mirror] Revoke connection error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // ============================================================
  // Observer Source Configuration (Phase 1)
  // ============================================================

  // POST /api/v1/upi-mirror/connections/:id/sources — Add observer source
  server.post(`${base}/connections/:id/sources`, async (req, res, params) => {
    try {
      const body = await HttpServer.parseBody(req);
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      const connection = ctx.upiConnectionRepo.findById(params.id);
      if (!connection || connection.merchantId !== merchant.id) {
        return HttpServer.json(res, 404, { error: 'UPI connection not found.' });
      }

      const { sourceName, sourceCategory } = body;
      if (!sourceName || !sourceCategory) {
        return HttpServer.json(res, 400, { error: 'Source name and category are required.' });
      }

      const source = ctx.observerSourceConfigRepo.create({
        upiConnectionId: connection.id,
        sourceName,
        sourceCategory,
        isEnabled: true,
        parserVersion: '1.0'
      });

      return HttpServer.json(res, 201, {
        id: source.id,
        sourceName: source.sourceName,
        sourceCategory: source.sourceCategory,
        isEnabled: source.isEnabled
      });
    } catch (err) {
      console.error('[UPI Mirror] Add source error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // PATCH /api/v1/upi-mirror/sources/:id — Toggle source enabled
  server.patch(`${base}/sources/:id`, async (req, res, params) => {
    try {
      const body = await HttpServer.parseBody(req);
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      const source = ctx.observerSourceConfigRepo.findById(params.id);
      if (!source) {
        return HttpServer.json(res, 404, { error: 'Observer source not found.' });
      }

      const connection = ctx.upiConnectionRepo.findById(source.upiConnectionId);
      if (!connection || connection.merchantId !== merchant.id) {
        return HttpServer.json(res, 403, { error: 'Access denied.' });
      }

      const updated = ctx.observerSourceConfigRepo.update(params.id, {
        isEnabled: body.isEnabled
      });

      return HttpServer.json(res, 200, {
        id: updated.id,
        sourceName: updated.sourceName,
        isEnabled: updated.isEnabled
      });
    } catch (err) {
      console.error('[UPI Mirror] Update source error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // ============================================================
  // Device Pairing (Phase 3)
  // ============================================================

  // POST /api/v1/upi-mirror/pairing/challenge — Generate pairing QR challenge
  server.post(`${base}/pairing/challenge`, async (req, res) => {
    try {
      const body = await HttpServer.parseBody(req);
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      if (!isFeatureEnabled(merchant.id, 'device-pairing')) {
        return HttpServer.json(res, 403, { error: 'Device pairing not enabled for this merchant.' });
      }

      const entitlement = ctx.subscriptionEntitlementRepo.findByMerchant(merchant.id);
      if (entitlement && entitlement.status === 'ACTIVE') {
        const existing = ctx.observerDeviceRepo.findByMerchant(merchant.id);
        const activeCount = existing.filter(d => d.isActive).length;
        if (activeCount >= entitlement.maxObserverDevices) {
          return HttpServer.json(res, 403, {
            error: `Maximum observer devices (${entitlement.maxObserverDevices}) reached for this plan.`
          });
        }
      }

      const challenge = generateRandomToken(32);
      const qrPayload = JSON.stringify({
        type: 'dynamo-bridge-pairing',
        merchantId: merchant.id,
        challenge,
        merchantName: merchant.businessName,
        timestamp: new Date().toISOString()
      });

      const pairing = ctx.pairingChallengeRepo.create({
        merchantId: merchant.id,
        challenge,
        qrPayload,
        status: ObserverDevicePairingState.PAIRING_PENDING
      });

      return HttpServer.json(res, 201, {
        pairingId: pairing.id,
        challenge,
        qrPayload,
        expiresAt: pairing.expiresAt,
        merchantName: merchant.businessName,
        instructions: 'Install Dynamo Bridge, scan this QR, and confirm pairing in the app.'
      });
    } catch (err) {
      console.error('[UPI Mirror] Pairing challenge error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // POST /api/v1/upi-mirror/pairing/confirm — Device confirms pairing
  server.post(`${base}/pairing/confirm`, async (req, res) => {
    try {
      const body = await HttpServer.parseBody(req);
      const { pairingId, deviceId, publicKey, fingerprintHash, deviceTokenHash, deviceName, deviceModel, androidVersion, appVersion } = body;

      if (!pairingId || !deviceId || !publicKey || !fingerprintHash || !deviceTokenHash) {
        return HttpServer.json(res, 400, { error: 'Pairing ID, device ID, public key, fingerprint hash, and device token hash are required.' });
      }

      const pairing = ctx.pairingChallengeRepo.findById(pairingId);
      if (!pairing) {
        return HttpServer.json(res, 404, { error: 'Pairing challenge not found.' });
      }
      if (pairing.status !== 'PENDING') {
        return HttpServer.json(res, 409, { error: 'Pairing challenge already consumed or expired.' });
      }
      if (new Date(pairing.expiresAt) <= new Date()) {
        return HttpServer.json(res, 410, { error: 'Pairing challenge expired.' });
      }

      const merchant = ctx.merchantRepo.findById(pairing.merchantId);
      if (!merchant) {
        return HttpServer.json(res, 404, { error: 'Merchant not found.' });
      }

      // Consume the pairing challenge
      ctx.pairingChallengeRepo.consume(pairingId, deviceId);

      // Check if device already exists
      let device = ctx.observerDeviceRepo.findByFingerprint(fingerprintHash);
      if (!device) {
        device = ctx.observerDeviceRepo.create({
          id: deviceId,
          merchantId: merchant.id,
          deviceName,
          deviceModel,
          androidVersion,
          appVersion,
          publicKey,
          fingerprintHash,
          deviceTokenHash,
          pairingState: ObserverDevicePairingState.PAIRED,
          listenerStatus: 'UNKNOWN',
          notificationPermission: 0,
          isActive: true
        });
      } else {
        device = ctx.observerDeviceRepo.update(deviceId, {
          pairingState: ObserverDevicePairingState.PAIRED,
          publicKey,
          fingerprintHash,
          deviceTokenHash,
          deviceName,
          deviceModel,
          androidVersion,
          appVersion,
          isActive: true
        });
      }

      // Update UPI connection if linked
      if (body.upiConnectionId) {
        const connection = ctx.upiConnectionRepo.findById(body.upiConnectionId);
        if (connection && connection.merchantId === merchant.id) {
          ctx.upiConnectionRepo.update(connection.id, {
            observerDeviceId: deviceId,
            connectionState: UpiConnectionState.OBSERVER_CONNECTED
          });

          if (ctx.connectionHealthEventRepo) {
            ctx.connectionHealthEventRepo.create({
              upiConnectionId: connection.id,
              observerDeviceId: deviceId,
              previousState: connection.connectionState,
              newState: UpiConnectionState.OBSERVER_CONNECTED,
              trigger: 'DEVICE_PAIRED'
            });
          }
        }
      }

      if (ctx.auditRepo) {
        ctx.auditRepo.log({
          merchantId: merchant.id,
          entityType: 'OBSERVER_DEVICE',
          entityId: deviceId,
          action: 'DEVICE_PAIRED',
          actorType: 'MERCHANT',
          actorId: merchant.id,
          details: { deviceName, pairingId }
        });
      }

      return HttpServer.json(res, 200, {
        deviceId: device.id,
        pairingState: device.pairingState,
        merchantId: merchant.id,
        message: 'Device paired successfully.'
      });
    } catch (err) {
      console.error('[UPI Mirror] Pairing confirm error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // GET /api/v1/upi-mirror/devices — List merchant's observer devices
  server.get(`${base}/devices`, async (req, res) => {
    try {
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      const devices = ctx.observerDeviceRepo.findByMerchant(merchant.id);

      return HttpServer.json(res, 200, {
        devices: devices.map(d => ({
          id: d.id,
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
          createdAt: d.createdAt
        }))
      });
    } catch (err) {
      console.error('[UPI Mirror] List devices error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // DELETE /api/v1/upi-mirror/devices/:id — Revoke an observer device
  server.delete(`${base}/devices/:id`, async (req, res, params) => {
    try {
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      const device = ctx.observerDeviceRepo.findById(params.id);
      if (!device || device.merchantId !== merchant.id) {
        return HttpServer.json(res, 404, { error: 'Observer device not found.' });
      }

      ctx.observerDeviceRepo.revoke(params.id, 'MERCHANT_REVOCATION');

      // De-link from UPI connections
      const connections = ctx.upiConnectionRepo.findByObserverDevice(params.id);
      for (const conn of connections) {
        ctx.upiConnectionRepo.update(conn.id, {
          observerDeviceId: null,
          connectionState: UpiConnectionState.OWNERSHIP_PENDING
        });
      }

      if (ctx.auditRepo) {
        ctx.auditRepo.log({
          merchantId: merchant.id,
          entityType: 'OBSERVER_DEVICE',
          entityId: params.id,
          action: 'DEVICE_REVOKED',
          actorType: 'MERCHANT',
          actorId: merchant.id,
          details: { deviceName: device.deviceName }
        });
      }

      return HttpServer.json(res, 200, { success: true, deviceId: params.id });
    } catch (err) {
      console.error('[UPI Mirror] Revoke device error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // POST /api/v1/upi-mirror/devices/:id/heartbeat — Device health check-in
  server.post(`${base}/devices/:id/heartbeat`, async (req, res, params) => {
    try {
      const body = await HttpServer.parseBody(req);
      const device = ctx.observerDeviceRepo.findById(params.id);
      if (!device) {
        return HttpServer.json(res, 404, { error: 'Observer device not found.' });
      }

      ctx.observerDeviceRepo.touch(params.id);

      if (body.listenerStatus) {
        ctx.observerDeviceRepo.update(params.id, {
          listenerStatus: body.listenerStatus
        });
      }
      if (body.appVersion) {
        ctx.observerDeviceRepo.update(params.id, { appVersion: body.appVersion });
      }
      if (body.androidVersion) {
        ctx.observerDeviceRepo.update(params.id, { androidVersion: body.androidVersion });
      }

      return HttpServer.json(res, 200, {
        deviceId: params.id,
        status: 'OK',
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('[UPI Mirror] Heartbeat error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // ============================================================
  // Observation Ingestion (Phase 3)
  // ============================================================

  // POST /api/v1/upi-mirror/events — Ingest observer event (device-authenticated)
  server.post(`${base}/events`, async (req, res) => {
    const startTime = Date.now();

    try {
      // Capture raw body for HMAC verification before JSON parsing
      const rawBody = await HttpServer.parseRawBody(req);
      let body;
      try {
        body = rawBody.trim() ? JSON.parse(rawBody) : {};
      } catch {
        return HttpServer.json(res, 400, { error: 'Malformed JSON body.' });
      }

      // Security: input validation
      const validation = SecurityMiddleware.validateObservationEvent(body);
      if (validation) {
        return HttpServer.json(res, validation.statusCode, { error: validation.error });
      }

      // Extract device identity from headers (never trust payload merchantId)
      const deviceId = req.headers['x-device-id'];
      const deviceSignature = req.headers['x-signature'];
      const deviceTimestamp = req.headers['x-timestamp'];

      if (!deviceId || !deviceSignature || !deviceTimestamp) {
        return HttpServer.json(res, 401, { error: 'Device authentication headers required.' });
      }

      // Security: device rate limiting
      if (!SecurityMiddleware.checkDeviceRateLimit(deviceId)) {
        return HttpServer.json(res, 429, { error: 'Device rate limit exceeded.' });
      }

      // Timestamp plausibility (within 5 minutes)
      const ts = Number(deviceTimestamp);
      if (isNaN(ts) || Math.abs(Date.now() - ts) > 300000) {
        return HttpServer.json(res, 401, { error: 'Invalid or stale timestamp.' });
      }

      // Resolve device
      const device = ctx.observerDeviceRepo.findById(deviceId);
      if (!device || !device.isActive) {
        return HttpServer.json(res, 401, { error: 'Device not found or inactive.' });
      }

      // Verify device signature over raw body
      const signaturePayload = `${deviceTimestamp}${rawBody}`;
      const isValidSig = crypto.verify(
        'SHA256',
        Buffer.from(signaturePayload),
        { key: device.publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(deviceSignature, 'base64')
      );
      if (!isValidSig) {
        // Try DER encoding fallback
        try {
          const derValid = crypto.verify(
            'SHA256',
            Buffer.from(signaturePayload),
            device.publicKey,
            Buffer.from(deviceSignature, 'base64')
          );
          if (!derValid) {
            return HttpServer.json(res, 401, { error: 'Invalid device signature.' });
          }
        } catch {
          return HttpServer.json(res, 401, { error: 'Invalid device signature.' });
        }
      }

      // Resolve merchant from device
      const merchant = ctx.merchantRepo.findById(device.merchantId);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Device merchant not found.' });
      }

      // Security: merchant rate limiting
      if (!SecurityMiddleware.checkMerchantRateLimit(merchant.id)) {
        return HttpServer.json(res, 429, { error: 'Merchant rate limit exceeded.' });
      }

      // Validate event payload
      const {
        eventId, source, direction, amountPaise, currency, referenceUtr,
        claimingReceivingIdentity, notificationTimestamp, deviceObservedTimestamp,
        parserVersion, eventSignature
      } = body;

      if (!eventId || !source || !amountPaise) {
        return HttpServer.json(res, 400, { error: 'eventId, source, and amountPaise are required.' });
      }

      // Check for duplicate event
      const existing = ctx.upiMirrorObservationRepo.findByEventId(eventId);
      if (existing) {
        return HttpServer.json(res, 200, {
          eventId,
          status: 'DUPLICATE',
          observationId: existing.id,
          classification: existing.classification,
          message: 'Event already ingested.'
        });
      }

      // Compute fingerprint
      const fingerprint = crypto.createHash('sha256')
        .update(`${device.merchantId}:${amountPaise}:${source}:${referenceUtr || 'NO_REF'}:${Math.floor(new Date(notificationTimestamp || Date.now()).getTime() / 60000)}`)
        .digest('hex');

      const fingerprintExisting = ctx.upiMirrorObservationRepo.findByFingerprint(fingerprint);
      const isDuplicate = Boolean(fingerprintExisting);

      // Find the UPI connection for this merchant that matches the claiming identity
      let upiConnection = null;
      const connections = ctx.upiConnectionRepo.findByMerchant(merchant.id);
      if (claimingReceivingIdentity) {
        upiConnection = connections.find(c => c.vpa.toLowerCase() === claimingReceivingIdentity.toLowerCase());
      }
      if (!upiConnection && connections.length > 0) {
        upiConnection = connections.find(c => c.connectionState === 'OBSERVER_CONNECTED') || connections[0];
      }

      // Persist the observation durably before acknowledging
      const observation = ctx.upiMirrorObservationRepo.create({
        id: `obs_${crypto.randomUUID()}`,
        merchantId: merchant.id,
        upiConnectionId: upiConnection?.id || null,
        observerDeviceId: deviceId,
        eventId,
        source,
        direction: direction || 'INBOUND',
        amountPaise,
        currency: currency || 'INR',
        referenceUtr,
        claimingReceivingIdentity,
        notificationTimestamp,
        deviceObservedTimestamp,
        serverReceivedTimestamp: new Date().toISOString(),
        parserVersion,
        eventSignature,
        fingerprintHash: fingerprint,
        classification: isDuplicate ? ObservationClassification.DISPUTED : ObservationClassification.PENDING,
        isDuplicate
      });

      if (isDuplicate) {
        ctx.upiMirrorObservationRepo.update(observation.id, { classification: ObservationClassification.DISPUTED });
      }

      // Update connection health
      if (upiConnection) {
        ctx.upiConnectionRepo.update(upiConnection.id, {
          lastObservedAt: new Date().toISOString(),
          healthStatus: 'HEALTHY'
        });

        const sourceConfig = ctx.observerSourceConfigRepo.findEnabledByConnection(upiConnection.id)
          .find(s => s.sourceName === source);
        if (sourceConfig) {
          ctx.observerSourceConfigRepo.update(sourceConfig.id, {
            lastEventAt: new Date().toISOString(),
            eventCount: sourceConfig.eventCount + 1,
            duplicateCount: sourceConfig.duplicateCount + (isDuplicate ? 1 : 0)
          });
        }

        if (ctx.connectionHealthEventRepo) {
          ctx.connectionHealthEventRepo.create({
            upiConnectionId: upiConnection.id,
            observerDeviceId: deviceId,
            previousState: upiConnection.connectionState,
            newState: upiConnection.connectionState,
            trigger: 'OBSERVATION_RECEIVED',
            latencyMs: Date.now() - startTime
          });
        }
      }

      const ingestionLatency = Date.now() - startTime;

      return HttpServer.json(res, 201, {
        eventId,
        observationId: observation.id,
        status: 'ACCEPTED',
        classification: observation.classification,
        isDuplicate,
        merchantId: merchant.id,
        upiConnectionId: upiConnection?.id || null,
        ingestionLatencyMs: ingestionLatency,
        serverReceivedAt: new Date().toISOString(),
        message: 'Observation accepted. Classification pending matching engine.'
      });
    } catch (err) {
      console.error('[UPI Mirror] Event ingestion error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // GET /api/v1/upi-mirror/observations — List observations for merchant
  server.get(`${base}/observations`, async (req, res) => {
    try {
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      const observations = ctx.upiMirrorObservationRepo.findByMerchant(merchant.id, 100);

      return HttpServer.json(res, 200, {
        observations: observations.map(o => ({
          id: o.id,
          eventId: o.eventId,
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
        }))
      });
    } catch (err) {
      console.error('[UPI Mirror] List observations error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // GET /api/v1/upi-mirror/devices/:id/diagnostics — Run device diagnostics
  server.get(`${base}/devices/:id/diagnostics`, async (req, res, params) => {
    try {
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      const device = ctx.observerDeviceRepo.findById(params.id);
      if (!device || device.merchantId !== merchant.id) {
        return HttpServer.json(res, 404, { error: 'Observer device not found.' });
      }

      const diagnostics = {
        deviceId: device.id,
        deviceName: device.deviceName,
        pairingState: device.pairingState,
        listenerStatus: device.listenerStatus,
        notificationPermission: device.notificationPermission,
        lastHeartbeatAt: device.lastHeartbeatAt,
        lastEventAt: device.lastEventAt,
        avgForwardingLatencyMs: device.avgForwardingLatencyMs,
        isActive: device.isActive,
        linkedConnections: ctx.upiConnectionRepo.findByObserverDevice(device.id).map(c => ({
          id: c.id,
          vpa: c.vpa,
          connectionState: c.connectionState,
          healthStatus: c.healthStatus
        })),
        healthChecks: {
          pairing: device.pairingState === 'PAIRED' ? 'PASS' : 'FAIL',
          listener: device.listenerStatus === 'ACTIVE' ? 'PASS' : 'WARN',
          permission: device.notificationPermission ? 'PASS' : 'FAIL',
          heartbeat: device.lastHeartbeatAt
            ? (Date.now() - new Date(device.lastHeartbeatAt).getTime() < 300000 ? 'PASS' : 'WARN')
            : 'FAIL',
          forwarding: device.lastEventAt
            ? (Date.now() - new Date(device.lastEventAt).getTime() < 600000 ? 'PASS' : 'INFO')
            : 'INFO'
        },
        timestamp: new Date().toISOString()
      };

      return HttpServer.json(res, 200, diagnostics);
    } catch (err) {
      console.error('[UPI Mirror] Device diagnostics error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // ============================================================
  // Subscription Entitlements (Phase 1)
  // ============================================================

  // GET /api/v1/upi-mirror/subscription — Get merchant's subscription entitlements
  server.get(`${base}/subscription`, async (req, res) => {
    try {
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      const entitlement = ctx.subscriptionEntitlementRepo.findByMerchant(merchant.id);

      if (!entitlement) {
        return HttpServer.json(res, 200, {
          hasSubscription: false,
          message: 'No active subscription. Subscribe to enable UPI Mirror.'
        });
      }

      const connections = ctx.upiConnectionRepo.findByMerchant(merchant.id);
      const devices = ctx.observerDeviceRepo.findByMerchant(merchant.id);

      return HttpServer.json(res, 200, {
        hasSubscription: true,
        planId: entitlement.planId,
        status: entitlement.status,
        maxUpiiConnections: entitlement.maxUpiiConnections,
        maxObserverDevices: entitlement.maxObserverDevices,
        observationSourcesEnabled: entitlement.observationSourcesEnabled,
        webhookEndpointsEnabled: entitlement.webhookEndpointsEnabled,
        callbackConcurrency: entitlement.callbackConcurrency,
        apiQuotaDaily: entitlement.apiQuotaDaily,
        paymentLinkLimit: entitlement.paymentLinkLimit,
        featureEntitlements: entitlement.featureEntitlements,
        currentPeriodEnd: entitlement.currentPeriodEnd,
        gracePeriodEndsAt: entitlement.gracePeriodEndsAt,
        currentUsage: {
          upiConnections: connections.length,
          observerDevices: devices.filter(d => d.isActive).length
        },
        createdAt: entitlement.createdAt,
        updatedAt: entitlement.updatedAt
      });
    } catch (err) {
      console.error('[UPI Mirror] Get subscription error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });

  // GET /api/v1/upi-mirror/download — Secure APK download for subscribed merchants
  server.get(`${base}/download`, async (req, res) => {
    try {
      const merchant = resolveMerchant(req);
      if (!merchant) {
        return HttpServer.json(res, 401, { error: 'Merchant authentication required.' });
      }

      const entitlement = ctx.subscriptionEntitlementRepo.findByMerchant(merchant.id);
      if (!entitlement || entitlement.status !== 'ACTIVE') {
        return HttpServer.json(res, 403, {
          error: 'Active subscription required to download Dynamo Bridge.',
          message: 'Subscribe to Dynamo Pay to enable Android Bridge download.'
        });
      }

      const downloadUrl = process.env.DYNAMO_BRIDGE_APK_URL
        || 'https://github.com/Tashima-Tarsh/Sanbookpay/releases/latest/download/app-debug.apk';

      const checksumUrl = process.env.DYNAMO_BRIDGE_APK_CHECKSUM_URL
        || 'https://github.com/Tashima-Tarsh/Sanbookpay/releases/latest/download/app-debug.apk.sha256';

      // QR code payload: the download URL (merchant scans this on their phone)
      const qrPayload = JSON.stringify({
        type: 'dynamo-bridge-download',
        app: 'Dynamo Bridge',
        downloadUrl,
        checksumUrl,
        merchantId: merchant.id,
        timestamp: new Date().toISOString()
      });

      return HttpServer.json(res, 200, {
        appName: 'Dynamo Bridge',
        version: '1.0.0',
        minAndroidVersion: 'Android 8.0 (API 26)',
        downloadUrl,
        checksumUrl,
        qrPayload,
        qrDisplayText: downloadUrl,
        security: {
          integrityCheck: 'SHA256 checksum provided',
          delivery: 'HTTPS only',
          codeSigning: 'Debug key (CI-built). Use release key for Play Store.',
          dataCollection: 'No UPI PINs, passwords, OTPs, or bank credentials collected.',
          permissions: [
            'Notification access (to observe UPI credit alerts)',
            'Internet (to forward events to your backend)',
            'Camera (to scan pairing QR)',
            'Foreground service (background persistence)'
          ],
          whatWeDoNotCollect: [
            'UPI PIN',
            'Bank login password',
            'OTP',
            'Debit card details',
            'Private UPI app credentials'
          ]
        },
        installationSteps: [
          '1. Tap the download link or scan the QR code on your phone.',
          '2. Enable "Install from unknown sources" in Android Settings if prompted.',
          '3. Open the downloaded APK to install Dynamo Bridge.',
          '4. Open the app and scan the pairing QR from your merchant dashboard.',
          '5. Grant Notification Listener permission when prompted.'
        ],
        merchantId: merchant.id,
        generatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('[UPI Mirror] Download endpoint error:', err);
      return HttpServer.json(res, 500, { error: 'Internal Server Error' });
    }
  });
}
