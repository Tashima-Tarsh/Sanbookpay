import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import './test-support.js';
import {PostgresDatabase} from '../packages/db/src/postgres-database.js';
import {runMigrations,MerchantRepository} from '@youpi/db';
import {ObservationNormalizer} from '@youpi/core';
import {resolveSecret} from '@youpi/common';

test('Postgres compatibility preserves quoted parameters and orders foreign-key dependencies',()=>{
 const adapter=Object.create(PostgresDatabase.prototype);
 assert.equal(adapter.normalizeSql("SELECT '?' AS literal FROM receipts WHERE id=?"),"SELECT '?' AS literal FROM receipts WHERE id=$1");
 assert.equal(adapter.normalizeSql('INSERT OR IGNORE INTO receipts(id) VALUES(?)'),'INSERT INTO receipts(id) VALUES($1) ON CONFLICT DO NOTHING');
 const schema=adapter.prepareSchema('CREATE TABLE "child" (id TEXT REFERENCES "parent"(id)); CREATE TABLE "parent"(id TEXT PRIMARY KEY);');
 assert.ok(schema.indexOf('CREATE TABLE "parent"')<schema.indexOf('CREATE TABLE "child"'));
});

test('Postgres: schema, API collection, queue, bank matching and rollback',{skip:!process.env.DYNAMO_POSTGRES_TEST_URL},async()=>{
 const db=new PostgresDatabase(process.env.DYNAMO_POSTGRES_TEST_URL);const schema='trial_test_'+crypto.randomBytes(8).toString('hex');let app,server;
 try{
  db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}, public`);runMigrations(db);
  assert.throws(()=>db.transaction(()=>{db.execute("INSERT INTO operational_alerts(id,severity,category,title,message) VALUES ('rollback','INFO','TEST','Test','Test')");throw Error('rollback');}),/rollback/);
  assert.equal(db.queryOne("SELECT id FROM operational_alerts WHERE id='rollback'"),null);
  const {createPaymentApp}=await import('../apps/payment-api/src/index.js');app=createPaymentApp(db);server=app.rawServer;await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const merchant=new MerchantRepository(db).getDefault();new MerchantRepository(db).update(merchant.id,{webhookUrl:null});
  const headers={'Content-Type':'application/json','Client-ID':'dp_client_'+merchant.id,'Client-Secret':crypto.createHmac('sha256',resolveSecret('dynamo_client_master_key')).update(merchant.id).digest('hex'),'Service-Id':merchant.id};
  const base=`http://127.0.0.1:${server.address().port}`;
  const create=order=>fetch(base+'/v1.0/collect/upi',{method:'POST',headers,body:JSON.stringify({amount:'201.00',uniquetransactionid:order})});
  const first=await create('PG-ONE');assert.equal(first.status,201);const payment=await first.json();assert.equal(payment.internalStatus,'ACTIVE');assert.equal((await create('PG-ONE')).status,200);
  const second=await create('PG-TWO');assert.equal(second.status,201);assert.equal((await second.json()).internalStatus,'QUEUED');
  const account=app.context.accountRepo.findActiveForMerchant(merchant.id);
  const bank=ObservationNormalizer.normalize({source:'SMS_GATEWAY',receivingAccountId:account.id,amount:'201.00',bankReferenceNumber:'900000000001',observedAt:new Date(),rawPayload:{text:'synthetic acceptance credit'}});
  assert.equal(app.context.attributionEngine.processObservation(bank).attributed,true);assert.equal(app.context.sessionRepo.findById(payment.transaction).status,'SUCCESS');
  const status=await fetch(base+'/v1.0/payin/checkstatus',{method:'POST',headers,body:JSON.stringify({uniquetransactionid:'PG-ONE'})});assert.equal(status.status,200);assert.equal((await status.json()).status,'SUCCESS');
  const balance=await fetch(base+'/v1.0/wallet',{method:'POST',headers,body:'{}'});assert.equal(balance.status,200);
  const previousOrigin=process.env.DYNAMO_PUBLIC_URL;process.env.DYNAMO_PUBLIC_URL='https://hosted.example.test';
  try{
   const legacy=await fetch(base+'/api/v1/payments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:'PG-HOSTED-LINK',amount:'201.00'})});
   assert.equal(legacy.status,201);assert.ok((await legacy.json()).checkoutUrl.startsWith('https://hosted.example.test/checkout/'));
  }finally{if(previousOrigin===undefined)delete process.env.DYNAMO_PUBLIC_URL;else process.env.DYNAMO_PUBLIC_URL=previousOrigin;}
 }finally{
  app?.destroy();if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}
  db.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);db.close();
 }
});
