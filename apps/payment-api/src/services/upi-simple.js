import crypto from 'node:crypto';
import { validateOutboundWebhookUrl, generateHmac, isValidVpa, toPaise, buildUpiPaymentUri } from '@youpi/common';

const now = () => new Date().toISOString();

function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}

export function createUpiSimpleService(ctx) {
  const { db } = ctx;

  db.execute(`CREATE TABLE IF NOT EXISTS upi_simple_merchants (
    id TEXT PRIMARY KEY,
    upi_vpa TEXT NOT NULL UNIQUE,
    callback_url TEXT,
    callback_secret TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  db.execute(`CREATE TABLE IF NOT EXISTS upi_simple_orders (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'PENDING',
    callback_url TEXT,
    upi_vpa TEXT NOT NULL,
    utr TEXT,
    sender_vpa TEXT,
    qr_uri TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE(merchant_id, order_id)
  )`);

  db.execute(`CREATE TABLE IF NOT EXISTS upi_simple_observations (
    id TEXT PRIMARY KEY,
    order_id TEXT,
    merchant_id TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    utr TEXT NOT NULL,
    sender_vpa TEXT,
    source TEXT NOT NULL,
    raw_text TEXT,
    received_at TEXT NOT NULL,
    matched INTEGER NOT NULL DEFAULT 0
  )`);

  db.execute(`CREATE INDEX IF NOT EXISTS upi_simple_orders_merchant_status ON upi_simple_orders(merchant_id, status)`);
  db.execute(`CREATE INDEX IF NOT EXISTS upi_simple_observations_utr ON upi_simple_observations(utr)`);

  async function sendCallback(order, observation) {
    const callbackUrl = order.callback_url;
    if (!callbackUrl) return { sent: false, reason: 'no callback url' };

    const check = validateOutboundWebhookUrl(callbackUrl);
    if (!check.valid) return { sent: false, reason: 'invalid callback url' };

    const payload = {
      event: 'PAYMENT_SUCCESS',
      orderId: order.order_id,
      paymentId: order.id,
      amount: toRupeesString(order.amount_paise),
      amountPaise: order.amount_paise,
      currency: order.currency,
      status: 'SUCCESS',
      utr: observation.utr,
      senderVpa: observation.sender_vpa || null,
      payeeVpa: order.upi_vpa,
      completedAt: now(),
      source: observation.source
    };

    const payloadString = JSON.stringify(payload);
    const signature = generateHmac(payloadString, order.callback_secret || '');

    try {
      const response = await fetch(check.url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Event': 'PAYMENT_SUCCESS',
          'X-Gateway-Signature': 'sha256=' + signature,
          'X-Gateway-Delivery-Id': order.id,
          'X-Gateway-Timestamp': String(Date.now())
        },
        body: payloadString
      });
      return { sent: response.ok, status: response.status, url: check.url.toString() };
    } catch (error) {
      return { sent: false, error: error.message, url: check.url.toString() };
    }
  }

  function toRupeesString(paise) {
    const p = BigInt(paise);
    const whole = p / 100n;
    const fraction = p % 100n;
    return `${whole}.${fraction.toString().padStart(2, '0')}`;
  }

  return {
    registerMerchant(merchantId, upiVpa, callbackUrl, webhookSecret) {
      if (!isValidVpa(upiVpa)) fail('Invalid UPI VPA');
      if (callbackUrl) {
        const check = validateOutboundWebhookUrl(callbackUrl);
        if (!check.valid) fail('Invalid callback URL');
      }
      const id = merchantId;
      const secret = webhookSecret || crypto.randomBytes(32).toString('base64url');
      return db.transaction(() => {
        db.execute(
          'INSERT INTO upi_simple_merchants (id, upi_vpa, callback_url, callback_secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET upi_vpa=excluded.upi_vpa, callback_url=excluded.callback_url, callback_secret=excluded.callback_secret, updated_at=excluded.updated_at',
          [id, upiVpa.trim().toLowerCase(), callbackUrl || null, secret, now(), now()]
        );
        return { id, upiVpa: upiVpa.trim().toLowerCase(), callbackUrl: callbackUrl || null, secret };
      });
    },

    getMerchant(merchantId) {
      const row = db.queryOne('SELECT * FROM upi_simple_merchants WHERE id = ?', [merchantId]);
      if (!row) fail('Merchant not found', 404);
      return { id: row.id, upiVpa: row.upi_vpa, callbackUrl: row.callback_url, secret: row.callback_secret };
    },

    getMerchantByVpa(upiVpa) {
      const row = db.queryOne('SELECT * FROM upi_simple_merchants WHERE upi_vpa = ?', [upiVpa.trim().toLowerCase()]);
      if (!row) fail('UPI VPA not registered', 404);
      return { id: row.id, upiVpa: row.upi_vpa, callbackUrl: row.callback_url, secret: row.callback_secret };
    },

    setupMerchantFromPlatform(merchantId, upiVpa, callbackUrl, businessName, contactEmail, contactPhone, webhookSecret) {
      if (!isValidVpa(upiVpa)) fail('Invalid UPI VPA');
      if (!callbackUrl) fail('Callback URL is required');
      const check = validateOutboundWebhookUrl(callbackUrl);
      if (!check.valid) fail('Invalid callback URL');
      const id = merchantId;
      const secret = webhookSecret || crypto.randomBytes(32).toString('base64url');
      const accessToken = crypto.randomBytes(32).toString('base64url');
      return db.transaction(() => {
        db.execute(
          'INSERT INTO upi_simple_merchants (id, upi_vpa, callback_url, callback_secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET upi_vpa=excluded.upi_vpa, callback_url=excluded.callback_url, callback_secret=excluded.callback_secret, updated_at=excluded.updated_at',
          [id, upiVpa.trim().toLowerCase(), callbackUrl, secret, now(), now()]
        );
        return {
          merchantId: id,
          businessName: businessName || 'Merchant',
          upiVpa: upiVpa.trim().toLowerCase(),
          callbackUrl,
          webhookSecret: secret,
          accessToken,
          accessLink: `/merchant/${id}`,
          apiBaseUrl: process.env.DYNAMO_PUBLIC_URL || 'http://localhost:6100',
          createdAt: now()
        };
      });
    },

    createOrder({ merchantId, orderId, amount, currency = 'INR', callbackUrl }) {
      const paise = toPaise(amount);
      const merchant = db.queryOne('SELECT * FROM upi_simple_merchants WHERE id = ?', [merchantId]);
      if (!merchant) fail('Merchant not found', 404);

      const finalCallbackUrl = callbackUrl || merchant.callback_url;
      if (finalCallbackUrl) {
        const check = validateOutboundWebhookUrl(finalCallbackUrl);
        if (!check.valid) fail('Invalid callback URL');
      }

      const id = crypto.randomUUID();
      const qrUri = buildUpiPaymentUri({
        vpa: merchant.upi_vpa,
        name: 'Merchant',
        amount: Number(paise) / 100,
        orderId,
        note: `Payment ${orderId}`
      });

      return db.transaction(() => {
        db.execute(
          `INSERT INTO upi_simple_orders (id, merchant_id, order_id, amount_paise, currency, status, callback_url, upi_vpa, qr_uri, created_at)
           VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`,
          [id, merchantId, orderId, Number(paise), currency, finalCallbackUrl || null, merchant.upi_vpa, qrUri, now()]
        );
        return {
          id,
          orderId,
          amountPaise: Number(paise),
          currency,
          status: 'PENDING',
          upiVpa: merchant.upi_vpa,
          qrUri,
          callbackUrl: finalCallbackUrl || null
        };
      });
    },

    getOrder(merchantId, orderId) {
      const row = db.queryOne('SELECT * FROM upi_simple_orders WHERE merchant_id = ? AND order_id = ?', [merchantId, orderId]);
      if (!row) fail('Order not found', 404);
      return {
        id: row.id,
        orderId: row.order_id,
        amountPaise: row.amount_paise,
        currency: row.currency,
        status: row.status,
        upiVpa: row.upi_vpa,
        utr: row.utr || null,
        senderVpa: row.sender_vpa || null,
        qrUri: row.qr_uri,
        callbackUrl: row.callback_url || null,
        createdAt: row.created_at,
        completedAt: row.completed_at || null
      };
    },

    listOrders(merchantId, limit = 50) {
      const rows = db.query('SELECT * FROM upi_simple_orders WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?', [merchantId, limit]);
      return rows.map(row => ({
        id: row.id,
        orderId: row.order_id,
        amountPaise: row.amount_paise,
        status: row.status,
        upiVpa: row.upi_vpa,
        utr: row.utr || null,
        createdAt: row.created_at
      }));
    },

    async recordObservation({ merchantId, orderId, amountPaise, utr, senderVpa, source, rawText }) {
      if (!utr || !/^\d{12}$/.test(String(utr))) fail('Invalid UTR (12 digits required)');
      const paise = Number(amountPaise);
      if (!Number.isSafeInteger(paise) || paise <= 0) fail('Invalid amount');

      const observationId = crypto.randomUUID();

      let callbackData = null;

      const result = db.transaction(() => {
        let order = null;
        if (orderId) {
          order = db.queryOne('SELECT * FROM upi_simple_orders WHERE merchant_id = ? AND order_id = ?', [merchantId, orderId]);
        }

        if (!order) {
          order = db.queryOne(
            'SELECT * FROM upi_simple_orders WHERE merchant_id = ? AND amount_paise = ? AND status = ? ORDER BY created_at ASC LIMIT 1',
            [merchantId, paise, 'PENDING']
          );
        }

        if (!order) {
          db.execute(
            `INSERT INTO upi_simple_observations (id, merchant_id, amount_paise, utr, sender_vpa, source, raw_text, received_at, matched)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [observationId, merchantId, paise, utr, senderVpa || null, source, rawText || null, now()]
          );
          return { matched: false, observationId, reason: 'No matching pending order' };
        }

        if (order.status !== 'PENDING') {
          db.execute(
            `INSERT INTO upi_simple_observations (id, order_id, merchant_id, amount_paise, utr, sender_vpa, source, raw_text, received_at, matched)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [observationId, order.id, merchantId, paise, utr, senderVpa || null, source, rawText || null, now()]
          );
          return { matched: false, orderId: order.order_id, status: order.status, reason: 'Order already processed' };
        }

        const merchantRow = db.queryOne('SELECT * FROM upi_simple_merchants WHERE id = ?', [merchantId]);
        const completedAt = now();

        db.execute(
          `INSERT INTO upi_simple_observations (id, order_id, merchant_id, amount_paise, utr, sender_vpa, source, raw_text, received_at, matched)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [observationId, order.id, merchantId, paise, utr, senderVpa || null, source, rawText || null, now()]
        );

        db.execute(
          `UPDATE upi_simple_orders SET status = 'SUCCESS', utr = ?, sender_vpa = ?, completed_at = ? WHERE id = ?`,
          [utr, senderVpa || null, completedAt, order.id]
        );

        callbackData = {
          order: { ...order, callback_url: order.callback_url, callback_secret: merchantRow ? merchantRow.callback_secret : '' },
          observation: { utr, senderVpa, source }
        };

        return { matched: true, orderId: order.order_id, status: 'SUCCESS', utr };
      });

      if (callbackData) {
        try {
          const callbackResult = await sendCallback(callbackData.order, callbackData.observation);
          result.callback = callbackResult;
        } catch (e) {
          result.callback = { sent: false, error: e.message };
        }
      }

      return result;
    }
  };
}
