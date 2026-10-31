/**
 * Multi-VPA Auto-Rotation Guard (CouPI PG V2 feature).
 *
 * Tracks daily volume per receiving account (VPA) and auto-rotates before
 * hitting the NPCI ₹1,00,000/day UPI ceiling. Safety threshold at ₹90,000
 * (10% buffer). When a VPA approaches the threshold, the guard promotes the
 * next available VPA in descending capacity order.
 */
export class VpaRotationGuard {
  /**
   * @param {{
   *   accountRepo: import('@youpi/db').ReceivingAccountRepository,
   *   sessionRepo: import('@youpi/db').PaymentSessionRepository,
   *   eventEmitter?: { emit: (event: string, payload: any) => void },
   *   auditRepo?: import('@youpi/db').AuditLogRepository,
   *   dailyThresholdPaise?: number
   * }} options
   */
  constructor(options) {
    this.accountRepo = options.accountRepo;
    this.sessionRepo = options.sessionRepo;
    this.eventEmitter = options.eventEmitter || { emit: () => {} };
    this.auditRepo = options.auditRepo;
    this.dailyThresholdPaise = options.dailyThresholdPaise || 9000000; // ₹90,000
  }

  /**
   * Check if a receiving account is safe to use for a payment of the given amount.
   * Returns { ok: true } or { ok: false, reason, suggestedAction }.
   * @param {string} receivingAccountId
   * @param {number} amountPaise
   * @returns {{ ok: boolean, reason?: string, suggestedAction?: string, currentVolumePaise?: number }}
   */
  checkCapacity(receivingAccountId, amountPaise) {
    const account = this.accountRepo.findById(receivingAccountId);
    if (!account) {
      return { ok: false, reason: 'Receiving account not found' };
    }

    const currentVolume = Number(account.daily_volume_paise || 0);
    const amountNum = typeof amountPaise === 'bigint' ? Number(amountPaise) : Number(amountPaise);
    const projectedVolume = currentVolume + amountNum;
    const threshold = Number(account.rotation_threshold_paise || this.dailyThresholdPaise);

    if (projectedVolume > threshold) {
      return {
        ok: false,
        reason: 'VPA daily volume threshold would be exceeded',
        suggestedAction: 'ROTATE_VPA',
        currentVolumePaise: currentVolume,
        thresholdPaise: threshold,
        projectedVolumePaise: projectedVolume
      };
    }

    return {
      ok: true,
      currentVolumePaise: currentVolume,
      thresholdPaise: threshold,
      projectedVolumePaise: projectedVolume
    };
  }

  /**
   * Record a payment volume against a receiving account (call on successful payment).
   * @param {string} receivingAccountId
   * @param {number} amountPaise
   */
  recordVolume(receivingAccountId, amountPaise) {
    const account = this.accountRepo.findById(receivingAccountId);
    if (!account) return;

    const amountNum = typeof amountPaise === 'bigint' ? Number(amountPaise) : Number(amountPaise);
    const newVolume = Number(account.daily_volume_paise || 0) + amountNum;
    const newCount = Number(account.daily_txn_count || 0) + 1;

    this.accountRepo.db.execute(`
      UPDATE payment_receiving_accounts
      SET daily_volume_paise = ?, daily_txn_count = ?, updated_at = ?
      WHERE id = ?
    `, [newVolume, newCount, new Date().toISOString(), receivingAccountId]);

    // Check if we've crossed the threshold and should alert
    const threshold = Number(account.rotation_threshold_paise || this.dailyThresholdPaise);
    if (newVolume > threshold && newVolume - amountPaise <= threshold) {
      this.eventEmitter.emit('VPA.THRESHOLD_CROSSED', {
        receivingAccountId,
        upiId: account.upiId,
        currentVolumePaise: newVolume,
        thresholdPaise: threshold,
        merchantId: account.merchantId
      });

      if (this.auditRepo) {
        this.auditRepo.log({
          entityType: 'PAYMENT_RECEIVING_ACCOUNT',
          entityId: receivingAccountId,
          action: 'VPA_THRESHOLD_CROSSED',
          actorType: 'SYSTEM',
          details: { receivingAccountId, upiId: account.upiId, currentVolumePaise: newVolume, thresholdPaise: threshold }
        });
      }
    }
  }

  /**
   * Reset daily volume for all receiving accounts (call once per day, e.g. midnight).
   * @returns {number} Number of accounts reset
   */
  resetDailyVolume() {
    const result = this.accountRepo.db.execute(`
      UPDATE payment_receiving_accounts
      SET daily_volume_paise = 0, daily_txn_count = 0, updated_at = ?
    `, [new Date().toISOString()]);
    return result.changes || 0;
  }

  /**
   * Get all receiving accounts for a merchant sorted by remaining capacity (descending).
   * Returns accounts with most remaining capacity first.
   * @param {string} merchantId
   * @returns {Array}
   */
  getAccountsByRemainingCapacity(merchantId) {
    const accounts = this.accountRepo.findByMerchantId(merchantId);
    return accounts
      .filter(a => a.is_active && a.is_merchant_enabled)
      .map(a => {
        const currentVolume = Number(a.daily_volume_paise || 0);
        const threshold = Number(a.rotation_threshold_paise || this.dailyThresholdPaise);
        return {
          ...a,
          remainingCapacityPaise: Math.max(0, threshold - currentVolume),
          utilizationPercent: threshold > 0 ? Math.round((currentVolume / threshold) * 100) : 0
        };
      })
      .sort((a, b) => b.remainingCapacityPaise - a.remainingCapacityPaise);
  }

  /**
   * Find the best receiving account for a payment of the given amount.
   * Returns the account with most remaining capacity that can accommodate the amount.
   * @param {string} merchantId
   * @param {number} amountPaise
   * @returns {object | null}
   */
  findBestAccount(merchantId, amountPaise) {
    const accounts = this.getAccountsByRemainingCapacity(merchantId);
    for (const account of accounts) {
      const check = this.checkCapacity(account.id, amountPaise);
      if (check.ok) {
        return account;
      }
    }
    return null;
  }
}
