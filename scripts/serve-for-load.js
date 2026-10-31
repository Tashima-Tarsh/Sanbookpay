#!/usr/bin/env node
// DYNAMO PAY — In-process server boot for load testing.
// Starts the Payment API the same way the test suite does (createPaymentApp),
// so load-test CI exercises the exact code path that is proven to work.
import crypto from 'node:crypto';

// Full test mode defaults before the app module is imported (validate-env.js
// requires these in every environment; the values are test-only placeholders).
process.env.NODE_ENV ??= 'test';
process.env.YOUPI_MODE ??= 'localhost';
process.env.INITIAL_ADMIN_EMAIL ??= 'admin@loadtest.example';
process.env.INITIAL_ADMIN_PASSWORD ??= crypto.randomBytes(24).toString('hex');
process.env.ENCRYPTION_MASTER_KEY ??= crypto.randomBytes(32).toString('hex');
process.env.JWT_SECRET ??= crypto.randomBytes(32).toString('hex');
process.env.BASE_CHECKOUT_URL ??= 'http://localhost:7000';
process.env.BASE_PAYMENT_API_URL ??= 'http://localhost:6100';

const { createPaymentApp } = await import('../apps/payment-api/src/index.js');

const port = Number(process.env.PAYMENT_API_PORT || 6100);
const bindHost = process.env.YOUPI_BIND_HOST || '127.0.0.1';

const app = createPaymentApp();
const server = app.rawServer;

server.listen(port, bindHost, () => {
  console.log(`[LoadServer] listening on ${bindHost}:${port}`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

setInterval(() => {}, 1 << 30);
