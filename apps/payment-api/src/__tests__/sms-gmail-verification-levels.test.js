fix/ci-render-latest
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Database } from '@youpi/db';
import { PaymentStatus, PaymentMethod } from '@youpi/common';
import { startServer } from '../index.js';
import { authFetch, seedActivePaymentProfile } from '../../../../scripts/test-support.js';

describe('2-Level Verification (SMS Gateway + Gmail) & Queue Management Tests', () => {
  let apiInstance;
  let testDb;
  let baseUrl;

  before(async () => {
    testDb = new Database({ inMemory: true });
    apiInstance = await startServer(6208, testDb);
    baseUrl = `http://localhost:${apiInstance.port}`;
    seedActivePaymentProfile(testDb, '00000000-0000-0000-0000-000000000001');
  });

  after(async () => {
    await apiInstance.close();
    testDb.close();
  });

  test('POST /api/v1/admin/queue/clear expires all waiting UPI queue sessions', async () => {
    const sessionRepo = apiInstance.app.context.sessionRepo;
    const receivingAccountRepo = apiInstance.app.context.accountRepo;
    const merchantId = '00000000-0000-0000-0000-000000000001';
    const receivingAccountId = receivingAccountRepo.findActiveForMerchant(merchantId).id;

    // Create 1 active and 3 queued sessions
    const sActive = sessionRepo.create({
      merchantId,
      receivingAccountId,
      orderId: 'ORD-ACTIVE-1',
      amountPaise: 10000n
    });
    apiInstance.app.context.queueEngine.enqueueOrActivate(sActive.id, receivingAccountId);

    const sQ1 = sessionRepo.create({
      merchantId,
      receivingAccountId,
      orderId: 'ORD-Q-1',
      amountPaise: 20000n
    });
    apiInstance.app.context.queueEngine.enqueueOrActivate(sQ1.id, receivingAccountId);

    const sQ2 = sessionRepo.create({
      merchantId,
      receivingAccountId,
      orderId: 'ORD-Q-2',
      amountPaise: 30000n
    });
    apiInstance.app.context.queueEngine.enqueueOrActivate(sQ2.id, receivingAccountId);

    const clearRes = await authFetch(`${baseUrl}/api/v1/admin/queue/clear`, {
      method: 'POST'
    });
    assert.equal(clearRes.status, 200);
    const clearData = await clearRes.json();
    assert.equal(clearData.success, true);
    assert.ok(clearData.clearedCount >= 2);

    // Verify queue sessions are now EXPIRED
    const q1Updated = sessionRepo.findById(sQ1.id);
    const q2Updated = sessionRepo.findById(sQ2.id);
    assert.equal(q1Updated.status, PaymentStatus.EXPIRED);
    assert.equal(q2Updated.status, PaymentStatus.EXPIRED);

    // Clean up sActive so receiving account slot is released
    sessionRepo.transitionToTerminal(sActive.id, PaymentStatus.SUCCESS);
  });

  test('Detects active session conflict when customer already has an active session', async () => {
    const sessionRepo = apiInstance.app.context.sessionRepo;
    const customerRepo = apiInstance.app.context.customerRepo;
    const receivingAccountRepo = apiInstance.app.context.accountRepo;
    const merchantId = '00000000-0000-0000-0000-000000000001';
    const receivingAccountId = receivingAccountRepo.findActiveForMerchant(merchantId).id;

    // Create a customer
    const customer = customerRepo.create({
      phoneNumber: '9876543210',
      fullName: 'Conflict Test User'
    });

    // Session 1: bound to customer and ACTIVE
    const session1 = sessionRepo.create({
      merchantId,
      receivingAccountId,
      customerId: customer.id,
      orderId: 'ORD-FIRST-ACTIVE',
      amountPaise: 50000n
    });
    apiInstance.app.context.queueEngine.enqueueOrActivate(session1.id, receivingAccountId);

    // Session 2: new session created for the same customer
    const session2 = sessionRepo.create({
      merchantId,
      receivingAccountId,
      customerId: customer.id,
      orderId: 'ORD-SECOND-ATTEMPT',
      amountPaise: 75000n
    });

    // Check state of session 2 via API
    const res = await authFetch(`${baseUrl}/api/v1/checkout/${session2.id}/state`);
    assert.equal(res.status, 200);
    const state = await res.json();

    assert.equal(state.hasActiveSessionConflict, true);
    assert.ok(state.conflictingSession);
    assert.equal(state.conflictingSession.id, session1.id);

    // Retrying new payment clears old conflict
    const retryRes = await authFetch(`${baseUrl}/api/v1/checkout/${session2.id}/retry-new-payment`, {
      method: 'POST'
    });
    assert.equal(retryRes.status, 200);

    const oldSession = sessionRepo.findById(session1.id);
    assert.equal(oldSession.status, PaymentStatus.CANCELLED);

    // Clean up session2 so slot is released
    sessionRepo.transitionToTerminal(session2.id, PaymentStatus.CANCELLED);
  });

  test('Gmail credentials can be saved and connection tested via Admin API', async () => {
    const saveRes = await authFetch(`${baseUrl}/api/v1/admin/gmail/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'test-client-id.apps.googleusercontent.com',
        clientSecret: 'test-secret',
        refreshToken: 'mock_test_refresh_token_string_98765'
      })
    });
    assert.equal(saveRes.status, 200);
    const saveData = await saveRes.json();
    assert.equal(saveData.success, true);
    assert.equal(saveData.status, 'CONFIGURED');

    const getRes = await authFetch(`${baseUrl}/api/v1/admin/gmail/credentials`);
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.gmailConfig.clientId, 'test-client-id.apps.googleusercontent.com');

    // Test connection endpoint
    const testRes = await authFetch(`${baseUrl}/api/v1/admin/gmail/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: 'mock_token'
      })
    });
    assert.equal(testRes.status, 200);
  });
});
=======
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Database } from '@youpi/db';
import { PaymentStatus, PaymentMethod } from '@youpi/common';
import { startServer } from '../index.js';
import { authFetch, seedActivePaymentProfile } from '../../../../scripts/test-support.js';

