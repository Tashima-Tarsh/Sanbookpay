import { decrypt } from '@youpi/common';
import { CashfreeProvider } from './cashfree-provider.js';
import { DirectBankProvider } from './direct-bank-provider.js';

/**
 * Provider Registry
 * Instantiates and configures provider adapters dynamically from merchant provider connection records.
 */
export class ProviderRegistry {
  /**
   * @param {Object} options
   * @param {import('@youpi/db').Database} options.db
   * @param {string} [options.masterKey]
   */
  constructor(options = {}) {
    this.db = options.db;
    this.masterKey = options.masterKey || process.env.ENCRYPTION_MASTER_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    this._cache = new Map();
  }

  /**
   * Helper to decrypt sensitive stored fields safely.
   */
  _decryptSecret(cipher) {
    if (!cipher) return '';
    try {
      if (cipher.includes(':')) {
        return decrypt(cipher, this.masterKey);
      }
      return cipher; // unencrypted fallback for test environments
    } catch {
      return cipher;
    }
  }

  /**
   * Resolves a provider instance for a merchant.
   * @param {string} merchantId
   * @param {string} [providerName='CASHFREE']
   * @returns {import('./payment-provider.interface.js').PaymentProvider}
   */
  getProvider(merchantId, providerName = 'CASHFREE') {
    const normalizedName = providerName.toUpperCase();
    const cacheKey = `${merchantId}:${normalizedName}`;

    // Lookup connection from database
    const conn = this.db.queryOne(
      `SELECT * FROM provider_connections WHERE merchant_id = $1 AND provider_name = $2 AND is_active = 1 LIMIT 1`,
      [merchantId, normalizedName]
    );

    const clientSecret = conn?.client_secret_encrypted
      ? this._decryptSecret(conn.client_secret_encrypted)
      : (process.env.CASHFREE_CLIENT_SECRET || '');

    const webhookSecret = conn?.webhook_secret_encrypted
      ? this._decryptSecret(conn.webhook_secret_encrypted)
      : (process.env.CASHFREE_WEBHOOK_SECRET || clientSecret);

    const clientId = conn?.client_id || process.env.CASHFREE_CLIENT_ID || '';
    const environment = conn?.environment || process.env.CASHFREE_ENVIRONMENT || 'PRODUCTION';

    const config = {
      merchantId,
      providerName: normalizedName,
      environment,
      clientId,
      clientSecret,
      webhookSecret,
      extra: {
        corporateId: conn?.corporate_id,
        merchantVpa: conn?.merchant_vpa,
        terminalId: conn?.terminal_id
      }
    };

    if (normalizedName === 'CASHFREE') {
      return new CashfreeProvider(config);
    } else {
      return new DirectBankProvider(config);
    }
  }
}

