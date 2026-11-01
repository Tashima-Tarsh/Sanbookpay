'use strict';

const express = require('express');
const { parseSms } = require('../parse');
const { get: dbGet, run: dbRun, all: dbAll } = require('../db');
const { verifyMiddleware } = require('../verify');
const { alertMerchant } = require('../notify');

const router = express.Router();
router.use(express.raw({ type: '*/*', limit: '64kb' }));

router.use((req, res, next) => {
  if (Buffer.isBuffer(req.body)) req.rawBody = req.body;
  next();
});

router.use(verifyMiddleware);

router.post('/', async (req, res) => {
  const start = Date.now();

  let payload;
  try {
    payload = JSON.parse(req.rawBody.toString('utf8'));
  } catch (e) {
    const id = require('crypto').randomBytes(16).toString('hex');
    await dbRun('INSERT INTO sms_events (id, device_id, sender, body, ts, received_at, parsed, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, 'unknown', 'unknown', req.rawBody.toString('utf8').slice(0, 4000), new Date().toISOString(), new Date().toISOString(), 0, 'unparsed', 'invalid_json']);
    return res.status(200).json({ status: 'accepted' });
  }

  const ts = payload.ts;
  if (ts) {
    const tsMs = Date.parse(ts);
    if (isNaN(tsMs) || Date.now() - tsMs > 5 * 60 * 1000) {
      return res.status(401).json({ error: 'stale_timestamp' });
    }
  }

  const sender = payload.sender;
  const body = payload.body;
  const deviceId = payload.device_id || 'unknown';

  const parsed = parseSms(sender, body);

  if (parsed.sender_not_allowed) {
    const id = require('crypto').randomBytes(16).toString('hex');
    await dbRun('INSERT INTO sms_events (id, device_id, sender, body, ts, received_at, parsed, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, deviceId, sender, body, ts || new Date().toISOString(), new Date().toISOString(), 0, 'rejected', 'sender_not_allowed']);
    return res.status(422).json({ error: 'sender_not_allowed' });
  }

  if (parsed.unparsed) {
    const id = require('crypto').randomBytes(16).toString('hex');
    await dbRun('INSERT INTO sms_events (id, device_id, sender, body, ts, received_at, parsed, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, deviceId, sender, body, ts || new Date().toISOString(), new Date().toISOString(), 0, 'unparsed', 'unparseable']);
    return res.status(200).json({ status: 'accepted' });
  }

  const { amount, utr } = parsed;

  const existing = await dbGet('SELECT id FROM sms_events WHERE utr = ? AND utr IS NOT NULL AND utr <> ?', [utr, '']);
  if (existing) {
    return res.status(200).json({ status: 'accepted' });
  }

  const id = require('crypto').randomBytes(16).toString('hex');
  const note = parsed.note || null;
  const vpa = parsed.vpa || null;

  await dbRun(
    'INSERT INTO sms_events (id, device_id, sender, body, ts, received_at, parsed, amount, utr, vpa, status, matched_order_id, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, deviceId, sender, body, ts || new Date().toISOString(), new Date().toISOString(), 1, amount, utr, vpa, 'received', null, null]
  );

  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const openOrders = await dbAll("SELECT * FROM orders WHERE status = 'open' AND created_at >= ?", [thirtyMinAgo]);

  let matchedOrder = null;
  for (const order of openOrders) {
    if (Number(order.amount) !== Number(amount)) continue;
    if (note && order.upi_note && String(order.upi_note).includes(note)) {
      matchedOrder = order;
      break;
    }
    if (!note && order.order_id && String(body).includes(order.order_id)) {
      matchedOrder = order;
      break;
    }
  }

  if (matchedOrder) {
    await dbRun("UPDATE orders SET paid_sms = 1, status = 'paid_sms', matched_sms_id = ?, updated_at = datetime('now') WHERE order_id = ?", [id, matchedOrder.order_id]);
    await dbRun("UPDATE sms_events SET status = 'matched', matched_order_id = ? WHERE id = ?", [matchedOrder.order_id, id]);
    alertMerchant(matchedOrder, { id, sender, body, ts: ts || new Date().toISOString(), amount, utr, vpa });
  }

  return res.status(200).json({ status: 'accepted' });
});

module.exports = router;
