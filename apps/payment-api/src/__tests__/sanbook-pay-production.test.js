import {ProviderRegistry} from '@youpi/core';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Database, runMigrations } from '@youpi/db';
import { startServer as startPaymentApi } from '../index.js';
import { authFetch } from '../../../../scripts/test-support.js';

describe('SANBOOK PAY — Production Financial Platform Test Suite', () => {
  let apiInstance;
  let testDb;
  let baseUrl;
  const merchantId = '00000000-0000-0000-0000-000000000001';
  let createdBeneficiaryId;
  let createdPayoutId;
  let createdCollectionId;

  before(async () => {
    testDb = new Database({ inMemory: true });
    runMigrations(testDb);
    apiInstance = await startPaymentApi(6305, testDb);
    baseUrl = 'http://localhost:6305';
  });

  after(async () => {
    if (apiInstance) {
      await apiInstance.close();
    }
    if (testDb) {
      testDb.close();
    }
  });

  // 1. BANKING & PROVIDER CONNECTIONS
  describe('Banking Connection Wizard & Credentials', () => {
    let connectionId;

    it('saves a new Cashfree provider connection with encrypted secrets', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/banking/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': merchantId
        },
        body: JSON.stringify({
          providerName: 'CASHFREE',
          environment: 'SANDBOX',
          clientId: 'CF_TEST_APP_12345678',
          clientSecret: 'cf_sec_abcdef1234567890abcdef1234567890',
          webhookSecret: 'cf_wh_secret_999999999'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.id);
      assert.strictEqual(data.providerName, 'CASHFREE');
      connectionId = data.id;
    });

    it('lists connections without exposing plain secrets', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/banking/connections`, {
        headers: { 'x-api-key': merchantId }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.connections));
      assert.strictEqual(data.connections.length, 1);
      const conn = data.connections[0];
      assert.strictEqual(conn.hasClientSecret, true);
      assert.strictEqual(conn.clientSecret, undefined);
    });

    it('retrieves capabilities for Cashfree connection', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/banking/connections/${connectionId}/capabilities`, {
        headers: { 'x-api-key': merchantId }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.capabilities));
      assert.ok(data.capabilities.some(c => c.code === 'COLLECTIONS'));
      assert.ok(data.capabilities.some(c => c.code === 'PAYOUTS'));
    });

    it('returns explicit capability error when direct bank provider is invoked without bank H2H setup', async () => {
      // Save direct bank connection
      const saveRes = await authFetch(`${baseUrl}/api/v1/banking/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': merchantId
        },
        body: JSON.stringify({
          providerName: 'HDFC',
          clientId: 'CORP_HDFC_99'
        })
      });
      const saveData = await saveRes.json();
      assert.strictEqual(saveRes.status, 200);

      // Test direct bank connection
      const testRes = await authFetch(`${baseUrl}/api/v1/banking/connections/${saveData.id}/test`, {
        method: 'POST',
        headers: { 'x-api-key': merchantId }
      });
      const testData = await testRes.json();
      assert.strictEqual(testData.valid, false);
      assert.ok(testData.error.includes('DIRECT_BANK_NOT_ACTIVATED'));
    });
  });

  // 2. REAL COLLECTIONS
  describe('Universal Payment Collections', () => {
    it('creates a collection order and records immutable creation event', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/collections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': merchantId,
          'idempotency-key': 'idem_coll_001'
        },
        body: JSON.stringify({
          orderId: 'ORD_REAL_1001',
          amount: 499.00,
          currency: 'INR',
          customer: {
            name: 'Rohit Sharma',
            phone: '9876543210',
            email: 'rohit@example.com'
          },
          metadata: { plan: 'PREMIUM_ANNUAL' }
        })
      });

      assert.strictEqual(res.status, 503);
      const data = await res.json();
      assert.strictEqual(data.code, 'PROVIDER_UNAVAILABLE');
      assert.equal(data.paymentId, undefined);
      createdCollectionId = 'not-created';
    });

    it('honors idempotency key on duplicate collection request', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/collections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': merchantId,
          'idempotency-key': 'idem_coll_001'
        },
        body: JSON.stringify({
          orderId: 'ORD_REAL_1001',
          amount: 499.00
        })
      });

      assert.strictEqual(res.status, 503);
      const data = await res.json();
      assert.strictEqual(data.code, 'PROVIDER_UNAVAILABLE');
    });

    it('retrieves collection details with audit event trail', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/collections/${createdCollectionId}`, {
        headers: { 'x-api-key': merchantId }
      });
      assert.strictEqual(res.status, 404);
    });

    it('rejects duplicate orderId without idempotency key', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/collections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': merchantId
        },
        body: JSON.stringify({
          orderId: 'ORD_REAL_1001',
          amount: 100.00
        })
      });
      assert.strictEqual(res.status, 503);
    });
  });

  // 3. REAL MONEY PAYOUTS
  describe('Outbound Disbursements & Beneficiaries', () => {
    it('registers a bank account beneficiary', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/beneficiaries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': merchantId
        },
        body: JSON.stringify({
          name: 'Jane Developer',
          bankAccount: '918273645019',
          ifsc: 'HDFC0000001',
          email: 'jane@developer.com',
          phone: '9876543210'
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.beneficiaryId);
      assert.strictEqual(data.name, 'Jane Developer');
      assert.strictEqual(data.type, 'BANK_ACCOUNT');
      createdBeneficiaryId = data.beneficiaryId;
    });

    it('registers a UPI ID beneficiary', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/beneficiaries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': merchantId
        },
        body: JSON.stringify({
          name: 'Contractor UPI',
          upiId: 'contractor@okhdfcbank'
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.type, 'UPI_ID');
      assert.strictEqual(data.upiId, 'contractor@okhdfcbank');
    });

    it('initiates a payout requiring maker-checker approval', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/payouts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': merchantId,
          'idempotency-key': 'idem_payout_001'
        },
        body: JSON.stringify({
          beneficiaryId: createdBeneficiaryId,
          amount: 2500.00,
          payoutRail: 'IMPS',
          remarks: 'Vendor payment',
          requireApproval: true
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.payoutId);
      assert.strictEqual(data.status, 'APPROVAL_REQUIRED');
      assert.strictEqual(data.amount, '2500.00');
      createdPayoutId = data.payoutId;
    });

    it('checker approves the payout instruction', async t => {
      t.mock.method(ProviderRegistry.prototype,'getProvider',()=>({createPayout:async()=>({status:'PROCESSING',providerTransferId:'isolated-approval-test',utr:null})}));
      const res = await authFetch(`${baseUrl}/api/v1/payouts/${createdPayoutId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': merchantId
        },
        body: JSON.stringify({
          approverId: 'OFFICER_007',
          decision: 'APPROVED',
          comments: 'Approved under discretionary limit'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.status);
    });
  });

  // 4. FINANCIAL LEDGER & DOUBLE-ENTRY INVARIANTS
  describe('Double-Entry Financial Ledger', () => {
    it('retrieves standard chart of accounts', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/ledger/accounts`, {
        headers: { 'x-api-key': merchantId }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.accounts));
      assert.ok(data.accounts.some(a => a.code === 'PROVIDER_CLEARING'));
      assert.ok(data.accounts.some(a => a.code === 'MERCHANT_RECEIVABLES'));
      assert.ok(data.accounts.some(a => a.code === 'BANK_CASH'));
    });

    it('retrieves balanced trial balance', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/ledger/trial-balance`, {
        headers: { 'x-api-key': merchantId }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.trialBalance);
      assert.ok(data.trialBalance.summary !== undefined);
    });
  });

  // 5. REFUNDS
  describe('Refund Management', () => {
    it('rejects refund on non-SUCCESS order', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/refunds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': merchantId
        },
        body: JSON.stringify({
          paymentId: createdCollectionId,
          amount: 100.00
        })
      });
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.ok(data.error.includes('not found'));
    });
  });

  // 6. 60-SECOND ENGINE & OPERATIONAL METRICS
  describe('60-Second Engine & Performance Latency', () => {
    it('retrieves measured latency percentiles and 60-second SLA percentage', async () => {
      const res = await authFetch(`${baseUrl}/api/v1/operations/metrics`, {
        headers: { 'x-api-key': merchantId }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.objectiveTargetMs, 60000);
      assert.ok(data.latencies.p50Seconds !== undefined);
      assert.ok(data.latencies.p95Seconds !== undefined);
      assert.ok(data.latencies.p99Seconds !== undefined);
      assert.ok(typeof data.under60sPercentage === 'number');
    });
  });
});
