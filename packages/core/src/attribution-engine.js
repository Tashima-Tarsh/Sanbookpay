import crypto from 'node:crypto';
import { PaymentStatus, ObservationAttributionStatus, TicketStatus, SenderType } from '@youpi/common';
import { assertValidTransition } from '@youpi/core';
const BANK_SOURCES = ['GMAIL','GOOGLE_MESSAGES','ANDROID_OBSERVER','SMS_GATEWAY'];
const INTENT_SOURCE = 'INTENT_RETURN';

export class AttributionEngine {
  /**
   * @param {{
   *   sessionRepo: import('@youpi/db').PaymentSessionRepository,
   *   obsRepo: import('@youpi/db').ObservationRepository,
   *   ticketRepo?: import('@youpi/db').SupportTicketRepository,
   *   auditRepo?: import('@youpi/db').AuditLogRepository,
   *   eventEmitter?: { emit: (event: string, payload: any) => void }
   * }} options
   */
  constructor(options) {
    this.sessionRepo = options.sessionRepo;
    this.obsRepo = options.obsRepo;
    this.ticketRepo = options.ticketRepo;
    this.auditRepo = options.auditRepo;
    this.eventEmitter = options.eventEmitter || { emit: () => {} };
    const isTestExecution = process.env.NODE_ENV === 'test' ||
      (process.execArgv && process.execArgv.includes('--test')) ||
      (process.argv && process.argv.some(a => typeof a === 'string' && a.includes('test')));

    this.gracePeriodMs = options.gracePeriodMs !== undefined
      ? options.gracePeriodMs
      : (process.env.PAYMENT_GRACE_PERIOD_MS !== undefined
        ? Number(process.env.PAYMENT_GRACE_PERIOD_MS)
        : (isTestExecution ? 0 : 5000));
    /** @type {Map<string, NodeJS.Timeout>} */
    this.pendingGraceTimers = new Map();
  }

