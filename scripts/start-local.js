/**
 * YOUPI PG — Local Development Start Script
 * Starts the three core services directly without Cloudflare tunnel requirement.
 * Perfect for testing UPI payment flow locally with zero API cost.
 *
 * Services:
 *   - Payment Core API    : http://127.0.0.1:6100
 *   - Checkout Portal     : http://127.0.0.1:7000
 *   - Merchant Admin      : http://127.0.0.1:6001
 */

import { spawn } from 'node:child_process';
import { runMigrations } from '../packages/db/src/migrate.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load .env if available
try {
  const fs = await import('node:fs');
  const rootEnv = path.resolve(rootDir, '.env');
  if (fs.existsSync(rootEnv) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(rootEnv);
  }
} catch {}

// Ensure localhost mode
if (!process.env.YOUPI_MODE) process.env.YOUPI_MODE = 'localhost';
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';

console.log('====================================================');
console.log('🚀 YOUPI PG — Local Mode (Zero API Cost)');
console.log('====================================================');
console.log('UPI QR payments work with GPay, PhonePe, Paytm, BHIM, CRED');
console.log('No payment gateway API purchase required.');
console.log('====================================================\n');

// 1. Run database migrations
console.log('[1/3] Applying database migrations...');
const migrationResult = runMigrations();
console.log(`   ✓ Database ready. Default merchant: ${migrationResult.defaultMerchant.businessName}`);
console.log(`   ✓ Merchant ID: ${migrationResult.defaultMerchant.id}\n`);

// 2. Start all three services as child processes
console.log('[2/3] Starting core services...');

const services = [
  { name: 'Payment Core API',    entry: 'apps/payment-api/src/index.js',    port: 6100 },
  { name: 'Checkout Portal',     entry: 'apps/checkout-portal/src/index.js', port: 7000 },
  { name: 'Merchant Admin',      entry: 'apps/merchant-admin/src/index.js',  port: 6001 }
];

const processes = [];
for (const svc of services) {
  const child = spawn(process.execPath, [svc.entry], {
    cwd: rootDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      YOUPI_BIND_HOST: '127.0.0.1',
      NODE_ENV: process.env.NODE_ENV || 'development'
    }
  });

  processes.push({ name: svc.name, port: svc.port, child });

  child.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      for (const line of text.split('\n')) {
        if (line.trim()) console.log(`   [${svc.name}] ${line}`);
      }
    }
  });

  child.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      for (const line of text.split('\n')) {
        if (line.trim()) console.error(`   [${svc.name} ERR] ${line}`);
      }
    }
  });

  child.on('exit', (code, signal) => {
    console.log(`   [${svc.name}] Process exited (code=${code}, signal=${signal})`);
  });
}

console.log('   ✓ All services started\n');

console.log('====================================================');
console.log('🟢 ALL SERVICES ONLINE');
console.log('====================================================');
console.log('• Payment Core REST API:   http://127.0.0.1:6100');
console.log('• Checkout Portal:         http://127.0.0.1:7000');
console.log('• Merchant Admin Hub:      http://127.0.0.1:6001');
console.log('• Health Check:            http://127.0.0.1:6100/health');
console.log('====================================================');
console.log('API Usage (example):');
console.log('  POST http://127.0.0.1:6100/api/v1/payments');
console.log('  Body: { "orderId": "ORD-001", "amount": 499, "customer": { "name": "John", "phone": "9876543210" } }');
console.log('====================================================');
console.log('Press Ctrl+C to stop all services.\n');

// 3. Graceful shutdown
const shutdown = async () => {
  console.log('\nStopping all services...');
  for (const proc of processes) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(proc.child.pid), '/f', '/t']);
      } else {
        proc.child.kill('SIGTERM');
      }
    } catch {}
  }
  await new Promise(r => setTimeout(r, 1000));
  console.log('All services stopped.');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  shutdown();
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err.message);
  shutdown();
});
