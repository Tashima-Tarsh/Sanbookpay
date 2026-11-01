'use strict';

const express = require('express');
const { run: dbRun, get: dbGet, all: dbAll } = require('../db');

const router = express.Router();
router.use(express.json());

function genId() {
  return require('crypto').randomBytes(16).toString('hex');
}

router.post('/', async (req, res) => {
  const { order_id, amount, payer_email, payer_phone } = req.body;
  if (!order_id || !amount) {
    return res.status(400).json({ error: 'order_id and amount required' });
  }

  const num = Number(amount);
  if (!Number.isFinite(num) || num <= 0) {
    return res.status(400).json({ error: 'invalid amount' });
  }

  const id = genId();
  const upi_note = 'UPI-' + require('crypto').randomBytes(6).toString('hex').toUpperCase();

  await dbRun(
    'INSERT INTO orders (id, order_id, amount, currency, payer_email, payer_phone, upi_note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))',
    [id, order_id, num.toFixed(2), 'INR', payer_email || null, payer_phone || null, upi_note, 'open']
  );

  return res.status(201).json({
    id,
    order_id,
    amount: num.toFixed(2),
    currency: 'INR',
    upi_note,
    status: 'open',
    upi_uri: `upi://pay?pa=YOUR_VPA&pn=Merchant&am=${num.toFixed(2)}&tn=${upi_note}`,
  });
});

router.get('/', async (req, res) => {
  const rows = await dbAll('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100');
  return res.status(200).json({ orders: rows });
});

router.get('/:order_id', async (req, res) => {
  const row = await dbGet('SELECT * FROM orders WHERE order_id = ?', [req.params.order_id]);
  if (!row) return res.status(404).json({ error: 'order_not_found' });
  return res.status(200).json({ order: row });
});

router.post('/:order_id/close', async (req, res) => {
  const row = await dbGet('SELECT * FROM orders WHERE order_id = ?', [req.params.order_id]);
  if (!row) return res.status(404).json({ error: 'order_not_found' });
  await dbRun("UPDATE orders SET status = 'closed', updated_at = datetime('now') WHERE order_id = ?", [req.params.order_id]);
  return res.status(200).json({ status: 'closed' });
});

module.exports = router;
