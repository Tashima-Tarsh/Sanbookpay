/**
 * DYNAMO PAY UPI Mirror Service.
 *
 * Orchestrates the complete UPI Mirror flow:
 * 1. Observation ingestion (device-authenticated)
 * 2. Flash matching (deterministic correlation)
 * 3. Evidence classification (OBSERVED -> MATCHED -> VERIFIED)
 * 4. Webhook dispatch via transactional outbox
 * 5. SSE real-time notifications
 */
export class UpiMirrorService {
  /**
   * @param {{
   *   db: import('@youpi/db').Database,
   *   upiConnectionRepo: import('@youpi/db').MerchantUpiConnectionRepository,
   *   observerDeviceRepo: import('@youpi/db').MerchantObserverDeviceRepository,
   *   pairingChallengeRepo: import('@youpi/db').DevicePairingChallengeRepository,
   *   observerSourceConfigRepo: import('@youpi/db').ObserverSourceConfigRepository,
   *   subscriptionEntitlementRepo: import('@youpi/db').SubscriptionEntitlementRepository,
   *   connectionHealthEventRepo: import('@youpi/db').ConnectionHealthEventRepository,
   *   upiMirrorObservationRepo: import('@youpi/db').UpiMirrorObservationRepository,
   *   callbackOutboxRepo: import('@youpi/db').CallbackOutboxRepository,
   *   callbackDeliveryAttemptRepo: import('@youpi/db').CallbackDeliveryAttemptRepository,
   *   sessionRepo: import('@youpi/db').PaymentSessionRepository,
   *   merchantRepo: import('@youpi/db').MerchantRepository,
   *   auditRepo: import('@youpi/db').AuditLogRepository,
   *   flashMatchingEngine: import('./flash-matching-engine.js').FlashMatchingEngine,
   *   eventEmitter?: { emit: (event: string, payload: any) => void },
   *   server?: { broadcastSse: (topic, event, data) => void }
   * }} options
   */
  constructor(options) {
    this.db = options.db;
    this.upiConnectionRepo = options.upiConnectionRepo;
    this.observerDeviceRepo = options.observerDeviceRepo;
    this.pairingChallengeRepo = options.pairingChallengeRepo;
    this.observerSourceConfigRepo = options.observerSourceConfigRepo;
    this.subscriptionEntitlementRepo = options.subscriptionEntitlementRepo;
    this.connectionHealthEventRepo = options.connectionHealthEventRepo;
    this.upiMirrorObservationRepo = options.upiMirrorObservationRepo;
    this.callbackOutboxRepo = options.callbackOutboxRepo;
    this.callbackDeliveryAttemptRepo = options.callbackDeliveryAttemptRepo;
    this.sessionRepo = options.sessionRepo;
    this.merchantRepo = options.merchantRepo;
    this.auditRepo = options.auditRepo;
    this.flashMatchingEngine = options.flashMatchingEngine;
    this.eventEmitter = options.eventEmitter || { emit: () => {} };
    this.server = options.server || null;
    this.processing = false;
  }

