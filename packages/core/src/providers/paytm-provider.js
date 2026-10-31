/**
 * Paytm Business PG Provider (Free — Government of India mandates 0% MDR on UPI since 2020)
 * 
 * Official Paytm PG API integration:
 *   • Initiate transaction: POST /theia/api/v1/initiateTransaction
 *   • Check status:         GET  /theia/api/v1/transactionStatus/{mid}/{orderId}?checksum=...
 *   • Webhook:              POST to merchant callbackUrl
 * 
 * Signature: Paytm checksum = HMAC-SHA256(sortedParamString, merchantKey)
 * 
 * No bank approval required. Sign up at https://developer.paytm.com (free, KYC takes 1-3 days).
 * Money settles directly to your linked bank account via NPCI/UPI.
 */
import crypto from 'node:crypto';
import { PaymentProvider } from './payment-provider.interface.js';

const PAYTM_BASE = {
  STAGING: 'https://securegw-stage.paytm.in/theia/api/v1',
  PRODUCTION: 'https://securegw.paytm.in/theia/api/v1'
};

/**
 * Generates Paytm checksum: HMAC-SHA256(sortedPipeSeparatedParams, merchantKey)
 * Paytm sorts parameter names alphabetically, joins values with '|', then HMACs.
 */
function generatePaytmChecksum(params, merchantKey) {
  const sortedKeys = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '').sort();
  const str = sortedKeys.map(k => params[k]).join('|');
  return crypto.createHmac('sha256', merchantKey).update(str).digest('hex');
}

export class PaytmProvider extends PaymentProvider {
  constructor(config = {}) {
    super({
      ...config,
      providerName: 'PAYTM'
    });

    const isStaging = (this.environment || '').toUpperCase() === 'STAGING';
    this.baseUrl = isStaging ? PAYTM_BASE.STAGING : PAYTM_BASE.PRODUCTION;
    this.merchantKey = config.extra?.merchantKey || process.env.PAYTM_MERCHANT_KEY || '';
    this.website = config.extra?.website || process.env.PAYTM_WEBSITE || 'WEBSTAGING';
    this.industryType = config.extra?.industryType || process.env.PAYTM_INDUSTRY_TYPE || 'Retail';
    this.channelId = config.extra?.channelId || process.env.PAYTM_CHANNEL_ID || 'WEB';
  }

