import { decrypt, resolveSecret } from '@youpi/common';
import { CashfreeProvider } from './cashfree-provider.js';
import { DirectBankProvider } from './direct-bank-provider.js';
import { PhonePeProvider } from './phonepe-provider.js';
import { PaytmProvider } from './paytm-provider.js';

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
    this.masterKey = options.masterKey || resolveSecret('encryption_master_key','ENCRYPTION_MASTER_KEY');
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
      if(process.env.NODE_ENV==='test')return cipher;
      throw Error('Provider credentials must be encrypted before production use');
    } catch {
      throw Error('Provider credential decryption failed; preserve the original encryption key and review configuration');
    }
  }

  /**
   * Resolves a provider instance for a merchant.
   * @param {string} merchantId
   * @param {string} [providerName='CASHFREE']
   * @returns {import('./payment-provider.interface.js').PaymentProvider}
   */
  getProvider(merchantId, providerName = 'CASHFREE', connectionId = null) {
    const normalizedName = providerName.toUpperCase();
    const cacheKey = `${merchantId}:${normalizedName}`;

    let conn;
    if(connectionId){
      conn=this.db.queryOne('SELECT * FROM provider_connections WHERE id=? AND merchant_id=? AND provider_name=?',[connectionId,merchantId,normalizedName]);
      if(!conn)throw Error('Provider connection does not belong to this merchant/provider');
    }else{
      const candidates=this.db.query('SELECT * FROM provider_connections WHERE merchant_id=? AND provider_name=? AND is_active=1',[merchantId,normalizedName]);
      if(candidates.length>1)throw Error('An exact provider connection ID is required');
      conn=candidates[0];
    }
    if(!conn&&process.env.NODE_ENV!=='test')throw Error('Approved merchant provider connection is required');

    const clientSecret = conn?.client_secret_encrypted
      ? this._decryptSecret(conn.client_secret_encrypted)
      : (process.env.CASHFREE_CLIENT_SECRET || process.env.PHONEPE_SALT_KEY || process.env.PAYTM_MERCHANT_KEY || '');

    const webhookSecret = conn?.webhook_secret_encrypted
      ? this._decryptSecret(conn.webhook_secret_encrypted)
      : (process.env.CASHFREE_WEBHOOK_SECRET || process.env.PHONEPE_SALT_KEY || process.env.PAYTM_MERCHANT_KEY || clientSecret);

    const clientId = conn?.client_id || process.env.CASHFREE_CLIENT_ID || process.env.PHONEPE_MERCHANT_ID || process.env.PAYTM_MERCHANT_ID || '';
    const environment = conn?.environment || process.env.CASHFREE_ENVIRONMENT || process.env.PHONEPE_ENVIRONMENT || process.env.PAYTM_ENVIRONMENT || 'PRODUCTION';

    const config = {
      merchantId,
      providerName: normalizedName,
      environment,
      clientId,
      clientSecret,
      webhookSecret,
      extra: {
        connectionId: conn?.id,
        capabilities: JSON.parse(conn?.diagnostics || '{}').capabilities || [],
        corporateId: conn?.corporate_id,
        merchantVpa: conn?.merchant_vpa,
        terminalId: conn?.terminal_id,
        // PhonePe specific
        saltKey: conn?.salt_key_encrypted ? this._decryptSecret(conn.salt_key_encrypted) : (process.env.PHONEPE_SALT_KEY || ''),
        saltIndex: conn?.salt_index || process.env.PHONEPE_SALT_INDEX || '1',
        // Paytm specific
        merchantKey: conn?.merchant_key_encrypted ? this._decryptSecret(conn.merchant_key_encrypted) : (process.env.PAYTM_MERCHANT_KEY || ''),
        website: conn?.website || process.env.PAYTM_WEBSITE || 'WEBSTAGING',
        industryType: conn?.industry_type || process.env.PAYTM_INDUSTRY_TYPE || 'Retail',
        channelId: conn?.channel_id || process.env.PAYTM_CHANNEL_ID || 'WEB'
      }
    };

    if (normalizedName === 'CASHFREE') {
      return new CashfreeProvider(config);
    } else if (normalizedName === 'PHONEPE') {
      return new PhonePeProvider(config);
    } else if (normalizedName === 'PAYTM') {
      return new PaytmProvider(config);
    } else {
      return new DirectBankProvider(config);
    }
  }
}

