/**
 * DYNAMO PAY — Android SMS Gateway Integration
 * Real SMS-based payment verification via Android SMS Gateway
 * Connects to capcom6/android-sms-gateway running on Android device
 */

import http from 'node:http';

export class DynamoPaySMSGateway {
  constructor(options = {}) {
    this.baseUrl = process.env.SMS_GATEWAY_URL || 'http://localhost:8080';
    this.apiKey = process.env.SMS_GATEWAY_API_KEY || '';
    this.pollIntervalMs = Number(process.env.SMS_POLL_INTERVAL_MS || 3000);
    this.polling = false;
    this.pollInterval = null;
  }

  /**
   * Send SMS via Android SMS Gateway
   */
  async sendSMS(phoneNumber, message) {
    try {
      const data = JSON.stringify({
        phoneNumber,
        message,
        apiKey: this.apiKey
      });

      return await new Promise((resolve, reject) => {
        const req = http.request(
          `${this.baseUrl}/api/sms/send`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data)
            }
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              try {
                resolve(JSON.parse(body));
              } catch {
                resolve({ success: true, raw: body });
              }
            });
          }
        );
        req.on('error', reject);
        req.write(data);
        req.end();
      });
    } catch (err) {
      console.error('[DynamoPay SMS] Send failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get received SMS messages
   */
  async getReceivedSMS() {
    try {
      return await new Promise((resolve, reject) => {
        const req = http.get(
          `${this.baseUrl}/api/sms/received?apiKey=${this.apiKey}`,
          (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              try {
                resolve(JSON.parse(body));
              } catch {
                resolve([]);
              }
            });
          }
        );
        req.on('error', reject);
      });
    } catch (err) {
      console.error('[DynamoPay SMS] Get failed:', err.message);
      return [];
    }
  }

  /**
   * Parse UPI payment from SMS
   */
  parseUPIPayment(message) {
    const text = message.message || message.body || message.text || '';

    // UPI payment patterns in SMS
    // Pattern 1: UPI payment received
    const upiRegex = /(?:upi|upi pay|payment received|credited)[: ]*([^ ]+)[^0-9]*([0-9,]+(?:\.[0-9]{2})?)[^0-9]*([A-Z0-9]{6,20})/i;
    const match = text.match(upiRegex);

    if (match) {
      return {
        senderVpa: match[1],
        amount: match[2].replace(/,/g, ''),
        transactionId: match[3],
        source: 'sms',
        rawMessage: text
      };
    }

    // Pattern 2: Transaction reference
    const txnRegex = /(?:txn|transaction|reference|utr|ref)[:# ]*([A-Z0-9]{6,20})/i;
    const txnMatch = text.match(txnRegex);

    if (txnMatch) {
      return {
        transactionId: txnMatch[1],
        source: 'sms',
        rawMessage: text
      };
    }

    return null;
  }

  /**
   * Start polling SMS gateway for payment SMS
   */
  startPolling(onPaymentFound) {
    if (this.polling) return;
    this.polling = true;

    this.pollInterval = setInterval(async () => {
      try {
        const messages = await this.getReceivedSMS();
        const smsList = Array.isArray(messages) ? messages : (messages.messages || []);

        for (const sms of smsList) {
          const payment = this.parseUPIPayment(sms);
          if (payment) {
            onPaymentFound(payment, sms);
          }
        }
      } catch (err) {
        console.error('[DynamoPay SMS] Poll error:', err.message);
      }
    }, this.pollIntervalMs);

    console.log('[DynamoPay SMS] Polling started');
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.polling = false;
    console.log('[DynamoPay SMS] Polling stopped');
  }
}

export default DynamoPaySMSGateway;
