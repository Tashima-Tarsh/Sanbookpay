'use strict';

const { initDb, run: dbRun } = require('../src/db');

async function main() {
  await initDb();

  const orders = [
    { order_id: 'ORD-2026-001', amount: '300.00', payer_email: 'payer1@example.com', payer_phone: '+919876543210' },
    { order_id: 'ORD-2026-002', amount: '150.00', payer_email: 'payer2@example.com', payer_phone: '+919876543211' },
    { order_id: 'ORD-2026-003', amount: '500.00', payer_email: null, payer_phone: '+919876543212' },
  ];

  for (const o of orders) {
    const id = require('crypto').randomBytes(16).toString('hex');
    const upiNote = 'UPI-' + require('crypto').randomBytes(6).toString('hex').toUpperCase();
    await dbRun(
      'INSERT OR IGNORE INTO orders (id, order_id, amount, currency, payer_email, payer_phone, upi_note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))',
      [id, o.order_id, o.amount, 'INR', o.payer_email, o.payer_phone, upiNote, 'open']
    );
    console.log(`Seeded order ${o.order_id} (upi_note: ${upiNote})`);
  }

  console.log('Seed complete.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