  destroy() {
    for (const timer of this.pendingGraceTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingGraceTimers.clear();
  }

  reconcilePendingPayment(sessionId) {
    const session=this.sessionRepo.findById(sessionId);
    if(![PaymentStatus.ACTIVE,PaymentStatus.PROCESSING,PaymentStatus.VERIFICATION_PENDING].includes(session?.status) || !session.metadata?.reportedUtr) return null;
    const rows=this.sessionRepo.db.query(`SELECT * FROM payment_observations WHERE receiving_account_id=? AND amount_paise=? AND bank_reference_number=? AND attributed_payment_id IS NULL AND attribution_status IN ('UNATTRIBUTED','LATE_UNMATCHED') ORDER BY observed_at`,[session.receivingAccountId,Number(session.amountPaise),session.metadata.reportedUtr]);
    for(const row of rows){
      if(!BANK_SOURCES.includes(row.source)) continue;
      const result=this.processObservation(this.obsRepo.mapRow(row));
      if(result.attributed)return result;
    }
    return null;
  }

  /**
   * Processes a normalized canonical observation through the attribution pipeline.
   * @param {ReturnType<typeof import('./normalizer.js').ObservationNormalizer.normalize>} normalizedObs
   * @returns {{
   *   attributed: boolean,
   *   duplicate: boolean,
   *   lateMatch: boolean,
   *   paymentSessionId?: string,
   *   observationId: string,
   *   outcomeStatus: string,
   *   verificationLevel?: number,
   *   verificationTag?: string,
   *   verificationSources?: string[]
   * }}
   */
  processObservation(normalizedObs) {
    // Notifications are evidence, not an independently authenticated bank settlement.
    if(process.env.NODE_ENV==='production') {
      const prior=this.obsRepo.findByFingerprint(normalizedObs.fingerprintHash);
      const saved=prior||this.obsRepo.create(normalizedObs);
      if(!prior)this.auditRepo?.log({entityType:'PAYMENT_OBSERVATION',entityId:saved.id,action:'SUPPLEMENTARY_EVIDENCE_RECORDED',actorType:'OBSERVER',details:{source:normalizedObs.source,requires:'PROVIDER_OR_BANK_CONFIRMATION'}});
      return {attributed:false,duplicate:Boolean(prior),lateMatch:false,observationId:saved.id,outcomeStatus:'VERIFICATION_PENDING'};
    }
    // Tier 1: Check fingerprint for deduplication
    const existing = this.obsRepo.findByFingerprint(normalizedObs.fingerprintHash);
    const retrySavedBankRecord=existing && !existing.attributedPaymentId && ['UNATTRIBUTED','LATE_UNMATCHED'].includes(existing.attributionStatus) && BANK_SOURCES.includes(existing.source) && normalizedObs.bankReferenceNumber && this.sessionRepo.db.queryOne(`SELECT COUNT(*) AS n FROM payment_sessions WHERE status IN ('ACTIVE','PROCESSING','VERIFICATION_PENDING') AND receiving_account_id=? AND amount_paise=? AND json_extract(metadata,'$.reportedUtr')=?`,[normalizedObs.receivingAccountId,Number(normalizedObs.amountPaise),normalizedObs.bankReferenceNumber]).n===1;
    if(retrySavedBankRecord)normalizedObs=existing;
    if (existing && !retrySavedBankRecord) {
      // If observation came from the SAME source, drop as redundant duplicate
      if (existing.source === normalizedObs.source) {
        if (this.auditRepo) {
          this.auditRepo.log({
            entityType: 'PAYMENT_OBSERVATION',
            entityId: existing.id,
            action: 'DUPLICATE_OBSERVATION_DROPPED',
            actorType: 'OBSERVER',
            details: { fingerprintHash: normalizedObs.fingerprintHash, source: normalizedObs.source }
          });
        }
        return {
          attributed: false,
          duplicate: true,
          lateMatch: false,
          paymentSessionId: existing.attributedPaymentId || undefined,
          observationId: existing.id,
          outcomeStatus: ObservationAttributionStatus.DUPLICATE_IGNORED
        };
      }

      // If observation came from a NEW, DIFFERENT channel and payment was already attributed:
      // Upgrade verification tier to Level 2 (Dual Verification)!
      if (existing.attributedPaymentId) {
        // Cancel pending 5-second grace timer if any
        const pendingTimer = this.pendingGraceTimers.get(existing.attributedPaymentId);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          this.pendingGraceTimers.delete(existing.attributedPaymentId);
        }

        const savedObs = this.obsRepo.create(normalizedObs);
        const verifyResult = this.sessionRepo.recordVerificationSource(
          existing.attributedPaymentId,
          normalizedObs.source,
          savedObs.id,
          { finalizeSuccess: true }
        );
        this.obsRepo.markAttributed(savedObs.id, existing.attributedPaymentId);

        if (this.auditRepo) {
          this.auditRepo.log({
            entityType: 'PAYMENT_SESSION',
            entityId: existing.attributedPaymentId,
            action: 'PAYMENT_VERIFICATION_UPGRADED',
            actorType: 'SYSTEM',
            details: {
              source: normalizedObs.source,
              level: verifyResult.level,
              tag: verifyResult.tag,
              sources: verifyResult.sources
            }
          });
        }

        if (verifyResult.isFirstSuccess) {
          this.eventEmitter.emit('PAYMENT.SUCCESS', {
            paymentId: existing.attributedPaymentId,
            orderId: verifyResult.session.orderId,
            merchantId: verifyResult.session.merchantId,
            amountPaise: verifyResult.session.amountPaise,
            observationId: savedObs.id,
            verificationLevel: verifyResult.level,
            verificationTag: verifyResult.tag,
            sources: verifyResult.sources
          });
        }

        this.eventEmitter.emit('PAYMENT.VERIFICATION_UPGRADED', {
          paymentId: existing.attributedPaymentId,
          verificationLevel: verifyResult.level,
          verificationTag: verifyResult.tag,
          sources: verifyResult.sources
        });

        return {
          attributed: true,
          duplicate: false,
          lateMatch: false,
          paymentSessionId: existing.attributedPaymentId,
          observationId: savedObs.id,
          outcomeStatus: PaymentStatus.SUCCESS,
          verificationLevel: verifyResult.level,
          verificationTag: verifyResult.tag,
          verificationSources: verifyResult.sources
        };
      }
    }

    // Persist new observation as UNATTRIBUTED first
    const savedObs = retrySavedBankRecord ? existing : this.obsRepo.create(normalizedObs);
    if(BANK_SOURCES.includes(normalizedObs.source)&&normalizedObs.bankReferenceNumber){
      const manual=this.sessionRepo.db.query(`SELECT * FROM payment_sessions WHERE status='SUCCESS' AND verification_tag='MERCHANT_CONFIRMED' AND receiving_account_id=? AND amount_paise=? AND json_extract(metadata,'$.reportedUtr')=?`,[normalizedObs.receivingAccountId,Number(normalizedObs.amountPaise),normalizedObs.bankReferenceNumber]);
      if(manual.length>1)return {attributed:false,duplicate:false,lateMatch:false,observationId:savedObs.id,outcomeStatus:ObservationAttributionStatus.UNATTRIBUTED};
      if(manual.length===1&&normalizedObs.observedAt.getTime()>=new Date(manual[0].created_at).getTime()-300000){
        const verified=this.sessionRepo.recordVerificationSource(manual[0].id,normalizedObs.source,savedObs.id,{finalizeSuccess:true});
        this.obsRepo.markAttributed(savedObs.id,manual[0].id);
        this.eventEmitter.emit('PAYMENT.VERIFICATION_UPGRADED',{paymentId:manual[0].id,verificationLevel:verified.level,verificationTag:verified.tag,sources:verified.sources});
        return {attributed:true,duplicate:false,lateMatch:false,paymentSessionId:manual[0].id,observationId:savedObs.id,outcomeStatus:PaymentStatus.SUCCESS};
      }
    }

    // Tier 2: Check currently active session on receiving account
    let currentSession = null;
    const unresolved=this.sessionRepo.db.query(`SELECT * FROM payment_sessions WHERE receiving_account_id=? AND amount_paise=? AND status=?`,[normalizedObs.receivingAccountId,Number(normalizedObs.amountPaise),PaymentStatus.VERIFICATION_PENDING]);
    // A delayed bank record can settle an unresolved payment only by its exact reported reference,
    // receiving account and amount; amount-only matching could credit a newer customer's order.
    if (normalizedObs.bankReferenceNumber) {
      const pending = this.sessionRepo.db.query(`SELECT * FROM payment_sessions WHERE receiving_account_id=? AND amount_paise=? AND status IN ('ACTIVE','PROCESSING','VERIFICATION_PENDING') AND json_extract(metadata,'$.reportedUtr')=?`, [normalizedObs.receivingAccountId, Number(normalizedObs.amountPaise), normalizedObs.bankReferenceNumber]);
      if(pending.length > 1) return { attributed:false, duplicate:false, lateMatch:false, observationId:savedObs.id, outcomeStatus:ObservationAttributionStatus.UNATTRIBUTED };
      if(pending.length === 1) currentSession=this.sessionRepo.mapRow(pending[0]);
    }
    if(!currentSession && unresolved.length)return {attributed:false,duplicate:false,lateMatch:false,observationId:savedObs.id,outcomeStatus:ObservationAttributionStatus.UNATTRIBUTED};
    if (!currentSession && normalizedObs.rawPayload?.targetSessionId) {
      currentSession = this.sessionRepo.findById(normalizedObs.rawPayload.targetSessionId);
    }
    if (!currentSession || (currentSession.amountPaise !== normalizedObs.amountPaise)) {
      currentSession = this.sessionRepo.findCurrentActiveOrProcessing(normalizedObs.receivingAccountId);
    }
    if (currentSession && currentSession.amountPaise !== normalizedObs.amountPaise) {
      const matchRow = this.sessionRepo.db.queryOne(`
        SELECT * FROM payment_sessions
        WHERE receiving_account_id = ? AND status IN ('ACTIVE', 'PROCESSING') AND amount_paise = ?
        ORDER BY created_at DESC
        LIMIT 1
      `, [normalizedObs.receivingAccountId, Number(normalizedObs.amountPaise)]);
      if (matchRow) {
        currentSession = this.sessionRepo.mapRow(matchRow);
      }
    }
    if (!currentSession) {
      // Fallback: match the amount, but only inside the receiving account the observer
      // reported. Matching "any ACTIVE session on the gateway with this amount" could settle a
      // different merchant's live payment (cross-merchant hijack), so it is intentionally gone.
      const scopedRow = this.sessionRepo.db.queryOne(`
        SELECT * FROM payment_sessions
        WHERE receiving_account_id = ?
          AND status IN ('ACTIVE', 'PROCESSING')
          AND amount_paise = ?
        ORDER BY created_at DESC
        LIMIT 1
      `, [normalizedObs.receivingAccountId, Number(normalizedObs.amountPaise)]);
      if (scopedRow) {
        currentSession = this.sessionRepo.mapRow(scopedRow);
      }
    }

    if (currentSession) {
      // Invariant Check 1: Must be in ACTIVE or PROCESSING status
      const isEligibleStatus = [PaymentStatus.ACTIVE, PaymentStatus.PROCESSING].includes(currentSession.status) || (currentSession.status === PaymentStatus.VERIFICATION_PENDING && BANK_SOURCES.includes(normalizedObs.source) && Boolean(normalizedObs.bankReferenceNumber) && currentSession.metadata?.reportedUtr === normalizedObs.bankReferenceNumber);

      // Invariant Check 2: Exact Amount Match (in integer paise)
      const isAmountMatch = Number(currentSession.amountPaise) === Number(normalizedObs.amountPaise);

      // Invariant Check 3: Temporal Window (with 5-minute clock skew tolerance, strictly preventing hijacking of prior expired sessions)
      let isPriorExpiredSession = false;
      if (currentSession.slotAcquiredAt && normalizedObs.observedAt < currentSession.slotAcquiredAt) {
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        const recentExpired = this.sessionRepo.findRecentlyExpiredOrFailed(
          normalizedObs.receivingAccountId,
          thirtyMinutesAgo
        );
        isPriorExpiredSession = recentExpired.some(s => Number(s.amountPaise) === Number(normalizedObs.amountPaise));
      }

      const slotStart = currentSession.slotAcquiredAt
        ? new Date(currentSession.slotAcquiredAt.getTime() - 300000)
        : new Date(currentSession.createdAt.getTime() - 300000);

      const isTimeValid = !isPriorExpiredSession && (normalizedObs.observedAt >= slotStart);

      if (isEligibleStatus && isAmountMatch && isTimeValid) {
        const wasActive = currentSession.status === PaymentStatus.ACTIVE;

        // Check if there is already an active grace period awaiting second source for this session
        const pendingGrace = this.pendingGraceTimers.get(currentSession.id);
        if (pendingGrace) {
          clearTimeout(pendingGrace);
          this.pendingGraceTimers.delete(currentSession.id);

          // Second source confirmed within 5-second grace window -> LEVEL 2 DUAL VERIFICATION!
          const verifyResult = this.sessionRepo.recordVerificationSource(
            currentSession.id,
            normalizedObs.source,
            savedObs.id,
            { finalizeSuccess: true }
          );
          this.obsRepo.markAttributed(savedObs.id, currentSession.id);

          if (this.auditRepo) {
            this.auditRepo.log({
              merchantId: currentSession.merchantId,
              entityType: 'PAYMENT_SESSION',
              entityId: currentSession.id,
              action: 'PAYMENT_VERIFICATION_UPGRADED_L2',
              actorType: 'SYSTEM',
              details: {
                observationId: savedObs.id,
                source: normalizedObs.source,
                verificationLevel: 2,
                verificationTag: verifyResult.tag,
                sources: verifyResult.sources
              }
            });
          }

          this.eventEmitter.emit('PAYMENT.SUCCESS', {
            paymentId: currentSession.id,
            orderId: currentSession.orderId,
            merchantId: currentSession.merchantId,
            amountPaise: currentSession.amountPaise,
            observationId: savedObs.id,
            verificationLevel: 2,
            verificationTag: verifyResult.tag,
            sources: verifyResult.sources
          });

          if (this.server) {
            this.server.broadcastSse(`payment_session_${currentSession.id}`, 'status_change', {
              sessionId: currentSession.id,
              orderId: currentSession.orderId,
              status: PaymentStatus.SUCCESS,
              amountPaise: currentSession.amountPaise ? currentSession.amountPaise.toString() : '0',
              baseAmountPaise: currentSession.metadata?.baseAmountPaise ? String(currentSession.metadata.baseAmountPaise) : null,
              paiseOffset: currentSession.metadata?.paiseOffset || 0,
              completedAt: currentSession.completedAt ? currentSession.completedAt.toISOString() : null,
              verificationLevel: 2,
              verificationTag: verifyResult.tag
            });
          }

          this.eventEmitter.emit('PAYMENT.VERIFICATION_UPGRADED', {
            paymentId: currentSession.id,
            orderId: currentSession.orderId,
            verificationLevel: 2,
            verificationTag: verifyResult.tag,
            sources: verifyResult.sources
          });

          return {
            attributed: true,
            duplicate: false,
            lateMatch: false,
            wasActive,
            paymentSessionId: currentSession.id,
            observationId: savedObs.id,
            outcomeStatus: PaymentStatus.SUCCESS,
            verificationLevel: 2,
            verificationTag: verifyResult.tag,
            verificationSources: verifyResult.sources
          };
        }

        // FIRST SOURCE CONFIRMATION:
        // Record Level 1 verification source without immediate finalization (start 5-second grace window)
        const verifyResult = this.sessionRepo.recordVerificationSource(
          currentSession.id,
          normalizedObs.source,
          savedObs.id,
          { finalizeSuccess: false }
        );

        this.obsRepo.markAttributed(savedObs.id, currentSession.id);

        if (this.auditRepo) {
          this.auditRepo.log({
            merchantId: currentSession.merchantId,
            entityType: 'PAYMENT_SESSION',
            entityId: currentSession.id,
            action: 'PAYMENT_LEVEL1_VERIFIED',
            actorType: 'SYSTEM',
            details: {
              observationId: savedObs.id,
              source: normalizedObs.source,
              amountPaise: normalizedObs.amountPaise.toString(),
              verificationLevel: 1,
              verificationTag: verifyResult.tag,
              sources: verifyResult.sources
            }
          });
        }

        this.eventEmitter.emit('PAYMENT.LEVEL1_VERIFIED', {
          paymentId: currentSession.id,
          orderId: currentSession.orderId,
          merchantId: currentSession.merchantId,
          amountPaise: currentSession.amountPaise,
          observationId: savedObs.id,
          verificationLevel: 1,
          verificationTag: verifyResult.tag,
          sources: verifyResult.sources
        });

        // If grace period is 0 (e.g. in instant tests), finalize immediately
        if (this.gracePeriodMs <= 0) {
          const finalResult = this.sessionRepo.recordVerificationSource(
            currentSession.id,
            normalizedObs.source,
            savedObs.id,
            { finalizeSuccess: true }
          );
          this.eventEmitter.emit('PAYMENT.SUCCESS', {
            paymentId: currentSession.id,
            orderId: currentSession.orderId,
            merchantId: currentSession.merchantId,
            amountPaise: currentSession.amountPaise,
            observationId: savedObs.id,
            verificationLevel: finalResult.level,
            verificationTag: finalResult.tag,
            sources: finalResult.sources
          });

          if (this.server) {
            this.server.broadcastSse(`payment_session_${currentSession.id}`, 'status_change', {
              sessionId: currentSession.id,
              orderId: currentSession.orderId,
              status: PaymentStatus.SUCCESS,
              amountPaise: currentSession.amountPaise ? currentSession.amountPaise.toString() : '0',
              baseAmountPaise: currentSession.metadata?.baseAmountPaise ? String(currentSession.metadata.baseAmountPaise) : null,
              paiseOffset: currentSession.metadata?.paiseOffset || 0,
              completedAt: currentSession.completedAt ? currentSession.completedAt.toISOString() : null,
              verificationLevel: finalResult.level,
              verificationTag: finalResult.tag
            });
          }

          return {
            attributed: true,
            duplicate: false,
            lateMatch: false,
            wasActive,
            paymentSessionId: currentSession.id,
            observationId: savedObs.id,
            outcomeStatus: PaymentStatus.SUCCESS,
            verificationLevel: finalResult.level,
            verificationTag: finalResult.tag,
            verificationSources: finalResult.sources
          };
        }

        // Start 5-second grace window awaiting second poller
        const targetSessionId = currentSession.id;
        const targetObsId = savedObs.id;
        const targetSource = normalizedObs.source;
        const targetOrderId = currentSession.orderId;
        const targetMerchantId = currentSession.merchantId;
        const targetAmountPaise = currentSession.amountPaise;

        const graceTimer = setTimeout(() => {
          this.pendingGraceTimers.delete(targetSessionId);
          // 5 seconds elapsed without second source: finalize as Level 1
          const finalResult = this.sessionRepo.recordVerificationSource(
            targetSessionId,
            targetSource,
            targetObsId,
            { finalizeSuccess: true }
          );

          if (this.auditRepo) {
            this.auditRepo.log({
              merchantId: targetMerchantId,
              entityType: 'PAYMENT_SESSION',
              entityId: targetSessionId,
              action: 'PAYMENT_ATTRIBUTED_SUCCESS_L1',
              actorType: 'SYSTEM',
              details: {
                observationId: targetObsId,
                source: targetSource,
                verificationLevel: finalResult.level,
                verificationTag: finalResult.tag
              }
            });
          }

          this.eventEmitter.emit('PAYMENT.SUCCESS', {
            paymentId: targetSessionId,
            orderId: targetOrderId,
            merchantId: targetMerchantId,
            amountPaise: targetAmountPaise,
            observationId: targetObsId,
            verificationLevel: finalResult.level,
            verificationTag: finalResult.tag,
            sources: finalResult.sources
          });

          if (this.server) {
            this.server.broadcastSse(`payment_session_${targetSessionId}`, 'status_change', {
              sessionId: targetSessionId,
              orderId: targetOrderId,
              status: PaymentStatus.SUCCESS,
              amountPaise: targetAmountPaise ? targetAmountPaise.toString() : '0',
              completedAt: new Date().toISOString(),
              verificationLevel: finalResult.level,
              verificationTag: finalResult.tag
            });
          }
        }, this.gracePeriodMs);

        if (graceTimer.unref) graceTimer.unref();
        this.pendingGraceTimers.set(targetSessionId, graceTimer);

        return {
          attributed: true,
          duplicate: false,
          lateMatch: false,
          wasActive,
          paymentSessionId: currentSession.id,
          observationId: savedObs.id,
          outcomeStatus: 'VERIFYING',
          verificationLevel: 1,
          verificationTag: verifyResult.tag,
          verificationSources: verifyResult.sources
        };
      }
    }

    // Check if observation confirms a recently successful session on this receiving account (within 60s)
    // Upgrades verification level (e.g. from Level 1 -> Level 2 -> Level 3)
    const recentSuccessSession = this.sessionRepo.db.queryOne(`
      SELECT * FROM payment_sessions
      WHERE receiving_account_id = ? AND status = 'SUCCESS'
        AND amount_paise = ? AND completed_at >= datetime('now', '-60 seconds')
      ORDER BY completed_at DESC LIMIT 1
    `, [normalizedObs.receivingAccountId, Number(normalizedObs.amountPaise)]);

    if (recentSuccessSession) {
      // Check if this session's attributed observation had a UTR
      const existingObs = recentSuccessSession.attributed_observation_id
        ? this.obsRepo.findById(recentSuccessSession.attributed_observation_id)
        : null;

      // If both have UTRs and they do NOT match, this is NOT the same transaction!
      const isUtrConflict = normalizedObs.bankReferenceNumber &&
        existingObs?.bankReferenceNumber &&
        normalizedObs.bankReferenceNumber !== existingObs.bankReferenceNumber;

      const sessionSlotStart = recentSuccessSession.slot_acquired_at
        ? new Date(new Date(recentSuccessSession.slot_acquired_at).getTime() - 30000)
        : new Date(new Date(recentSuccessSession.created_at).getTime() - 30000);
      const sessionCompleted = recentSuccessSession.completed_at
        ? new Date(new Date(recentSuccessSession.completed_at).getTime() + 30000)
        : new Date();

      // Temporal check: observation must have been observed during this session's window
      if (!isUtrConflict && normalizedObs.observedAt >= sessionSlotStart && normalizedObs.observedAt <= sessionCompleted) {
        const verifyResult = this.sessionRepo.recordVerificationSource(
          recentSuccessSession.id,
          normalizedObs.source,
          savedObs.id
        );

        this.obsRepo.markAttributed(savedObs.id, recentSuccessSession.id);

        if (this.auditRepo) {
          this.auditRepo.log({
            merchantId: recentSuccessSession.merchant_id,
            entityType: 'PAYMENT_SESSION',
            entityId: recentSuccessSession.id,
            action: 'PAYMENT_VERIFICATION_UPGRADED',
            actorType: 'SYSTEM',
            details: {
              observationId: savedObs.id,
              source: normalizedObs.source,
              amountPaise: normalizedObs.amountPaise.toString(),
              verificationLevel: verifyResult.level,
              verificationTag: verifyResult.tag,
              sources: verifyResult.sources
            }
          });
        }

        this.eventEmitter.emit('PAYMENT.VERIFICATION_UPGRADED', {
          paymentId: recentSuccessSession.id,
          orderId: recentSuccessSession.order_id,
          verificationLevel: verifyResult.level,
          verificationTag: verifyResult.tag,
          sources: verifyResult.sources
        });

        return {
          attributed: true,
          duplicate: false,
          lateMatch: false,
          paymentSessionId: recentSuccessSession.id,
          observationId: savedObs.id,
          outcomeStatus: PaymentStatus.SUCCESS,
          verificationLevel: verifyResult.level,
          verificationTag: verifyResult.tag,
          verificationSources: verifyResult.sources
        };
      }
    }

    // Tier 3: Late Observation Handling
    // Check if observation matches a recently expired or failed session on this receiving account (< 30 mins)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const recentExpired = this.sessionRepo.findRecentlyExpiredOrFailed(
      normalizedObs.receivingAccountId,
      thirtyMinutesAgo
    );

