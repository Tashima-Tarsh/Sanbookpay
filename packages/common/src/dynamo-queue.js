/**
 * DYNAMO PAY — BullMQ Job Queue
 * Production-grade job queue for payment processing and webhook retries
 * Built on Redis via ioredis
 */

import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

export class DynamoPayQueue {
  constructor(options = {}) {
    this.connection = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || 6379),
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });

    // Payment processing queue
    this.paymentQueue = new Queue('dynamo-pay-payments', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    });

    // Webhook delivery queue
    this.webhookQueue = new Queue('dynamo-pay-webhooks', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    });

    // SMS verification queue
    this.smsQueue = new Queue('dynamo-pay-sms', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 30000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    });

    // Gmail verification queue
    this.gmailQueue = new Queue('dynamo-pay-gmail', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 30000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    });
  }

  async connect() {
    await this.connection.connect();
    console.log('[DynamoPay Queue] Redis connected');
  }

  async disconnect() {
    await this.connection.quit();
    console.log('[DynamoPay Queue] Redis disconnected');
  }

  // Payment job methods
  async addPaymentJob(paymentData) {
    return await this.paymentQueue.add('process-payment', paymentData, {
      jobId: `payment-${paymentData.orderId}`,
      attempts: 3
    });
  }

  async addWebhookJob(webhookData) {
    return await this.webhookQueue.add('deliver-webhook', webhookData, {
      jobId: `webhook-${webhookData.paymentId}`
    });
  }

  async addSMSJob(smsData) {
    return await this.smsQueue.add('send-sms', smsData, {
      jobId: `sms-${smsData.phoneNumber}-${Date.now()}`
    });
  }

  async addGmailJob(gmailData) {
    return await this.gmailQueue.add('send-gmail', gmailData, {
      jobId: `gmail-${gmailData.orderId}`
    });
  }

  // Worker factory
  createPaymentWorker(handler) {
    return new Worker('dynamo-pay-payments', async (job) => {
      return await handler(job.data);
    }, {
      connection: this.connection,
      concurrency: 10
    });
  }

  createWebhookWorker(handler) {
    return new Worker('dynamo-pay-webhooks', async (job) => {
      return await handler(job.data);
    }, {
      connection: this.connection,
      concurrency: 20
    });
  }

  createSMSWorker(handler) {
    return new Worker('dynamo-pay-sms', async (job) => {
      return await handler(job.data);
    }, {
      connection: this.connection,
      concurrency: 5
    });
  }

  createGmailWorker(handler) {
    return new Worker('dynamo-pay-gmail', async (job) => {
      return await handler(job.data);
    }, {
      connection: this.connection,
      concurrency: 5
    });
  }
}

export default DynamoPayQueue;
