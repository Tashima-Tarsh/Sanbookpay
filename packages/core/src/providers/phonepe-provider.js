/**
 * PhonePe Business PG Provider (Free — Government of India mandates 0% MDR on UPI since 2020)
 * 
 * Official PhonePe PG API integration:
 *   • Create payment:   POST /pg/v1/pay
 *   • Check status:     GET  /pg/v1/status/{merchantId}/{merchantTransactionId}
 *   • Webhook:          POST to merchant callbackUrl (IP allowlist recommended)
 * 
 * Signature: X-VERIFY = sha256(path + body + saltKey) + '###' + saltIndex
 * 
 * No bank approval required. Sign up at https://developer.phonepe.com (free, KYC takes 1-3 days).
 * Money settles directly to your linked bank account via NPCI/UPI.
 */
import crypto from 'node:crypto';
import { PaymentProvider } from './payment-provider.interface.js';

const PHONEPE_BASE = {
  SANDBOX: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
  PRODUCTION: 'https://api.phonepe.com/apis/hermes'
};

export class PhonePeProvider extends PaymentProvider {
  constructor(config = {}) {
    super({
      ...config,
      providerName: 'PHONEPE'
    });

    const isSandbox = (this.environment || '').toUpperCase() === 'SANDBOX';
    this.baseUrl = isSandbox ? PHONEPE_BASE.SANDBOX : PHONEPE_BASE.PRODUCTION;
    // PhonePe saltKey/index come from extra config or env
    this.saltKey = config.extra?.saltKey || process.env.PHONEPE_SALT_KEY || '';
    this.saltIndex = config.extra?.saltIndex !== undefined ? config.extra.saltIndex : (process.env.PHONEPE_SALT_INDEX || '1');
  }

  /**
   * Builds PhonePe X-VERIFY header: sha256(path + body + saltKey)###saltIndex
   */
  _xVerify(path, bodyString) {
    const hash = crypto.createHmac('sha256', this.saltKey).update(path + bodyString + this.saltKey).digest('hex');
    return `${hash}###${this.saltIndex}`;
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
          'X-MERCHANT-ID': this.merchantId,
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
    if (!this.merchantId || !this.saltKey) {
      return { valid: false, error: 'PhonePe Merchant ID and Salt Key are required.' };
    }
    // Lightweight check: status endpoint with a dummy transaction ID returns 404 but proves connectivity
    const res = await this._request(`/pg/v1/status/${this.merchantId}/verify_credential_check`);
    return { valid: res.status === 404 || res.ok, details: { environment: this.environment, checkedAt: new Date().toISOString() } };
  }

  async getCapabilities() {
    const enabled = new Set(this.extra?.capabilities || []);
    return ['COLLECTIONS', 'WEBHOOKS', 'UPI_QR', 'REFUNDS'].map(code => ({
      code,
      enabled: enabled.has(code),
      description: enabled.has(code) ? 'Configured' : 'Requires PhonePe Business account setup'
    }));
  }

  /**
   * Creates a PhonePe payment order.
   * @param {Object} order — { merchantOrderId, amountPaise, customerPhone, customerName, returnUrl, notifyUrl, idempotencyKey }
   */
  async createCollection(order) {
    if (!order.merchantOrderId) throw new Error('merchantOrderId is required');
    const amountPaise = Number(order.amountPaise);
    if (!amountPaise || amountPaise <= 0) throw new Error('amountPaise must be a positive integer');

    const payload = {
      merchantId: this.merchantId,
      merchantTransactionId: order.merchantOrderId,
      amount: amountPaise, // PhonePe expects amount in paise
      merchantUserId: order.customerId || order.customerPhone || 'guest',
      callbackUrl: order.notifyUrl || order.returnUrl || '',
      mobileNumber: order.customerPhone || undefined,
      paymentInstrument: { type: 'PAY_PAGE' }
    };

    const bodyString = JSON.stringify(payload);
    const xVerify = this._xVerify('/pg/v1/pay', bodyString);

    const res = await this._request('/pg/v1/pay', {
      method: 'POST',
      body: bodyString,
      headers: {
        'X-VERIFY': xVerify,
        'X-MERCHANT-ID': this.merchantId
      },
      headers: order.idempotencyKey ? { 'X-IDempotency-Key': order.idempotencyKey } : {}
    });

    if (!res.ok) {
      throw Object.assign(new Error(`PhonePe order creation failed (HTTP ${res.status}): ${res.data?.message || JSON.stringify(res.data)}`), { code: 'PROVIDER_ORDER_CREATE_FAILED', httpStatus: res.status });
    }

    const data = res.data;
    if (data.code !== 'PAYMENT_INITIATED' && data.code !== 'SUCCESS') {
      throw new Error(`PhonePe did not initiate payment: ${data.message || JSON.stringify(data)}`);
    }

    return {
      providerOrderId: data.data?.merchantTransactionId || order.merchantOrderId,
      merchantOrderId: order.merchantOrderId,
      paymentSessionId: data.data?.transactionId || null,
      checkoutUrl: data.data?.instrumentResponse?.redirectInfo?.url || null,
      rawResponse: data
    };
  }

