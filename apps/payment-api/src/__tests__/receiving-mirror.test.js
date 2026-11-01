import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {Database,runMigrations,MerchantRepository,ReceivingAccountRepository,PaymentSessionRepository} from '@youpi/db';
import {WebhookEngine} from '@youpi/core';
import {createReceivingMirror} from '../services/receiving-mirror.js';
import {HttpServer} from '../server.js';
import {registerPollerRoutes} from '../routes/pollers.routes.js';
import {generateHmac} from '@youpi/common';
import {createPaymentApp} from '../index.js';
import '../../../../scripts/test-support.js';
process.env.NODE_ENV='test';

test('paired receiving mirror deduplicates detection and queues a pending callback without crediting money',()=>{
 const db=new Database({inMemory:true});runMigrations(db);
 const merchants=new MerchantRepository(db),accounts=new ReceivingAccountRepository(db),sessions=new PaymentSessionRepository(db),m=merchants.getDefault();
 merchants.update(m.id,{webhookUrl:'https://merchant.example.test/callback'});
 const account=accounts.findActiveForMerchant(m.id),webhookEngine=new WebhookEngine({db,merchantRepo:merchants});
 webhookEngine.retryPending=async()=>[];
 const broadcasts=[],ctx={db,merchantRepo:merchants,accountRepo:accounts,sessionRepo:sessions,webhookEngine};
 const mirror=createReceivingMirror({broadcastSse:(...args)=>broadcasts.push(args)},ctx);
 try{
  const pairing=mirror.issuePairing(m.id,account.id,true);
  assert.ok(!JSON.stringify(db.query('SELECT * FROM pp_receiver_pairings')).includes(pairing.token));
  const bound=mirror.consumePairing(pairing.token,m.id);assert.equal(bound.receivingAccountId,account.id);
  assert.throws(()=>mirror.consumePairing(pairing.token,m.id),/expired|used/i);
  const expired=mirror.issuePairing(m.id,account.id,false);db.execute('UPDATE pp_receiver_pairings SET expires_at=? WHERE token_hash=?',[new Date(Date.now()-1000).toISOString(),crypto.createHash('sha256').update(expired.token).digest('hex')]);
  assert.throws(()=>mirror.consumePairing(expired.token,m.id),/expired|used/i);
  const device={id:crypto.randomUUID(),merchant_id:m.id};
  db.execute('INSERT INTO android_devices(id,merchant_id,device_name,device_model,signing_key_hash,is_active) VALUES(?,?,?,?,?,1)',[device.id,m.id,'Vivo','Android','test-key']);mirror.bindDevice(device.id,bound);
  const s=sessions.create({merchantId:m.id,receivingAccountId:account.id,orderId:'player-order',amountPaise:10000,status:'ACTIVE',expiresAt:new Date(Date.now()+300000)});
  const input={device,accountId:account.id,source:'ANDROID_OBSERVER',rawText:'Rs 100.00 credited UPI Ref 123456789012',observedAt:new Date(),amountPaise:10000n,bankReference:'123456789012'};
  const first=mirror.record(input);assert.equal(first.matchStatus,'DETECTED');assert.equal(first.paymentId,s.id);
  assert.equal(mirror.record(input).duplicate,true);assert.equal(db.query('SELECT * FROM pp_receiver_events').length,1);
  assert.equal(db.query('SELECT * FROM webhook_deliveries').length,1);
  const callback=JSON.parse(db.queryOne('SELECT payload FROM webhook_deliveries').payload);
  assert.equal(callback.event,'PAYMENT_DETECTED');assert.equal(callback.status,'PENDING');assert.equal(callback.confirmationSource,'OBSERVER_EVIDENCE');assert.equal(callback.completedAt,null);assert.equal(callback.utr,'123456789012');
  assert.notEqual(sessions.findById(s.id).status,'SUCCESS');assert.equal(db.query('SELECT * FROM ledger_transactions').length,0);
  assert.ok(broadcasts.some(args=>args[0]==='platform:merchant:'+m.id));
  assert.throws(()=>mirror.record({...input,accountId:'foreign'}),/bound|account/i);
  db.execute('UPDATE android_devices SET is_active=0 WHERE id=?',[device.id]);assert.throws(()=>mirror.record(input),/inactive|revoked/i);
 }finally{webhookEngine.stop();db.close();}
});

