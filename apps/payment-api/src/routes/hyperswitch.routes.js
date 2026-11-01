import { HttpServer } from '../server.js';
import { toPaise } from '@youpi/common';
import { ProviderRegistry } from '@youpi/core';

export function registerHyperswitchRoutes(server, ctx) {
  const { db } = ctx;
  const registry = new ProviderRegistry({ db });

  // POST /api/v1/hyperswitch/payments — Create a Hyperswitch payment
  server.post('/api/v1/hyperswitch/payments', async (req, res) => {
    try {
      const body = await HttpServer.parseBody(req);
      const { merchantId, orderId, amount, currency = 'INR', returnUrl, customerId, customerEmail, customerPhone, customerName, idempotencyKey } = body;

      if (!merchantId || !orderId || !amount) {
        return HttpServer.json(res, 400, { error: 'merchantId, orderId and amount are required' });
      }

      const amountPaise = toPaise(amount);
      if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
        return HttpServer.json(res, 400, { error: 'amount must be a positive integer in paise' });
      }

      if (!returnUrl) {
        return HttpServer.json(res, 400, { error: 'returnUrl is required for Hyperswitch checkout' });
      }

      // Resolve Hyperswitch provider connection for this merchant
      const connections = db.query(
        'SELECT * FROM provider_connections WHERE merchant_id=? AND provider_name=\'HYPERSWITCH\' AND is_active=1',
        [merchantId]
      );
      if (connections.length === 0) {
        return HttpServer.json(res, 404, { error: 'No active Hyperswitch connection found for this merchant' });
      }
      const connection = connections[0];

      const provider = registry.getProvider(merchantId, 'HYPERSWITCH', connection.id);

      // Validate credentials before creating payment
      const credCheck = await provider.validateCredentials();
      if (!credCheck.reachable || !credCheck.authenticated) {
        return HttpServer.json(res, 502, { error: 'Hyperswitch credentials not configured or unreachable', details: credCheck });
      }

      const result = await provider.createCollection({
        merchantOrderId: orderId,
        amountPaise,
        currency,
        returnUrl,
        customerId,
        customerEmail,
        customerPhone,
        customerName,
        idempotencyKey
      });

      // Store the Hyperswitch connection reference in the payment session for webhook matching
      const metadata = JSON.stringify({
        connectionId: connection.id,
        environment: connection.environment,
        providerOrderId: result.providerOrderId,
        merchantId
      });

      db.execute(
        `INSERT INTO payment_sessions (id, merchant_id, order_id, amount_paise, currency, status, provider_name, provider_order_id, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'PROCESSING', 'HYPERSWITCH', ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET status='PROCESSING', provider_order_id=?, metadata=?, updated_at=datetime('now')`,
        [orderId, merchantId, orderId, amountPaise, currency, result.providerOrderId, metadata, result.providerOrderId, metadata]
      );

      return HttpServer.json(res, 201, {
        paymentId: orderId,
        orderId,
        amountPaise,
        currency,
        status: 'PROCESSING',
        provider: 'HYPERSWITCH',
        providerOrderId: result.providerOrderId,
        checkoutUrl: result.checkoutUrl,
        rawResponse: result.rawResponse
      });
    } catch (error) {
      console.error('[Hyperswitch create payment]', error.message);
      return HttpServer.json(res, error.httpStatus || 502, { error: error.message || 'Hyperswitch payment creation failed' });
    }
  });

  // GET /api/v1/hyperswitch/payments/:paymentId — Get payment status
  server.get('/api/v1/hyperswitch/payments/:paymentId', async (req, res, params) => {
    try {
      const { paymentId } = params;
      const { merchantId } = req.query;

      if (!paymentId) {
        return HttpServer.json(res, 400, { error: 'paymentId is required' });
      }

      const session = db.queryOne(
        'SELECT * FROM payment_sessions WHERE order_id=? AND provider_name=\'HYPERSWITCH\'',
        [paymentId]
      );
      if (!session) {
        return HttpServer.json(res, 404, { error: 'Hyperswitch payment not found' });
      }
      if (merchantId && session.merchant_id !== merchantId) {
        return HttpServer.json(res, 403, { error: 'Payment does not belong to this merchant' });
      }

      const connections = db.query(
        'SELECT * FROM provider_connections WHERE id=? AND provider_name=\'HYPERSWITCH\'',
        [session.metadata ? JSON.parse(session.metadata).connectionId : null]
      );
      if (connections.length === 0) {
        return HttpServer.json(res, 404, { error: 'Hyperswitch connection not found' });
      }

      const provider = registry.getProvider(session.merchant_id, 'HYPERSWITCH', connections[0].id);
      const status = await provider.getCollectionStatus(session.provider_order_id);

      return HttpServer.json(res, 200, {
        paymentId: session.order_id,
        orderId: session.order_id,
        amountPaise: status.amountPaise,
        currency: status.currency,
        status: status.status,
        provider: 'HYPERSWITCH',
        providerOrderId: status.providerPaymentId,
        bankReference: status.bankReference,
        paymentMethod: status.paymentMethod,
        checkoutUrl: status.checkoutUrl || null,
        rawResponse: status.rawResponse
      });
    } catch (error) {
      console.error('[Hyperswitch get status]', error.message);
      return HttpServer.json(res, error.httpStatus || 502, { error: error.message || 'Hyperswitch status check failed' });
    }
  });

  // GET /api/v1/hyperswitch/capabilities — Get provider capabilities
  server.get('/api/v1/hyperswitch/capabilities', async (req, res) => {
    try {
      const { merchantId } = req.query;
      if (!merchantId) {
        return HttpServer.json(res, 400, { error: 'merchantId is required' });
      }

      const connections = db.query(
        'SELECT * FROM provider_connections WHERE merchant_id=? AND provider_name=\'HYPERSWITCH\' AND is_active=1',
        [merchantId]
      );
      if (connections.length === 0) {
        return HttpServer.json(res, 404, { error: 'No active Hyperswitch connection found for this merchant' });
      }

      const provider = registry.getProvider(merchantId, 'HYPERSWITCH', connections[0].id);
      const capabilities = await provider.getCapabilities();

      return HttpServer.json(res, 200, {
        provider: 'HYPERSWITCH',
        environment: connections[0].environment,
        capabilities
      });
    } catch (error) {
      console.error('[Hyperswitch capabilities]', error.message);
      return HttpServer.json(res, 500, { error: error.message || 'Failed to get capabilities' });
    }
  });

  // POST /api/v1/hyperswitch/credentials/validate — Validate Hyperswitch credentials
  server.post('/api/v1/hyperswitch/credentials/validate', async (req, res) => {
    try {
      const body = await HttpServer.parseBody(req);
      const { merchantId } = body;
      if (!merchantId) {
        return HttpServer.json(res, 400, { error: 'merchantId is required' });
      }

      const connections = db.query(
        'SELECT * FROM provider_connections WHERE merchant_id=? AND provider_name=\'HYPERSWITCH\' AND is_active=1',
        [merchantId]
      );
      if (connections.length === 0) {
        return HttpServer.json(res, 404, { error: 'No active Hyperswitch connection found for this merchant' });
      }

      const provider = registry.getProvider(merchantId, 'HYPERSWITCH', connections[0].id);
      const result = await provider.validateCredentials();

      return HttpServer.json(res, 200, {
        provider: 'HYPERSWITCH',
        environment: connections[0].environment,
        ...result
      });
    } catch (error) {
      console.error('[Hyperswitch validate credentials]', error.message);
      return HttpServer.json(res, 500, { error: error.message || 'Credential validation failed' });
    }
  });
}
