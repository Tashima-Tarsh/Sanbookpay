import test from 'node:test';
import assert from 'node:assert/strict';
import { Database, runMigrations, MerchantRepository, PaymentSessionRepository, CustomerRepository } from '@youpi/db';
import { NotificationDeliveryService } from '../services/notification-delivery.service.js';
import { ReceiptNotificationService } from '../services/receipt-notification.service.js';

const key='ab'.repeat(32);
const config={ENCRYPTION_MASTER_KEY:key,NTFY_TOPIC:'test-topic',SMS_GATEWAY_URL:'http://127.0.0.1:8080',SMS_GATEWAY_USERNAME:'user',SMS_GATEWAY_PASSWORD:'private',GMAIL_SEND_CLIENT_ID:'client',GMAIL_SEND_CLIENT_SECRET:'secret',GMAIL_SEND_REFRESH_TOKEN:'refresh',GMAIL_SEND_FROM:'owner@example.test'};
function fixture(t, options={}) {
  const db=new Database({inMemory:true});runMigrations(db);t.after(()=>db.close());
  const service=new NotificationDeliveryService(db,{env:config,...options});
  return {db,service};
}
const receipt={sessionId:'payment-1',receiptId:'RCPT-1',emailSubject:'Receipt',emailHtml:'<p>Payment recorded</p>',smsMessage:'Payment recorded',method:'UPI'};

test('durable encrypted channel jobs submit once and keep public alerts generic',async t=>{
  const calls=[];const {db,service}=fixture(t,{fetch:async(url,options)=>{calls.push({url:String(url),...options});return new Response(JSON.stringify({id:'accepted'}),{status:202});},gmailSend:async raw=>{calls.push({raw});return 'gmail-id';}});
  service.enqueue(receipt,{email:'payer@example.test',phone:'+919876543210'});
  service.enqueue(receipt,{email:'payer@example.test',phone:'+919876543210'});
  assert.equal(db.query('SELECT * FROM notification_deliveries').length,3);
  assert.ok(!JSON.stringify(db.query('SELECT * FROM notification_deliveries')).includes('payer@example.test'));
  await service.processPending();await service.processPending();assert.equal(calls.length,3);
  assert.ok(db.query('SELECT * FROM notification_deliveries').every(r=>r.status==='SUBMITTED'));
  const sms=calls.find(c=>c.url?.endsWith('/message'));assert.deepEqual(JSON.parse(sms.body).phoneNumbers,['+919876543210']);
  assert.equal(sms.headers.Authorization,'Basic '+Buffer.from('user:private').toString('base64'));
  const push=calls.find(c=>c.url?.includes('ntfy'));assert.ok(!push.body.includes('RCPT-1'));assert.ok(!push.body.includes('payer'));
  const mime=Buffer.from(calls.find(c=>c.raw).raw,'base64url').toString();assert.match(mime,/To: payer@example.test/);
});

test('transient errors retry after restart, permanent errors stop, lease prevents concurrent sends',async t=>{
  let now=1000,calls=0;const {db,service}=fixture(t,{now:()=>now,fetch:async()=>{calls++;return new Response('',{status:503});}});
  service.enqueue(receipt,{});await Promise.all([service.processPending(),service.processPending()]);assert.equal(calls,1);
  assert.equal(db.queryOne('SELECT * FROM notification_deliveries').status,'PENDING');
  await service.processPending();assert.equal(calls,1);now+=60000;
  const restarted=new NotificationDeliveryService(db,{env:config,now:()=>now,fetch:async()=>new Response('',{status:401})});
  await restarted.processPending();assert.equal(db.queryOne('SELECT * FROM notification_deliveries').status,'FAILED');
});

test('missing config and recipients are explicit; invalid recipients cannot inject MIME headers',async t=>{
  const {db,service}=fixture(t,{env:{}});assert.deepEqual(service.enqueue(receipt,{}),{pushStatus:'NOT_CONFIGURED',smsStatus:'NOT_CONFIGURED',emailStatus:'NOT_CONFIGURED'});
  assert.equal(db.query('SELECT * FROM notification_deliveries').length,0);
  const configured=new NotificationDeliveryService(db,{env:config});
  const states=configured.enqueue(receipt,{email:'a@example.test\r\nBcc: victim@example.test',phone:'bad'});
  assert.equal(states.emailStatus,'INVALID_RECIPIENT');assert.equal(states.smsStatus,'INVALID_RECIPIENT');
});