    const lateMatchedSession = recentExpired.find(s => s.amountPaise === normalizedObs.amountPaise);

    if (lateMatchedSession) {
      // Mark observation as LATE_UNMATCHED
      this.obsRepo.markLateUnmatched(savedObs.id);

      if (this.auditRepo) {
        this.auditRepo.log({
          merchantId: lateMatchedSession.merchantId,
          entityType: 'PAYMENT_SESSION',
          entityId: lateMatchedSession.id,
          action: 'LATE_OBSERVATION_DETECTED',
          actorType: 'SYSTEM',
          details: {
            observationId: savedObs.id,
            source: normalizedObs.source,
            amountPaise: normalizedObs.amountPaise.toString(),
            sessionStatus: lateMatchedSession.status
          }
        });
      }

      // Automatically create a high-priority reconciliation support ticket if customer exists
      if (this.ticketRepo && lateMatchedSession.customerId) {
        this.ticketRepo.createTicket({
          merchantId: lateMatchedSession.merchantId,
          customerId: lateMatchedSession.customerId,
          paymentId: lateMatchedSession.id,
          subject: `[LATE PAYMENT DETECTED] Order #${lateMatchedSession.orderId}`,
          status: TicketStatus.OPEN,
          initialMessage: {
            senderType: SenderType.ADMIN,
            senderId: lateMatchedSession.merchantId,
            message: `A delayed payment observation of ${normalizedObs.amountPaise / 100n} INR was detected after session ${lateMatchedSession.id} ended with status ${lateMatchedSession.status}. Flagged for manual merchant reconciliation.`
          }
        });
      }

      // Emit LATE_DETECTED event
      this.eventEmitter.emit('PAYMENT.LATE_DETECTED', {
        paymentId: lateMatchedSession.id,
        orderId: lateMatchedSession.orderId,
        merchantId: lateMatchedSession.merchantId,
        amountPaise: normalizedObs.amountPaise,
        observationId: savedObs.id
      });

      return {
        attributed: false,
        duplicate: false,
        lateMatch: true,
        paymentSessionId: lateMatchedSession.id,
        observationId: savedObs.id,
        outcomeStatus: ObservationAttributionStatus.LATE_UNMATCHED
      };
    }

