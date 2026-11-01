'use strict';

const express = require('express');
const { get: dbGet, all: dbAll, run: dbRun } = require('../db');
const { reconcile } = require('../reconcile');

const router = express.Router();
router.use(express.json());

const rateLimit = require('express-rate-limit');
const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });

router.use(adminLimiter);

router.get('/unmatched', async (req, res) => {
  const rows = await dbAll(
    `SELECT se.* FROM sms_events se
     LEFT JOIN orders o ON o.order_id = se.matched_order_id
     WHERE se.status = 'unmatched' OR (se.status = 'received' AND se.parsed = 1 AND se.matched_order_id IS NULL)
     ORDER BY se.received_at DESC LIMIT 200`
  );
  return res.status(200).json({ unmatched: rows });
});

router.post('/match', async (req, res) => {
  const { unmatched_id, order_id } = req.body;
  if (!unmatched_id || !order_id) {
    return res.status(400).json({ error: 'unmatched_id and order_id required' });
  }

  const order = await dbGet('SELECT * FROM orders WHERE order_id = ?', [order_id]);
  if (!order) return res.status(404).json({ error: 'order_not_found' });

  await dbRun("UPDATE sms_events SET status = 'matched', matched_order_id = ? WHERE id = ?", [order_id, unmatched_id]);
  await dbRun("UPDATE orders SET paid_sms = 1, status = 'paid_sms', matched_sms_id = ?, updated_at = datetime('now') WHERE order_id = ?", [unmatched_id, order_id]);
  return res.status(200).json({ status: 'matched' });
});

router.get('/health', async (req, res) => {
  const lastSms = await dbGet('SELECT MAX(received_at) as last_sms_at FROM sms_events');
  const { queueDepth } = require('../notify');
  const row = await dbAll('SELECT COUNT(*) as c FROM sms_events WHERE received_at >= datetime("now", "-10 minutes")');
  const recent = row[0] ? row[0].c : 0;
  return res.status(200).json({
    ok: recent > 0,
    last_sms_at: lastSms ? lastSms.last_sms_at : null,
    queue_depth: queueDepth(),
    recent_sms_10m: recent,
  });
});

router.post('/reconcile', async (req, res) => {
  const result = await reconcile();
  return res.status(200).json(result);
});

module.exports = router;
