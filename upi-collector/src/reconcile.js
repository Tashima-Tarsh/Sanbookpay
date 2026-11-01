'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const { get: dbGet, run: dbRun, all: dbAll, log: dbLog } = require('./db');

const STATEMENT_DIR = path.join(__dirname, '..', 'data', 'statements');
if (!fs.existsSync(STATEMENT_DIR)) {
  fs.mkdirSync(STATEMENT_DIR, { recursive: true });
}

function parseAmountFromCsv(value) {
  if (value == null) return null;
  const s = String(value).replace(/,/g, '').replace(/₹/g, '').replace(/INR/i, '').trim();
  const num = Number(s);
  if (!Number.isFinite(num)) return null;
  return num.toFixed(2);
}

function extractUtr(text) {
  if (!text) return null;
  const m = String(text).match(/\b(\d{12})\b/);
  return m ? m[1] : null;
}

async function importCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
  const imported = [];

  for (const rec of records) {
    const date = rec.date || rec.Date || rec['Transaction Date'] || new Date().toISOString();
    const amount = parseAmountFromCsv(rec.amount || rec.Amount || rec['Credit Amount'] || rec.amt);
    const utr = extractUtr(rec.utr || rec.UTR || rec['UTR/Ref No'] || rec.Remarks || rec.narration || rec.description || '');
    const sender = rec.sender || rec.Sender || 'STATEMENT';
    const body = rec.body || rec.Body || rec.Narration || rec.description || rec['Transaction Details'] || '';
    const id = 'stmt_' + crypto.randomBytes(8).toString('hex');

    if (utr) {
      const existing = await dbGet('SELECT id FROM sms_events WHERE utr = ? AND utr IS NOT NULL AND utr <> ?', [utr, '']);
      if (existing) continue;
    }

    await dbRun(
      'INSERT INTO sms_events (id, device_id, sender, body, ts, received_at, parsed, amount, utr, vpa, status, matched_order_id, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, 'statement-import', sender, body, date, new Date().toISOString(), amount ? 1 : 0, amount, utr, null, 'received', null, null]
    );
    imported.push({ id, amount, utr, sender });
  }

  await dbLog('info', 'statement imported', { file: filePath, count: imported.length });
  return imported;
}

async function reconcile() {
  const rows = await dbAll(
    `SELECT se.id, se.amount, se.utr, se.body, se.sender,
            o.order_id, o.amount as order_amount, o.status as order_status
     FROM sms_events se
     LEFT JOIN orders o ON o.order_id = se.matched_order_id
     WHERE se.parsed = 1 AND se.utr IS NOT NULL AND se.status = 'received'`
  );

  let matched = 0;
  for (const row of rows) {
    const orderAmount = Number(row.order_amount || 0);
    const smsAmount = Number(row.amount || 0);
    if (orderAmount === smsAmount && row.order_status === 'open') {
      await dbRun("UPDATE orders SET paid_sms = 1, status = 'paid_sms', matched_sms_id = ?, updated_at = datetime('now') WHERE order_id = ?", [row.id, row.order_id]);
      await dbRun("UPDATE sms_events SET status = 'matched', matched_order_id = ? WHERE id = ?", [row.order_id, row.id]);
      matched++;
    }
  }

  await dbLog('info', 'reconcile complete', { matched });
  return { matched };
}

async function verifySmsAgainstStatement(orderId, statementFile) {
  const imported = await importCsv(statementFile);
  const order = await dbGet('SELECT * FROM orders WHERE order_id = ?', [orderId]);
  if (!order) return { error: 'order_not_found' };

  const hit = imported.find((r) => r.amount === order.amount && r.utr);
  if (hit) {
    await dbRun("UPDATE orders SET paid_verified = 1, status = 'paid', updated_at = datetime('now') WHERE order_id = ?", [orderId]);
    await dbRun("UPDATE sms_events SET status = 'verified' WHERE id = ?", [hit.id]);
    return { verified: true, orderId, utr: hit.utr };
  }
  return { verified: false, orderId };
}

module.exports = { importCsv, reconcile, verifySmsAgainstStatement };
