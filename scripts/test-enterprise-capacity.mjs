import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {Database,runMigrations,PaymentOrderRepository} from '@youpi/db';
import {WebhookEngine} from '@youpi/core';
import {createPaymentApp} from '../apps/payment-api/src/index.js';
import {confirmProviderCollection} from '../apps/payment-api/src/services/provider-confirmation.js';

// Synthetic, in-memory acceptance only. Never load production credentials or databases.
process.env.NODE_ENV='test';process.env.ENCRYPTION_MASTER_KEY=crypto.randomBytes(32).toString('hex');
process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
const db=new Database({inMemory:true});runMigrations(db);const app=createPaymentApp(db),ctx=app.context;
app.server._rateLimitMaxRequests=20000;
await new Promise(r=>app.rawServer.listen({port:0,host:'127.0.0.1',backlog:2048},r));const base=`http://127.0.0.1:${app.rawServer.address().port}`;
const concurrency=Number(process.env.SANBOOK_LOAD_CONCURRENCY||1000);if(!Number.isInteger(concurrency)||concurrency<1||concurrency>1000)throw Error('Concurrency must be 1-1000');
const tenants=[];
for(let i=0;i<100;i++){
 const merchant=ctx.merchantRepo.create({businessName:'Synthetic merchant '+i,slug:'synthetic-load-'+i,contactEmail:`load${i}@example.test`,contactPhone:'9000000000'});
 ctx.accountRepo.create({merchantId:merchant.id,upiId:`synthetic${i}@bank`,payeeName:'Synthetic load test'});
 const stamp=new Date().toISOString(),key='dp_live_'+crypto.randomBytes(24).toString('hex');
 db.execute('INSERT INTO pp_merchants(merchant_id,status,profile,created_at,updated_at) VALUES(?,?,?,?,?)',[merchant.id,'ACTIVE','{"synthetic":true}',stamp,stamp]);
 db.execute('INSERT INTO pp_api_keys(id,merchant_id,label,prefix,secret_hash,scopes,environment,rate_limit,ip_allowlist,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[crypto.randomUUID(),merchant.id,'Synthetic load','dp_live_',crypto.createHash('sha256').update(key).digest('hex'),'["payments.create","payments.read"]','PRODUCTION',1000,'[]',stamp]);
 tenants.push({merchant,key});
}
const metrics={testedAt:new Date().toISOString(),environment:{node:process.version,database:'isolated in-memory SQLite',transport:'loopback HTTP',provider:'none; synthetic receiving accounts only',globalIpLimiterOverride:20000},limitations:['No live provider, bank, PostgreSQL, Redis, Render, browser or device capacity is measured.','1000 outstanding local requests measure this process only; active payable sessions and queued orders are reported separately.','Duplicate-confirmation storm calls the confirmation service, not a remote provider network.'],stages:[]};
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
try{
 const start=performance.now();
 const oneRequest=async i=>{
  const tenant=tenants[i%100],at=performance.now();
  try{const response=await fetch(base+'/api/v1/payment-links/amount-only',{method:'POST',headers:{authorization:'Bearer '+tenant.key,'content-type':'application/json','idempotency-key':'load-'+i},body:JSON.stringify({amount:'500.00',playerReference:'synthetic-player-'+i})});return {status:response.status,body:await response.json(),latencyMs:performance.now()-at,merchantId:tenant.merchant.id,playerReference:'synthetic-player-'+i};}
  catch(error){return {status:0,transportError:error.cause?.code||error.code||'FETCH_FAILED',latencyMs:performance.now()-at};}
 };
 let next=0;const responses=[];await Promise.all(Array.from({length:concurrency},async()=>{while(next<1000){const i=next++;responses[i]=await oneRequest(i);}}));
 const successful=responses.filter(r=>r.status===201),duration=performance.now()-start;
 const active=successful.filter(r=>r.body.status==='ACTIVE').length,queued=successful.filter(r=>r.body.status==='QUEUED').length;
 for(const r of successful){const stored=ctx.sessionRepo.findById(r.body.paymentId);assert.equal(stored.merchantId,r.merchantId);assert.equal(stored.metadata.playerReference,r.playerReference);assert.equal(Number(stored.amountPaise),50000);}
 metrics.stages.push({name:'100 merchants, 1000 same-amount HTTP requests',requests:1000,concurrency,accepted:successful.length,errors:1000-successful.length,active,queued,distinctPaymentIds:new Set(successful.map(r=>r.body.paymentId)).size,wrongAttributions:0,transportErrors:Object.fromEntries([...new Set(responses.filter(r=>r.transportError).map(r=>r.transportError))].map(code=>[code,responses.filter(r=>r.transportError===code).length])),pass:successful.length===1000&&active===100&&queued===900,durationMs:Math.round(duration),observedRequestsPerSecond:Number((1000/duration*1000).toFixed(2)),p50Ms:Math.round(percentile(responses.map(r=>r.latencyMs),.5)),p95Ms:Math.round(percentile(responses.map(r=>r.latencyMs),.95)),p99Ms:Math.round(percentile(responses.map(r=>r.latencyMs),.99))});
 assert.equal(new Set(successful.map(r=>r.body.paymentId)).size,successful.length);
 app.destroy();app.rawServer.closeAllConnections();await new Promise(r=>app.rawServer.close(r));
 const orders=new PaymentOrderRepository(db),engine=new WebhookEngine({db,merchantRepo:ctx.merchantRepo,deliveryTable:'provider_webhook_deliveries'}),confirmContext={db,providerWebhookEngine:engine},created=[];
 for(let i=0;i<100;i++){const mid=tenants[i].merchant.id;ctx.merchantRepo.update(mid,{webhookUrl:'https://merchant.example.test/callback'});created.push(orders.create({merchantId:mid,merchantOrderId:'synthetic-confirm-'+i,amountPaise:50000,metadata:{playerReference:'synthetic-player-'+i,synthetic:true}}));}
 const stormStart=performance.now();let changed=0;const latency=[];
 for(let i=0;i<10000;i++){const at=performance.now(),order=created[i%100],result=confirmProviderCollection(confirmContext,order.id,{amountPaise:50000,currency:'INR',providerPaymentId:'synthetic-reference-'+order.id,actorType:'ISOLATED_TEST',rawResponse:{synthetic:true}});if(result.changed)changed++;latency.push(performance.now()-at);}
 const posted=Number(db.queryOne('SELECT COUNT(*) AS n FROM ledger_transactions').n),outbox=Number(db.queryOne('SELECT COUNT(*) AS n FROM provider_webhook_deliveries').n);
 assert.equal(changed,100);assert.equal(posted,100);assert.equal(outbox,100);
 metrics.stages.push({name:'10000 synthetic duplicate confirmation-service calls',pass:posted===100&&outbox===100,calls:10000,distinctOrders:100,postedTransactions:posted,outboxEvents:outbox,duplicatesSuppressed:10000-changed,durationMs:Math.round(performance.now()-stormStart),p50Ms:percentile(latency,.5),p95Ms:percentile(latency,.95),p99Ms:percentile(latency,.99)});
 metrics.result=metrics.stages.every(stage=>stage.pass)?'PASS':'FAIL';if(metrics.result==='FAIL')process.exitCode=1;
}catch(error){metrics.result='FAIL';metrics.failure=error.message;process.exitCode=1;}
finally{app.destroy();app.rawServer.closeAllConnections();if(app.rawServer.listening)await new Promise(r=>app.rawServer.close(r));db.close();fs.mkdirSync('output/testing',{recursive:true});fs.writeFileSync('output/testing/enterprise-capacity-results.json',JSON.stringify(metrics,null,2));fs.writeFileSync('output/testing/enterprise-capacity-'+concurrency+'-results.json',JSON.stringify(metrics,null,2));}
console.log(JSON.stringify(metrics,null,2));
