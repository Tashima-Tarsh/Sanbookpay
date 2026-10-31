import crypto from 'node:crypto';
import {
  PaymentStatus,
  ObservationClassification,
  PaymentEvidenceState,
  UpiMirrorWebhookEvent
} from '@youpi/common';

/**
 * DYNAMO FLASH — Real-Time Event Correlation & Matching Engine.
 *
 * Deterministically matches observer events to payment orders without guessing.
 * Never matches on amount alone when multiple plausible pending orders exist.
 * Explicitly handles ambiguity with unresolved states.
 */
export class FlashMatchingEngine {
  /**
   * @param {{
   *   db: import('@youpi/db').Database,
   *   sessionRepo: import('@youpi/db').PaymentSessionRepository,
   *   obsRepo: import('@youpi/db').ObservationRepository,
   *   upiMirrorObsRepo: import('@youpi/db').UpiMirrorObservationRepository,
   *   upiConnectionRepo: import('@youpi/db').MerchantUpiConnectionRepository,
   *   callbackOutboxRepo: import('@youpi/db').CallbackOutboxRepository,
   *   eventEmitter?: { emit: (event: string, payload: any) => void },
   *   server?: { broadcastSse: (topic, event, data) => void }
   * }} options
   */
  constructor(options) {
    this.db = options.db;
    this.sessionRepo = options.sessionRepo;
    this.obsRepo = options.obsRepo;
    this.upiMirrorObsRepo = options.upiMirrorObsRepo;
    this.upiConnectionRepo = options.upiConnectionRepo;
    this.callbackOutboxRepo = options.callbackOutboxRepo;
    this.eventEmitter = options.eventEmitter || { emit: () => {} };
    this.server = options.server || null;
  }

  /**
   * Process a pending UPI Mirror observation through the matching engine.
   * Returns the match result with classification and evidence.
   */
  async processObservation(observation) {
    const {
      id: obsId,
      merchantId,
      upiConnectionId,
      amountPaise,
      currency,
      referenceUtr,
      claimingReceivingIdentity,
      notificationTimestamp,
      deviceObservedTimestamp,
      fingerprintHash,
      classification
    } = observation;

    // Skip if already classified
    if (classification !== 'PENDING') {
      return { observationId: obsId, classification, matched: false };
    }

    const matchEvidence = {
      rulesAttempted: [],
      exactMatch: false,
      amountOnlyCandidates: 0,
      ambiguityResolved: false,
      matchReason: null
    };

    // Rule 1: Exact UTR/RRN match — highest confidence
    if (referenceUtr) {
      matchEvidence.rulesAttempted.push('EXACT_UTR');
      const exactMatch = this.findExactUtrMatch(merchantId, referenceUtr, amountPaise);
      if (exactMatch) {
        matchEvidence.exactMatch = true;
        matchEvidence.matchReason = 'Exact UTR reference match';
        return await this.commitMatch(obsId, exactMatch.session, ObservationClassification.MATCHED, matchEvidence, merchantId);
      }
    }

    // Rule 2: VPA + amount + time window match — medium confidence
    if (upiConnectionId) {
      matchEvidence.rulesAttempted.push('VPA_AMOUNT_TIME');
      const vpaMatch = this.findVpaAmountTimeMatch(upiConnectionId, amountPaise, notificationTimestamp);
      if (vpaMatch.session && vpaMatch.ambiguous === false) {
        matchEvidence.matchReason = 'VPA + amount + time window match';
        return await this.commitMatch(obsId, vpaMatch.session, ObservationClassification.MATCHED, matchEvidence, merchantId);
      } else if (vpaMatch.session && vpaMatch.ambiguous === true) {
        // Multiple plausible orders — cannot deterministically match
        matchEvidence.amountOnlyCandidates = vpaMatch.candidateCount;
        matchEvidence.ambiguityResolved = false;
        return await this.commitUnresolved(obsId, ObservationClassification.UNKNOWN, matchEvidence, merchantId);
      }
    }

    // Rule 3: Amount-only within merchant's active sessions — low confidence, never deterministic
    const amountMatches = this.findAmountOnlyMatches(merchantId, amountPaise);
    matchEvidence.amountOnlyCandidates = amountMatches.length;

    if (amountMatches.length === 1) {
      // Single candidate but no UTR/VPA confirmation — mark as OBSERVED not MATCHED
      matchEvidence.rulesAttempted.push('AMOUNT_ONLY_SINGLE');
      matchEvidence.matchReason = 'Single amount-only candidate (unconfirmed)';
      return await this.commitMatch(obsId, amountMatches[0], ObservationClassification.OBSERVED, matchEvidence, merchantId);
    }

    if (amountMatches.length > 1) {
      // Multiple candidates — ambiguous, cannot match
      matchEvidence.rulesAttempted.push('AMOUNT_ONLY_MULTIPLE');
      return await this.commitUnresolved(obsId, ObservationClassification.UNKNOWN, matchEvidence, merchantId);
    }

    // No match found — observation remains PENDING for later reconciliation
    matchEvidence.rulesAttempted.push('NO_CANDIDATE');
    await this.upiMirrorObsRepo.update(obsId, {
      classification: ObservationClassification.PENDING,
      matchEvidence: JSON.stringify(matchEvidence)
    });

    return {
      observationId: obsId,
      classification: ObservationClassification.PENDING,
      matched: false,
      evidence: matchEvidence
    };
  }

