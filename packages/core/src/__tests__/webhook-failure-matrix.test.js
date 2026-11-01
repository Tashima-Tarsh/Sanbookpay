import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Database,runMigrations,MerchantRepository,PaymentSessionRepository} from '@youpi/db';
import {WebhookEngine} from '../webhook-engine.js';
import {generateHmac} from '@youpi/common';
import '../../../../scripts/test-support.js';

test('callbacks recover after 400/429/500, preserve signatures and stop after five attempts',async()=>{
 const db=new Database({inMemory:true});runMigrations(db);const merchants=new MerchantRepository(db),sessions=new PaymentSessionRepository(db),m=merchants.getDefault();
 let status=500;const received=[];
 const receiver=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;received.push({headers:req.headers,raw});res.writeHead(status);res.end('test');});
 await new Promise(r=>receiver.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${receiver.address().port}/callback`;
 merchants.update(m.id,{webhookUrl:url,webhookSecret:'matrix-signing-secret'});const engine=new WebhookEngine({db,merchantRepo:merchants});
 try{
 for(const code of [400,429,500]){
  status=code;const s=sessions.create({merchantId:m.id,orderId:'RETRY-'+code,amountPaise:20100,status:'SUCCESS'});
  const first=await engine.dispatch('SUCCESS',s);assert.equal(first.delivered,false);
  db.execute('UPDATE webhook_deliveries SET next_retry_at=? WHERE id=?',[new Date(Date.now()-1000).toISOString(),first.deliveryId]);status=200;
  const retries=await engine.retryPending();assert.equal(retries.find(r=>r.id===first.deliveryId).success,true);
  const pair=received.slice(-2);assert.equal(pair[0].headers['x-gateway-delivery-id'],pair[1].headers['x-gateway-delivery-id']);assert.equal(pair[0].raw,pair[1].raw);
  assert.equal(pair[0].headers['x-gateway-signature'],'sha256='+generateHmac(pair[0].raw,'matrix-signing-secret'));
 }
 status=500;const s=sessions.create({merchantId:m.id,orderId:'EXHAUST',amountPaise:20100,status:'SUCCESS'});const first=await engine.dispatch('SUCCESS',s);
 for(let i=0;i<4;i++){db.execute('UPDATE webhook_deliveries SET next_retry_at=? WHERE id=?',[new Date(Date.now()-1000).toISOString(),first.deliveryId]);await engine.retryPending();}
 const stopped=db.queryOne('SELECT * FROM webhook_deliveries WHERE id=?',[first.deliveryId]);assert.equal(stopped.attempt_count,5);assert.equal(stopped.next_retry_at,null);assert.equal((await engine.retryPending()).length,0);
 await new Promise(r=>receiver.close(r));
 const down=sessions.create({merchantId:m.id,orderId:'NETWORK-DOWN',amountPaise:20100,status:'SUCCESS'});assert.equal((await engine.dispatch('SUCCESS',down)).delivered,false);
 }finally{receiver.closeAllConnections?.();if(receiver.listening)await new Promise(r=>receiver.close(r));db.close();}
});

test('stopping a webhook engine cancels delivery before the database closes',async()=>{
 const db=new Database({inMemory:true});runMigrations(db);const merchants=new MerchantRepository(db),sessions=new PaymentSessionRepository(db),merchant=merchants.getDefault();
 merchants.update(merchant.id,{webhookUrl:'https://merchant.example.com/webhook',webhookSecret:'test-secret'});
 const engine=new WebhookEngine({db,merchantRepo:merchants});const session=sessions.create({merchantId:merchant.id,orderId:'SHUTDOWN',amountPaise:400,status:'SUCCESS'});
 engine.transport=async(_url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
 try{
  const dispatch=engine.dispatch('SUCCESS',session);assert.equal(engine.inFlight.size,1);
  engine.stop();db.close();assert.equal((await dispatch).delivered,false);assert.deepEqual(await engine.retryPending(),[]);
 }finally{engine.stop();}
});