test('shared-UPI collisions and late alerts remain unassigned and never send a credit callback',()=>{
 const db=new Database({inMemory:true});runMigrations(db);
 const merchantRepo=new MerchantRepository(db),accountRepo=new ReceivingAccountRepository(db),sessionRepo=new PaymentSessionRepository(db),a=merchantRepo.getDefault();
 const b=merchantRepo.create({businessName:'Other gaming site',slug:'mirror-other',contactEmail:'other@example.test',contactPhone:'9000000000'}),account=accountRepo.findActiveForMerchant(a.id);
 const other=accountRepo.create({merchantId:b.id,upiId:account.upiId,payeeName:'Other site'});
 const webhookEngine=new WebhookEngine({db,merchantRepo});webhookEngine.retryPending=async()=>[];
 const mirror=createReceivingMirror({broadcastSse(){}},{db,merchantRepo,accountRepo,sessionRepo,webhookEngine});
 try{
  const first=sessionRepo.create({merchantId:a.id,receivingAccountId:account.id,orderId:'first',amountPaise:10000,status:'ACTIVE'});
  const second=sessionRepo.create({merchantId:b.id,receivingAccountId:other.id,orderId:'second',amountPaise:10000,status:'ACTIVE'});
  const result=mirror.record({accountId:account.id,source:'GMAIL',rawText:'bank alert',amountPaise:10000n,observedAt:new Date(),bankReference:'real-alert-reference'});
  assert.equal(result.matchStatus,'AMBIGUOUS');assert.equal(result.paymentId,null);
  assert.equal(db.query('SELECT * FROM webhook_deliveries').length,0);
  const stale=mirror.record({accountId:account.id,source:'GMAIL',rawText:'old bank alert',amountPaise:10000n,observedAt:new Date(Date.now()-86400000),bankReference:'older-reference'});
  assert.equal(stale.matchStatus,'UNMATCHED');assert.notEqual(sessionRepo.findById(first.id).status,'SUCCESS');assert.notEqual(sessionRepo.findById(second.id).status,'SUCCESS');
 }finally{webhookEngine.stop();db.close();}
});

test('Android pairing and signed notification ingress use the stored receiving binding',async t=>{
 const db=new Database({inMemory:true});runMigrations(db);
 const merchantRepo=new MerchantRepository(db),accountRepo=new ReceivingAccountRepository(db),sessionRepo=new PaymentSessionRepository(db),mid=merchantRepo.getDefault().id,account=accountRepo.findActiveForMerchant(mid);
 const webhookEngine=new WebhookEngine({db,merchantRepo});webhookEngine.retryPending=async()=>[];
 const ctx={db,merchantRepo,accountRepo,sessionRepo,webhookEngine};const server=new HttpServer();ctx.receivingMirror=createReceivingMirror(server,ctx);registerPollerRoutes(server,ctx);
 const http=server.createServer();await new Promise(r=>http.listen(0,'127.0.0.1',r));
 t.after(async()=>{webhookEngine.stop();http.closeAllConnections();await new Promise(r=>http.close(r));db.close();});
 const url='http://127.0.0.1:'+http.address().port;
 const request=(path,body,headers={})=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const pair=ctx.receivingMirror.issuePairing(mid,account.id,false);
 assert.equal((await request('/api/v1/pollers/android/pair',{merchantId:'foreign',enrollmentToken:pair.token})).status,401);
 const paired=await request('/api/v1/pollers/android/pair',{merchantId:mid,enrollmentToken:pair.token,version:'v1'});assert.equal(paired.status,200);const device=await paired.json();
 assert.equal((await request('/api/v1/pollers/android/pair',{merchantId:mid,enrollmentToken:pair.token})).status,401);
 const body={deviceId:device.deviceId,body:'Rs.100.00 credited to your account UPI Ref 123456789012',observedAt:Date.now()};
 const ts=String(Date.now()),headers={'x-device-id':device.deviceId,'x-timestamp':ts,'x-signature':generateHmac(JSON.stringify(body)+':'+ts,device.signingKey)};
 assert.equal((await request('/api/v1/pollers/android/events',body)).status,401);
 const event=await request('/api/v1/pollers/android/events',body,headers);assert.equal(event.status,200);assert.equal((await event.json()).status,'VERIFICATION_PENDING');
 assert.equal((await request('/api/v1/pollers/android/events',body,headers)).status,200);assert.equal(db.query('SELECT * FROM pp_receiver_events').length,1);
 const foreign={...body,receivingAccountId:'other-account'};const sig=generateHmac(JSON.stringify(foreign)+':'+ts,device.signingKey);
 assert.equal((await request('/api/v1/pollers/android/events',foreign,{...headers,'x-signature':sig})).status,403);
});

