import { HttpServer } from '../server.js';

export function registerUpiSimpleRoutes(server, ctx) {
  const base = '/api/v1/upi';
  const upiSimple = ctx.upiSimple;

  function requireMerchant(req) {
    const merchantId = req.headers['x-merchant-id'];
    if (!merchantId) {
      throw Object.assign(new Error('X-Merchant-Id header required'), { statusCode: 401 });
    }
    return upiSimple.getMerchant(merchantId);
  }

  function requireMerchantSecret(req) {
    const merchantId = req.headers['x-merchant-id'];
    const secret = req.headers['x-merchant-secret'];
    if (!merchantId || !secret) {
      throw Object.assign(new Error('X-Merchant-Id and X-Merchant-Secret headers required'), { statusCode: 401 });
    }
    const merchant = upiSimple.getMerchant(merchantId);
    const crypto = require('node:crypto');
    const expected = merchant.secret;
    const a = Buffer.from(String(secret || ''));
    const b = Buffer.from(String(expected || ''));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw Object.assign(new Error('Invalid merchant secret'), { statusCode: 401 });
    }
    return merchant;
  }

  server.post(`${base}/orders`, async (req, res) => {
    try {
      const merchant = requireMerchant(req);
      const body = await HttpServer.parseBody(req);
      const { orderId, amount, currency, callbackUrl } = body;
      if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
        return HttpServer.json(res, 400, { error: 'orderId is required' });
      }
      if (!amount) {
        return HttpServer.json(res, 400, { error: 'amount is required' });
      }
      const result = upiSimple.createOrder({
        merchantId: merchant.id,
        orderId: orderId.trim(),
        amount,
        currency,
        callbackUrl
      });
      return HttpServer.json(res, 201, result);
    } catch (error) {
      return HttpServer.json(res, error.statusCode || 500, { error: error.message });
    }
  });

  server.get(`${base}/orders/:orderId`, async (req, res, params) => {
    try {
      const merchant = requireMerchant(req);
      const result = upiSimple.getOrder(merchant.id, params.orderId);
      return HttpServer.json(res, 200, result);
    } catch (error) {
      return HttpServer.json(res, error.statusCode || 500, { error: error.message });
    }
  });

  server.get(`${base}/orders`, async (req, res) => {
    try {
      const merchant = requireMerchant(req);
      const limit = Number(req.query.limit) || 50;
      const result = upiSimple.listOrders(merchant.id, limit);
      return HttpServer.json(res, 200, { orders: result });
    } catch (error) {
      return HttpServer.json(res, error.statusCode || 500, { error: error.message });
    }
  });

  server.post(`${base}/merchant/register`, async (req, res) => {
    try {
      const body = await HttpServer.parseBody(req);
      const { merchantId, upiVpa, callbackUrl } = body;
      if (!merchantId || !upiVpa) {
        return HttpServer.json(res, 400, { error: 'merchantId and upiVpa are required' });
      }
      const result = upiSimple.registerMerchant(merchantId, upiVpa, callbackUrl);
      return HttpServer.json(res, 201, result);
    } catch (error) {
      return HttpServer.json(res, error.statusCode || 500, { error: error.message });
    }
  });

  server.post(`${base}/notify`, async (req, res) => {
    try {
      const merchant = requireMerchantSecret(req);
      const body = await HttpServer.parseBody(req);
      const { orderId, amountPaise, utr, senderVpa, source, rawText } = body;
      if (!amountPaise) {
        return HttpServer.json(res, 400, { error: 'amountPaise is required' });
      }
      if (!utr) {
        return HttpServer.json(res, 400, { error: 'utr is required' });
      }
      const result = await upiSimple.recordObservation({
        merchantId: merchant.id,
        orderId: orderId || null,
        amountPaise,
        utr,
        senderVpa: senderVpa || null,
        source: source || 'OBSERVER',
        rawText: rawText || null
      });
      return HttpServer.json(res, 200, result);
    } catch (error) {
      return HttpServer.json(res, error.statusCode || 500, { error: error.message });
    }
  });

  server.get(`${base}/merchant`, async (req, res) => {
    try {
      const merchant = requireMerchant(req);
      return HttpServer.json(res, 200, {
        id: merchant.id,
        upiVpa: merchant.upiVpa,
        callbackUrl: merchant.callbackUrl
      });
    } catch (error) {
      return HttpServer.json(res, error.statusCode || 500, { error: error.message });
    }
  });
}
