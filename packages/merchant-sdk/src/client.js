import { verifyHmac } from '@youpi/common';

export class SanbookPayClient {
  /**
   * @param {{
   *   apiUrl?: string,
   *   merchantId?: string,
   *   apiKey?: string,
   *   webhookSecret?: string
   * }} options
   */
  constructor(options = {}) {
    this.apiUrl = (options.apiUrl || process.env.BASE_PAYMENT_API_URL || 'http://localhost:6100').replace(/\/+$/, '');
    this.merchantId = options.merchantId || null;
    this.apiKey = options.apiKey || options.webhookSecret || null;
    this.webhookSecret = options.webhookSecret || options.apiKey || null;
  }

  _getHeaders(extraHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...extraHeaders
    };
    if (this.merchantId) headers['X-Merchant-Id'] = this.merchantId;
    if (this.apiKey) headers['X-Merchant-Key'] = this.apiKey;
    return headers;
  }

  // --- REAL COLLECTIONS API ---

  /**
   * Creates a new payment collection order.
   * @param {{
   *   orderId: string,
   *   amount: number | string,
   *   currency?: string,
   *   customerName?: string,
   *   customerPhone?: string,
   *   customerEmail?: string,
   *   method?: string,
   *   idempotencyKey?: string
   * }} params
   */
  async createCollection(params) {
    const url = `${this.apiUrl}/api/v1/collections`;
    const headers = this._getHeaders(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {});
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Create collection failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  /**
   * Retrieves full collection details and lifecycle audit events.
   * @param {string} paymentId
   */
  async getCollection(paymentId) {
    const url = `${this.apiUrl}/api/v1/collections/${encodeURIComponent(paymentId)}`;
    const res = await fetch(url, { headers: this._getHeaders() });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get collection failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  /**
   * Queries collection status, bank reference (UTR), and latency.
   * @param {string} paymentId
   */
  async getCollectionStatus(paymentId) {
    const url = `${this.apiUrl}/api/v1/collections/${encodeURIComponent(paymentId)}/status`;
    const res = await fetch(url, { headers: this._getHeaders() });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get collection status failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  /**
   * Force refreshes payment status directly from upstream banking provider.
   * @param {string} paymentId
   */
  async refreshCollectionStatus(paymentId) {
    const url = `${this.apiUrl}/api/v1/collections/${encodeURIComponent(paymentId)}/refresh-status`;
    const res = await fetch(url, { method: 'POST', headers: this._getHeaders() });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Refresh collection status failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  // --- BENEFICIARIES & REAL PAYOUTS API ---

  /**
   * Registers a new beneficiary for bank/UPI payouts.
   */
  async registerBeneficiary(params) {
    const url = `${this.apiUrl}/api/v1/beneficiaries`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Register beneficiary failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  /**
   * Performs penny-drop or provider verification of beneficiary account.
   */
  async verifyBeneficiary(beneficiaryId) {
    const url = `${this.apiUrl}/api/v1/beneficiaries/verify`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ beneficiaryId })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Verify beneficiary failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  /**
   * Lists all registered payout beneficiaries.
   */
  async listBeneficiaries() {
    const url = `${this.apiUrl}/api/v1/beneficiaries`;
    const res = await fetch(url, { headers: this._getHeaders() });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`List beneficiaries failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  /**
   * Initiates a real-money payout transfer.
   */
  async createPayout(params) {
    const url = `${this.apiUrl}/api/v1/payouts`;
    const headers = this._getHeaders(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {});
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Create payout failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  /**
   * Retrieves payout status and bank transfer UTR.
   */
  async getPayout(payoutId) {
    const url = `${this.apiUrl}/api/v1/payouts/${encodeURIComponent(payoutId)}`;
    const res = await fetch(url, { headers: this._getHeaders() });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get payout failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  /**
   * Approves a pending payout requiring explicit operator authorization.
   */
  async approvePayout(payoutId, approvalParams = {}) {
    const url = `${this.apiUrl}/api/v1/payouts/${encodeURIComponent(payoutId)}/approve`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(approvalParams)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Approve payout failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  /**
   * Refreshes payout transfer status from upstream bank/provider.
   */
  async refreshPayoutStatus(payoutId) {
    const url = `${this.apiUrl}/api/v1/payouts/${encodeURIComponent(payoutId)}/refresh-status`;
    const res = await fetch(url, { method: 'POST', headers: this._getHeaders() });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Refresh payout status failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  // --- REFUNDS API ---

  /**
   * Initiates a real refund for a completed collection.
   */
  async createRefund(params) {
    const url = `${this.apiUrl}/api/v1/refunds`;
    const headers = this._getHeaders(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {});
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Create refund failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  /**
   * Retrieves refund status and ARN reference.
   */
  async getRefund(refundId) {
    const url = `${this.apiUrl}/api/v1/refunds/${encodeURIComponent(refundId)}`;
    const res = await fetch(url, { headers: this._getHeaders() });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get refund failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  // --- SETTLEMENTS & BANKING API ---

  async getSettlementOverview() {
    const url = `${this.apiUrl}/api/v1/settlements/overview`;
    const res = await fetch(url, { headers: this._getHeaders() });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get settlement overview failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  async getBankingConnections() {
    const url = `${this.apiUrl}/api/v1/banking/connections`;
    const res = await fetch(url, { headers: this._getHeaders() });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get banking connections failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  async getBankingBalance() {
    const url = `${this.apiUrl}/api/v1/banking/balance`;
    const res = await fetch(url, { headers: this._getHeaders() });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get banking balance failed [HTTP ${res.status}]: ${err}`);
    }
    return await res.json();
  }

  // --- LEGACY PAYMENT METHODS ---

  /**
   * Creates a new payment session and receives checkout URL for redirection.
   */
  async createPayment(params) {
    const url = `${this.apiUrl}/api/v1/payments`;
    const headers = {
      'Content-Type': 'application/json',
      ...this._getHeaders(),
    };

    if (this.merchantId) {
      headers['X-Merchant-Id'] = this.merchantId;
    }
    if (params.idempotencyKey) {
      headers['Idempotency-Key'] = params.idempotencyKey;
    }

    const payload = {
      orderId: params.orderId,
      amount: params.amount,
      currency: params.currency || 'INR',
      returnUrl: params.returnUrl,
      customer: params.customer,
      metadata: params.metadata
    };
    if (params.autoActivate === true) {
      payload.autoActivate = true;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Create payment failed [HTTP ${res.status}]: ${err}`);
    }

    return await res.json();
  }

  /**
   * Queries payment status and details.
   */
  async getPayment(paymentId) {
    const url = `${this.apiUrl}/api/v1/payments/${paymentId}`;
    const headers = {};
    if (this.webhookSecret) {
      headers['X-Merchant-Key'] = this.webhookSecret;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get payment failed [HTTP ${res.status}]: ${err}`);
    }

    return await res.json();
  }

  /**
   * Cryptographically verifies an incoming webhook payload using HMAC-SHA256.
   * @param {string} rawPayloadString Raw request body text (unparsed)
   * @param {string} signatureHeader Value of 'X-Gateway-Signature' header (e.g. 'sha256=...')
   * @param {string} [customSecret] Optional override secret
   * @returns {any} Validated parsed webhook event payload
   */
  verifyWebhook(rawPayloadString, signatureHeader, customSecret = null) {
    const secret = customSecret || this.webhookSecret;
    if (!secret) {
      throw new Error('Webhook verification failed: webhookSecret is not configured.');
    }

    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      throw new Error('Webhook verification failed: invalid signature header format. Expected sha256=...');
    }

    const actualSignature = signatureHeader.replace('sha256=', '');
    const isValid = verifyHmac(rawPayloadString, secret, actualSignature);

    if (!isValid) {
      throw new Error('Webhook verification failed: signature mismatch.');
    }

    return JSON.parse(rawPayloadString);
  }
}

// Backwards compatibility alias
export const YoupiPaymentClient = SanbookPayClient;
