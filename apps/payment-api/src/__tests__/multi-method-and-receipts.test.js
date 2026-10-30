import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentApp } from '../index.js';
import { Database, runMigrations } from '@youpi/db';
import { PaymentStatus } from '@youpi/common';

test('Sanbook Pay - Customer Auto-Provisioning, Multi-Method & Receipts Suite', async (t) => {
  const db = new Database({ inMemory: true });
  runMigrations(db);
  const { server, context, destroy, rawServer } = createPaymentApp(db);

  await new Promise(resolve => rawServer.listen(0, '127.0.0.1', resolve));
  const port = rawServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    destroy();
    await new Promise(resolve => rawServer.close(resolve));
  });

  let createdPaymentId = null;

  await t.test('1. Customer auto-generation with masked details in POST /api/v1/payments', async () => {
    const res = await fetch(`${baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ORD-AUTO-CUST-99',
        amount: '499.00',
        customer: {
          name: 'Mohit Sharma',
          email: 'mohit.sharma@example.com',
          phone: '9876543210'
        }
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.paymentId);
    assert.equal(data.orderId, 'ORD-AUTO-CUST-99');
    assert.equal(data.amount, '499.00');
    assert.ok(data.customer);
    assert.equal(data.customer.name, 'Mohit Sharma');
    assert.match(data.customer.maskedPhone, /\+91 98\*\*\* \*\*\*10/);
    assert.match(data.customer.maskedEmail, /m\*\*\*a@example\.com/);

    createdPaymentId = data.paymentId;
  });

  await t.test('2. Online Card Payment Processing (POST /api/v1/checkout/:id/card-pay)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/checkout/${createdPaymentId}/card-pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardNumber: '4532 1111 2222 8910',
        cardExp: '12/28',
        cardCvv: '789',
        cardHolderName: 'Mohit Sharma'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.status, PaymentStatus.SUCCESS);
    assert.equal(data.method, 'CARD');
    assert.equal(data.card.brand, 'VISA');
    assert.equal(data.card.last4, '8910');
    assert.ok(data.utr.startsWith('SBKVISA'));
  });

  await t.test('3. Official Digital Bill Receipt Retrieval (GET /api/v1/payments/:id/receipt)', async () => {
    // Test JSON format
    const jsonRes = await fetch(`${baseUrl}/api/v1/payments/${createdPaymentId}/receipt?format=json`);
    assert.equal(jsonRes.status, 200);
    const receiptData = await jsonRes.json();
    assert.equal(receiptData.success, true);
    assert.ok(receiptData.receiptId);
    assert.equal(receiptData.orderId, 'ORD-AUTO-CUST-99');
    assert.equal(receiptData.amount, '499.00');
    assert.equal(receiptData.method, 'CARD');
    assert.equal(receiptData.smsStatus, 'SENT');
    assert.equal(receiptData.emailStatus, 'DELIVERED');
    assert.ok(receiptData.customer.maskedPhone);
    assert.ok(receiptData.customer.maskedEmail);

    // Test HTML format
    const htmlRes = await fetch(`${baseUrl}/api/v1/payments/${createdPaymentId}/receipt`);
    assert.equal(htmlRes.status, 200);
    assert.equal(htmlRes.headers.get('content-type'), 'text/html; charset=utf-8');
    const htmlText = await htmlRes.text();
    assert.ok(htmlText.includes('SANBOOK PAY'));
    assert.ok(htmlText.includes('ORD-AUTO-CUST-99'));
    assert.ok(htmlText.includes('499.00'));
    assert.ok(htmlText.includes('Bank UTR:'));
  });

  await t.test('4. Online NetBanking Payment Processing (POST /api/v1/checkout/:id/netbanking-pay)', async () => {
    // Create new payment session for NetBanking
    const createRes = await fetch(`${baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ORD-NETBANK-77',
        amount: '1250.00',
        customer: {
          name: 'Priya Patel',
          email: 'priya.patel@bank.com',
          phone: '9988776655'
        }
      })
    });
    assert.equal(createRes.status, 201);
    const { paymentId } = await createRes.json();

    const nbRes = await fetch(`${baseUrl}/api/v1/checkout/${paymentId}/netbanking-pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bankCode: 'HDFC'
      })
    });

    assert.equal(nbRes.status, 200);
    const nbData = await nbRes.json();
    assert.equal(nbData.success, true);
    assert.equal(nbData.status, PaymentStatus.SUCCESS);
    assert.equal(nbData.method, 'NETBANKING');
    assert.equal(nbData.bank, 'HDFC');
    assert.ok(nbData.utr.startsWith('SBKHDFC'));

    // Check receipt
    const nbReceipt = await (await fetch(`${baseUrl}/api/v1/payments/${paymentId}/receipt?format=json`)).json();
    assert.equal(nbReceipt.method, 'NETBANKING');
    assert.equal(nbReceipt.amount, '1250.00');
  });
});
