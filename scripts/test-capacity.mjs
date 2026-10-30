import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {Database,runMigrations,MerchantRepository,ReceivingAccountRepository,PaymentSessionRepository,ObservationRepository} from '@youpi/db';
import {AttributionEngine,ObservationNormalizer,QueueEngine} from '@youpi/core';
import {resolveSecret} from '@youpi/common';
import {HttpServer} from '../apps/payment-api/src/server.js';
import {registerDynamoPayRoutes} from '../apps/payment-api/src/routes/dynamopay.routes.js';

const out=path.resolve('output/testing');fs.mkdirSync(out,{recursive:true});
const file=path.resolve('tmp/capacity-'+Date.now()+'.sqlite');fs.mkdirSync(path.dirname(file),{recursive:true});
const db=new Database({dbPath:file,autoMigrate:false});runMigrations(db);
const merchants=new MerchantRepository(db),accounts=new ReceivingAccountRepository(db),sessions=new PaymentSessionRepository(db),observations=new ObservationRepository(db);
const merchant=merchants.getDefault();merchants.update(merchant.id,{webhookUrl:null});
const report={testedAt:new Date().toISOString(),environment:{node:process.version,os:os.platform(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryGiB:Math.round(os.totalmem()/1073741824),database:'isolated on-disk SQLite WAL',transport:'HTTP loopback; no Cloudflare or bank network'},results:[],limits:{rateLimitDefault:1000,windowMs:60000,activeVpasPerMerchant:1,activeSessionsPerReceivingAccount:1},limitations:['Synthetic bank observations; no real money moved.','Single process, local machine; results are not a production SLA.','No external provider, real device, Gmail consent or mobile app handoff tested.']};
const startAccounts=performance.now();
for(let i=0;i<1000;i++)accounts.create({merchantId:merchant.id,upiId:`capacity${i}@bank`,payeeName:'Capacity test',isActive:false});
assert.equal(accounts.findByMerchantId(merchant.id).length,1001);
assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM payment_receiving_accounts WHERE merchant_id=? AND is_active=1',[merchant.id]).n,1);
report.results.push({name:'Receiving account storage',storedAccounts:1001,activeAccounts:1,durationMs:Math.round(performance.now()-startAccounts),pass:true});
const multi=[];
for(let i=0;i<10;i++){
 const m=merchants.create({businessName:'Capacity merchant '+i,slug:'capacity-'+i,contactEmail:'test@example.com',contactPhone:''});
 const a=accounts.create({merchantId:m.id,upiId:`merchant${i}@bank`,payeeName:m.businessName});multi.push({m,a});
}
const queue=new QueueEngine({sessionRepo:sessions,accountRepo:accounts});
const ctx={db,merchantRepo:merchants,sessionRepo:sessions,accountRepo:accounts,queueEngine:queue,timingEngine:{startActiveTimer(){}}};
const router=new HttpServer();router._rateLimitMaxRequests=10000;registerDynamoPayRoutes(router,ctx);
const raw=router.createServer();await new Promise(r=>raw.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${raw.address().port}`;
function headers(m){return {'Content-Type':'application/json','Client-ID':`dp_client_${m.id}`,'Client-Secret':crypto.createHmac('sha256',resolveSecret('dynamo_client_master_key')).update(m.id).digest('hex'),'Service-Id':m.id};}
let transportRetries=0;
async function request(order,m=merchant){
 const start=performance.now();
 for(let attempt=0;attempt<2;attempt++){
  try{const r=await fetch(base+'/v1.0/collect/upi',{method:'POST',headers:headers(m),body:JSON.stringify({amount:'201.00',uniquetransactionid:order})});const body=await r.json();return {status:r.status,body,ms:performance.now()-start};}
  catch(error){if(attempt)throw error;transportRetries++;}
 }
}
async function bounded(count,concurrency,fn){let next=0;const results=[];await Promise.all(Array.from({length:concurrency},async()=>{while(next<count){const i=next++;results[i]=await fn(i);}}));return results;}
try{
 const start=performance.now(),burst=await bounded(200,25,i=>request('BURST-'+i)),elapsed=performance.now()-start;
 assert.ok(burst.every(r=>r.status===201));const active=burst.filter(r=>r.body.internalStatus==='ACTIVE');assert.equal(active.length,1);assert.equal(burst.filter(r=>r.body.internalStatus==='QUEUED').length,199);
 assert.ok(burst.filter(r=>r.body.internalStatus==='QUEUED').every(r=>r.body.intent===null&&r.body.qr===null));
 const latency=burst.map(r=>r.ms).sort((a,b)=>a-b);
 report.results.push({name:'One merchant burst',requests:200,concurrency:25,accepted:200,active:1,queued:199,errors:0,durationMs:Math.round(elapsed),requestsPerSecond:Number((200/(elapsed/1000)).toFixed(2)),p50Ms:Math.round(latency[99]),p95Ms:Math.round(latency[189]),p99Ms:Math.round(latency[197]),rateLimitOverriddenForBenchmark:10000,pass:true});
 const repeated=await bounded(50,25,()=>request('BURST-0'));assert.ok(repeated.every(r=>r.status===200));assert.equal(new Set(repeated.map(r=>r.body.transaction)).size,1);
 report.results.push({name:'Concurrent idempotency',requests:50,concurrency:25,distinctTransactions:1,pass:true});
 const engine=new AttributionEngine({sessionRepo:sessions,obsRepo:observations,gracePeriodMs:0});const account=accounts.findActiveForMerchant(merchant.id);
 const verifyStart=performance.now();let verified=0;
 for(let i=0;i<200;i++){
   const current=sessions.findCurrentActiveOrProcessing(account.id);assert.ok(current);
   const bank=ObservationNormalizer.normalize({source:'SMS_GATEWAY',receivingAccountId:account.id,amount:'201.00',bankReferenceNumber:String(700000000000+i),observedAt:new Date(),rawPayload:{text:'synthetic test bank credit',targetSessionId:current.id}});
   const result=engine.processObservation(bank);assert.equal(result.attributed,true);assert.equal(sessions.findById(current.id).status,'SUCCESS');verified++;queue.promoteNext(account.id);
 }
 assert.equal(sessions.findCurrentActiveOrProcessing(account.id),null);
 report.results.push({name:'Sequential bank confirmation and queue drain',confirmed:verified,remainingQueued:db.queryOne("SELECT COUNT(*) AS n FROM payment_sessions WHERE merchant_id=? AND status='QUEUED'",[merchant.id]).n,durationMs:Math.round(performance.now()-verifyStart),simulatedBank:true,pass:true});
 const parallel=await Promise.all(multi.map(({m},i)=>request('PARALLEL-'+i,m)));assert.ok(parallel.every(r=>r.status===201&&r.body.internalStatus==='ACTIVE'));
 let successes=0;for(const {m,a} of multi){const active=sessions.findCurrentActiveOrProcessing(a.id);const result=engine.processObservation(ObservationNormalizer.normalize({source:'GMAIL',receivingAccountId:a.id,amount:'201.00',bankReferenceNumber:String(800000000000+successes),observedAt:new Date(),rawPayload:{text:'synthetic cross-merchant credit'}}));assert.equal(result.attributed,true);assert.equal(sessions.findById(active.id).merchantId,m.id);successes++;}
 report.results.push({name:'Separate merchant parallel checkouts',merchants:10,simultaneouslyActive:10,verified:successes,wrongMerchantAttributions:0,simulatedBank:true,pass:true});engine.destroy();
 assert.equal(db.query('PRAGMA foreign_key_check').length,0);report.foreignKeyIntegrity='PASS';report.transportRetryCount=transportRetries;report.transportRetryPolicy='At most one transport-error retry with the same order ID; no status-error retries';
}finally{await new Promise(r=>raw.close(r));db.close();}
fs.writeFileSync(path.join(out,'capacity-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