  /**
   * Ingest an observation from an authenticated observer device.
   * Persists durably before acknowledging, then triggers matching.
   */
  async ingestObservation(eventData) {
    const {
      eventId, source, direction, amountPaise, currency, referenceUtr,
      claimingReceivingIdentity, notificationTimestamp, deviceObservedTimestamp,
      parserVersion, eventSignature, fingerprintHash, merchantId, observerDeviceId
    } = eventData;

    // Check for duplicate event ID
    const existing = this.upiMirrorObservationRepo.findByEventId(eventId);
    if (existing) {
      return {
        eventId,
        observationId: existing.id,
        status: 'DUPLICATE',
        classification: existing.classification,
        message: 'Event already ingested'
      };
    }

    // Check fingerprint for near-duplicate detection
    const fpExisting = this.upiMirrorObservationRepo.findByFingerprint(fingerprintHash);
    const isDuplicate = Boolean(fpExisting);

    // Resolve UPI connection for this merchant + claiming identity
    let upiConnectionId = null;
    if (merchantId) {
      const connections = this.upiConnectionRepo.findByMerchant(merchantId);
      if (claimingReceivingIdentity) {
        upiConnectionId = connections.find(c => c.vpa.toLowerCase() === claimingReceivingIdentity.toLowerCase())?.id || null;
      }
      if (!upiConnectionId && connections.length > 0) {
        upiConnectionId = connections.find(c => c.connectionState === 'OBSERVER_CONNECTED')?.id ||
                          connections[0]?.id || null;
      }
    }

    // Persist durably before acknowledging
    const observation = this.upiMirrorObservationRepo.create({
      id: `upi_obs_${crypto.randomUUID()}`,
      merchantId,
      upiConnectionId,
      observerDeviceId,
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
      fingerprintHash,
      classification: isDuplicate ? 'DISPUTED' : 'PENDING',
      isDuplicate
    });

    // Update connection health
    if (upiConnectionId) {
      this.upiConnectionRepo.update(upiConnectionId, {
        lastObservedAt: new Date().toISOString(),
        healthStatus: 'HEALTHY'
      });

      const sourceConfigs = this.observerSourceConfigRepo.findEnabledByConnection(upiConnectionId);
      const matchingConfig = sourceConfigs.find(s => s.sourceName === source);
      if (matchingConfig) {
        this.observerSourceConfigRepo.update(matchingConfig.id, {
          lastEventAt: new Date().toISOString(),
          eventCount: matchingConfig.eventCount + 1,
          duplicateCount: matchingConfig.duplicateCount + (isDuplicate ? 1 : 0)
        });
      }

      if (this.connectionHealthEventRepo) {
        this.connectionHealthEventRepo.create({
          id: `chealth_${crypto.randomUUID()}`,
          upiConnectionId,
          observerDeviceId,
          previousState: null,
          newState: 'OBSERVATION_RECEIVED',
          trigger: 'OBSERVATION_INGESTED',
          latencyMs: Date.now() - new Date(deviceObservedTimestamp || Date.now()).getTime()
        });
      }
    }

    // Audit log
    if (this.auditRepo) {
      this.auditRepo.log({
        merchantId,
        entityType: 'UPI_MIRROR_OBSERVATION',
        entityId: observation.id,
        action: 'OBSERVATION_INGESTED',
        actorType: 'OBSERVER',
        details: {
          eventId, source, amountPaise, currency, referenceUtr,
          isDuplicate, upiConnectionId
        }
      });
    }

    // Trigger flash matching if not already processing
    if (!this.processing) {
      this.processMatchingLoop();
    }

    return {
      eventId,
      observationId: observation.id,
      status: 'ACCEPTED',
      classification: observation.classification,
      isDuplicate,
      upiConnectionId,
      serverReceivedAt: observation.serverReceivedTimestamp,
      message: isDuplicate ? 'Duplicate observation recorded' : 'Observation accepted. Matching in progress.'
    };
  }