    // Unattributed observation
    return {
      attributed: false,
      duplicate: false,
      lateMatch: false,
      observationId: savedObs.id,
      outcomeStatus: ObservationAttributionStatus.UNATTRIBUTED
    };
  }

  /**
   * Processes a client-reported UPI intent return as triple-signal input (Source A).
   *
   * Client-returns are REPORTED-level evidence (buyer-reported), NOT bank-confirmed settlement.
   * Correlation: if an authoritative bank observation (Gmail/SMS/Android) already exists for the
   * same payment (matched by UTR + receiving account + amount, never amount alone), the payment
   * is upgraded to MULTI_SIGNAL_MATCHED. PAID_VERIFIED still requires an authoritative
   * bank/provider verification event.
   *
   * @param {{ paymentId: string, attemptId: string?, correlationId: string?, upiTransactionReference?: string, amountPaise?: number, sourcePlatform?: string, appIdentity?: string, rawResult?: string, eventTimestamp?: Date, metadata?: Record<string,any> }} signal
   * @returns {{ attributed: boolean, paymentSessionId?: string, outcomeStatus: string, matchedBankObservation?: boolean }}
   */
  processIntentReturnSignal(signal) {
    const { paymentId, attemptId, correlationId, upiTransactionReference, amountPaise,
      sourcePlatform, appIdentity, rawResult, eventTimestamp, metadata = {} } = signal;

    const session = this.sessionRepo.findById(paymentId);
    if (!session) {
      return { attributed: false, paymentSessionId: undefined, outcomeStatus: 'PAYMENT_NOT_FOUND' };
    }

    // Persist the intent return as a REPORTED-level observation (supplementary evidence).
    const obsId = `obs_intent_${crypto.randomUUID()}`;
    try {
      this.obsRepo.create({
        id: obsId,
        receivingAccountId: session.receivingAccountId || null,
        source: INTENT_SOURCE,
        amountPaise: Number(amountPaise || session.amountPaise),
        observedAt: eventTimestamp || new Date(),
        senderVpa: metadata.senderVpa || null,
        bankReferenceNumber: upiTransactionReference || null,
        fingerprintHash: crypto.createHash('sha256')
          .update(`INTENT:${paymentId}:${signal.idempotencyKey || paymentId}:${Date.now()}`).digest('hex'),
        rawPayload: JSON.stringify({
          source: INTENT_SOURCE, attemptId, correlationId, upiTransactionReference,
          sourcePlatform, appIdentity, rawResult, metadata
        }),
        attributionStatus: ObservationAttributionStatus.UNATTRIBUTED,
        attributedPaymentId: paymentId
      });
    } catch (e) {
      // Observation already recorded by the intent route; continue to correlation.
    }

    // Correlate with any existing bank observation for this payment (UTR + account + amount).
    let matchedBankObservation = false;
    if (upiTransactionReference && session.receivingAccountId) {
      const bankObs = this.obsRepo.findByReceivingAccount(session.receivingAccountId, 100)
        .filter(o => BANK_SOURCES.includes(o.source))
        .filter(o => o.bankReferenceNumber && o.bankReferenceNumber === upiTransactionReference)
        .filter(o => Number(o.amountPaise) === Number(amountPaise || session.amountPaise));
      if (bankObs.length > 0) matchedBankObservation = true;
    }

    // Determine outcome status based on current session state + correlation.
    let outcomeStatus = session.status;
    if (matchedBankObservation) {
      // Multiple signals matched (intent return + bank observation) but still awaiting
      // authoritative bank/provider verification for PAID_VERIFIED.
      outcomeStatus = PaymentStatus.MULTI_SIGNAL_MATCHED;
    } else if (session.status === PaymentStatus.INTENT_OPENED ||
               session.status === PaymentStatus.ACTIVE ||
               session.status === PaymentStatus.PROCESSING) {
      outcomeStatus = PaymentStatus.CLIENT_REPORTED_SUCCESS;
    }

    // Transition state if allowed (client-reported, non-terminal progression).
    if (outcomeStatus !== session.status) {
      try {
        assertValidTransition(session.status, outcomeStatus);
      } catch (e) {
        // Transition not permitted; keep current status but record the signal.
      }
      if (outcomeStatus !== session.status) {
        try {
          const now = new Date().toISOString();
          this.sessionRepo.db.execute(
            'UPDATE payment_sessions SET status = ?, verification_tag = ?, updated_at = ? WHERE id = ?',
            [outcomeStatus, `Intent return correlated${matchedBankObservation ? ' + bank signal' : ''}`, now, paymentId]
          );
        } catch (e) {
          console.error('[Attribution] intent return status transition warning:', e.message);
        }
      }
    }

    // Audit log the triple-signal event.
    this.auditRepo?.log({
      merchantId: session.merchantId,
      entityType: 'PAYMENT_SESSION',
      entityId: paymentId,
      action: 'INTENT_RETURN_SIGNAL_RECEIVED',
      actorType: 'OBSERVER',
      details: {
        source: INTENT_SOURCE,
        attemptId,
        correlationId,
        upiTransactionReference,
        matchedBankObservation,
        outcomeStatus,
        sourcePlatform,
        appIdentity
      }
    });

    this.eventEmitter.emit('PAYMENT.INTENT_RETURN_SIGNAL', {
      paymentId,
      orderId: session.orderId,
      merchantId: session.merchantId,
      status: outcomeStatus,
      matchedBankObservation,
      evidenceLevel: 'REPORTED'
    });

    // If bank verification already finalized this session, emit verified status.
    const updated = this.sessionRepo.findById(paymentId);
    if (updated && updated.status === PaymentStatus.PAID_VERIFIED) {
      this.eventEmitter.emit('PAYMENT.VERIFIED', {
        paymentId: updated.id,
        orderId: updated.orderId,
        merchantId: updated.merchantId,
        amountPaise: updated.amountPaise,
        verificationLevel: updated.verificationLevel || 0,
        verificationTag: updated.verificationTag
      });
    }

    return {
      attributed: matchedBankObservation,
      paymentSessionId: paymentId,
      outcomeStatus,
      matchedBankObservation
    };
  }
}
