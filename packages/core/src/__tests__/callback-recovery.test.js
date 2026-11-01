import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {Database,runMigrations,MerchantRepository,PaymentSessionRepository} from '@youpi/db';
import {WebhookEngine} from '../webhook-engine.js';import '../../../../scripts/test-support.js';
test('missing endpoint is durable and recovers automatically after configuration repair',async()=>{
 const db=new Database({inMemory:true});runMigrations(db);const merchants=new MerchantRepository(db),sessions=new PaymentSessionRepository(db),mid=merchants.getDefault().id;merchants.update(mid,{webhookUrl:null});
 const engine=new WebhookEngine({db,merchantRepo:merchants});let requests=0;const receiver=http.createServer((req,res)=>{requests++;req.resume();res.end('ok');});await new Promise(r=>receiver.listen(0,'127.0.0.1',r));
 try{
  const payment=sessions.create({merchantId:mid,orderId:'RECOVER-CALLBACK',amountPaise:100,status:'SUCCESS'}),queued=engine.enqueue('SUCCESS',payment);assert.ok(queued.deliveryId);
  assert.deepEqual(await engine.retryPending(queued.deliveryId),[]);assert.equal(db.queryOne('SELECT attempt_count FROM webhook_deliveries').attempt_count,0);
  merchants.update(mid,{webhookUrl:'http://127.0.0.1:'+receiver.address().port+'/callback'});db.execute('UPDATE webhook_deliveries SET next_retry_at=?',[new Date(Date.now()-1000).toISOString()]);
  assert.equal((await engine.retryPending())[0].success,true);assert.equal(requests,1);assert.equal(db.queryOne('SELECT id FROM webhook_deliveries').id,queued.deliveryId);
 }finally{engine.stop();receiver.closeAllConnections();await new Promise(r=>receiver.close(r));db.close();}
});
test('one slow callback does not serialize other merchants and parallel sweeps do not resend an in-flight event',async()=>{
 const db=new Database({inMemory:true});runMigrations(db);const merchants=new MerchantRepository(db),sessions=new PaymentSessionRepository(db),first=merchants.getDefault(),second=merchants.create({businessName:'Second',slug:'second-recovery',contactEmail:'s@example.test',contactPhone:'9000000001'});
 for(const m of [first,second])merchants.update(m.id,{webhookUrl:'https://callback.example.test/'+m.id});
 let release;const slow=new Promise(r=>release=r),calls=[];const engine=new WebhookEngine({db,merchantRepo:merchants});engine.transport=async(url)=>{calls.push(url);if(url.endsWith(first.id))await slow;return {ok:true,status:200,text:async()=>''};};
 try{
  for(const m of [first,second])engine.enqueue('SUCCESS',sessions.create({merchantId:m.id,orderId:'PARALLEL-'+m.id,amountPaise:100,status:'SUCCESS'}));
  const running=engine.retryPending();await new Promise(r=>setImmediate(r));assert.equal(calls.length,2);assert.equal(db.queryOne('SELECT is_successful FROM webhook_deliveries WHERE merchant_id=?',[second.id]).is_successful,1);
  assert.deepEqual(await engine.retryPending(),[]);release();assert.equal((await running).length,2);assert.equal(calls.length,2);
 }finally{release();engine.stop();db.close();}
});
test('a large oldest backlog from one merchant leaves a fair slot for another merchant',async()=>{
 const db=new Database({inMemory:true});runMigrations(db);const merchants=new MerchantRepository(db),sessions=new PaymentSessionRepository(db),a=merchants.getDefault(),b=merchants.create({businessName:'Newer merchant',slug:'fair-retry',contactEmail:'fair@example.test',contactPhone:'9000000001'});
 for(const m of [a,b])merchants.update(m.id,{webhookUrl:'https://callback.example.test/'+m.id});const engine=new WebhookEngine({db,merchantRepo:merchants});const calls=[];engine.transport=async url=>{calls.push(url);return {ok:true,status:200,text:async()=>''};};
 try{
  for(let i=0;i<101;i++)engine.enqueue('SUCCESS',sessions.create({merchantId:a.id,orderId:'OLD-'+i,amountPaise:100,status:'SUCCESS'}));
  engine.enqueue('SUCCESS',sessions.create({merchantId:b.id,orderId:'NEWER',amountPaise:100,status:'SUCCESS'}));
  await engine.retryPending();assert.ok(calls.some(url=>url.endsWith(b.id)));assert.equal(calls.filter(url=>url.endsWith(a.id)).length,5);
 }finally{engine.stop();db.close();}
});