test('receipt creation queues work atomically and exposes real submission state',async t=>{
  const {db,service}=fixture(t,{fetch:async()=>new Response('{"id":"accepted"}',{status:202}),gmailSend:async()=> 'accepted'});
  const merchant=new MerchantRepository(db).getDefault();
  const session=new PaymentSessionRepository(db).create({merchantId:merchant.id,orderId:'LOCAL-NOTIFY',amountPaise:100,status:'SUCCESS'});
  const receipts=new ReceiptNotificationService(db,null,service);
  const first=await receipts.sendPaymentReceipt(session,{email:'payer@example.test',mobileNumber:'+919876543210'},merchant);
  assert.equal(first.emailStatus,'PENDING');assert.equal(first.smsStatus,'PENDING');
  await service.processPending();const final=receipts.getReceipt(session.id);
  assert.equal(final.emailStatus,'SUBMITTED');assert.equal(final.smsStatus,'SUBMITTED');assert.ok(final.dispatchedAt);
  await receipts.sendPaymentReceipt(session);assert.equal(db.query('SELECT * FROM notification_deliveries').length,3);
});

test('registered Indian customer numbers send as +91 and placeholder login emails are not mailed',async t=>{
  const {db,service}=fixture(t);const merchant=new MerchantRepository(db).getDefault();
  const customer=new CustomerRepository(db).create({name:'Phone-only customer',mobileNumber:'9876543210'});
  const session=new PaymentSessionRepository(db).create({merchantId:merchant.id,customerId:customer.id,orderId:'PHONE-ONLY',amountPaise:100,status:'SUCCESS'});
  const receipts=new ReceiptNotificationService(db,null,service);
  const result=await receipts.sendPaymentReceipt(session,customer,merchant);
  assert.equal(result.smsStatus,'PENDING');assert.equal(result.emailStatus,'NO_RECIPIENT');
  assert.equal(db.query("SELECT * FROM notification_deliveries WHERE channel='email'").length,0);
});

test('separate workers honor active leases and recover expired claims',async t=>{
  let now=1000,release,calls=0;
  const {db,service}=fixture(t,{now:()=>now,fetch:async()=>{calls++;await new Promise(resolve=>release=resolve);return new Response('',{status:202});}});
  service.enqueue(receipt,{});const first=service.processPending();
  const second=new NotificationDeliveryService(db,{env:config,now:()=>now,fetch:async()=>{calls++;return new Response('',{status:202});}});
  await second.processPending();assert.equal(calls,1);release();await first;
  service.enqueue({...receipt,sessionId:'crashed-job'},{});
  db.execute("UPDATE notification_deliveries SET status='SENDING',lease_until=?,claim_token='old' WHERE payment_id='crashed-job'",[now+120000]);
  await second.processPending();assert.equal(calls,1);now+=120001;await second.processPending();assert.equal(calls,2);
});

test('retry attempts are bounded and receipt/audit failures roll back queued notifications',async t=>{
  let now=1000,calls=0;
  const {db,service}=fixture(t,{now:()=>now,fetch:async()=>{calls++;return new Response('',{status:503});}});
  service.enqueue(receipt,{});
  for(let i=0;i<7;i++){await service.processPending();now+=3600001;}
  const row=db.queryOne('SELECT * FROM notification_deliveries');assert.equal(calls,5);assert.equal(row.status,'FAILED');assert.equal(row.payload,null);
  const merchant=new MerchantRepository(db).getDefault();
  const session=new PaymentSessionRepository(db).create({merchantId:merchant.id,orderId:'ROLLBACK-QUEUE',amountPaise:100,status:'SUCCESS'});
  const receipts=new ReceiptNotificationService(db,{log(){throw Error('audit failure');}},service);
  await assert.rejects(receipts.sendPaymentReceipt(session),/audit failure/);
  assert.equal(db.queryOne('SELECT receipt FROM payment_receipts WHERE payment_id=?',[session.id]),null);
  assert.equal(db.queryOne('SELECT id FROM notification_deliveries WHERE payment_id=?',[session.id]),null);
});

test('shutdown leaves an in-flight job leased for recovery without accessing a closed database',async t=>{
  let release;const {db,service}=fixture(t,{fetch:async()=>{await new Promise(resolve=>release=resolve);return new Response('',{status:202});}});
  service.enqueue(receipt,{});const pending=service.processPending();service.stop();release();await pending;
  assert.equal(db.queryOne('SELECT status FROM notification_deliveries').status,'SENDING');
});