describe('2-Level Verification (SMS Gateway + Gmail) & Queue Management Tests', () => {
  let apiInstance;
  let testDb;
  let baseUrl;

  before(async () => {
    testDb = new Database({ inMemory: true });
    apiInstance = await startServer(6208, testDb);
    baseUrl = `http://localhost:${apiInstance.port}`;
    seedActivePaymentProfile(testDb, '00000000-0000-0000-0000-000000000001');
  });

  after(async () => {
    await apiInstance.close();
    testDb.close();
  });

  test('POST /api/v1/admin/queue/clear expires all waiting UPI queue sessions', async () => {
    const sessionRepo = apiInstance.app.context.sessionRepo;
    const receivingAccountId = '00000000-0000-0000-0000-000000000002';
    const merchantId = '00000000-0000-0000-0000-000000000001';

    // Create 1 active and 3 queued sessions
    const sActive = sessionRepo.create({
      merchantId,
      receivingAccountId,
      orderId: 'ORD-ACTIVE-1',
      amountPaise: 10000n
    });
    apiInstance.app.context.queueEngine.enqueueOrActivate(sActive.id, receivingAccountId);

    const sQ1 = sessionRepo.create({
      merchantId,
      receivingAccountId,
      orderId: 'ORD-Q-1',
      amountPaise: 20000n
    });
    apiInstance.app.context.queueEngine.enqueueOrActivate(sQ1.id, receivingAccountId);

    const sQ2 = sessionRepo.create({
      merchantId,
      receivingAccountId,
      orderId: 'ORD-Q-2',
      amountPaise: 30000n
    });
    apiInstance.app.context.queueEngine.enqueueOrActivate(sQ2.id, receivingAccountId);

    const clearRes = await authFetch(`${baseUrl}/api/v1/admin/queue/clear`, {
      method: 'POST'
    });
    assert.equal(clearRes.status, 200);
    const clearData = await clearRes.json();
    assert.equal(clearData.success, true);
    assert.ok(clearData.clearedCount >= 2);

    // Verify queue sessions are now EXPIRED
    const q1Updated = sessionRepo.findById(sQ1.id);
    const q2Updated = sessionRepo.findById(sQ2.id);
    assert.equal(q1Updated.status, PaymentStatus.EXPIRED);
    assert.equal(q2Updated.status, PaymentStatus.EXPIRED);

    // Clean up sActive so receiving account slot is released
    sessionRepo.transitionToTerminal(sActive.id, PaymentStatus.SUCCESS);
  });

  test('Detects active session conflict when customer already has an active session', async () => {
    const sessionRepo = apiInstance.app.context.sessionRepo;
    const customerRepo = apiInstance.app.context.customerRepo;
    const receivingAccountId = '00000000-0000-0000-0000-000000000002';
    const merchantId = '00000000-0000-0000-0000-000000000001';

    // Create a customer
    const customer = customerRepo.create({
      phoneNumber: '9876543210',
      fullName: 'Conflict Test User'
    });

    // Session 1: bound to customer and ACTIVE
    const session1 = sessionRepo.create({
      merchantId,
      receivingAccountId,
      customerId: customer.id,
      orderId: 'ORD-FIRST-ACTIVE',
      amountPaise: 50000n
    });
    apiInstance.app.context.queueEngine.enqueueOrActivate(session1.id, receivingAccountId);

    // Session 2: new session created for the same customer
    const session2 = sessionRepo.create({
      merchantId,
      receivingAccountId,
      customerId: customer.id,
      orderId: 'ORD-SECOND-ATTEMPT',
      amountPaise: 75000n
    });

    // Check state of session 2 via API
    const res = await authFetch(`${baseUrl}/api/v1/checkout/${session2.id}/state`);
    assert.equal(res.status, 200);
    const state = await res.json();

    assert.equal(state.hasActiveSessionConflict, true);
    assert.ok(state.conflictingSession);
    assert.equal(state.conflictingSession.id, session1.id);

    // Retrying new payment clears old conflict
    const retryRes = await authFetch(`${baseUrl}/api/v1/checkout/${session2.id}/retry-new-payment`, {
      method: 'POST'
    });
    assert.equal(retryRes.status, 200);

    const oldSession = sessionRepo.findById(session1.id);
    assert.equal(oldSession.status, PaymentStatus.CANCELLED);

    // Clean up session2 so slot is released
    sessionRepo.transitionToTerminal(session2.id, PaymentStatus.CANCELLED);
  });

  test('Gmail credentials can be saved and connection tested via Admin API', async () => {
    const saveRes = await authFetch(`${baseUrl}/api/v1/admin/gmail/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'test-client-id.apps.googleusercontent.com',
        clientSecret: 'test-secret',
        refreshToken: 'mock_test_refresh_token_string_98765'
      })
    });
    assert.equal(saveRes.status, 200);
    const saveData = await saveRes.json();
    assert.equal(saveData.success, true);
    assert.equal(saveData.status, 'CONFIGURED');

    const getRes = await authFetch(`${baseUrl}/api/v1/admin/gmail/credentials`);
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.gmailConfig.clientId, 'test-client-id.apps.googleusercontent.com');

    // Test connection endpoint
    const testRes = await authFetch(`${baseUrl}/api/v1/admin/gmail/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: 'mock_token'
      })
    });
    assert.equal(testRes.status, 200);
  });
});
main