test('portal mirror requires a tenant session, CSRF and privileged MFA-bound phone assignment',async t=>{
 const db=new Database({inMemory:true});runMigrations(db);const app=createPaymentApp(db);
 await new Promise(r=>app.rawServer.listen(0,'127.0.0.1',r));
 t.after(async()=>{app.destroy();app.rawServer.closeAllConnections();await new Promise(r=>app.rawServer.close(r));db.close();});
 const mid=app.context.merchantRepo.getDefault().id,account=app.context.accountRepo.findActiveForMerchant(mid),token='isolated-platform-token';
 db.execute('INSERT INTO pp_users(id,merchant_id,email,password_hash,role,active,email_verified,mobile_verified,mfa_secret,created_at) VALUES(?,?,?,?,?,1,1,1,?,?)',['mirror-admin',null,'admin@mirror.test','unused','SUPER_ADMIN','synthetic-mfa-secret',new Date().toISOString()]);
 db.execute('INSERT INTO pp_sessions(id,user_id,token_hash,csrf_token,mfa_verified,expires_at,created_at) VALUES(?,?,?,?,1,?,?)',['mirror-session','mirror-admin',crypto.createHash('sha256').update(token).digest('hex'),'csrf',new Date(Date.now()+60000).toISOString(),new Date().toISOString()]);
 const base='http://127.0.0.1:'+app.rawServer.address().port,endpoint='/api/platform/v1/receiving-mirror';
 const headers={cookie:'dp_platform_session='+token,'content-type':'application/json','x-csrf-token':'csrf'};
 assert.equal((await fetch(base+endpoint+'?merchantId='+mid)).status,401);
 const state=await fetch(base+endpoint+'?merchantId='+mid,{headers});assert.equal(state.status,200);assert.equal((await state.json()).setup.receivingUpi,account.upiId);
 const pair=()=>JSON.stringify({receivingAccountId:account.id,detectedCallbacks:true});
 assert.equal((await fetch(base+endpoint+'/pair?merchantId='+mid,{method:'POST',headers:{...headers,'x-csrf-token':'wrong'},body:pair()})).status,403);
 const made=await fetch(base+endpoint+'/pair?merchantId='+mid,{method:'POST',headers,body:pair()});assert.equal(made.status,201);assert.equal(made.headers.get('cache-control'),'no-store');
 const qr=await made.json();assert.equal(qr.pairingPayload.merchantId,mid);assert.ok(qr.qrSvg.startsWith('<svg'));
 const paired=await fetch(base+'/api/v1/pollers/android/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({merchantId:mid,enrollmentToken:qr.pairingPayload.token})});const phone=await paired.json();assert.equal(paired.status,200);
 app.context.merchantRepo.update(mid,{webhookUrl:'https://merchant.example.test/callback'});
 const policy=await fetch(base+endpoint+'/policy?merchantId='+mid,{method:'POST',headers,body:JSON.stringify({receivingAccountId:account.id,autoSuccess:true,reason:'Owner accepts notifications as paid'})});assert.equal(policy.status,200);
 assert.equal(app.context.canActivateMerchant(mid),true,'approved notification setup is an alternative to a provider connection');
 const revoked=await fetch(base+endpoint+'/devices/'+phone.deviceId+'/revoke?merchantId='+mid,{method:'POST',headers,body:'{}'});assert.equal(revoked.status,200);
 const devices=(await(await fetch(base+endpoint+'?merchantId='+mid,{headers})).json()).devices;assert.equal(devices[0].status,'REVOKED');assert.ok(!JSON.stringify(devices).includes(phone.signingKey));
 assert.equal(app.context.canActivateMerchant(mid),false,'a revoked phone cannot supply activation readiness');
 db.execute('UPDATE pp_sessions SET mfa_verified=0 WHERE id=?',['mirror-session']);
 assert.equal((await fetch(base+endpoint+'/pair?merchantId='+mid,{method:'POST',headers,body:pair()})).status,403);
 db.execute('UPDATE pp_sessions SET mfa_verified=1 WHERE id=?',['mirror-session']);db.execute("UPDATE pp_users SET merchant_id=?,role='OWNER' WHERE id=?",[mid,'mirror-admin']);
 assert.equal((await fetch(base+endpoint+'?merchantId=another-tenant',{headers})).status,403);
 assert.equal((await fetch(base+endpoint+'/pair',{method:'POST',headers,body:pair()})).status,403);
 assert.equal((await fetch(base+endpoint+'/policy',{method:'POST',headers,body:JSON.stringify({receivingAccountId:account.id,autoSuccess:true,reason:'Not allowed from merchant'})})).status,403);
});

test('detection callback retries keep their raw signature and delivery ID across an engine restart',async t=>{
 const db=new Database({inMemory:true});runMigrations(db);const merchants=new MerchantRepository(db),m=merchants.getDefault(),sessions=new PaymentSessionRepository(db);
 let responseStatus=500;const received=[];
 const receiver=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;received.push({raw,headers:req.headers});res.writeHead(responseStatus);res.end('received');});
 await new Promise(r=>receiver.listen(0,'127.0.0.1',r));
 merchants.update(m.id,{webhookUrl:'http://127.0.0.1:'+receiver.address().port+'/callback'});
 const engine=new WebhookEngine({db,merchantRepo:merchants});
 t.after(async()=>{engine.stop();receiver.closeAllConnections();await new Promise(r=>receiver.close(r));db.close();});
 const s=sessions.create({merchantId:m.id,orderId:'detection-retry',amountPaise:10000,status:'ACTIVE'});
 const sent=await engine.dispatch('PAYMENT_DETECTED',{...s,confirmationSource:'OBSERVER_EVIDENCE',bankReference:'123456789012'});
 assert.equal(sent.delivered,false);assert.equal(received.length,1);
 engine.stop();const restarted=new WebhookEngine({db,merchantRepo:merchants});
 responseStatus=200;db.execute('UPDATE webhook_deliveries SET next_retry_at=? WHERE id=?',[new Date(Date.now()-1000).toISOString(),sent.deliveryId]);
 try{assert.equal((await restarted.retryPending())[0].success,true);}finally{restarted.stop();}
 assert.equal(received[0].raw,received[1].raw);assert.equal(received[0].headers['x-gateway-delivery-id'],received[1].headers['x-gateway-delivery-id']);
 assert.equal(received[0].headers['x-gateway-signature'],'sha256='+generateHmac(received[0].raw,m.webhookSecret));
 assert.equal(JSON.parse(received[1].raw).status,'PENDING');assert.notEqual(sessions.findById(s.id).status,'SUCCESS');
});

