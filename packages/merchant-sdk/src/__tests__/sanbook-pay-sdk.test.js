import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SanbookPayClient, YoupiPaymentClient } from '../client.js';

describe('Sanbook Pay SDK Client Tests', () => {
  test('SanbookPayClient and YoupiPaymentClient export correctly and instantiate', () => {
    const client = new SanbookPayClient({
      apiUrl: 'http://localhost:6100',
      merchantId: 'merch_test_123',
      apiKey: 'sec_test_secret'
    });

    assert.equal(client.apiUrl, 'http://localhost:6100');
    assert.equal(client.merchantId, 'merch_test_123');
    assert.equal(client.apiKey, 'sec_test_secret');
    assert.equal(client.webhookSecret, 'sec_test_secret');
    assert.equal(typeof client.createCollection, 'function');
    assert.equal(typeof client.getCollection, 'function');
    assert.equal(typeof client.getCollectionStatus, 'function');
    assert.equal(typeof client.refreshCollectionStatus, 'function');
    assert.equal(typeof client.createPayout, 'function');
    assert.equal(typeof client.getPayout, 'function');
    assert.equal(typeof client.approvePayout, 'function');
    assert.equal(typeof client.registerBeneficiary, 'function');
    assert.equal(typeof client.verifyBeneficiary, 'function');
    assert.equal(typeof client.createRefund, 'function');
    assert.equal(typeof client.getSettlementOverview, 'function');
    assert.equal(typeof client.verifyWebhook, 'function');

    // Backwards compatibility verification
    assert.equal(SanbookPayClient, YoupiPaymentClient);
  });

  test('Webhook signature verification verifies authentic HMAC payloads and rejects tampered ones', () => {
    const client = new SanbookPayClient({
      webhookSecret: 'test_super_secret_webhook_key'
    });

    const payload = JSON.stringify({
      event: 'PAYMENT.SUCCESS',
      paymentId: 'pay_998877',
      orderId: 'ORD-1001',
      amount: '500.00',
      utr: '629817263541'
    });

    // Compute expected signature
    import('node:crypto').then(crypto => {
      const hmac = crypto.createHmac('sha256', 'test_super_secret_webhook_key').update(payload).digest('hex');
      const sigHeader = `sha256=${hmac}`;

      const verified = client.verifyWebhook(payload, sigHeader);
      assert.equal(verified.paymentId, 'pay_998877');
      assert.equal(verified.orderId, 'ORD-1001');

      // Tampered payload
      assert.throws(() => {
        client.verifyWebhook(payload + ' ', sigHeader);
      }, /signature mismatch/);
    });
  });
});

