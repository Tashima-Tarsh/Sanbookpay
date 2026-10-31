import { PaymentStatus } from '@youpi/common';

/**
 * Paise Offset Engine (CouPI PG V2 feature).
 *
 * Allows multiple concurrent buyers to pay the same base amount by assigning each
 * a distinct paise offset (₹0.00 – ₹0.99). The bank reports the exact amount paid
 * (base + offset), enabling 100% deterministic attribution without queueing.
 *
 * Up to 100 simultaneous buyers per VPA can pay the same base product amount.
 */
export class PaiseOffsetAllocator {
  /**
   * @param {{
   *   sessionRepo: import('@youpi/db').PaymentSessionRepository,
   *   eventEmitter?: { emit: (event: string, payload: any) => void },
   *   auditRepo?: import('@youpi/db').AuditLogRepository
   * }} options
   */
  constructor(options) {
    this.sessionRepo = options.sessionRepo;
    this.eventEmitter = options.eventEmitter || { emit: () => {} };
    this.auditRepo = options.auditRepo;

    // In-memory pool of used offsets per receiving account: Map<accountId, Set<offset>>
    this.usedOffsets = new Map();
  }

  /**
   * Allocate a paise offset (0-99) for a receiving account.
   * Returns { offset, totalAmountPaise } or null if no offset available.
   * @param {string} receivingAccountId
   * @param {number|bigint} baseAmountPaise
   * @returns {{ offset: number, totalAmountPaise: number|bigint } | null }
   */
  allocateOffset(receivingAccountId, baseAmountPaise) {
    const baseNum = typeof baseAmountPaise === 'bigint' ? Number(baseAmountPaise) : Number(baseAmountPaise);
    let used = this.usedOffsets.get(receivingAccountId);
    if (!used) {
      used = new Set();
      this.usedOffsets.set(receivingAccountId, used);
    }

    // Find first free offset 0-99
    for (let offset = 0; offset <= 99; offset++) {
      if (!used.has(offset)) {
        used.add(offset);
        const totalAmountPaise = baseNum + offset;

        if (this.auditRepo) {
          this.auditRepo.log({
            entityType: 'PAISE_OFFSET_ALLOCATION',
            entityId: receivingAccountId,
            action: 'PAISE_OFFSET_ALLOCATED',
            actorType: 'SYSTEM',
            details: { receivingAccountId, baseAmountPaise: baseNum, offset, totalAmountPaise }
          });
        }

        return { offset, totalAmountPaise };
      }
    }

    return null; // No offset available - all 100 slots in use
  }

  /**
   * Release a paise offset back to the pool for a receiving account.
   * @param {string} receivingAccountId
   * @param {number} offset
   */
  releaseOffset(receivingAccountId, offset) {
    const used = this.usedOffsets.get(receivingAccountId);
    if (used) {
      used.delete(offset);
      if (used.size === 0) {
        this.usedOffsets.delete(receivingAccountId);
      }

      if (this.auditRepo) {
        this.auditRepo.log({
          entityType: 'PAISE_OFFSET_ALLOCATION',
          entityId: receivingAccountId,
          action: 'PAISE_OFFSET_RELEASED',
          actorType: 'SYSTEM',
          details: { receivingAccountId, offset }
        });
      }
    }
  }

  /**
   * Get the total amount a customer should pay (base + offset).
   * @param {number} baseAmountPaise
   * @param {number} offset
   * @returns {number}
   */
  getTotalAmountPaise(baseAmountPaise, offset) {
    return baseAmountPaise + offset;
  }

  /**
   * Get all used offsets for a receiving account (for debugging/monitoring).
   * @param {string} receivingAccountId
   * @returns {number[]}
   */
  getUsedOffsets(receivingAccountId) {
    const used = this.usedOffsets.get(receivingAccountId);
    return used ? Array.from(used).sort((a, b) => a - b) : [];
  }

  /**
   * Check if an offset is available for a receiving account.
   * @param {string} receivingAccountId
   * @param {number} offset
   * @returns {boolean}
   */
  isOffsetAvailable(receivingAccountId, offset) {
    const used = this.usedOffsets.get(receivingAccountId);
    return !used || !used.has(offset);
  }

  /**
   * Initialize used offsets from existing ACTIVE/PROCESSING sessions on startup.
   * Call this after constructing the allocator to rebuild in-memory state from DB.
   * @param {string} receivingAccountId
   */
  async initFromDb(receivingAccountId) {
    const used = new Set();
    const sessions = this.sessionRepo.db.query(`
      SELECT paise_offset FROM payment_sessions
      WHERE receiving_account_id = ? AND status IN ('ACTIVE', 'PROCESSING')
        AND paise_offset IS NOT NULL
    `, [receivingAccountId]);

    for (const row of sessions) {
      const offset = Number(row.paise_offset);
      if (Number.isInteger(offset) && offset >= 0 && offset <= 99) {
        used.add(offset);
      }
    }

    this.usedOffsets.set(receivingAccountId, used);
    return used.size;
  }

  /**
   * Get capacity remaining for a receiving account (0-100).
   * @param {string} receivingAccountId
   * @returns {number}
   */
  getCapacityRemaining(receivingAccountId) {
    const used = this.usedOffsets.get(receivingAccountId);
    return 100 - (used ? used.size : 0);
  }
}
