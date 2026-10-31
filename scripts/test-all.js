import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// A clean checkout must run without a live .env or production database.
const testEnv = {
  NODE_ENV: 'test',
  YOUPI_MODE: 'localhost',
  ENCRYPTION_MASTER_KEY: crypto.randomBytes(32).toString('hex'),
  JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  INITIAL_ADMIN_EMAIL: 'admin@example.test',
  INITIAL_ADMIN_PASSWORD: crypto.randomBytes(24).toString('hex'),
  BASE_CHECKOUT_URL: 'http://localhost:7000',
  BASE_PAYMENT_API_URL: 'http://localhost:6100',
  SQLITE_DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dynamo-tests-')), 'tests.sqlite')
};

const testFiles = [
  'packages/common/src/__tests__/common.test.js',
  'packages/db/src/__tests__/customer-reset.test.js',
  'packages/db/src/__tests__/auth-matrix.test.js',
  'packages/db/src/__tests__/db.test.js',
  'packages/core/src/__tests__/core.test.js',
  'packages/core/src/__tests__/queue-timing.test.js',
  'packages/core/src/__tests__/verification-pending.test.js',
  'packages/core/src/__tests__/webhook-engine.test.js',
  'packages/core/src/__tests__/webhook-failure-matrix.test.js',
  'packages/merchant-sdk/src/__tests__/merchant-sdk.test.js',
  'packages/merchant-sdk/src/__tests__/sanbook-pay-sdk.test.js',
  'packages/merchant-sdk/src/__tests__/youpi-universal-integration.test.js',
  'apps/checkout-portal/src/__tests__/checkout-portal.test.js',
  'apps/checkout-portal/src/__tests__/checkout-interactions.test.js',
  'apps/coin-wallet-store/src/__tests__/coin-wallet-store.test.js',
  'apps/merchant-admin/src/__tests__/merchant-admin.test.js',
  'apps/merchant-admin/src/__tests__/console-navigation.test.js',
  'apps/payment-help/src/__tests__/payment-help.test.js',
  'apps/gmail-observer/src/__tests__/gmail-observer.test.js',
  'apps/sms-observer/src/__tests__/sms-observer.test.js',
  'apps/android-observer-app/__tests__/android-observer.test.js',
  'apps/control-center/src/__tests__/control-center.test.js',
  'apps/payment-api/src/__tests__/payment-api.test.js',
  'apps/payment-api/src/__tests__/merchant-console.test.js',
  'apps/payment-api/src/__tests__/dynamo-public-api.test.js',
  'apps/payment-api/src/__tests__/auth-guard.test.js',
  'apps/payment-api/src/__tests__/rate-limit.test.js',
  'apps/payment-api/src/__tests__/counter-payments.test.js',
  'apps/payment-api/src/__tests__/selling-modes-and-cod.test.js',
  'apps/payment-api/src/__tests__/developer-payment-simulator.test.js',
  'apps/payment-api/src/__tests__/developer-test-mode.test.js',
  'apps/payment-api/src/__tests__/device-binding-duplicate-session.test.js',
  'apps/payment-api/src/__tests__/fraud-ban-pipeline.test.js',
  'apps/payment-api/src/__tests__/sms-gmail-verification-levels.test.js',
  'apps/payment-api/src/__tests__/upi-server-health-and-pc-ui.test.js',
  'apps/payment-api/src/__tests__/whatsapp-berry-auth.test.js',
  'apps/payment-api/src/__tests__/whitelabel-branding.test.js',
  'apps/payment-api/src/__tests__/cod-parallel-timer-decoupling.test.js',
  'apps/payment-api/src/__tests__/sanbook-pay-production.test.js',
  'apps/payment-api/src/__tests__/multi-method-and-receipts.test.js',
  'apps/payment-api/src/__tests__/payment-confirmation-regression.test.js',
  'apps/payment-api/src/__tests__/production-hardening.test.js',
  'apps/payment-api/src/__tests__/platform-identity.test.js',
  'apps/payment-api/src/__tests__/platform-operations.test.js',
  'apps/payment-api/src/__tests__/platform-payments.test.js',
  'apps/payment-api/src/__tests__/external-banking.test.js',
  'apps/payment-api/src/__tests__/secure-platform-boundaries.test.js',
  'apps/merchant-admin/src/__tests__/platform-ui.test.js',
  'scripts/chaos-concurrency.test.js',
  'scripts/postgres-acceptance.test.js',
  'scripts/production-infrastructure.test.js'
];

console.log('============================================================');
console.log('🛡️ SANBOOK PAY — FULL REGRESSION TEST RUNNER');
console.log(`Running ${testFiles.length} curated test suites...`);
console.log('============================================================\n');

let passedCount = 0;
const startTotal = Date.now();
const suiteResults=[];

for (let i = 0; i < testFiles.length; i++) {
  const file = testFiles[i];
  process.stdout.write(`[${i + 1}/${testFiles.length}] Testing ${file}... `);
  const startFile = Date.now();
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], {
    stdio: 'pipe',
    env: {
      ...process.env,
      ...testEnv
    },
    encoding: 'utf8'
  });

  const duration = ((Date.now() - startFile) / 1000).toFixed(2);
  const passed=result.status===0&&!/^\s*not ok\b/m.test(result.stdout||'');
  suiteResults.push({file,passed,durationSeconds:Number(duration),tests:Number(result.stdout?.match(/^# tests (\d+)/m)?.[1]||0),testFailures:Number(result.stdout?.match(/^# fail (\d+)/m)?.[1]||0)});
  fs.mkdirSync('output/testing',{recursive:true});
  fs.writeFileSync('output/testing/regression-results.json',JSON.stringify({testedAt:new Date().toISOString(),suiteCount:testFiles.length,completed:suiteResults.length,passedSuites:suiteResults.filter(r=>r.passed).length,totalTests:suiteResults.reduce((n,r)=>n+r.tests,0),durationSeconds:Number(((Date.now()-startTotal)/1000).toFixed(2)),suites:suiteResults},null,2));

  if (result.status === 0 && !/^\s*not ok\b/m.test(result.stdout || '')) {
    passedCount++;
    console.log(`✅ PASS (${duration}s)`);
  } else {
    console.log(`❌ FAIL (${duration}s)\n`);
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    console.error(`\n[-] Test failed in ${file}`);
    process.exit(result.status || 1);
  }
}

const totalDuration = ((Date.now() - startTotal) / 1000).toFixed(2);
console.log('\n============================================================');
console.log(`🎉 ALL ${passedCount} TEST SUITES PASSED CLEANLY (Total: ${totalDuration}s)`);
console.log('============================================================');
process.exit(0);
