/**
 * YOUPI PG — Production Health Check
 * Verifies all critical subsystems are operational.
 * Exit 0 = healthy, Exit 1 = unhealthy.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), '..');
const ENV_FILE = path.resolve(ROOT, '.env');
const DB_PATH = path.resolve(ROOT, 'data', 'youpi_pg.sqlite');

const BASE_URL = process.env.BASE_PAYMENT_API_URL || 'http://127.0.0.1:6100';
const TIMEOUT_MS = 5000;

let failures = 0;

function log(status, msg) {
  console.log(`${status.padEnd(7)} ${msg}`);
}

function fail(msg) {
  failures++;
  log('FAIL', msg);
}

function pass(msg) {
  log('PASS', msg);
}

async function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}${pathname}`, { timeout: TIMEOUT_MS }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function main() {
  if (typeof process.loadEnvFile === 'function') {
    try { if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE); } catch {}
  }

  // 1. Database file exists
  pass(`Database file: ${fs.existsSync(DB_PATH) ? 'present' : 'MISSING'}`);
  if (!fs.existsSync(DB_PATH)) fail('SQLite database not found at ' + DB_PATH);

  // 2. Health endpoint
  try {
    const h = await get('/health');
    if (h.status === 200) {
      const j = JSON.parse(h.body);
      pass(`Health endpoint: ${j.status} (${j.service})`);
    } else {
      fail(`Health endpoint returned ${h.status}`);
    }
  } catch (err) {
    fail(`Health endpoint unreachable: ${err.message}`);
  }

  // 3. Payments endpoint (create a probe payment)
  try {
    const body = JSON.stringify({
      orderId: `HEALTH-${Date.now()}`,
      amount: 100,
      currency: 'INR',
      customer: { name: 'Health Check', phone: '9876543210' },
    });
    const req = http.request(
      `${BASE_URL}/api/v1/payments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode === 201) {
            try {
              const j = JSON.parse(data);
              pass(`Payment creation: ${j.status} (${j.paymentId})`);
            } catch {
              pass('Payment creation: 201');
            }
          } else {
            fail(`Payment creation returned ${res.statusCode}`);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => fail('Payment creation unreachable'));
    req.write(body);
    req.end();
  } catch {
    fail('Payment creation failed');
  }

  await new Promise((r) => setTimeout(r, 300));

  // 4. Split settlement endpoint (read-only overview)
  try {
    const s = await get('/api/v1/split-settlements/overview');
    if (s.status === 200) pass('Split settlement endpoint: reachable');
    else fail(`Split settlement endpoint returned ${s.status}`);
  } catch {
    fail('Split settlement endpoint unreachable');
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Health check error:', err.message);
  process.exit(1);
});