  async _request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        },
        signal: controller.signal
      });
      clearTimeout(timeout);

      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

      return { ok: response.ok, status: response.status, data };
    } catch (err) {
      clearTimeout(timeout);
      return { ok: false, status: 0, error: err.name === 'AbortError' ? 'Provider request timed out (15s)' : err.message, data: null };
    }
  }

  async validateCredentials() {
    if (!this.merchantId || !this.merchantKey) {
      return { valid: false, error: 'Paytm Merchant ID and Merchant Key are required.' };
    }
    // Lightweight check: initiate transaction with minimal data returns error but proves connectivity
    const res = await this._request('/initiateTransaction', {
      method: 'POST',
      body: JSON.stringify({
        head: { requestTimestamp: String(Date.now()), version: 'v1', channelId: this.channelId, signature: '' },
        body: { requestType: 'Payment', mid: this.merchantId, orderId: 'verify_cred', amount: '1.00', transactionToken: '', userInfo: { custId: 'verify' } }
      })
    });
    return { valid: res.status === 400 || res.ok, details: { environment: this.environment, checkedAt: new Date().toISOString() } };
  }

  async getCapabilities() {
    const enabled = new Set(this.extra?.capabilities || []);
    return ['COLLECTIONS', 'WEBHOOKS', 'UPI_QR', 'REFUNDS'].map(code => ({
      code,
      enabled: enabled.has(code),
      description: enabled.has(code) ? 'Configured' : 'Requires Paytm Business account setup'
    }));
  }

  /**
   * Creates a Paytm payment order.
   */
  async createCollection(order) {
    if (!order.merchantOrderId) throw new Error('merchantOrderId is required');
    const amountRupees = (Number(order.amountPaise) / 100).toFixed(2);

    const orderTime = Date.now();
    const body = {
      requestType: 'Payment',
      mid: this.merchantId,
      orderId: order.merchantOrderId,
      amount: amountRupees,
      transactionToken: '',
      userInfo: { custId: order.customerId || order.customerPhone || 'guest' }
    };
    const head = {
      requestTimestamp: String(orderTime),
      version: 'v1',
      channelId: this.channelId,
      signature: generatePaytmChecksum(body, this.merchantKey)
    };

    const res = await this._request('/initiateTransaction', {
      method: 'POST',
      body: JSON.stringify({ head, body })
    });

    if (!res.ok) {
      throw Object.assign(new Error(`Paytm order creation failed (HTTP ${res.status}): ${res.data?.message || JSON.stringify(res.data)}`), { code: 'PROVIDER_ORDER_CREATE_FAILED', httpStatus: res.status });
    }

    const data = res.data;
    if (data.body?.resultInfo?.resultCode !== '0001' && data.body?.resultInfo?.resultStatus !== 'S') {
      throw new Error(`Paytm did not initiate payment: ${data.body?.resultInfo?.resultMsg || JSON.stringify(data)}`);
    }

    const txnToken = data.body?.txnToken || null;

    return {
      providerOrderId: order.merchantOrderId,
      merchantOrderId: order.merchantOrderId,
      paymentSessionId: txnToken,
      checkoutUrl: `${this.baseUrl}/order?mid=${this.merchantId}&orderId=${order.merchantOrderId}&txnToken=${txnToken}&amount=${amountRupees}`,
      rawResponse: data
    };
  }

  async getCollectionStatus(providerOrderId) {
    if (!providerOrderId) throw new Error('providerOrderId is required');

    const body = { mid: this.merchantId, orderId: providerOrderId };
    const checksum = generatePaytmChecksum(body, this.merchantKey);

    const res = await this._request(`/transactionStatus/${this.merchantId}/${encodeURIComponent(providerOrderId)}?checksum=${encodeURIComponent(checksum)}`, { method: 'GET' });

    if (!res.ok) {
      throw new Error(`Paytm status check failed (HTTP ${res.status}): ${res.data?.message || 'Order not found'}`);
    }

    const data = res.data;
    const resultInfo = data.body?.resultInfo || {};
    const statusMap = { TXN_SUCCESS: 'SUCCESS', TXN_FAILURE: 'FAILED', PENDING: 'PENDING', NO_RECORD_FOUND: 'EXPIRED' };

    return {
      status: statusMap[resultInfo.resultStatus] || 'PENDING',
      amountPaise: Math.round(Number(resultInfo.txnAmount || 0) * 100),
      bankReference: resultInfo.bankTxnId || null,
      providerPaymentId: String(resultInfo.txnId || providerOrderId),
      paymentMethod: resultInfo.paymentMode || 'UPI',
      rawResponse: data
    };
  }

  /**
   * Verifies Paytm webhook checksum.
   * Paytm sends POST with body + checksum parameter.
   */
  verifyCollectionWebhook({ rawBody, headers }) {
    try {
      let payload;
      try { payload = JSON.parse(rawBody); } catch { return false; }

      const checksum = payload.CHECKSUMHASH || headers['x-paytm-checksum'] || headers['X-Paytm-Checksum'];
      if (!checksum || !this.merchantKey) return false;

      // Remove checksum from params before verifying
      const params = { ...payload };
      delete params.CHECKSUMHASH;

      const expected = generatePaytmChecksum(params, this.merchantKey);
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(checksum));
    } catch {
      return false;
    }
  }

  /**
   * Decodes Paytm webhook response into normalized payment event.
   */
  decodeWebhookResponse(rawBody) {
    try {
      const payload = JSON.parse(rawBody);
      return {
        merchantTransactionId: payload.ORDERID,
        transactionId: payload.TXNID,
        amountPaise: Math.round(Number(payload.TXNAMOUNT || 0) * 100),
        state: (payload.STATUS || '').toUpperCase(),
        code: payload.RESPCODE,
        message: payload.RESPMSG,
        rawResponse: payload
      };
    } catch {
      return null;
    }
  }
}
