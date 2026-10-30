/**
 * DYNAMO PAY — Gmail Verification via Google API Node.js Client
 * Real Gmail-based payment verification using Google API
 * Uses google-api-nodejs-client for authenticated Gmail access
 */

import { google } from 'googleapis';

export class DynamoPayGmailVerification {
  constructor(options = {}) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI || 'http://localhost:6003/oauth/callback'
    );

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    this.pollIntervalMs = Number(process.env.GMAIL_POLL_INTERVAL_MS || 5000);
    this.polling = false;
    this.pollInterval = null;
  }

  /**
   * Set OAuth2 credentials (after user authorization)
   */
  setCredentials(tokens) {
    this.oauth2Client.setCredentials(tokens);
  }

  /**
   * Get authorization URL for user to grant Gmail access
   */
  getAuthUrl() {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify'
      ],
      prompt: 'consent'
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  /**
   * Search for payment-related emails from banks
   */
  async searchPaymentEmails(query = 'from:@bank.com OR from:@upi.com OR subject:(payment OR transaction OR credit)') {
    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 10
      });

      const messages = response.data.messages || [];
      const emails = [];

      for (const msg of messages) {
        const email = await this.gmail.users.messages.get({
          userId: 'me',
          id: msg.id
        });
        emails.push(email.data);
      }

      return emails;
    } catch (err) {
      console.error('[DynamoPay Gmail] Search failed:', err.message);
      return [];
    }
  }

  /**
   * Parse UPI payment details from email
   */
  parseUPIPayment(email) {
    const snippet = email.snippet || '';
    const body = this._getEmailBody(email);

    // Look for UPI transaction patterns in email
    const upiRegex = /upi[:/](?:pay\?pa=([^&&]+)&pn=([^&]+)&am=([^&]+)&tn=([^&]+))/i;
    const match = body.match(upiRegex) || snippet.match(upiRegex);

    if (match) {
      return {
        senderVpa: match[1],
        senderName: match[2],
        amount: match[3],
        transactionId: match[4],
        source: 'gmail'
      };
    }

    // Look for transaction reference patterns
    const txnRegex = /(?:txn|transaction|reference|utr)[:# ]*([A-Z0-9]{6,20})/i;
    const txnMatch = body.match(txnRegex) || snippet.match(txnRegex);

    if (txnMatch) {
      return {
        transactionId: txnMatch[1],
        source: 'gmail'
      };
    }

    return null;
  }

  _getEmailBody(email) {
    const parts = email.payload?.parts || [];
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    if (email.payload?.body?.data) {
      return Buffer.from(email.payload.body.data, 'base64').toString('utf-8');
    }
    return '';
  }

  /**
   * Start polling Gmail for payment emails
   */
  startPolling(onPaymentFound) {
    if (this.polling) return;
    this.polling = true;

    this.pollInterval = setInterval(async () => {
      try {
        const emails = await this.searchPaymentEmails();
        for (const email of emails) {
          const payment = this.parseUPIPayment(email);
          if (payment) {
            onPaymentFound(payment, email);
          }
        }
      } catch (err) {
        console.error('[DynamoPay Gmail] Poll error:', err.message);
      }
    }, this.pollIntervalMs);

    console.log('[DynamoPay Gmail] Polling started');
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
    console.log('[DynamoPay Gmail] Polling stopped');
  }
}

export default DynamoPayGmailVerification;
