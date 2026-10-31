#!/usr/bin/env node
// DYNAMO PAY — In-process server boot for load testing.
// Starts the Payment API the same way the test suite does (createPaymentApp),
// so load-test CI exercises the exact code path that is proven to work.
import { createPaymentApp } from '../apps/payment-api/src/index.js';

const port = Number(process.env.PAYMENT_API_PORT || 6100);
const bindHost = process.env.YOUPI_BIND_HOST || '127.0.0.1';

const app = createPaymentApp();
const server = app.rawServer;

server.listen(port, bindHost, () => {
  console.log(`[LoadServer] listening on ${bindHost}:${port}`);
});

// Allow graceful shutdown by workflow kill signal.
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

setInterval(() => {}, 1 << 30);