  /**
   * Find a session with exact UTR match.
   */
  findExactUtrMatch(merchantId, referenceUtr, amountPaise) {
    const rows = this.db.query(`
      SELECT ps.* FROM payment_sessions ps
      WHERE ps.merchant_id = ?
        AND ps.status IN ('ACTIVE', 'PROCESSING', 'VERIFICATION_PENDING')
        AND json_extract(ps.metadata, '\$.reportedUtr') = ?
        AND ps.amount_paise = ?
      ORDER BY ps.created_at DESC
    `, [merchantId, referenceUtr, Number(amountPaise)]);

    if (rows.length === 0) return null;
    if (rows.length > 1) {
      // Duplicate UTR across sessions — ambiguous, return null to force unresolved
      return null;
    }
    return { session: this.sessionRepo.mapRow(rows[0]), ambiguous: false };
  }

  /**
   * Find sessions matching VPA + amount + time window.
   */
  findVpaAmountTimeMatch(upiConnectionId, amountPaise, notificationTimestamp) {
    const conn = this.upiConnectionRepo.findById(upiConnectionId);
    if (!conn) return { session: null, ambiguous: false, candidateCount: 0 };

    const obsTime = notificationTimestamp ? new Date(notificationTimestamp) : new Date();
    // 30-minute window before and after observation
    const windowStart = new Date(obsTime.getTime() - 30 * 60000).toISOString();
    const windowEnd = new Date(obsTime.getTime() + 30 * 60000).toISOString();

    const rows = this.db.query(`
      SELECT ps.* FROM payment_sessions ps
      WHERE ps.receiving_account_id IN (
        SELECT id FROM payment_receiving_accounts WHERE merchant_id = ? AND upi_id = ?
      )
        AND ps.status IN ('ACTIVE', 'PROCESSING', 'VERIFICATION_PENDING')
        AND ps.amount_paise = ?
        AND ps.created_at >= ?
        AND ps.created_at <= ?
      ORDER BY ps.created_at DESC
    `, [conn.merchantId, conn.vpa, Number(amountPaise), windowStart, windowEnd]);

    if (rows.length === 0) return { session: null, ambiguous: false, candidateCount: 0 };
    if (rows.length === 1) return { session: this.sessionRepo.mapRow(rows[0]), ambiguous: false, candidateCount: 1 };

    // Multiple candidates — ambiguous
    return { session: null, ambiguous: true, candidateCount: rows.length };
  }

  /**
   * Find amount-only matches within merchant's active sessions.
   * Never deterministic — used only for OBSERVED classification.
   */
  findAmountOnlyMatches(merchantId, amountPaise) {
    const rows = this.db.query(`
      SELECT ps.* FROM payment_sessions ps
      WHERE ps.merchant_id = ?
        AND ps.status IN ('ACTIVE', 'PROCESSING', 'VERIFICATION_PENDING')
        AND ps.amount_paise = ?
      ORDER BY ps.created_at DESC
    `, [merchantId, Number(amountPaise)]);

    return rows.map(r => this.sessionRepo.mapRow(r));
  }

