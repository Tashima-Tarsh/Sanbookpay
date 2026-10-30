import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Database } from '@youpi/db';
import { getAdminToken } from '@youpi/common';
import { startAdminServer } from '../index.js';

describe('Merchant Admin Integration Tests', () => {
  let serverInstance;
  let baseUrl;
  let testDb;

  before(async () => {
    testDb = new Database({ inMemory: true });
    serverInstance = await startAdminServer(6101, { db: testDb });
    baseUrl = `http://localhost:${serverInstance.port}`;
  });

  after(async () => {
    await serverInstance.close();
    testDb.close();
  });

  function get(path, headers = {}) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${path}`, { headers }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, text: data });
        });
      }).on('error', reject);
    });
  }

  test('GET /health returns UP', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    const json = JSON.parse(res.text);
    assert.equal(json.status, 'UP');
    assert.equal(json.service, 'merchant-admin');
  });

  test('GET / renders premium Dynamo Pay merchant dashboard', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/html'));

    assert.ok(res.text.includes('<!DOCTYPE html>'));
    assert.ok(res.text.includes('name="viewport"'));
    assert.ok(res.text.includes('Dynamo Pay'));
    assert.ok(res.text.includes('dp-sidebar'));
    assert.ok(res.text.includes('dp-main'));
    assert.ok(res.text.includes('dp-stats-grid'));
    assert.ok(res.text.includes('dp-stat-card'));
    assert.ok(res.text.includes('dp-table-wrap'));
    assert.ok(res.text.includes('dp-table'));

    // Verify premium glassmorphism dashboard elements
    assert.ok(res.text.includes('Overview'));
    assert.ok(res.text.includes('Transactions'));
    assert.ok(res.text.includes('Merchants'));
    assert.ok(res.text.includes('Settlements'));
    assert.ok(res.text.includes('UPI Accounts'));
    assert.ok(res.text.includes('API Keys'));
    assert.ok(res.text.includes('Alerts'));
  });

  test('GET /api/admin/tickets requires the admin token', async () => {
    const anonymous = await get('/api/admin/tickets');
    assert.equal(anonymous.status, 401);

    const res = await get('/api/admin/tickets', { Authorization: `Bearer ${getAdminToken()}` });
    assert.equal(res.status, 200);
    const json = JSON.parse(res.text);
    assert.ok(Array.isArray(json));
  });
});
