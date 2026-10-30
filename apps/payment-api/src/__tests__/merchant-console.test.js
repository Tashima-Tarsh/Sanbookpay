import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Database, runMigrations, MerchantRepository, PaymentSessionRepository, AuditLogRepository, PaymentOrderRepository } from '@youpi/db';
import { registerAdminRoutes } from '../routes/admin.routes.js';
import { HttpServer } from '../server.js';
import { authGuard } from '../auth-guard.js';
import { registerMerchantConsoleRoutes, allocateRecipients } from '../routes/merchant-console.routes.js';
import { TEST_ADMIN_TOKEN } from '../../../../scripts/test-support.js';
let db, server, base, merchant, sessions, events;
before(async () => {
  db = new Database({ inMemory: true }); runMigrations(db);
  const merchantRepo = new MerchantRepository(db); merchant = merchantRepo.getDefault();
  sessions = new PaymentSessionRepository(db);
  const router = new HttpServer(); router.use(authGuard);
  events = new EventEmitter();
  registerMerchantConsoleRoutes(router, { db, merchantRepo, sessionRepo: sessions, eventEmitter:events });
  registerAdminRoutes(router,{ db,merchantRepo,sessionRepo:sessions,auditRepo:new AuditLogRepository(db) });
  server = router.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1/admin/console`;
});
after(async () => { if(server) await new Promise(r => server.close(r)); db?.close(); });
async function call(path, body) {
  return fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${TEST_ADMIN_TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}
test('recipient rounding preserves every paise', () => {
  const result = allocateRecipients(101, [{ name: 'A', vpa: 'alice@upi', shareBps: 5000 }, { name: 'B', vpa: 'bob@upi', shareBps: 5000 }]);
  assert.equal(result.reduce((n,r) => n + r.amountPaise, 0), 101);
  assert.throws(() => allocateRecipients(100, [{ shareBps: 9999 }]), /100%/);
});
test('console is protected and summary uses all payments in paise, excluding COD from paid volume', async () => {
  assert.equal((await fetch(base + '/summary')).status, 401);
  sessions.create({ merchantId: merchant.id, orderId: 'UPI', amountPaise: 12345, status: 'SUCCESS' });
  sessions.create({ merchantId: merchant.id, orderId: 'COD', amountPaise: 50000, method: 'COD', status: 'SUCCESS' });
  const data = await (await call('/summary')).json();
  assert.equal(data.collectedPaise, 12345); assert.equal(data.total, 2);
});
test('split configuration validates recipients and persists both modes', async () => {
  assert.equal((await call('/splits', { platformFeeBps: 500, gstPercent: 18, recipients: [{ name: 'A', vpa: 'alice@upi', shareBps: 5000 }] })).status, 400);
  const res = await call('/splits', { platformFeeBps: 500, gstPercent: 18, recipients: [{ name: 'A', vpa: 'alice@upi', shareBps: 6000 }, { name: 'B', vpa: 'bob@upi', shareBps: 4000 }] });
  assert.equal(res.status, 200);
  const saved = await (await call('/splits')).json(); assert.equal(saved.recipients.length, 2); assert.equal(saved.platformFeeBps, 500);
});
test('refund requests reject over-refunds and unpaid COD and remain pending bank action', async () => {
  assert.equal((await call('/refunds', { paymentId: 'COD', amount: '10', reason: 'Return' })).status, 400);
  let res = await call('/refunds', { paymentId: 'UPI', amount: '100', reason: 'Return' });
  assert.equal(res.status, 201); assert.equal((await res.json()).status, 'PENDING_MANUAL');
  assert.equal((await call('/refunds', { paymentId: 'UPI', amount: '30', reason: 'Return' })).status, 400);
  assert.equal((await call('/refunds', { paymentId: 'UPI', amount: 'NaN', reason: 'Return' })).status, 400);
});
test('verified payment allocates net proceeds exactly once; recipient transfers need references',async()=>{
  const p=sessions.create({merchantId:merchant.id,orderId:'SPLIT',amountPaise:10101,status:'SUCCESS'});
  events.emit('PAYMENT.SUCCESS',{paymentId:p.id});events.emit('PAYMENT.SUCCESS',{paymentId:p.id});
  const rows=(await (await call('/allocations')).json()).allocations;
  assert.equal(rows.length,1);
  const a=rows[0];assert.equal(a.gross_paise,a.fee_paise+a.gst_paise+a.recipients.reduce((n,r)=>n+r.amountPaise,0));
  assert.equal((await call(`/allocations/${p.id}/transfer`,{vpa:'alice@upi',bankReference:'x'})).status,400);
  assert.equal((await call(`/allocations/${p.id}/transfer`,{vpa:'alice@upi',bankReference:'BANK-12345'})).status,200);
  assert.equal((await call(`/allocations/${p.id}/transfer`,{vpa:'alice@upi',bankReference:'BANK-12345'})).status,400);
  assert.equal((await call(`/allocations/${p.id}/transfer`,{vpa:'bob@upi',bankReference:'BANK-67890'})).status,200);
  assert.equal((await (await call('/allocations')).json()).allocations[0].status,'MANUALLY_CONFIRMED');
});
test('rounding never allocates more money than a one-paise payment',async()=>{
  assert.equal((await call('/splits',{platformFeeBps:5000,gstPercent:100,recipients:[{name:'Alice',vpa:'alice@upi',shareBps:10000}]})).status,200);
  const p=sessions.create({merchantId:merchant.id,orderId:'TINY',amountPaise:1,status:'SUCCESS'});
  events.emit('PAYMENT.SUCCESS',{paymentId:p.id});
  const a=(await(await call('/allocations')).json()).allocations.find(r=>r.payment_id===p.id);
  assert.equal(a.fee_paise+a.gst_paise+a.recipients.reduce((n,r)=>n+r.amountPaise,0),1);
});
test('verified provider collections also allocate exactly once',async()=>{
  const p=new PaymentOrderRepository(db).create({merchantId:merchant.id,merchantOrderId:'PROVIDER-SPLIT',amountPaise:10000,status:'SUCCESS'});
  events.emit('PAYMENT.PROVIDER_SUCCESS',{paymentOrderId:p.id});events.emit('PAYMENT.PROVIDER_SUCCESS',{paymentOrderId:p.id});
  const rows=(await(await call('/allocations')).json()).allocations.filter(r=>r.payment_id===p.id);assert.equal(rows.length,1);
});
test('merchant contacts persist after settings are saved and reloaded',async()=>{
  const url=base.replace('/console','')+'/merchant-settings',headers={Authorization:`Bearer ${TEST_ADMIN_TOKEN}`,'Content-Type':'application/json'};
  const res=await fetch(url,{method:'POST',headers,body:JSON.stringify({contactEmail:'support@example.com',contactPhone:'9998887776'})});assert.equal(res.status,200);
  const data=await(await fetch(url,{headers})).json();assert.equal(data.contactEmail,'support@example.com');assert.equal(data.contactPhone,'9998887776');
});
test('zero-paise recipient shares do not require an impossible bank transfer',async()=>{
  await call('/splits',{platformFeeBps:0,gstPercent:0,recipients:[{name:'Alice',vpa:'alice@upi',shareBps:5000},{name:'Bob',vpa:'bob@upi',shareBps:5000}]});
  const p=sessions.create({merchantId:merchant.id,orderId:'ROUNDING-TRANSFER',amountPaise:1,status:'SUCCESS'});events.emit('PAYMENT.SUCCESS',{paymentId:p.id});
  assert.equal((await call(`/allocations/${p.id}/transfer`,{vpa:'bob@upi',bankReference:'BANK-00000'})).status,400);
  assert.equal((await call(`/allocations/${p.id}/transfer`,{vpa:'alice@upi',bankReference:'BANK-11111'})).status,200);
  assert.equal((await(await call('/allocations')).json()).allocations.find(r=>r.payment_id===p.id).status,'MANUALLY_CONFIRMED');
});
test('UPI channel settings validate and persist enable, limits and allowlist',async()=>{
  assert.equal((await call('/upi-channel',{enabled:true,minAmountPaise:20000,maxAmountPaise:10000,allowedVpas:[]})).status,400);
  assert.equal((await call('/upi-channel',{enabled:true,minAmountPaise:20000,maxAmountPaise:2000000,allowedVpas:['bad']})).status,400);
  const settings={enabled:false,minAmountPaise:20000,maxAmountPaise:2000000,allowedVpas:['business@upi']};
  assert.equal((await call('/upi-channel',settings)).status,200);assert.deepEqual(await(await call('/upi-channel')).json(),settings);
});
