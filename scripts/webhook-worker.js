#!/usr/bin/env node
// DYNAMO PAY — Webhook Worker
// Processes the transactional outbox with concurrent, per-merchant dispatch.

import { createPaymentApp } from '../apps/payment-api/src/index.js';

const app = createPaymentApp({
  // Webhook worker mode: only runs the concurrent webhook engine
  webhookWorker: true
});

const webhookEngine = app.getWebhookEngine();

// Process outbox every 5 seconds
setInterval(async () => {
  try {
    await webhookEngine.processOutbox();
  } catch (err) {
    console.error('[Webhook Worker] Outbox processing error:', err.message);
  }
}, 5000);

console.log('[Webhook Worker] Started. Processing outbox every 5s.');

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Webhook Worker] Shutting down...');
  webhookEngine.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Webhook Worker] Shutting down...');
  webhookEngine.stop();
  process.exit(0);
});