  async getCollectionStatus(providerOrderId) {
    if (!providerOrderId) throw new Error('providerOrderId is required');
    const path = `/pg/v1/status/${this.merchantId}/${encodeURIComponent(providerOrderId)}`;
    const xVerify = this._xVerify(path, '');

    const res = await this._request(path, { method: 'GET', headers: { 'X-VERIFY': xVerify } });

    if (!res.ok) {
      throw new Error(`PhonePe status check failed (HTTP ${res.status}): ${res.data?.message || 'Order not found'}`);
    }

    const data = res.data;
    const state = (data.data?.state || data.state || '').toUpperCase();
    const statusMap = { SUCCESS: 'SUCCESS', FAILED: 'FAILED', PENDING: 'PENDING', TIMEOUT: 'EXPIRED', CANCELLED: 'CANCELLED' };

    return {
      status: statusMap[state] || 'PENDING',
      amountPaise: Math.round(Number(data.data?.amount || data.amount || 0)),
      bankReference: data.data?.transactionId || null,
      providerPaymentId: String(data.data?.transactionId || providerOrderId),
      paymentMethod: data.data?.paymentInstrument?.type || 'UPI',
      rawResponse: data
    };
  }

  /**
   * Verifies PhonePe webhook signature.
   * PhonePe sends body as { response: base64(JSON) }. The X-VERIFY header is
   * sha256(/pg/v1/pay + callback body + saltKey)###saltIndex for verification.
   * Simplest robust check: decode the response and verify merchantTransactionId matches.
   */
  verifyCollectionWebhook({ rawBody, headers }) {
    try {
      const signature = headers['x-verify'] || headers['X-VERIFY'];
      if (!signature || !this.saltKey) return false;

      let payload;
      try { payload = JSON.parse(rawBody); } catch { return false; }

      const responseB64 = payload.response;
      if (!responseB64) return false;

      const decoded = Buffer.from(responseB64, 'base64').toString('utf8');
      let response;
      try { response = JSON.parse(decoded); } catch { return false; }

      // PhonePe X-VERIFY = sha256('/pg/v1/pay' + responseBody + saltKey)###saltIndex
      const expected = this._xVerify('/pg/v1/pay', decoded);
      const sigParts = signature.split('###');
      if (sigParts.length !== 2) return false;
      return crypto.timingSafeEqual(Buffer.from(expected.split('###')[0]), Buffer.from(sigParts[0]));
    } catch {
      return false;
    }
  }

  /**
   * Decodes PhonePe webhook response body into a normalized payment event.
   * @returns {Object} { merchantTransactionId, transactionId, amountPaise, state, code, message }
   */
  decodeWebhookResponse(rawBody) {
    try {
      const payload = JSON.parse(rawBody);
      const decoded = Buffer.from(payload.response, 'base64').toString('utf8');
      const response = JSON.parse(decoded);
      return {
        merchantTransactionId: response.merchantTransactionId,
        transactionId: response.transactionId,
        amountPaise: Math.round(Number(response.amount || 0)),
        state: (response.state || '').toUpperCase(),
        code: response.code,
        message: response.message,
        rawResponse: response
      };
    } catch {
      return null;
    }
  }
}
