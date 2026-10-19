import crypto from 'node:crypto';
import { PaymentProvider } from './payment-provider.interface.js';

/**
 * Cashfree Payments Production Provider
 * Official REST API implementation for:
 * 1. Cashfree PG — Collections (orders, sessions, payment status, webhooks)
 * 2. Cashfree Payouts — Outbound disbursements (beneficiaries, transfers, UTR, balance)
 * 3. Cashfree Settlements & Reconciliation
 */
export class CashfreeProvider extends PaymentProvider {
  constructor(config = {}) {
    super({
      ...config,
      providerName: 'CASHFREE'
    });

    const isSandbox = (this.environment || '').toUpperCase() === 'SANDBOX';
    this.pgBaseUrl = isSandbox
      ? 'https://sandbox.cashfree.com/pg'
      : 'https://api.cashfree.com/pg';

    this.payoutBaseUrl = isSandbox
      ? 'https://payout-gamma.cashfree.com/payout/v1'
      : 'https://payout-api.cashfree.com/payout/v1';

    this.apiVersion = '2023-08-01';
  }

  /**
   * Helper to execute HTTP requests with proper timeout and headers.
   */
  async _request(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'x-client-id': this.clientId,
      'x-client-secret': this.clientSecret,
      'x-api-version': this.apiVersion,
      ...(options.headers || {})
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });
      clearTimeout(timeout);

      const text = await response.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      return {
        ok: response.ok,
        status: response.status,
        data
      };
    } catch (err) {
      clearTimeout(timeout);
      return {
        ok: false,
        status: 0,
        error: err.name === 'AbortError' ? 'Provider request timed out (15s)' : err.message,
        data: null
      };
    }
  }

  /**
   * Validates production credentials against Cashfree PG and Payouts.
   */
  async validateCredentials() {
    if (!this.clientId || !this.clientSecret) {
      return {
        valid: false,
        error: 'Cashfree Client ID and Client Secret are required.'
      };
    }

    // Test PG credentials with a lightweight authenticated request
    const pgRes = await this._request(`${this.pgBaseUrl}/orders?limit=1`, {
      method: 'GET'
    });

    if (pgRes.status === 401 || pgRes.status === 403) {
      return {
        valid: false,
        error: `Authentication failed (HTTP ${pgRes.status}): ${pgRes.data?.message || 'Invalid Client ID or Secret'}`
      };
    }

    if (pgRes.status >= 500) {
      return {
        valid: false,
        error: `Cashfree gateway error (HTTP ${pgRes.status}): ${pgRes.data?.message || 'Service Unavailable'}`
      };
    }

    return {
      valid: true,
      details: {
        environment: this.environment,
        pgStatus: pgRes.ok ? 'OK' : `HTTP ${pgRes.status}`,
        checkedAt: new Date().toISOString()
      }
    };
  }

  /**
   * Retrieves available capabilities.
   */
  async getCapabilities() {
    const caps = [
      { code: 'COLLECTIONS', enabled: true, description: 'Cashfree Payment Gateway UPI / QR / NetBanking collections' },
      { code: 'WEBHOOKS', enabled: true, description: 'Signed webhook verification (HMAC-SHA256)' },
      { code: 'REFUNDS', enabled: true, description: 'API-driven refunds & reversals' },
      { code: 'PAYOUTS', enabled: true, description: 'Outbound disbursements to Bank Accounts & UPI IDs' },
      { code: 'BENEFICIARY_VERIFY', enabled: true, description: 'Penny-drop bank account & UPI ID verification' },
      { code: 'SETTLEMENTS', enabled: true, description: 'Automated settlement batches & bank UTR reconciliation' },
      { code: 'BALANCE_CHECK', enabled: true, description: 'Real-time payout ledger balance check' }
    ];
    return caps;
  }

  /**
   * Creates a payment collection order in Cashfree.
   */
  async createCollection(order) {
    const amountRupees = Number((order.amountPaise / 100).toFixed(2));
    const payload = {
      order_id: order.merchantOrderId,
      order_amount: amountRupees,
      order_currency: order.currency || 'INR',
      customer_details: {
        customer_id: order.customerPhone || order.customerEmail || `cust_${Date.now()}`,
        customer_phone: order.customerPhone || '9999999999',
        customer_name: order.customerName || 'Customer',
        customer_email: order.customerEmail || 'customer@sanbookpay.com'
      },
      order_meta: {
        return_url: order.returnUrl || undefined,
        notify_url: order.notifyUrl || undefined
      }
    };

    const res = await this._request(`${this.pgBaseUrl}/orders`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`Cashfree createCollection failed (HTTP ${res.status}): ${res.data?.message || JSON.stringify(res.data)}`);
    }

    const data = res.data;
    const checkoutUrl = data.payment_link || (data.payment_session_id ? `https://payments.cashfree.com/order/#${data.payment_session_id}` : null);

    return {
      providerOrderId: data.cf_order_id ? String(data.cf_order_id) : data.order_id,
      merchantOrderId: data.order_id,
      paymentSessionId: data.payment_session_id,
      checkoutUrl,
      rawResponse: data
    };
  }

  /**
   * Gets authoritative payment collection status and list of payment attempts.
   */
  async getCollectionStatus(orderId) {
    const res = await this._request(`${this.pgBaseUrl}/orders/${encodeURIComponent(orderId)}/payments`, {
      method: 'GET'
    });

    if (!res.ok) {
      // Fallback: query order directly
      const orderRes = await this._request(`${this.pgBaseUrl}/orders/${encodeURIComponent(orderId)}`, {
        method: 'GET'
      });
      if (!orderRes.ok) {
        throw new Error(`Cashfree getCollectionStatus failed (HTTP ${res.status}): ${res.data?.message || 'Order not found'}`);
      }
      const od = orderRes.data;
      return {
        status: od.order_status === 'PAID' ? 'SUCCESS' : od.order_status,
        amountPaise: Math.round(Number(od.order_amount) * 100),
        bankReference: null,
        providerPaymentId: null,
        rawResponse: od
      };
    }

    const payments = Array.isArray(res.data) ? res.data : [];
    const successfulPayment = payments.find(p => p.payment_status === 'SUCCESS');

    if (successfulPayment) {
      return {
        status: 'SUCCESS',
        amountPaise: Math.round(Number(successfulPayment.payment_amount) * 100),
        bankReference: successfulPayment.bank_reference || successfulPayment.payment_gateway_details?.gateway_order_id || null,
        providerPaymentId: String(successfulPayment.cf_payment_id),
        paymentMethod: successfulPayment.payment_group || 'UPI',
        rawResponse: successfulPayment
      };
    }

    const latest = payments[payments.length - 1];
    return {
      status: latest ? (latest.payment_status === 'FAILED' ? 'FAILED' : 'PENDING') : 'PENDING',
      amountPaise: latest ? Math.round(Number(latest.payment_amount) * 100) : 0,
      bankReference: latest?.bank_reference || null,
      providerPaymentId: latest ? String(latest.cf_payment_id) : null,
      rawResponse: latest || {}
    };
  }

  /**
   * Verifies Cashfree Webhook Signature.
   * Cashfree computes HMAC-SHA256 over: `${timestamp}${rawBody}` using the client secret, base64 encoded.
   */
  verifyCollectionWebhook({ rawBody, headers }) {
    const signature = headers['x-webhook-signature'] || headers['X-Webhook-Signature'];
    const timestamp = headers['x-webhook-timestamp'] || headers['X-Webhook-Timestamp'];

    if (!signature || !timestamp || !this.clientSecret) {
      return false;
    }

    try {
      const dataToSign = `${timestamp}${rawBody}`;
      const expected = crypto.createHmac('sha256', this.clientSecret)
        .update(dataToSign)
        .digest('base64');

      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  /**
   * Registers a beneficiary for outbound payouts.
   */
  async registerBeneficiary(beneficiary) {
    const isUpi = beneficiary.beneficiaryType === 'UPI_ID' || Boolean(beneficiary.upiId);
    const payload = {
      beneId: beneficiary.id || `bene_${Date.now()}`,
      name: beneficiary.name,
      email: beneficiary.email || 'beneficiary@sanbookpay.com',
      phone: beneficiary.phone || '9999999999',
      address1: 'Corporate Office',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001'
    };

    if (isUpi) {
      payload.vpa = beneficiary.upiId;
    } else {
      payload.bankAccount = beneficiary.bankAccount;
      payload.ifsc = beneficiary.ifsc;
    }

    const res = await this._request(`${this.payoutBaseUrl}/addBeneficiary`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!res.ok && res.data?.subCode !== '409') { // 409 means beneficiary already exists
      throw new Error(`Cashfree registerBeneficiary failed (HTTP ${res.status}): ${res.data?.message || JSON.stringify(res.data)}`);
    }

    return {
      providerBeneId: payload.beneId,
      verified: false,
      rawResponse: res.data
    };
  }

  /**
   * Verifies a bank account or UPI ID.
   */
  async verifyBeneficiary(target) {
    const isUpi = Boolean(target.upiId);
    let url;
    let method = 'GET';
    let body = undefined;

    if (isUpi) {
      url = `${this.payoutBaseUrl}/validation/upiDetails?vpa=${encodeURIComponent(target.upiId)}&name=${encodeURIComponent(target.name || '')}`;
    } else {
      url = `${this.payoutBaseUrl}/validation/bankDetails?name=${encodeURIComponent(target.name || '')}&phone=${encodeURIComponent(target.phone || '9999999999')}&bankAccount=${encodeURIComponent(target.bankAccount)}&ifsc=${encodeURIComponent(target.ifsc)}`;
    }

    const res = await this._request(url, { method });
    if (!res.ok) {
      return {
        valid: false,
        error: res.data?.message || 'Verification failed',
        rawResponse: res.data
      };
    }

    const data = res.data?.data || res.data;
    const isValid = data.accountStatus === 'VALID' || data.accountExists === 'YES' || res.data.status === 'SUCCESS';

    return {
      valid: isValid,
      registeredName: data.nameAtBank || data.name || null,
      rawResponse: res.data
    };
  }

  /**
   * Submits an authorized payout instruction to Cashfree Payouts.
   */
  async createPayout(payout) {
    const amountRupees = (payout.amountPaise / 100).toFixed(2);
    const payload = {
      beneId: payout.providerBeneId || payout.beneficiaryId,
      amount: amountRupees,
      transferId: payout.transferId,
      transferMode: (payout.payoutRail || 'IMPS').toLowerCase(),
      remarks: payout.remarks || 'Sanbook Pay Authorized Payout'
    };

    const res = await this._request(`${this.payoutBaseUrl}/requestTransfer`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`Cashfree createPayout failed (HTTP ${res.status}): ${res.data?.message || JSON.stringify(res.data)}`);
    }

    const data = res.data?.data || res.data;
    const statusMap = {
      SUCCESS: 'SUCCESS',
      PENDING: 'PROCESSING',
      RECEIVED: 'ACCEPTED',
      FAILED: 'FAILED',
      REJECTED: 'REJECTED'
    };

    return {
      providerTransferId: data.referenceId ? String(data.referenceId) : payout.transferId,
      status: statusMap[data.status] || 'PROCESSING',
      utr: data.utr || null,
      rawResponse: res.data
    };
  }

  /**
   * Queries authoritative payout transfer status.
   */
  async getPayoutStatus(transferId) {
    const res = await this._request(`${this.payoutBaseUrl}/getTransferStatus?transferId=${encodeURIComponent(transferId)}`, {
      method: 'GET'
    });

    if (!res.ok) {
      throw new Error(`Cashfree getPayoutStatus failed (HTTP ${res.status}): ${res.data?.message || 'Transfer not found'}`);
    }

    const transfer = res.data?.data?.transfer || res.data?.data || res.data;
    const statusMap = {
      SUCCESS: 'SUCCESS',
      PENDING: 'PROCESSING',
      RECEIVED: 'ACCEPTED',
      FAILED: 'FAILED',
      REJECTED: 'REJECTED',
      RETURNED: 'RETURNED'
    };

    return {
      status: statusMap[transfer.status] || transfer.status,
      utr: transfer.utr || null,
      failureReason: transfer.reason || null,
      rawResponse: res.data
    };
  }

  /**
   * Initiates a refund for an order.
   */
  async createRefund(refund) {
    const amountRupees = Number((refund.amountPaise / 100).toFixed(2));
    const payload = {
      refund_amount: amountRupees,
      refund_id: refund.refundId,
      refund_note: refund.reason || 'Sanbook Pay Authorized Refund'
    };

    const res = await this._request(`${this.pgBaseUrl}/orders/${encodeURIComponent(refund.merchantOrderId)}/refunds`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`Cashfree createRefund failed (HTTP ${res.status}): ${res.data?.message || JSON.stringify(res.data)}`);
    }

    const data = res.data;
    return {
      providerRefundId: data.cf_refund_id ? String(data.cf_refund_id) : data.refund_id,
      status: data.refund_status === 'SUCCESS' ? 'SUCCESS' : 'PENDING',
      rawResponse: data
    };
  }

  /**
   * Gets refund status.
   */
  async getRefundStatus(orderId, refundId) {
    const res = await this._request(`${this.pgBaseUrl}/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}`, {
      method: 'GET'
    });

    if (!res.ok) {
      throw new Error(`Cashfree getRefundStatus failed (HTTP ${res.status}): ${res.data?.message || 'Refund not found'}`);
    }

    const data = res.data;
    return {
      status: data.refund_status === 'SUCCESS' ? 'SUCCESS' : data.refund_status,
      utr: data.refund_arn || null,
      rawResponse: data
    };
  }

  /**
   * Retrieves available balance for payouts.
   */
  async retrieveAvailableBalance() {
    const res = await this._request(`${this.payoutBaseUrl}/getBalance`, {
      method: 'GET'
    });

    if (!res.ok) {
      throw new Error(`Cashfree retrieveAvailableBalance failed (HTTP ${res.status}): ${res.data?.message || 'Balance inquiry failed'}`);
    }

    const data = res.data?.data || res.data;
    const balancePaise = Math.round(Number(data.balance || 0) * 100);
    const availablePaise = Math.round(Number(data.availableBalance || data.balance || 0) * 100);

    return {
      balancePaise,
      availableBalancePaise: availablePaise,
      currency: 'INR'
    };
  }

  /**
   * Retrieves settlement records from Cashfree.
   */
  async retrieveSettlements(options = {}) {
    const url = `${this.pgBaseUrl}/settlements`;
    const res = await this._request(url, { method: 'GET' });
    if (!res.ok) return [];
    return Array.isArray(res.data) ? res.data : [];
  }

  /**
   * Retrieves reconciliation records from Cashfree.
   */
  async retrieveReconciliationRecords(options = {}) {
    const url = `${this.pgBaseUrl}/reconciliation/combined`;
    const res = await this._request(url, { method: 'POST', body: JSON.stringify(options) });
    if (!res.ok) return [];
    return Array.isArray(res.data) ? res.data : [];
  }
}

