/**
 * Payment Provider Base Interface
 * Common abstraction for all payment and banking providers (Cashfree, HDFC, ICICI, etc.)
 */
export class PaymentProvider {
  /**
   * @param {Object} config
   * @param {string} config.merchantId
   * @param {string} config.providerName
   * @param {string} [config.environment='PRODUCTION']
   * @param {string} [config.clientId]
   * @param {string} [config.clientSecret]
   * @param {string} [config.webhookSecret]
   * @param {Object} [config.extra]
   */
  constructor(config = {}) {
    this.merchantId = config.merchantId;
    this.providerName = config.providerName;
    this.environment = config.environment || 'PRODUCTION';
    this.clientId = config.clientId || '';
    this.clientSecret = config.clientSecret || '';
    this.webhookSecret = config.webhookSecret || config.clientSecret || '';
    this.extra = config.extra || {};
  }

  /**
   * Validates credentials against external provider API.
   * @returns {Promise<{ valid: boolean, error?: string, details?: any }>}
   */
  async validateCredentials() {
    throw new Error(`${this.providerName}: validateCredentials() must be implemented.`);
  }

  /**
   * Returns list of approved capabilities for this provider.
   * @returns {Promise<Array<{ code: string, enabled: boolean, description: string }>>}
   */
  async getCapabilities() {
    throw new Error(`${this.providerName}: getCapabilities() must be implemented.`);
  }

  /**
   * Creates a payment collection order.
   * @param {Object} order
   * @returns {Promise<{ providerOrderId: string, paymentSessionId?: string, checkoutUrl?: string, rawResponse: any }>}
   */
  async createCollection(order) {
    throw new Error(`${this.providerName}: createCollection() must be implemented.`);
  }

  /**
   * Gets authoritative payment collection status.
   * @param {string} providerOrderId
   * @returns {Promise<{ status: string, amountPaise: number, bankReference?: string, providerPaymentId?: string, rawResponse: any }>}
   */
  async getCollectionStatus(providerOrderId) {
    throw new Error(`${this.providerName}: getCollectionStatus() must be implemented.`);
  }

  /**
   * Verifies incoming webhook signature.
   * @param {Object} params
   * @param {string} params.rawBody
   * @param {Record<string, string>} params.headers
   * @returns {boolean}
   */
  verifyCollectionWebhook({ rawBody, headers }) {
    throw new Error(`${this.providerName}: verifyCollectionWebhook() must be implemented.`);
  }

  /**
   * Registers a beneficiary for outbound payouts.
   * @param {Object} beneficiary
   * @returns {Promise<{ providerBeneId: string, verified: boolean, verifiedName?: string, rawResponse: any }>}
   */
  async registerBeneficiary(beneficiary) {
    throw new Error(`${this.providerName}: registerBeneficiary() must be implemented.`);
  }

  /**
   * Verifies a bank account or UPI ID.
   * @param {Object} target
   * @returns {Promise<{ valid: boolean, registeredName?: string, rawResponse: any }>}
   */
  async verifyBeneficiary(target) {
    throw new Error(`${this.providerName}: verifyBeneficiary() must be implemented.`);
  }

  /**
   * Submits an authorized payout instruction to the provider.
   * @param {Object} payout
   * @returns {Promise<{ providerTransferId: string, status: string, utr?: string, rawResponse: any }>}
   */
  async createPayout(payout) {
    throw new Error(`${this.providerName}: createPayout() must be implemented.`);
  }

  /**
   * Queries authoritative payout status.
   * @param {string} transferId
   * @returns {Promise<{ status: string, utr?: string, failureReason?: string, rawResponse: any }>}
   */
  async getPayoutStatus(transferId) {
    throw new Error(`${this.providerName}: getPayoutStatus() must be implemented.`);
  }

  /**
   * Verifies incoming payout webhook signature.
   */
  verifyPayoutWebhook({ rawBody, headers }) {
    throw new Error(`${this.providerName}: verifyPayoutWebhook() must be implemented.`);
  }

  /**
   * Initiates a refund for an existing payment.
   * @param {Object} refund
   * @returns {Promise<{ providerRefundId: string, status: string, rawResponse: any }>}
   */
  async createRefund(refund) {
    throw new Error(`${this.providerName}: createRefund() must be implemented.`);
  }

  /**
   * Gets refund status.
   * @param {string} orderId
   * @param {string} refundId
   * @returns {Promise<{ status: string, utr?: string, rawResponse: any }>}
   */
  async getRefundStatus(orderId, refundId) {
    throw new Error(`${this.providerName}: getRefundStatus() must be implemented.`);
  }

  /**
   * Retrieves settlement batches from the provider.
   * @param {Object} options
   * @returns {Promise<Array<any>>}
   */
  async retrieveSettlements(options = {}) {
    throw new Error(`${this.providerName}: retrieveSettlements() must be implemented.`);
  }

  /**
   * Retrieves reconciliation records from the provider.
   * @param {Object} options
   * @returns {Promise<Array<any>>}
   */
  async retrieveReconciliationRecords(options = {}) {
    throw new Error(`${this.providerName}: retrieveReconciliationRecords() must be implemented.`);
  }

  /**
   * Retrieves available payout balance from the provider/bank.
   * @returns {Promise<{ balancePaise: number, availableBalancePaise: number, currency: string }>}
   */
  async retrieveAvailableBalance() {
    throw new Error(`${this.providerName}: retrieveAvailableBalance() must be implemented.`);
  }
}

