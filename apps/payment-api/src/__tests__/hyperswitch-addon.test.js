import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { Database, runMigrations, MerchantRepository, ReceivingAccountRepository, PaymentSessionRepository, ProviderConnectionRepository, PaymentOrderRepository } from '@youpi/db';
import { WebhookEngine } from '@youpi/core';
import { HttpServer } from '../server.js';
import { registerPlatformPayments } from '../platform/payments.js';
import { registerCollectionsRoutes } from '../routes/collections.routes.js';
import { registerProviderWebhooksRoutes } from '../routes/provider-webhooks.routes.js';

process.env.NODE_ENV='test';process.env.ENCRYPTION_MASTER_KEY='cd'.repeat(32);
test('Hyperswitch addon uses real HTTP contracts, encrypted merchant setup, bound callbacks and keeps direct UPI',async t=>{
  const db=new Database({inMemory:true});runMigrations(db);
  const merchantRepo=new MerchantRepository(db),accountRepo=new ReceivingAccountRepository(db),sessionRepo=new PaymentSessionRepository(db),merchant=merchantRepo.getDefault();
  db.execute('CREATE TABLE pp_merchants(merchant_id TEXT PRIMARY KEY,status TEXT,profile TEXT,created_at TEXT,updated_at TEXT)');
  db.execute('INSERT INTO pp_merchants VALUES(?,?,?,?,?)',[merchant.id,'ACTIVE','{}',new Date().toISOString(),new Date().toISOString()]);
  const requests=[],payments=new Map();let mode='normal';
  const upstream=http.createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;requests.push({path:req.url,headers:req.headers,body:raw});
    res.setHeader('Content-Type','application/json');
    if(req.url==='/payments/list?limit=1'){res.end('[]');return;}
    if(req.method==='POST'){
      const b=JSON.parse(raw);payments.set(b.payment_id,{payment_id:b.payment_id,merchant_id:'merchant_fixture',profile_id:'pro_fixture',amount:b.amount,currency:'INR',status:'requires_payment_method',amount_received:0,payment_link:{link:'https://sandbox.hyperswitch.io/payment_link/'+b.payment_id},client_secret:'should-not-persist'});
      if(mode==='uncertain'){res.writeHead(503);res.end('{}');return;}
      res.end(JSON.stringify(payments.get(b.payment_id)));return;
    }
    const id=decodeURIComponent(req.url.split('/')[2].split('?')[0]);res.end(JSON.stringify(payments.get(id)));
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(url,options)=>originalFetch(String(url).startsWith('https://sandbox.hyperswitch.io')?`http://127.0.0.1:${upstream.address().port}`+String(url).slice('https://sandbox.hyperswitch.io'.length):url,options);
  const server=new HttpServer(),providerWebhookEngine=new WebhookEngine({db,merchantRepo,deliveryTable:'provider_webhook_deliveries'});
  const ctx={db,merchantRepo,accountRepo,sessionRepo,providerWebhookEngine,auditRepo:{log(){}},queueEngine:{enqueueOrActivate:()=>({})},timingEngine:{startActiveTimer(){}},checkoutBaseUrl:'https://checkout.example.test'};
  server.use(req=>{if(req.headers['x-test-owner'])req.platform={merchantId:merchant.id,userId:'owner',platform:false,permissions:['*']};return false;});
  const identity={authorize:()=>true,tenant:req=>req.platform.merchantId,audit(){}};
  const api=registerPlatformPayments(server,ctx,identity);server.use(api.guard);registerCollectionsRoutes(server,ctx);registerProviderWebhooksRoutes(server,ctx);
  const listener=server.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${listener.address().port}`;
  t.after(async()=>{globalThis.fetch=originalFetch;providerWebhookEngine.stop();listener.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise(r=>listener.close(r)),new Promise(r=>upstream.close(r))]);db.close();});
  const call=async(path,body,headers={})=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  const connected=await call('/api/platform/v1/connections',{provider:'HYPERSWITCH',environment:'SANDBOX',clientId:'merchant_fixture',clientSecret:'fixture-key',profileId:'pro_fixture',webhookSecret:'fixture-hook'},{'x-test-owner':'yes'});
  assert.equal(connected.status,201);const connectionId=connected.body.connection.id;assert.ok(!JSON.stringify(connected).includes('fixture-key'));
  const stored=new ProviderConnectionRepository(db).findById(connectionId);assert.notEqual(stored.client_secret_encrypted,'fixture-key');assert.equal(stored.approved_account_id,'pro_fixture');
  const diagnostic=await call(`/api/platform/v1/connections/${connectionId}/test`,{},{'x-test-owner':'yes'});assert.equal(diagnostic.body.authenticated,true);
  db.execute('UPDATE provider_connections SET is_active=1 WHERE id=?',[connectionId]);db.execute('UPDATE pp_connection_policy SET approved=1,enabled=1 WHERE connection_id=?',[connectionId]);
  const made=await call('/api/platform/v1/api-keys',{label:'Sandbox',scopes:['payments.create','payments.read'],environment:'SANDBOX'},{'x-test-owner':'yes'});
  const auth={authorization:'Bearer '+made.body.secret,'Idempotency-Key':'hyperswitch-one'};
  const create=(name,extra={})=>call('/v1/payments',{orderId:name,amount:'1.00',connectionId,returnUrl:'https://merchant.example.test/return',...extra},{...auth,'Idempotency-Key':name});
  const created=await create('one');assert.equal(created.status,201);assert.equal(created.body.provider,'HYPERSWITCH');assert.match(created.body.checkoutUrl,/hyperswitch/);
  assert.equal((await create('one')).body.paymentId,created.body.paymentId);assert.equal(requests.filter(r=>r.body).length,1);
  const order=new PaymentOrderRepository(db).findById(created.body.paymentId),remote=payments.get(order.provider_order_id);
  assert.equal(order.provider_order_id.length,30,'Hyperswitch v1 requires a 30-character payment_id');
  assert.ok(!order.provider_response.includes('should-not-persist'));assert.equal(order.payment_method,'PROVIDER_CHECKOUT');
  const send=async(patch={},valid=true,path=connectionId)=>{
    const raw=JSON.stringify({merchant_id:'merchant_fixture',event_id:'evt_'+crypto.randomUUID(),event_type:'payment_succeeded',content:{type:'payment_details',object:{...remote,status:'succeeded',amount_received:100,payment_method:'card',...patch}}});
    return fetch(base+`/api/v1/webhooks/hyperswitch/${path}`,{method:'POST',headers:{'Content-Type':'application/json','x-webhook-signature-512':valid?crypto.createHmac('sha512','fixture-hook').update(raw).digest('hex'):'bad'},body:raw});
  };
  assert.equal((await send({},false)).status,401);
  for(const patch of [{amount:200},{currency:'USD'},{profile_id:'pro_other'},{merchant_id:'merchant_other'}])assert.equal((await send(patch)).status,409);
  assert.equal((await send({},true,'missing')).status,404);
  const execute=db.execute.bind(db);
  db.execute=(sql,args)=>{if(sql.includes('INSERT INTO ledger_entries'))throw Error('isolated ledger failure');return execute(sql,args);};
  try{assert.equal((await send()).status,409);}finally{db.execute=execute;}
  assert.notEqual(new PaymentOrderRepository(db).findById(order.id).status,'SUCCESS');
  assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM provider_payment_claims WHERE payment_order_id=?',[order.id]).n,0);
  assert.equal((await send({status:'requires_capture',amount_received:0})).status,200);
  assert.notEqual(new PaymentOrderRepository(db).findById(order.id).status,'SUCCESS');
  assert.equal((await send()).status,200);assert.equal((await send()).status,200);
  assert.equal((await send({status:'failed',amount_received:0})).status,200);
  assert.equal(new PaymentOrderRepository(db).findById(order.id).status,'SUCCESS');
  assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM ledger_transactions WHERE reference_id=?',[order.id]).n,1);
  assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM provider_webhook_deliveries WHERE payment_id=?',[order.id]).n,1);
  assert.equal(new PaymentOrderRepository(db).findById(order.id).payment_method,'CARD');
  mode='uncertain';const unknown=await create('timeout');assert.equal(unknown.status,502);assert.equal(unknown.body.status,'RECONCILIATION_REQUIRED');mode='normal';
  const unknownOrder=new PaymentOrderRepository(db).findById(unknown.body.paymentId);assert.ok(payments.has(unknownOrder.provider_order_id));
  const unknownRemote=payments.get(unknownOrder.provider_order_id);unknownRemote.amount=200;
  const mismatch=await call(`/v1/payments/${unknownOrder.id}/refresh-status`,{},auth);assert.equal(mismatch.status,502);
  assert.equal(new PaymentOrderRepository(db).findById(unknownOrder.id).status,'RECONCILIATION_REQUIRED');unknownRemote.amount=100;
  const recovered=await call(`/v1/payments/${unknownOrder.id}/refresh-status`,{},auth);assert.equal(recovered.status,200);assert.equal(recovered.body.status,'PENDING');assert.match(new PaymentOrderRepository(db).findById(unknownOrder.id).checkout_url,/hyperswitch/);
  const live=await call('/api/platform/v1/api-keys',{label:'UPI',scopes:['payments.create'],environment:'PRODUCTION'},{'x-test-owner':'yes'});
  const upi=await call('/v1/payments',{orderId:'unchanged-upi',amount:'1.00'},{authorization:'Bearer '+live.body.secret,'Idempotency-Key':'upi'});assert.equal(upi.status,201);assert.ok(sessionRepo.findById(upi.body.paymentId));
});