  /**
   * Process all pending observations through the flash matching engine.
   * Runs as a bounded batch to avoid blocking.
   */
  async processMatchingLoop() {
    if (this.processing) return;
    this.processing = true;

    try {
      const results = await this.flashMatchingEngine.processPendingBatch(50);
      // Emit batch completion
      if (results.length > 0) {
        this.eventEmitter.emit('UPI_MIRROR.BATCH_COMPLETED', {
          count: results.length,
          matched: results.filter(r => r.matched).length,
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('[UPI Mirror] Matching loop error:', err.message);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Classify a payment observation as verified (requires authoritative bank/PSP record).
   * This is NOT called from notification evidence alone.
   */
  async verifyObservation(observationId, authoritativeData, verifiedBy) {
    const obs = this.upiMirrorObservationRepo.findById(observationId);
    if (!obs) throw new Error('Observation not found');

    // Only allow verification if there's an authoritative source
    if (!authoritativeData.bankReferenceNumber && !authoritativeData.providerPaymentId) {
      throw new Error('Authoritative bank/PSP reference required for verification');
    }

    // Update observation classification
    this.upiMirrorObservationRepo.update(observationId, {
      classification: 'VERIFIED',
      matchEvidence: JSON.stringify({
        ...JSON.parse(obs.matchEvidence || '{}'),
        verifiedBy,
        verifiedAt: new Date().toISOString(),
        authoritativeData
      })
    });

    // Update session to VERIFIED if matched
    if (obs.matchedOrderId) {
      const session = this.sessionRepo.findByOrderId(obs.merchantId, obs.matchedOrderId);
      if (session) {
        const metadata = { ...session.metadata, evidenceState: 'VERIFIED', verificationSource: 'AUTHORITATIVE' };
        this.db.execute(`
          UPDATE payment_sessions
          SET metadata = ?, updated_at = ?
          WHERE id = ?
        `, [JSON.stringify(metadata), new Date().toISOString(), session.id]);

        // Create verified webhook event
        const merchant = this.merchantRepo.findById(obs.merchantId);
        if (merchant?.webhookUrl) {
          const idempotencyKey = `cb_verified_${observationId}`;
          const existing = this.callbackOutboxRepo.findByIdempotencyKey(idempotencyKey);
          if (!existing) {
            this.callbackOutboxRepo.create({
              id: `cbout_${crypto.randomUUID()}`,
              merchantId: obs.merchantId,
              paymentId: session.id,
              eventType: 'payment.verified',
              payload: JSON.stringify({
                event: 'payment.verified',
                merchantId: obs.merchantId,
                paymentId: session.id,
                orderId: session.orderId,
                amountPaise: session.amountPaise?.toString(),
                observationId,
                verificationSource: 'AUTHORITATIVE',
                verifiedBy,
                timestamp: new Date().toISOString()
              }),
              endpointUrl: merchant.webhookUrl,
              idempotencyKey,
              status: 'PENDING',
              maxAttempts: 5
            });
          }
        }

        this.eventEmitter.emit('UPI_MIRROR.VERIFIED', {
          observationId,
          paymentId: session.id,
          orderId: session.orderId,
          merchantId: obs.merchantId
        });

        if (this.server) {
          this.server.broadcastSse(`console_${obs.merchantId}`, 'upi_mirror_verified', {
            observationId,
            paymentId: session.id,
            orderId: session.orderId
          });
          this.server.broadcastSse(session.id, 'upi_mirror_verified', {
            orderId: session.orderId
          });
        }
      }
    }

    if (this.auditRepo) {
      this.auditRepo.log({
        merchantId: obs.merchantId,
        entityType: 'UPI_MIRROR_OBSERVATION',
        entityId: observationId,
        action: 'OBSERVATION_VERIFIED',
        actorType: verifiedBy.actorType || 'SYSTEM',
        actorId: verifiedBy.actorId || 'SYSTEM',
        details: authoritativeData
      });
    }

    return { observationId, classification: 'VERIFIED' };
  }

  /**
   * Get observations for a merchant with optional filtering.
   */
  getObservations(merchantId, options = {}) {
    const { limit = 50, classification, upiConnectionId } = options;
    let observations = this.upiMirrorObservationRepo.findByMerchant(merchantId, limit * 2);

    if (classification) {
      observations = observations.filter(o => o.classification === classification);
    }
    if (upiConnectionId) {
      observations = observations.filter(o => o.upiConnectionId === upiConnectionId);
    }

    return observations.slice(0, limit);
  }

  /**
   * Get UPI connections for a merchant.
   */
  getConnections(merchantId) {
    return this.upiConnectionRepo.findByMerchant(merchantId);
  }

  /**
   * Get observer devices for a merchant.
   */
  getDevices(merchantId) {
    return this.observerDeviceRepo.findByMerchant(merchantId);
  }

  /**
   * Get subscription entitlements for a merchant.
   */
  getEntitlements(merchantId) {
    return this.subscriptionEntitlementRepo.findByMerchant(merchantId);
  }

  /**
   * Get health events for a UPI connection.
   */
  getHealthEvents(upiConnectionId, limit = 50) {
    return this.connectionHealthEventRepo.findByConnection(upiConnectionId, limit);
  }
}
