import { PaymentProvider } from './payment-provider.interface.js';

/**
 * Direct Acquiring Bank Provider
 * Placeholder & architectural adapter for direct bank integrations (HDFC, ICICI, Axis, SBI, Kotak).
 * Strictly throws explicit capability errors when institutional credentials or bank-specific
 * host-to-host contracts are not yet configured.
 */
export class DirectBankProvider extends PaymentProvider {
  constructor(config = {}) {
    super(config);
    this.bankName = (config.providerName || 'DIRECT_BANK').toUpperCase();
  }

  async validateCredentials() {
    if (!this.clientId && !this.extra?.corporateId) {
      return {
        valid: false,
        error: `Institutional bank credentials missing for ${this.bankName}. Corporate ID and API Keys required.`
      };
    }
    return {
      valid: false,
      error: `DIRECT_BANK_NOT_ACTIVATED: Institutional Host-to-Host (H2H) direct API integration for ${this.bankName} requires signed bank nodal agreements, client certificate (mTLS), and static IP allowlisting with the bank's core banking server.`
    };
  }

  async getCapabilities() {
    return [
      { code: 'COLLECTIONS', enabled: false, description: `${this.bankName} Direct UPI/NetBanking Collections (Awaiting Bank H2H Setup)` },
      { code: 'PAYOUTS', enabled: false, description: `${this.bankName} Corporate Banking Outbound Transfers (Awaiting Corporate Agreement)` }
    ];
  }

  async createCollection(order) {
    throw new Error(`CAPABILITY_NOT_CONFIGURED: Direct bank collection for ${this.bankName} is not active. Use authorized Cashfree gateway or configure verified bank H2H certificates.`);
  }

  async getCollectionStatus(providerOrderId) {
    throw new Error(`CAPABILITY_NOT_CONFIGURED: Direct bank collection inquiry for ${this.bankName} is not active.`);
  }

  verifyCollectionWebhook({ rawBody, headers }) {
    return false;
  }

  async registerBeneficiary(beneficiary) {
    throw new Error(`CAPABILITY_NOT_CONFIGURED: Direct bank beneficiary registration for ${this.bankName} is not active.`);
  }

  async verifyBeneficiary(target) {
    throw new Error(`CAPABILITY_NOT_CONFIGURED: Direct bank penny-drop verification for ${this.bankName} is not active.`);
  }

  async createPayout(payout) {
    throw new Error(`CAPABILITY_NOT_CONFIGURED: Direct bank payout for ${this.bankName} is not active. Real disbursements require active corporate banking nodal access.`);
  }

  async getPayoutStatus(transferId) {
    throw new Error(`CAPABILITY_NOT_CONFIGURED: Direct bank payout inquiry for ${this.bankName} is not active.`);
  }

  verifyPayoutWebhook({ rawBody, headers }) {
    return false;
  }

  async createRefund(refund) {
    throw new Error(`CAPABILITY_NOT_CONFIGURED: Direct bank refund for ${this.bankName} is not active.`);
  }

  async getRefundStatus(orderId, refundId) {
    throw new Error(`CAPABILITY_NOT_CONFIGURED: Direct bank refund inquiry for ${this.bankName} is not active.`);
  }

  async retrieveSettlements(options = {}) {
    return [];
  }

  async retrieveReconciliationRecords(options = {}) {
    return [];
  }

  async retrieveAvailableBalance() {
    throw new Error(`CAPABILITY_NOT_CONFIGURED: Direct bank balance inquiry for ${this.bankName} is not active.`);
  }
}