test('explicit notification policy completes one matching UTR once, with honest source and atomic ledger/outbox',()=>{
 const db=new Database({inMemory:true});runMigrations(db);const merchants=new MerchantRepository(db),accounts=new ReceivingAccountRepository(db),sessions=new PaymentSessionRepository(db),m=merchants.getDefault(),a=accounts.findActiveForMerchant(m.id);
 merchants.update(m.id,{webhookUrl:'https://merchant.example.test/callback'});
 const engine=new WebhookEngine({db,merchantRepo:merchants});engine.retryPending=async()=>[];
 const mirror=createReceivingMirror({broadcastSse(){}},{db,merchantRepo:merchants,accountRepo:accounts,sessionRepo:sessions,webhookEngine:engine});
 try{
  mirror.setPolicy(m.id,a.id,true,'Owner accepts paired notification confirmation','admin');
  const s=sessions.create({merchantId:m.id,receivingAccountId:a.id,orderId:'auto-notification',amountPaise:10000,status:'ACTIVE'});
  const input={accountId:a.id,source:'GMAIL',amountPaise:10000n,observedAt:new Date(),bankReference:'123456789012',rawText:'Rs 100.00 credited UPI Ref 123456789012'};
  const result=mirror.record(input);assert.equal(result.matchStatus,'NOTIFICATION_CONFIRMED');assert.equal(sessions.findById(s.id).status,'SUCCESS');assert.equal(sessions.findById(s.id).verificationTag,'NOTIFICATION_CONFIRMED');assert.equal(sessions.findById(s.id).verificationLevel,0);
  const callback=JSON.parse(db.queryOne('SELECT payload FROM webhook_deliveries').payload);assert.equal(callback.event,'SUCCESS');assert.equal(callback.confirmationSource,'NOTIFICATION');assert.equal(callback.bankVerified,false);assert.equal(callback.utr,'123456789012');
  assert.equal(db.query('SELECT * FROM ledger_transactions').length,1);assert.equal(mirror.record(input).duplicate,true);assert.equal(db.query('SELECT * FROM webhook_deliveries').length,1);
  const second=sessions.create({merchantId:m.id,receivingAccountId:a.id,orderId:'different-amount',amountPaise:20000,status:'ACTIVE'});
  const reused=mirror.record({...input,amountPaise:20000n,rawText:'Rs 200.00 credited UPI Ref 123456789012'});assert.equal(reused.matchStatus,'REFERENCE_REUSED');assert.notEqual(sessions.findById(second.id).status,'SUCCESS');
  const noRef=mirror.record({...input,amountPaise:20000n,bankReference:null,rawText:'Rs 200.00 credited',observedAt:new Date(Date.now()+1)});assert.equal(noRef.matchStatus,'DETECTED');assert.notEqual(sessions.findById(second.id).status,'SUCCESS');
  sessions.transitionToTerminal(second.id,'CANCELLED');
  const third=sessions.create({merchantId:m.id,receivingAccountId:a.id,orderId:'atomic-notification',amountPaise:30000,status:'ACTIVE'});
  const next={...input,amountPaise:30000n,bankReference:'123456789013',rawText:'Rs 300.00 credited UPI Ref 123456789013'};
  const enqueue=engine.enqueue.bind(engine);engine.enqueue=()=>{throw Error('Synthetic outbox failure');};
  assert.throws(()=>mirror.record(next),/outbox failure/);assert.notEqual(sessions.findById(third.id).status,'SUCCESS');
  assert.equal(db.queryOne('SELECT payment_id FROM pp_receiver_reference_claims WHERE bank_reference=?',['123456789013']),null);
  assert.equal(db.query('SELECT * FROM ledger_transactions').length,1);
  engine.enqueue=enqueue;assert.equal(mirror.record(next).matchStatus,'NOTIFICATION_CONFIRMED');
 }finally{engine.stop();db.close();}
});
