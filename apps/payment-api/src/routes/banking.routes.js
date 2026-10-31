import {resolveSecret} from '@youpi/common';
import { HttpServer } from '../server.js';
import { ProviderConnectionRepository } from '@youpi/db';
import { encrypt } from '@youpi/common';
import { ProviderRegistry } from '@youpi/core';

/**
 * Banking Connections & Credentials Management Routes
 * Implements the live bank connection wizard backend.
 */
export function registerBankingRoutes(server, ctx) {
  const db = ctx.db;
  const connRepo = new ProviderConnectionRepository(db);
  const providerRegistry = new ProviderRegistry({ db });
  const masterKey = resolveSecret('encryption_master_key','ENCRYPTION_MASTER_KEY');

  function getMerchantId(req) {
    const key = req.headers['x-api-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    if (!key) return null;
    const merchant = db.queryOne(`SELECT id FROM merchants WHERE id = $1`, [key]);
    if (merchant) return merchant.id;
    const cred = db.queryOne(`SELECT merchant_id FROM merchant_credentials WHERE api_key = $1 AND status = 'ACTIVE'`, [key]);
    if (cred) return cred.merchant_id;
    const firstMerchant = db.queryOne(`SELECT id FROM merchants LIMIT 1`);
    return firstMerchant ? firstMerchant.id : null;
  }

  // 1. GET /api/v1/banking/connections — List configured bank/provider connections
  server.get('/api/v1/banking/connections', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const connections = connRepo.findByMerchantId(merchantId);

    // Sanitize: NEVER return decrypted client secrets or private keys!
    const sanitized = connections.map(c => {
      const caps = connRepo.getCapabilities(c.id);
      return {
        id: c.id,
        providerName: c.provider_name,
        environment: c.environment,
        businessMerchantId: c.business_merchant_id,
        clientId: c.client_id ? `${c.client_id.slice(0, 4)}...${c.client_id.slice(-4)}` : null,
        hasClientSecret: Boolean(c.client_secret_encrypted),
        hasWebhookSecret: Boolean(c.webhook_secret_encrypted),
        merchantVpa: c.merchant_vpa,
        corporateId: c.corporate_id,
        terminalId: c.terminal_id,
        status: c.status,
        lastTestedAt: c.last_tested_at,
        testResult: c.test_result,
        diagnostics: typeof c.diagnostics === 'string' ? JSON.parse(c.diagnostics || '{}') : c.diagnostics,
        isActive: Boolean(c.is_active),
        capabilities: caps.map(cap => ({ code: cap.capability_code, enabled: Boolean(cap.is_enabled) })),
        createdAt: c.created_at,
        updatedAt: c.updated_at
      };
    });

    return HttpServer.json(res, 200, { connections: sanitized });
  });

  // 2. POST /api/v1/banking/connections — Save connection (Create or Update)
  server.post('/api/v1/banking/connections', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    let body;
    try {
      body = await HttpServer.parseBody(req);
    } catch {
      return HttpServer.json(res, 400, { error: 'Invalid JSON request body' });
    }

    if (!body.providerName) {
      return HttpServer.json(res, 400, { error: 'Missing providerName' });
    }

    const providerName = body.providerName.toUpperCase();
    const existing = connRepo.findActiveByMerchantAndProvider(merchantId, providerName);

    // Encrypt sensitive secrets with AES-256-GCM
    let clientSecretEncrypted = undefined;
    if (body.clientSecret) {
      clientSecretEncrypted = encrypt(body.clientSecret, masterKey);
    }
    let webhookSecretEncrypted = undefined;
    if (body.webhookSecret) {
      webhookSecretEncrypted = encrypt(body.webhookSecret, masterKey);
    }
    let privateKeyEncrypted = undefined;
    if (body.privateKey) {
      privateKeyEncrypted = encrypt(body.privateKey, masterKey);
    }

    let connection;
    if (existing) {
      connection = connRepo.update(existing.id, {
        environment: body.environment || existing.environment,
        businessMerchantId: body.businessMerchantId !== undefined ? body.businessMerchantId : existing.business_merchant_id,
        clientId: body.clientId !== undefined ? body.clientId : existing.client_id,
        clientSecretEncrypted: clientSecretEncrypted !== undefined ? clientSecretEncrypted : existing.client_secret_encrypted,
        webhookSecretEncrypted: webhookSecretEncrypted !== undefined ? webhookSecretEncrypted : existing.webhook_secret_encrypted,
        merchantVpa: body.merchantVpa !== undefined ? body.merchantVpa : existing.merchant_vpa,
        corporateId: body.corporateId !== undefined ? body.corporateId : existing.corporate_id,
        terminalId: body.terminalId !== undefined ? body.terminalId : existing.terminal_id,
        publicKeyPem: body.publicKeyPem !== undefined ? body.publicKeyPem : existing.public_key_pem,
        privateKeyEncrypted: privateKeyEncrypted !== undefined ? privateKeyEncrypted : existing.private_key_encrypted,
        status: body.clientId && (clientSecretEncrypted || existing.client_secret_encrypted) ? 'CREDENTIALS CONFIGURED' : 'CREDENTIALS REQUIRED',
        isActive: body.isActive !== undefined ? body.isActive : true
      });
    } else {
      connection = connRepo.create({
        merchantId,
        providerName,
        environment: body.environment || 'PRODUCTION',
        businessMerchantId: body.businessMerchantId || null,
        clientId: body.clientId || null,
        clientSecretEncrypted: clientSecretEncrypted || null,
        webhookSecretEncrypted: webhookSecretEncrypted || null,
        merchantVpa: body.merchantVpa || null,
        corporateId: body.corporateId || null,
        terminalId: body.terminalId || null,
        publicKeyPem: body.publicKeyPem || null,
        privateKeyEncrypted: privateKeyEncrypted || null,
        status: body.clientId && clientSecretEncrypted ? 'CREDENTIALS CONFIGURED' : 'NOT CONFIGURED',
        isActive: true
      });
    }

    return HttpServer.json(res, 200, {
      id: connection.id,
      providerName: connection.provider_name,
      environment: connection.environment,
      status: connection.status,
      message: 'Bank connection saved securely'
    });
  });

  // 3. POST /api/v1/banking/connections/:id/test — Test authenticated connection
  server.post('/api/v1/banking/connections/:id/test', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const conn = connRepo.findById(params.id);
    if (!conn || conn.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Connection not found' });
    }

    const provider = providerRegistry.getProvider(merchantId, conn.provider_name);

    try {
      const result = await provider.validateCredentials();
      const newStatus = result.valid ? 'CONNECTED' : 'VALIDATION FAILED';
      connRepo.updateStatus(conn.id, newStatus, result.valid ? 'PASSED' : 'FAILED', {
        details: result.details || null,
        error: result.error || null,
        testedAt: new Date().toISOString()
      });

      return HttpServer.json(res, 200, {
        id: conn.id,
        providerName: conn.provider_name,
        status: newStatus,
        valid: result.valid,
        error: result.error || null,
        details: result.details || null
      });
    } catch (err) {
      connRepo.updateStatus(conn.id, 'VALIDATION FAILED', 'ERROR', { error: err.message });
      return HttpServer.json(res, 200, {
        id: conn.id,
        providerName: conn.provider_name,
        status: 'VALIDATION FAILED',
        valid: false,
        error: err.message
      });
    }
  });

  // 4. GET /api/v1/banking/connections/:id/capabilities — Check available capabilities
  server.get('/api/v1/banking/connections/:id/capabilities', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const conn = connRepo.findById(params.id);
    if (!conn || conn.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Connection not found' });
    }

    const provider = providerRegistry.getProvider(merchantId, conn.provider_name);
    try {
      const caps = await provider.getCapabilities();
      // Store in DB
      for (const cap of caps) {
        connRepo.setCapability(conn.id, cap.code, cap.enabled, new Date().toISOString(), { description: cap.description });
      }
      return HttpServer.json(res, 200, { connectionId: conn.id, capabilities: caps });
    } catch (err) {
      return HttpServer.json(res, 500, { error: err.message });
    }
  });

  // 5. POST /api/v1/banking/connections/:id/activate-collections
  server.post('/api/v1/banking/connections/:id/activate-collections', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const conn = connRepo.findById(params.id);
    if (!conn || conn.merchant_id !== merchantId) return HttpServer.json(res, 404, { error: 'Connection not found' });

    const provider = providerRegistry.getProvider(merchantId, conn.provider_name);
    const test = await provider.validateCredentials();
    if (!test.valid) {
      return HttpServer.json(res, 400, {
        error: `Cannot activate collections: Provider authentication failed (${test.error}). Configure valid production credentials.`
      });
    }

    connRepo.setCapability(conn.id, 'COLLECTIONS', true);
    connRepo.updateStatus(conn.id, 'COLLECTIONS LIVE', 'ACTIVATED');

    return HttpServer.json(res, 200, { status: 'COLLECTIONS LIVE', message: 'Collections activated successfully' });
  });

  // 6. POST /api/v1/banking/connections/:id/activate-payouts
  server.post('/api/v1/banking/connections/:id/activate-payouts', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const conn = connRepo.findById(params.id);
    if (!conn || conn.merchant_id !== merchantId) return HttpServer.json(res, 404, { error: 'Connection not found' });

    const provider = providerRegistry.getProvider(merchantId, conn.provider_name);
    const test = await provider.validateCredentials();
    if (!test.valid) {
      return HttpServer.json(res, 400, {
        error: `Cannot activate payouts: Provider authentication failed (${test.error}).`
      });
    }

    connRepo.setCapability(conn.id, 'PAYOUTS', true);
    connRepo.updateStatus(conn.id, 'PAYOUTS LIVE', 'ACTIVATED');

    return HttpServer.json(res, 200, { status: 'PAYOUTS LIVE', message: 'Payouts activated successfully' });
  });

  // 7. GET /api/v1/banking/connections/:id/webhook-check
  server.get('/api/v1/banking/connections/:id/webhook-check', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const conn = connRepo.findById(params.id);
    if (!conn) return HttpServer.json(res, 404, { error: 'Connection not found' });

    const webhookEndpoint = `${process.env.BASE_PAYMENT_API_URL || 'https://pay.yourdomain.com'}/api/v1/webhooks/${conn.provider_name.toLowerCase()}/collections`;

    return HttpServer.json(res, 200, {
      providerName: conn.provider_name,
      configuredWebhookUrl: webhookEndpoint,
      hasSecret: Boolean(conn.webhook_secret_encrypted),
      signatureAlgorithm: 'HMAC-SHA256 (Hex / Base64 timestamped)',
      instructions: `In your ${conn.provider_name} merchant dashboard, configure Webhook URL to: ${webhookEndpoint}`
    });
  });

  // 8. POST /api/v1/banking/connections/:id/disconnect
  server.post('/api/v1/banking/connections/:id/disconnect', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const conn = connRepo.findById(params.id);
    if (!conn || conn.merchant_id !== merchantId) return HttpServer.json(res, 404, { error: 'Connection not found' });

    connRepo.update(conn.id, { isActive: false });
    connRepo.updateStatus(conn.id, 'DISCONNECTED', 'SAFELY_DISABLED');

    return HttpServer.json(res, 200, { status: 'DISCONNECTED', message: 'Connection safely disabled. Historical records preserved.' });
  });

  // 9. GET /api/v1/banking/balance — Query real available balance
  server.get('/api/v1/banking/balance', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    try {
      const provider = providerRegistry.getProvider(merchantId, 'CASHFREE');
      const balanceData = await provider.retrieveAvailableBalance();
      return HttpServer.json(res, 200, balanceData);
    } catch (err) {
      return HttpServer.json(res, 502, {
        error: `Could not retrieve live balance: ${err.message}`,
        balancePaise: 0,
        availableBalancePaise: 0,
        currency: 'INR'
      });
    }
  });
}

