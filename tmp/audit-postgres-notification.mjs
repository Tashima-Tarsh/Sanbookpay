import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import pg from 'pg';
process.env.NODE_ENV='test';process.env.BASE_CHECKOUT_URL='http://localhost';
const {PostgresDatabase}=await import('../packages/db/src/postgres-database.js');
const {runMigrations,MerchantRepository,ReceivingAccountRepository,PaymentSessionRepository}=await import('@youpi/db');
const {WebhookEngine}=await import('@youpi/core');const {createReceivingMirror}=await import('../apps/payment-api/src/services/receiving-mirror.js');
const config=JSON.parse(fs.readFileSync('data/.secrets/render-postgres-connection.json','utf8')),url=new URL(config.externalConnectionString);
if(url.hostname!=='dpg-dbiop5142hec73b3bpq0-a.singapore-postgres.render.com'||url.pathname!=='/dynamo_pay')throw Error('Unexpected database');
url.searchParams.delete('sslmode');const admin=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:true}});await admin.connect();
const schema='audit_test_'+crypto.randomBytes(8).toString('hex');assert.match(schema,/^audit_test_[a-f0-9]{16}$/);
let db,engine;const start=performance.now();
try{
 await admin.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-c search_path='+schema);
 db=new PostgresDatabase(url.toString());assert.equal(db.queryOne('SELECT current_schema() AS schema').schema,schema);runMigrations(db);
 const merchantRepo=new MerchantRepository(db),accountRepo=new ReceivingAccountRepository(db),sessionRepo=new PaymentSessionRepository(db),mid=merchantRepo.getDefault().id,account=accountRepo.findActiveForMerchant(mid);
 merchantRepo.update(mid,{webhookUrl:'https://merchant.example.test/callback'});engine=new WebhookEngine({db,merchantRepo});engine.retryPending=async()=>[];
 const mirror=createReceivingMirror({broadcastSse(){}},{db,merchantRepo,accountRepo,sessionRepo,webhookEngine:engine});mirror.setPolicy(mid,account.id,true,'Isolated PostgreSQL notification acceptance','audit');
 const first=sessionRepo.create({merchantId:mid,receivingAccountId:account.id,orderId:'PG-NOTIFICATION',amountPaise:10000,status:'ACTIVE',expiresAt:new Date(Date.now()+300000)});
 const evidence={accountId:account.id,source:'GMAIL',rawText:'Rs 100.00 credited UPI Ref 990000000101',observedAt:new Date(),amountPaise:10000,bankReference:'990000000101'};
 assert.equal(mirror.record(evidence).matchStatus,'NOTIFICATION_CONFIRMED');assert.equal(sessionRepo.findById(first.id).status,'SUCCESS');assert.equal(mirror.record(evidence).duplicate,true);
 assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM ledger_transactions').n,1);assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM webhook_deliveries').n,1);
 const payload=JSON.parse(db.queryOne('SELECT payload FROM webhook_deliveries').payload);assert.equal(payload.confirmationSource,'NOTIFICATION');assert.equal(payload.bankVerified,false);
 const second=sessionRepo.create({merchantId:mid,receivingAccountId:account.id,orderId:'PG-ROLLBACK',amountPaise:20000,status:'ACTIVE',expiresAt:new Date(Date.now()+300000)});
 const next={...evidence,amountPaise:20000,bankReference:'990000000102',rawText:'Rs 200.00 credited UPI Ref 990000000102',observedAt:new Date()};
 const enqueue=engine.enqueue.bind(engine);engine.enqueue=()=>{throw Error('Synthetic outbox failure');};assert.throws(()=>mirror.record(next),/outbox failure/);
 assert.equal(sessionRepo.findById(second.id).status,'ACTIVE');assert.equal(db.queryOne('SELECT payment_id FROM pp_receiver_reference_claims WHERE bank_reference=?',[next.bankReference]),null);assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM ledger_transactions').n,1);
 engine.enqueue=enqueue;assert.equal(mirror.record(next).matchStatus,'NOTIFICATION_CONFIRMED');assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM ledger_transactions').n,2);
 const report={checkedAt:new Date().toISOString(),isolation:'Dedicated temporary schema; connection search_path set before adapter construction; no public financial data modified',checks:{schema:true,notificationSuccess:true,actualOutbox:true,ledger:true,sourceLabel:true,duplicateIdempotent:true,atomicRollback:true,retryAfterRollback:true},durationMs:Math.round(performance.now()-start)};
 fs.writeFileSync('output/testing/production-audit-postgres-2026-11-01.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{engine?.stop();db?.close();await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();}