  /**
   * Commit a match: update observation classification, session state, and create outbox event.
   */
  async commitMatch(obsId, session, classification, matchEvidence, merchantId) {
    await this.upiMirrorObsRepo.update(obsId, {
      classification,
      matchedOrderId: session.orderId,
      matchEvidence: JSON.stringify(matchEvidence)
    });

    // Update payment session evidence state
    const sessionRow = this.sessionRepo.findById(session.id);
    if (sessionRow) {
      const metadata = { ...sessionRow.metadata, evidenceState: classification };
      this.db.execute(`
        UPDATE payment_sessions
        SET metadata = ?, updated_at = ?
        WHERE id = ?
      `, [JSON.stringify(metadata), new Date().toISOString(), session.id]);
    }

    // Create callback outbox event for merchant notification
    const merchant = await this.getMerchant(merchantId);
    if (merchant?.webhookUrl) {
      const idempotencyKey = `cb_${obsId}`;
      const existing = this.callbackOutboxRepo.findByIdempotencyKey(idempotencyKey);
      if (!existing) {
        const payload = JSON.stringify({
          event: this.classificationToWebhookEvent(classification),
          merchantId,
          paymentId: session.id,
          orderId: session.orderId,
          amountPaise: session.amountPaise?.toString(),
          observationId: obsId,
          classification,
          evidence: matchEvidence,
          timestamp: new Date().toISOString()
        });

        this.callbackOutboxRepo.create({
          id: `cbout_${crypto.randomUUID()}`,
          merchantId,
          paymentId: session.id,
          eventType: this.classificationToWebhookEvent(classification),
          payload,
          endpointUrl: merchant.webhookUrl,
          idempotencyKey,
          status: 'PENDING',
          maxAttempts: 5
        });
      }
    }

    // Emit events
    this.eventEmitter.emit('UPI_MIRROR.MATCHED', {
      observationId: obsId,
      paymentId: session.id,
      orderId: session.orderId,
      merchantId,
      classification,
      amountPaise: session.amountPaise?.toString()
    });

    if (this.server) {
      this.server.broadcastSse(`console_${merchantId}`, 'upi_mirror_match', {
        observationId: obsId,
        paymentId: session.id,
        orderId: session.orderId,
        classification,
        amountPaise: session.amountPaise?.toString()
      });
      this.server.broadcastSse(session.id, 'upi_mirror_match', {
        classification,
        orderId: session.orderId,
        amountPaise: session.amountPaise?.toString()
      });
    }

    return {
      observationId: obsId,
      classification,
      matched: true,
      paymentId: session.id,
      orderId: session.orderId,
      evidence: matchEvidence
    };
  }

  /**
   * Commit an unresolved observation (ambiguous or no match).
   */
  async commitUnresolved(obsId, classification, matchEvidence, merchantId) {
    await this.upiMirrorObsRepo.update(obsId, {
      classification,
      matchEvidence: JSON.stringify(matchEvidence)
    });

    this.eventEmitter.emit('UPI_MIRROR.UNRESOLVED', {
      observationId: obsId,
      merchantId,
      classification,
      evidence: matchEvidence
    });

    return {
      observationId: obsId,
      classification,
      matched: false,
      evidence: matchEvidence
    };
  }

  /**
   * Map observation classification to webhook event type.
   */
  classificationToWebhookEvent(classification) {
    const map = {
      [ObservationClassification.OBSERVED]: UpiMirrorWebhookEvent.PAYMENT_OBSERVED,
      [ObservationClassification.MATCHED]: UpiMirrorWebhookEvent.PAYMENT_MATCHED,
      [ObservationClassification.VERIFIED]: UpiMirrorWebhookEvent.PAYMENT_VERIFIED,
      [ObservationClassification.FAILED]: UpiMirrorWebhookEvent.PAYMENT_FAILED,
      [ObservationClassification.REVERSED]: UpiMirrorWebhookEvent.PAYMENT_REVERSED,
      [ObservationClassification.EXPIRED]: UpiMirrorWebhookEvent.PAYMENT_FAILED
    };
    return map[classification] || UpiMirrorWebhookEvent.PAYMENT_EXCEPTION;
  }

  async getMerchant(merchantId) {
    // Try via upi connection repo's db
    const row = this.db.queryOne('SELECT * FROM merchants WHERE id = ?', [merchantId]);
    return row ? {
      id: row.id,
      businessName: row.business_name,
      webhookUrl: row.webhook_url,
      webhookSecret: row.webhook_secret
    } : null;
  }

  /**
   * Batch process all pending observations.
   */
  async processPendingBatch(limit = 100) {
    const pending = this.upiMirrorObsRepo.findPendingClassification(limit);
    const results = [];
    for (const obs of pending) {
      try {
        const result = await this.processObservation(obs);
        results.push(result);
      } catch (err) {
        console.error('[Flash Match] Error processing observation', obs.id, err.message);
        results.push({ observationId: obs.id, error: err.message });
      }
    }
    return results;
  }
}
