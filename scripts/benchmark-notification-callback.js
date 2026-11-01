// Isolated HTTP acceptance benchmark. Synthetic credits never touch hosted/customer records.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';

const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'dynamo-callback-benchmark-'));
Object.assign(process.env,{NODE_ENV:'test',YOUPI_MODE:'localhost',SQLITE_DB_PATH:path.join(sandbox,'gateway.sqlite'),BASE_CHECKOUT_URL:'http://127.0.0.1',BASE_PAYMENT_API_URL:'http://127.0.0.1',DYNAMO_PUBLIC_URL:'http://127.0.0.1',ENCRYPTION_MASTER_KEY:crypto.randomBytes(32).toString('hex'),JWT_SECRET:crypto.randomBytes(32).toString('hex'),INITIAL_ADMIN_EMAIL:'isolated-operator@benchmark.test',INITIAL_ADMIN_PASSWORD:crypto.randomBytes(32).toString('base64url')});
delete process.env.DATABASE_URL;
await import('./test-support.js');
const {Database,runMigrations}=await import('@youpi/db');
const {generateHmac}=await import('@youpi/common');
const {createPaymentApp}=await import('../apps/payment-api/src/index.js');
const {CheckoutServer}=await import('../apps/checkout-portal/src/server.js');
const db=new Database({dbPath:process.env.SQLITE_DB_PATH});runMigrations(db);
const wallet=new DatabaseSync(path.join(sandbox,'merchant-wallet.sqlite'));
wallet.exec('PRAGMA journal_mode=WAL; CREATE TABLE receipts(delivery_id TEXT PRIMARY KEY,payment_id TEXT NOT NULL); CREATE TABLE credits(payment_id TEXT PRIMARY KEY,order_id TEXT UNIQUE,player TEXT,amount_paise INTEGER);');
const app=createPaymentApp(db),ctx=app.context;
const mid=ctx.merchantRepo.getDefault().id,account=ctx.accountRepo.findActiveForMerchant(mid);
const attempts=new Map(),signals=new Map(),received=[];
let webhookSecret='',retryOrder=null,receiverError=null;
const receiver=http.createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString();
  const arrival=performance.now(),payload=JSON.parse(raw),deliveryId=req.headers['x-gateway-delivery-id'];
  assert.equal(req.headers['x-gateway-signature'],'sha256='+generateHmac(raw,webhookSecret));
  assert.equal(payload.event,'SUCCESS');assert.equal(payload.status,'SUCCESS');assert.equal(payload.confirmationSource,'NOTIFICATION');assert.equal(payload.bankVerified,false);
  assert.equal(payload.merchantId,mid);assert.equal(payload.currency,'INR');assert.equal(payload.amountPaise,10000);assert.equal(payload.playerReference,'test-player');
  const n=(attempts.get(payload.orderId)||0)+1;attempts.set(payload.orderId,n);
  received.push({orderId:payload.orderId,deliveryId,raw,arrival,attempt:n});
  if(payload.orderId===retryOrder&&n===1){res.writeHead(503);res.end('synthetic temporary failure');return;}
  wallet.exec('BEGIN IMMEDIATE');
  try{
   wallet.prepare('INSERT OR IGNORE INTO receipts VALUES(?,?)').run(deliveryId,payload.paymentId);
   wallet.prepare('INSERT OR IGNORE INTO credits VALUES(?,?,?,?)').run(payload.paymentId,payload.orderId,payload.playerReference,payload.amountPaise);
   wallet.exec('COMMIT');
  }catch(e){wallet.exec('ROLLBACK');throw e;}
  const credited=performance.now();res.writeHead(200);res.end('durably credited');
  signals.get(payload.orderId)?.resolve({arrival,credited,payload,deliveryId});
 }catch(e){receiverError=e;res.writeHead(500);res.end('test assertion failure');for(const s of signals.values())s.reject(e);}
});
let checkout=null;
const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
const close=s=>new Promise(resolve=>{s.closeAllConnections();s.close(resolve);});
const round=n=>Math.round(n*100)/100;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function waitForCallback(promise){let timeout;try{return await Promise.race([promise,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Callback did not arrive within 18 seconds')),18000);})]);}finally{clearTimeout(timeout);}}
async function until(check,timeout=18000){const end=performance.now()+timeout;while(performance.now()<end){if(check())return;await pause(10);}throw Error('Timed out waiting for callback outbox acknowledgment');}
try{
 await listen(receiver);await listen(app.rawServer);
 const base='http://127.0.0.1:'+app.rawServer.address().port;
 process.env.BASE_PAYMENT_API_URL=base;process.env.PAYMENT_API_PORT=String(app.rawServer.address().port);
 checkout=new CheckoutServer({apiBaseUrl:base}).createServer();await listen(checkout);
 const checkoutBase='http://127.0.0.1:'+checkout.address().port;
 const call=async(endpoint,body,headers={})=>{const r=await fetch(base+endpoint,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {status:r.status,body:await r.json()};};
 // Seed an isolated MFA-verified operator session, then use the real administrative HTTP routes.
 const token=crypto.randomBytes(32).toString('hex'),stamp=new Date().toISOString();
 db.execute('INSERT INTO pp_users(id,email,password_hash,role,active,email_verified,mobile_verified,mfa_secret,created_at) VALUES(?,?,?,?,1,1,1,?,?)',['bench-admin','operator@benchmark.test','unused','SUPER_ADMIN','synthetic-mfa',stamp]);
 db.execute('INSERT INTO pp_sessions(id,user_id,token_hash,csrf_token,mfa_verified,expires_at,created_at) VALUES(?,?,?,?,1,?,?)',['bench-session','bench-admin',crypto.createHash('sha256').update(token).digest('hex'),'csrf',new Date(Date.now()+600000).toISOString(),stamp]);
 const admin={cookie:'dp_platform_session='+token,'x-csrf-token':'csrf'};
 const root='/api/platform/v1';
 ctx.merchantRepo.update(mid,{webhookUrl:'http://127.0.0.1:'+receiver.address().port+'/payment-callback'});
 webhookSecret=ctx.merchantRepo.findById(mid).webhookSecret;
 // Activation is fixture data; owner delivery/real onboarding is not part of this latency measurement.
 db.execute("INSERT INTO pp_merchants(merchant_id,status,profile,created_at,updated_at) VALUES(?,'ACTIVE','{}',?,?) ON CONFLICT(merchant_id) DO UPDATE SET status='ACTIVE'",[mid,stamp,stamp]);
 assert.equal((await call(root+'/settings?merchantId='+mid,{channel:{enabled:true,minAmountPaise:0,maxAmountPaise:2000000,allowedVpas:[]}},admin)).status,200);
 const made=await call(root+'/api-keys?merchantId='+mid,{label:'Isolated benchmark',environment:'PRODUCTION',scopes:['payments.create','payments.read'],rateLimit:1000},admin);assert.equal(made.status,201);
 const auth={authorization:'Bearer '+made.body.secret};
 assert.equal((await call(root+'/receiving-mirror/policy?merchantId='+mid,{receivingAccountId:account.id,autoSuccess:true,trustedSources:{android:[],smsSenders:['TESTBANK']},reason:'Synthetic isolated callback latency acceptance'},admin)).status,200);
 const pair=await call(root+'/receiving-mirror/pair?merchantId='+mid,{receivingAccountId:account.id,detectedCallbacks:false},admin);assert.equal(pair.status,201);
 const phone=await call('/api/v1/pollers/android/pair',{merchantId:mid,enrollmentToken:pair.body.pairingPayload.token,version:'v1'});assert.equal(phone.status,200);
 const signed=body=>{const timestamp=String(Date.now());return {'x-device-id':phone.body.deviceId,'x-timestamp':timestamp,'x-signature':generateHmac(JSON.stringify(body)+':'+timestamp,phone.body.signingKey)};};
 const samples=[];const runId=crypto.randomBytes(4).toString('hex');
 for(let i=0;i<51;i++){
  const orderId='BENCH-'+runId+'-'+i;if(i===50)retryOrder=orderId;
  const signal={};signal.promise=new Promise((resolve,reject)=>Object.assign(signal,{resolve,reject}));signals.set(orderId,signal);
  const start=performance.now();
  const created=await call('/v1/payments',{orderId,amount:'100.00',currency:'INR',playerReference:'test-player'},{...auth,'idempotency-key':orderId});
  assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.body.status,'ACTIVE');
  const createMs=performance.now()-start;
  const checkoutStart=performance.now();const page=await fetch(checkoutBase+'/checkout/'+created.body.paymentId);assert.equal(page.status,200);assert.ok((await page.text()).includes(created.body.paymentId));
  const qr=await fetch(checkoutBase+'/checkout/'+created.body.paymentId+'/qr.svg');assert.equal(qr.status,200);assert.ok((await qr.text()).includes('<svg'));const checkoutAndQrMs=performance.now()-checkoutStart;
  const reference=String(880000000000+i),body={sourceEvidence:{kind:'SMS',sender:'TESTBANK'},deviceId:phone.body.deviceId,body:'Rs.100.00 credited to your account UPI Ref '+reference,observedAt:Date.now()};
  if(i===0){assert.equal((await call('/api/v1/pollers/android/events',body)).status,401);assert.equal(ctx.sessionRepo.findById(created.body.paymentId).status,'ACTIVE');}
  const alertStart=performance.now();
  const event=await call('/api/v1/pollers/android/events',body,signed(body));assert.equal(event.status,200);assert.equal(event.body.status,'SUCCESS');
  const ingressAcknowledged=performance.now();
  const credited=await waitForCallback(signal.promise);
  await until(()=>Boolean(db.queryOne('SELECT is_successful FROM webhook_deliveries WHERE id=?',[credited.deliveryId])?.is_successful));
  const inquiry=await call('/v1/payments/'+created.body.paymentId,undefined,auth);assert.equal(inquiry.status,200);assert.equal(inquiry.body.status,'SUCCESS');assert.equal(inquiry.body.confirmationSource,'NOTIFICATION');
  // A repeated authenticated notification must not post or credit twice.
  assert.equal((await call('/api/v1/pollers/android/events',body,signed(body))).status,200);
  assert.equal(Number(db.queryOne('SELECT COUNT(*) AS n FROM webhook_deliveries WHERE payment_id=?',[created.body.paymentId]).n),1);
  assert.equal(Number(wallet.prepare('SELECT COUNT(*) AS n FROM credits WHERE payment_id=?').get(created.body.paymentId).n),1);
  samples.push({index:i,scenario:i===50?'first-callback-503-then-automatic-retry':'first-attempt',createMs:round(createMs),checkoutAndQrMs:round(checkoutAndQrMs),alertToIngressAckMs:round(ingressAcknowledged-alertStart),alertToCallbackReceivedMs:round(credited.arrival-alertStart),alertToWalletCommittedMs:round(credited.credited-alertStart),createToWalletCommittedMs:round(credited.credited-start),callbackAttempts:attempts.get(orderId)});
 }
 assert.equal(receiverError,null);assert.equal(Number(wallet.prepare('SELECT COUNT(*) n FROM credits').get().n),51);assert.equal(Number(db.queryOne('SELECT COUNT(*) n FROM ledger_transactions').n),51);
 const retried=received.filter(x=>x.orderId===retryOrder);assert.equal(retried.length,2);assert.equal(retried[0].deliveryId,retried[1].deliveryId);assert.equal(retried[0].raw,retried[1].raw);
 // Replay an already signed callback directly into the consumer; wallet still credits once.
 const replay=retried[1],res=await fetch('http://127.0.0.1:'+receiver.address().port+'/payment-callback',{method:'POST',headers:{'x-gateway-signature':'sha256='+generateHmac(replay.raw,webhookSecret),'x-gateway-delivery-id':replay.deliveryId},body:replay.raw});assert.equal(res.status,200);assert.equal(Number(wallet.prepare('SELECT COUNT(*) n FROM credits').get().n),51);
 const stats=field=>{const values=samples.slice(0,50).map(s=>s[field]).sort((a,b)=>a-b);return {min:values[0],p50:values[Math.ceil(values.length*.5)-1],p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1)};};
 const report={measuredAt:new Date().toISOString(),sourceCommit:(await import('node:child_process')).execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTreeCandidate:true,environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0].model,database:'isolated on-disk SQLite WAL',transport:'HTTP loopback',mode:'test; production-shaped bearer API and signed observer, synthetic evidence; private callbacks permitted only for test receiver'},scope:'Payment creation -> checkout + QR -> signed Android HTTP ingestion -> notification acceptance + clearing ledger + durable outbox -> real HTTP signed callback -> separate durable merchant wallet -> inquiry + duplicate checks',sampleCount:50,summaryMs:Object.fromEntries(['createMs','checkoutAndQrMs','alertToIngressAckMs','alertToCallbackReceivedMs','alertToWalletCommittedMs','createToWalletCommittedMs'].map(f=>[f,stats(f)])),retry:samples[50],checks:{signaturesVerified:true,paidStatusAndSourceChecked:true,duplicateNotificationNoDoublePost:true,duplicateCallbackNoDoubleCredit:true,unsignedIngressRejected:true,automaticRetryObserved:true,retryStablePayloadAndDeliveryId:true,totalPayments:51,totalLedgerTransactions:51,totalWalletCredits:51},limitations:['No real bank transfer, receiving phone, Android app, Gmail consent or bank alert timing','Not hosted Render/PostgreSQL latency, cold start, concurrent load, owner verification or live settlement acceptance','Sequential warm-path samples; synthetic notification success is not bank verification'],samples};
 const out=path.resolve('output/testing');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'notification-callback-benchmark-2026-11-01.json'),JSON.stringify(report,null,2));
 const lines=['# Notification callback acceptance benchmark','',`Measured: ${report.measuredAt}`,`Source: ${report.sourceCommit}`,'','50 sequential successes and one automatic-retry scenario. Isolated SQLite WAL, HTTP loopback, synthetic signed receiving alerts. No hosted/customer financial data used.','','| Metric | p50 (ms) | p95 (ms) | max (ms) |','|---|---:|---:|---:|',...Object.entries(report.summaryMs).map(([k,v])=>`| ${k} | ${v.p50} | ${v.p95} | ${v.max} |`),'',`Automatic retry: ${report.retry.alertToWalletCommittedMs} ms to wallet credit; ${report.retry.callbackAttempts} callback attempts. First response was synthetic HTTP 503. No retry schedule was manually accelerated.`,'','All signature, Paid/inquiry, ledger/outbox, notification duplicate, consumer duplicate and stable-retry identity assertions passed.','',...report.limitations.map(x=>'- '+x),''];fs.writeFileSync(path.join(out,'NOTIFICATION-CALLBACK-BENCHMARK-2026-11-01.md'),lines.join('\n'));
 console.log(JSON.stringify({summaryMs:report.summaryMs,retry:report.retry,checks:report.checks},null,2));
}finally{
 app.destroy();await close(app.rawServer);if(checkout)await close(checkout);await close(receiver);wallet.close();db.close();
 // Keep the isolated files in OS temp for local diagnostics; never copy their synthetic credentials into reports.
}
