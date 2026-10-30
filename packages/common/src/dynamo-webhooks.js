/**
 * DYNAMO PAY — Svix Webhook Integration
 * Reliable webhook delivery to merchants via Svix
 * Replaces in-memory webhook engine with production-grade delivery
 */

import { Svix } from 'svix';

export class DynamoPayWebhooks {
  constructor(options = {}) {
    this.svix = new Svix(process.env.SVIX_API_KEY || '');
    this.applicationId = process.env.SVIX_APPLICATION_ID || 'dynamo-pay';
  }

  /**
   * Send webhook to merchant via Svix
   */
  async sendWebhook(webhookUrl, eventType, payload, merchantId) {
    try {
      const response = await this.svix.message.create(this.applicationId, {
        applicationId: this.applicationId,
        eventType: eventType,
        payload: payload
      });

      console.log(`[DynamoPay Webhooks] Sent ${eventType} to ${merchantId}: ${response.id}`);
      return { success: true, messageId: response.id };
    } catch (err) {
      console.error(`[DynamoPay Webhooks] Failed to send ${eventType} to ${merchantId}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Send payment success webhook
   */
  async sendPaymentSuccess(merchantId, paymentData) {
    return await this.sendWebhook(
      null, // Svix handles delivery to registered endpoints
      'payment.success',
      {
        paymentId: paymentData.paymentId,
        orderId: paymentData.orderId,
        amount: paymentData.amount,
        currency: paymentData.currency,
        status: 'SUCCESS',
        utr: paymentData.utr,
        payeeVpa: paymentData.payeeVpa,
        payeeName: paymentData.payeeName,
        verifiedAt: paymentData.verifiedAt,
        platform: 'dynamo-pay'
      },
      merchantId
    );
  }

  /**
   * Send payment failed webhook
   */
  async sendPaymentFailed(merchantId, paymentData) {
    return await this.sendWebhook(
      null,
      'payment.failed',
      {
        paymentId: paymentData.paymentId,
        orderId: paymentData.orderId,
        amount: paymentData.amount,
        currency: paymentData.currency,
        status: 'FAILED',
        failureReason: paymentData.failureReason,
        platform: 'dynamo-pay'
      },
      merchantId
    );
  }

  /**
   * Send payment expired webhook
   */
  async sendPaymentExpired(merchantId, paymentData) {
    return await this.sendWebhook(
      null,
      'payment.expired',
      {
        paymentId: paymentData.paymentId,
        orderId: paymentData.orderId,
        amount: paymentData.amount,
        currency: paymentData.currency,
        status: 'EXPIRED',
        platform: 'dynamo-pay'
      },
      merchantId
    );
  }
}

export default DynamoPayWebhooks;
