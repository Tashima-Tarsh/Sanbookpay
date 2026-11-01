// Regression checks for the repaired production audit cases. Synthetic fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import dns from 'node:dns/promises';
process.env.NODE_ENV='test';process.env.BASE_CHECKOUT_URL='http://localhost';
process.env.ENCRYPTION_MASTER_KEY=crypto.randomBytes(32).toString('hex');process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');process.env.INITIAL_ADMIN_EMAIL='audit@example.test';process.env.INITIAL_ADMIN_PASSWORD=crypto.randomBytes(32).toString('hex');
const {Database,runMigrations,MerchantRepository,ReceivingAccountRepository,PaymentSessionRepository}=await import('@youpi/db');
const {WebhookEngine}=await import('@youpi/core');
const {generateHmac,validateOutboundWebhookUrl}=await import('@youpi/common');
const {createReceivingMirror}=await import('../apps/payment-api/src/services/receiving-mirror.js');
const {HttpServer}=await import('../apps/payment-api/src/server.js');
const {registerPollerRoutes}=await import('../apps/payment-api/src/routes/pollers.routes.js');
const observations=[];
function fixture(){
 const db=new Database({inMemory:true});runMigrations(db);
 const merchantRepo=new MerchantRepository(db),accountRepo=new ReceivingAccountRepository(db),sessionRepo=new PaymentSessionRepository(db),mid=merchantRepo.getDefault().id,account=accountRepo.findActiveForMerchant(mid);
 merchantRepo.update(mid,{webhookUrl:'https://merchant.example.test/callback'});
 const engine=new WebhookEngine({db,merchantRepo});engine.retryPending=async()=>[];
 const server=new HttpServer(),ctx={db,merchantRepo,accountRepo,sessionRepo,webhookEngine:engine};ctx.receivingMirror=createReceivingMirror(server,ctx);ctx.receivingMirror.setPolicy(mid,account.id,true,'Isolated audit notification acceptance','audit-operator');
 const device={id:crypto.randomUUID(),merchant_id:mid};const key=crypto.randomBytes(32).toString('hex');
 db.execute('INSERT INTO android_devices(id,merchant_id,device_name,device_model,signing_key_hash,is_active) VALUES(?,?,?,?,?,1)',[device.id,mid,'Isolated audit phone','Synthetic Android',key]);ctx.receivingMirror.bindDevice(device.id,{merchantId:mid,receivingAccountId:account.id,detectedCallbacks:false});
 return {db,ctx,server,engine,mid,account,device,key,close(){engine.stop();db.close();}};
}
async function ingress(f,body){
 registerPollerRoutes(f.server,f.ctx);const s=f.server.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));
 try{const ts=String(Date.now()),raw=JSON.stringify({...body,deviceId:f.device.id,observedAt:Date.now()});const r=await fetch('http://127.0.0.1:'+s.address().port+'/api/v1/pollers/android/events',{method:'POST',headers:{'content-type':'application/json','x-device-id':f.device.id,'x-timestamp':ts,'x-signature':generateHmac(raw+':'+ts,f.key)},body:raw});return {status:r.status,body:await r.json()};}
 finally{s.closeAllConnections();await new Promise(r=>s.close(r));}
}
test('audit: split title/body native notification completes an approved source',async()=>{
 const f=fixture();try{
  const session=f.ctx.sessionRepo.create({merchantId:f.mid,receivingAccountId:f.account.id,orderId:'split-title',amountPaise:10000,status:'ACTIVE',expiresAt:new Date(Date.now()+300000)});
  f.ctx.receivingMirror.setPolicy(f.mid,f.account.id,true,'Synthetic source approval','audit',{android:[],smsSenders:['TESTBANK']});
  const response=await ingress(f,{sourceEvidence:{kind:'SMS',sender:'TESTBANK'},amountPaise:10000,bankReferenceNumber:'990000000001',rawNotification:{title:'Rs.100.00 received',text:'UPI Ref 990000000001'}});
  assert.equal(response.status,200);assert.equal(response.body.status,'SUCCESS');assert.equal(f.ctx.sessionRepo.findById(session.id).status,'SUCCESS');
  observations.push({id:'F02',fixed:true,outcome:'Combined title/body parser accepts the approved incoming alert'});
 }finally{f.close();}
});
test('audit: untrusted app package cannot complete a paired-phone payment',async()=>{
 const f=fixture();try{
  const session=f.ctx.sessionRepo.create({merchantId:f.mid,receivingAccountId:f.account.id,orderId:'untrusted-app',amountPaise:10000,status:'ACTIVE',expiresAt:new Date(Date.now()+300000)});
  const source=fs.readFileSync('apps/android-observer-app/app/src/main/java/com/youpi/observer/PaymentNotificationListenerService.java','utf8');assert.ok(source.includes('getPackageName('));
  const response=await ingress(f,{rawNotification:{package:'test.untrusted.notification.app',title:'Test app',text:'Rs.100.00 credited UPI Ref 990000000002'}});
  assert.equal(response.body.status,'UNTRUSTED_SOURCE');assert.equal(f.ctx.sessionRepo.findById(session.id).status,'ACTIVE');
  observations.push({id:'F01',fixed:true,outcome:'Unapproved app is rejected; Java includes OS-derived package identity'});
 }finally{f.close();}
});
test('audit: missing callback URL retains a durable outgoing reservation',()=>{
 const f=fixture();try{
  f.ctx.receivingMirror.setPolicy(f.mid,f.account.id,true,'Synthetic source approval','audit',{android:[],smsSenders:['TESTBANK']});
  f.ctx.merchantRepo.update(f.mid,{webhookUrl:null});
  const session=f.ctx.sessionRepo.create({merchantId:f.mid,receivingAccountId:f.account.id,orderId:'missing-callback',amountPaise:10000,status:'ACTIVE',expiresAt:new Date(Date.now()+300000)});
  const result=f.ctx.receivingMirror.record({device:f.device,accountId:f.account.id,source:'ANDROID_OBSERVER',sourceEvidence:{kind:'SMS',sender:'TESTBANK'},rawText:'Rs.100.00 credited UPI Ref 990000000003',observedAt:new Date(),amountPaise:10000,bankReference:'990000000003'});
  assert.equal(result.matchStatus,'NOTIFICATION_CONFIRMED');assert.equal(f.ctx.sessionRepo.findById(session.id).status,'SUCCESS');assert.equal(f.db.query('SELECT * FROM webhook_deliveries').length,1);
  observations.push({id:'F03',fixed:true,outcome:'SUCCESS with missing URL retains an outbox event for recovery'});
 }finally{f.close();}
});
test('audit: late alert within original payable window completes a pending order',()=>{
 const f=fixture();try{
  f.ctx.receivingMirror.setPolicy(f.mid,f.account.id,true,'Synthetic source approval','audit',{android:[],smsSenders:['TESTBANK']});
  const session=f.ctx.sessionRepo.create({merchantId:f.mid,receivingAccountId:f.account.id,orderId:'late-alert',amountPaise:10000,status:'ACTIVE',expiresAt:new Date(Date.now()+300000)});
  f.db.execute("UPDATE payment_sessions SET status='VERIFICATION_PENDING',created_at=?,processing_expires_at=? WHERE id=?",[new Date(Date.now()-120000).toISOString(),new Date(Date.now()-90000).toISOString(),session.id]);
  const result=f.ctx.receivingMirror.record({device:f.device,accountId:f.account.id,source:'ANDROID_OBSERVER',sourceEvidence:{kind:'SMS',sender:'TESTBANK'},rawText:'Rs.100.00 credited UPI Ref 990000000004',observedAt:new Date(),amountPaise:10000,bankReference:'990000000004'});
  assert.equal(result.matchStatus,'NOTIFICATION_CONFIRMED');assert.equal(f.ctx.sessionRepo.findById(session.id).status,'SUCCESS');
  observations.push({id:'F04',fixed:true,outcome:'Pending order accepts the alert within its original payable deadline'});
 }finally{f.close();}
});
test('audit: connection-time DNS validation blocks a hostname resolving to loopback',async()=>{
 const previous=process.env.YOUPI_ALLOW_PRIVATE_WEBHOOKS;process.env.YOUPI_ALLOW_PRIVATE_WEBHOOKS='false';
 try{
  const target='http://127.0.0.1.nip.io/callback';const accepted=validateOutboundWebhookUrl(target);assert.equal(accepted.valid,true);
  let resolved=null;try{resolved=(await dns.lookup('127.0.0.1.nip.io')).address;}catch{}
  if(resolved)assert.equal(resolved,'127.0.0.1');
  const {fetchPublic}=await import('@youpi/common');await assert.rejects(fetchPublic(target),/private|reserved/i);
  observations.push({id:'F05',fixed:true,outcome:'Connection transport rejects DNS resolving to loopback',dnsResolvedTo:resolved,dnsResolutionCheck:resolved?'confirmed':'unavailable; hostname acceptance confirmed only'});
 }finally{if(previous===undefined)delete process.env.YOUPI_ALLOW_PRIVATE_WEBHOOKS;else process.env.YOUPI_ALLOW_PRIVATE_WEBHOOKS=previous;}
});
test('audit: scoped refund retry returns one refund when refundId is omitted',async()=>{
 const {createPaymentApp}=await import('../apps/payment-api/src/index.js');
 const {PaymentOrderRepository}=await import('@youpi/db');const {ProviderRegistry}=await import('@youpi/core');
 const db=new Database({inMemory:true});runMigrations(db);const app=createPaymentApp(db),mid=app.context.merchantRepo.getDefault().id;
 const key='dp_live_'+crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();
 db.execute('INSERT INTO pp_api_keys(id,merchant_id,label,prefix,secret_hash,scopes,environment,rate_limit,ip_allowlist,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,mid,'Audit refund key',key.slice(0,16),crypto.createHash('sha256').update(key).digest('hex'),'["refunds.create"]','PRODUCTION',300,'[]',new Date().toISOString()]);
 const order=new PaymentOrderRepository(db).create({merchantId:mid,merchantOrderId:'AUDIT-REFUND',providerName:'CASHFREE',amountPaise:100000,status:'SUCCESS'});
 const original=ProviderRegistry.prototype.getProvider;let providerCalls=0;
 ProviderRegistry.prototype.getProvider=function(){return {createRefund:async()=>{providerCalls++;return {status:'SUCCESS',providerRefundId:'synthetic-'+providerCalls};}};};
 await new Promise(r=>app.rawServer.listen(0,'127.0.0.1',r));
 try{
  const call=()=>fetch('http://127.0.0.1:'+app.rawServer.address().port+'/v1/refunds',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key,'idempotency-key':'same-refund-request'},body:JSON.stringify({paymentId:order.id,amount:'100.00'})});
  const first=await call(),a=await first.json(),second=await call(),b=await second.json();assert.equal(first.status,201,JSON.stringify(a));assert.equal(second.status,200,JSON.stringify(b));assert.equal(a.refundId,b.refundId);assert.equal(providerCalls,1);assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM refunds').n,1);
  const conflict=await fetch('http://127.0.0.1:'+app.rawServer.address().port+'/v1/refunds',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key,'idempotency-key':'same-refund-request'},body:JSON.stringify({paymentId:order.id,amount:'101.00'})});assert.equal(conflict.status,409);assert.equal(providerCalls,1);
  observations.push({id:'F06',fixed:true,outcome:'Repeated refund key returns one refund and calls the provider once'});
 }finally{ProviderRegistry.prototype.getProvider=original;app.destroy();app.rawServer.closeAllConnections();await new Promise(r=>app.rawServer.close(r));db.close();}
});
test('audit: legacy small payments, notification balance and fresh merchant credentials',async()=>{
 const {registerDynamoPayRoutes}=await import('../apps/payment-api/src/routes/dynamopay.routes.js');
 const {resolveSecret}=await import('@youpi/common');const f=fixture();
 process.env.DYNAMO_CLIENT_MASTER_KEY=crypto.randomBytes(32).toString('hex');
 f.ctx.merchantRepo.update(f.mid,{branding:{upiChannel:{enabled:true,minAmountPaise:0,maxAmountPaise:2000000,allowedVpas:[]}}});
 f.ctx.queueEngine={enqueueOrActivate:(id,account)=>f.ctx.sessionRepo.acquireSlotAtomic(id,account)};f.ctx.timingEngine={startActiveTimer(){}};registerDynamoPayRoutes(f.server,f.ctx);const server=f.server.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const headers=mid=>({'content-type':'application/json','Client-ID':'dp_client_'+mid,'Service-Id':mid,'Client-Secret':generateHmac(mid,resolveSecret('dynamo_client_master_key'))});
 const call=(route,body,mid=f.mid)=>fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:headers(mid),body:JSON.stringify(body)});
 try{
  const low=await call('/v1.0/collect/upi',{amount:'1.00',uniquetransactionid:'LEGACY-LOW'});assert.equal(low.status,201);const lowPayment=await low.json();f.ctx.sessionRepo.transitionToTerminal(lowPayment.transaction,'CANCELLED');
  observations.push({id:'F07',fixed:true,outcome:'Legacy collect accepts INR 1 under minimum 0'});
  f.ctx.receivingMirror.setPolicy(f.mid,f.account.id,true,'Synthetic source approval','audit',{android:[],smsSenders:['TESTBANK']});
  f.ctx.sessionRepo.create({merchantId:f.mid,receivingAccountId:f.account.id,orderId:'WALLET-NOTIFY',amountPaise:10000,status:'ACTIVE',expiresAt:new Date(Date.now()+300000)});
  f.ctx.receivingMirror.record({device:f.device,accountId:f.account.id,source:'ANDROID_OBSERVER',sourceEvidence:{kind:'SMS',sender:'TESTBANK'},rawText:'Rs.100.00 credited UPI Ref 990000000007',observedAt:new Date(),amountPaise:10000,bankReference:'990000000007'});
  const balance=await call('/v1.0/wallet',{});assert.equal(balance.status,200);const b=await balance.json();assert.equal(b.unsettledbalance,'0.00');assert.equal(b.notificationclearingbalance,'100.00');
  assert.equal(f.db.queryOne("SELECT balance_paise FROM ledger_accounts WHERE merchant_id=? AND account_code='NOTIFICATION_CLEARING'",[f.mid]).balance_paise,10000);
  observations.push({id:'F09',fixed:true,outcome:'Legacy wallet exposes INR 100 separately as notification clearing'});
  const newcomer=f.ctx.merchantRepo.create({businessName:'After startup',slug:'after-startup',contactEmail:'new@audit.test',contactPhone:'9000000001'});
  const denied=await call('/v1.0/wallet',{},newcomer.id);assert.equal(denied.status,200);
  observations.push({id:'F08',fixed:true,outcome:'New merchant legacy credentials work without restart'});
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));f.close();}
});
test.after(()=>{fs.writeFileSync('output/testing/production-audit-probes-2026-11-01.json',JSON.stringify({checkedAt:new Date().toISOString(),meaning:'Regression assertions for repaired audit findings; historical outcome descriptions retained for traceability',observations},null,2));});
