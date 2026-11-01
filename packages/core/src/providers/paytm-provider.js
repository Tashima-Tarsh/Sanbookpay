/** Paytm legacy PG adapter. Merchant onboarding, KYC and provider acceptance are required. */
import PaytmChecksum from 'paytmchecksum';
import { toPaise } from '@youpi/common';
import { PaymentProvider } from './payment-provider.interface.js';

const PAYTM_BASE = {
  STAGING: 'https://securegw-stage.paytm.in',
  PRODUCTION: 'https://securegw.paytm.in'
};

function parseCallback(rawBody) {
  const text = rawBody.toString();
  return text.trimStart().startsWith('{') ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
}

export class PaytmProvider extends PaymentProvider {
  constructor(config = {}) {
    super({
      ...config,
      providerName: 'PAYTM'
    });

    const isStaging = ['STAGING','SANDBOX'].includes((this.environment || '').toUpperCase());
    this.baseUrl = isStaging ? PAYTM_BASE.STAGING : PAYTM_BASE.PRODUCTION;
    this.merchantKey = config.extra?.merchantKey ?? process.env.PAYTM_MERCHANT_KEY ?? '';
    this.website = config.extra?.website || process.env.PAYTM_WEBSITE || 'WEBSTAGING';
    this.industryType = config.extra?.industryType || process.env.PAYTM_INDUSTRY_TYPE || 'Retail';
    this.channelId = config.extra?.channelId || process.env.PAYTM_CHANNEL_ID || 'WEB';
    this.providerMerchantId = config.extra?.businessMerchantId || this.clientId || this.merchantId;
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
    if (!this.providerMerchantId || !this.merchantKey) {
      return { valid: false, error: 'Paytm Merchant ID and Merchant Key are required.' };
    }
    return {valid:false,error:'Credential approval requires a verified sandbox transaction; connectivity alone is insufficient.'};
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
    if (!Number.isSafeInteger(Number(order.amountPaise)) || Number(order.amountPaise)<=0) throw new Error('amountPaise must be a positive integer');
    const amountRupees = (Number(order.amountPaise) / 100).toFixed(2);

    const orderTime = Date.now();
    const body = {
      requestType: 'Payment',
      mid: this.providerMerchantId,
      orderId: order.merchantOrderId,
      websiteName: this.website,
      txnAmount: {value:amountRupees,currency:'INR'},
      callbackUrl: order.notifyUrl || order.returnUrl,
      userInfo: { custId: order.customerId || order.customerPhone || 'guest' }
    };
    const head = {
      requestTimestamp: String(orderTime),
      version: 'v1',
      channelId: this.channelId,
      signature: await PaytmChecksum.generateSignature(JSON.stringify(body), this.merchantKey)
    };

    const res = await this._request(`/theia/api/v1/initiateTransaction?mid=${encodeURIComponent(this.providerMerchantId)}&orderId=${encodeURIComponent(order.merchantOrderId)}`, {
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
      checkoutUrl: null, // Paytm requires CheckoutJS; the transaction token is not a hosted checkout URL.
      rawResponse: data
    };
  }

  async getCollectionStatus(providerOrderId) {
    if (!providerOrderId) throw new Error('providerOrderId is required');

    const body = { mid: this.providerMerchantId, orderId: providerOrderId };
    const checksum = await PaytmChecksum.generateSignature(JSON.stringify(body), this.merchantKey);

    const res = await this._request('/v3/order/status', { method: 'POST', body:JSON.stringify({body,head:{signature:checksum}}) });

    if (!res.ok) {
      throw new Error(`Paytm status check failed (HTTP ${res.status}): ${res.data?.message || 'Order not found'}`);
    }

    const data = res.data;
    if (!data.head?.signature || !PaytmChecksum.verifySignature(JSON.stringify(data.body),this.merchantKey,data.head.signature)) throw new Error('Invalid Paytm status response signature');
    if(data.body.mid!==this.providerMerchantId || data.body.orderId!==providerOrderId) throw new Error('Paytm status order ownership mismatch');
    const resultInfo = data.body?.resultInfo || {};
    const statusMap = { TXN_SUCCESS: 'SUCCESS', TXN_FAILURE: 'FAILED', PENDING: 'PENDING', NO_RECORD_FOUND: 'EXPIRED' };

    return {
      status: statusMap[resultInfo.resultStatus] || 'PENDING',
      amountPaise: Number(toPaise(data.body.txnAmount)),
      currency: 'INR',
      bankReference: data.body.bankTxnId || null,
      providerPaymentId: data.body.txnId || null,
      paymentMethod: data.body.paymentMode || 'UPI',
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
      try { payload = parseCallback(rawBody); } catch { return false; }

      const checksum = payload.CHECKSUMHASH || headers['x-paytm-checksum'] || headers['X-Paytm-Checksum'];
      if (!checksum || !this.merchantKey) return false;

      // Remove checksum from params before verifying
      const params = { ...payload };
      delete params.CHECKSUMHASH;

      if (params.MID !== this.providerMerchantId) return false;
      return PaytmChecksum.verifySignature(params, this.merchantKey, checksum);
    } catch {
      return false;
    }
  }

  /**
   * Decodes Paytm webhook response into normalized payment event.
   */
  decodeWebhookResponse(rawBody) {
    try {
      const payload = parseCallback(rawBody);
      return {
        merchantTransactionId: payload.ORDERID,
        transactionId: payload.TXNID,
        amountPaise: Number(toPaise(payload.TXNAMOUNT)),
        state: ({TXN_SUCCESS:'SUCCESS',TXN_FAILURE:'FAILED'})[payload.STATUS] || (payload.STATUS || '').toUpperCase(),
        code: payload.RESPCODE,
        message: payload.RESPMSG,
        rawResponse: payload
      };
    } catch {
      return null;
    }
  }
}
