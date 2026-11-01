import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'dynamo-onboarding-check-'));
Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:'',SQLITE_DB_PATH:path.join(sandbox,'fixture.sqlite'),BASE_CHECKOUT_URL:'http://localhost',BASE_PAYMENT_API_URL:'http://localhost',DYNAMO_PUBLIC_URL:'http://localhost',ENCRYPTION_MASTER_KEY:crypto.randomBytes(32).toString('hex'),JWT_SECRET:crypto.randomBytes(32).toString('hex'),INITIAL_ADMIN_EMAIL:'operator@onboarding.test',INITIAL_ADMIN_PASSWORD:crypto.randomBytes(32).toString('hex')});
const {Database,runMigrations}=await import('@youpi/db');const {generateHmac}=await import('@youpi/common');const {createPaymentApp}=await import('../apps/payment-api/src/index.js');
test('provider integration pack includes its approved route and genuine-customer placeholders',async()=>{
 const {merchantIntegrationDetails}=await import('../apps/payment-api/src/platform/merchant-integration.js');
 const details=merchantIntegrationDetails({merchantRepo:{findById:()=>({businessName:'Provider merchant',webhookUrl:'https://merchant.test/callback'})},db:{queryOne:()=>({id:'approved-provider-connection'})}},'provider-merchant');
 assert.equal(details.createPayment.body.connectionId,'approved-provider-connection');assert.ok(details.createPayment.body.customer.phone.includes('ACTUAL'));assert.equal(details.merchantId,'provider-merchant');
});
test('isolated merchant invitation to activated scoped payment and checkout naming, with gap assertions',async()=>{
 const db=new Database({inMemory:true});runMigrations(db);const app=createPaymentApp(db);const delivered=[];app.context.platformDelivery=async message=>{delivered.push(message);};
 // Callback delivery is covered by the separate end-to-end benchmark. This case checks onboarding/configuration.
 app.context.webhookEngine.retryPending=async()=>[];
 await new Promise(r=>app.rawServer.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.rawServer.address().port,root='/api/platform/v1',steps=[];
 const token=crypto.randomBytes(32).toString('hex'),stamp=new Date().toISOString();
 db.execute('INSERT INTO pp_users(id,email,password_hash,role,active,email_verified,mobile_verified,mfa_secret,created_at) VALUES(?,?,?,?,1,1,1,?,?)',['onboarding-root','operator@onboarding.test','unused','SUPER_ADMIN','synthetic-mfa',stamp]);
 db.execute('INSERT INTO pp_sessions(id,user_id,token_hash,csrf_token,mfa_verified,expires_at,created_at) VALUES(?,?,?,?,1,?,?)',['onboarding-root-session','onboarding-root',crypto.createHash('sha256').update(token).digest('hex'),'csrf',new Date(Date.now()+600000).toISOString(),stamp]);
 const admin={cookie:'dp_platform_session='+token,'x-csrf-token':'csrf'};
 async function call(endpoint,body,headers={}){const response=await fetch(base+endpoint,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 try{
  const made=await call(root+'/merchants',{businessName:'Example Games',contactName:'Synthetic Owner',email:'owner@example-games.test',mobile:'+919000000001',category:'Synthetic integration test'},admin);assert.equal(made.status,201,JSON.stringify(made.body));assert.equal(made.body.invitationSent,true);const mid=made.body.merchantId;
  steps.push('Super Admin creates independent merchant and owner invitation');
  const invite=delivered.find(m=>m.kind==='merchant_owner_invitation'),password=crypto.randomBytes(24).toString('base64url');
  assert.equal((await call(root+'/owner-invitations/accept',{token:invite.token,password})).status,200);
  const login=await call(root+'/login',{email:'owner@example-games.test',password,merchantId:mid});assert.equal(login.status,200);const owner={cookie:login.cookie,'x-csrf-token':login.body.csrfToken};
  assert.equal((await call(root+'/verification/send',{channel:'mobile'},owner)).status,200);const mobile=delivered.find(m=>m.kind==='verification'&&m.channel==='mobile');assert.equal((await call(root+'/verify',{channel:'mobile',token:mobile.token},owner)).status,200);
  const submitted=await call(root+'/onboarding',{address:'Synthetic test address',website:'https://example-games.test',submit:true},owner);assert.equal(submitted.status,200,JSON.stringify(submitted.body));assert.equal(submitted.body.status,'UNDER_REVIEW');
  assert.equal((await call(root+'/merchants/'+mid+'/state',{status:'APPROVED',reason:'Synthetic isolated onboarding approval'},admin)).status,200);steps.push('Owner accepts, signs in, verifies mobile, submits profile; platform approves');
  const account=await call(root+'/receiving-accounts?merchantId='+mid,{upiId:'synthetic-receiver@upi',payeeName:'Synthetic actual receiver'},admin);assert.equal(account.status,201);const aid=account.body.account.id;
  assert.equal((await call(root+'/receiving-accounts/'+aid+'/state?merchantId='+mid,{active:true},admin)).status,200);
  const settings=await call(root+'/settings?merchantId='+mid,{businessName:'Example Games',webhookUrl:'https://example-games.test/payment-callback',branding:{appName:'Example Games Pay',logoUrl:'https://example-games.test/logo.svg',primaryColor:'#224466'},channel:{enabled:true,minAmountPaise:0,maxAmountPaise:2000000,allowedVpas:[]}},admin);assert.equal(settings.status,200);
  assert.equal((await call(root+'/receiving-mirror/policy?merchantId='+mid,{receivingAccountId:aid,autoSuccess:true,trustedSources:{android:[],smsSenders:['TESTBANK']},reason:'Synthetic receiving alert acceptance'},admin)).status,200);
  const qr=await call(root+'/receiving-mirror/pair?merchantId='+mid,{receivingAccountId:aid,detectedCallbacks:false},admin);assert.equal(qr.status,201);
  const phone=await call('/api/v1/pollers/android/pair',{merchantId:mid,enrollmentToken:qr.body.pairingPayload.token});assert.equal(phone.status,200);
  assert.equal((await call(root+'/merchants/'+mid+'/state',{status:'ACTIVE',reason:'Synthetic isolated acceptance route ready'},admin)).status,200);steps.push('Assign account, callback, branding, policy, phone; merchant activates');
  const pack=await call(root+'/integration-pack?merchantId='+mid,{},admin);assert.equal(pack.status,201,JSON.stringify(pack.body));assert.equal(pack.body.integration.merchantId,mid);assert.equal(pack.body.integration.callback.url,'https://example-games.test/payment-callback');assert.ok(pack.body.apiSecret.startsWith('dp_live_'));assert.ok(pack.body.webhookSecret);assert.equal((await call(root+'/integration-readiness?merchantId='+mid,undefined,owner)).status,200);
  const key=await call(root+'/api-keys?merchantId='+mid,{label:'Synthetic game backend',environment:'PRODUCTION',scopes:['payments.create','payments.read']},admin);assert.equal(key.status,201);
  const payment=await call('/v1/payments',{orderId:'ONBOARDING-DEPOSIT',amount:'1.00',currency:'INR',playerReference:'synthetic-player',returnUrl:'https://example-games.test/deposit/result'},{authorization:'Bearer '+key.body.secret,'idempotency-key':'onboarding-deposit'});assert.equal(payment.status,201,JSON.stringify(payment.body));assert.equal(payment.body.status,'ACTIVE');
  const session=app.context.sessionRepo.findById(payment.body.paymentId);assert.equal(session.merchantId,mid);assert.equal(session.returnUrl,'https://example-games.test/deposit/result');
  const state=await call('/api/v1/checkout/'+session.id+'/state');assert.equal(state.status,200);assert.equal(state.body.merchantName,'Example Games');assert.equal(state.body.branding.appName,'Example Games Pay');steps.push('Scoped merchant creates INR 1 payment; active checkout identifies Example Games');
  const body={sourceEvidence:{kind:'SMS',sender:'TESTBANK'},deviceId:phone.body.deviceId,body:'Rs.1.00 credited UPI Ref 990000000201',observedAt:Date.now()},raw=JSON.stringify(body),ts=String(Date.now());
  const accepted=await call('/api/v1/pollers/android/events',body,{'x-device-id':phone.body.deviceId,'x-timestamp':ts,'x-signature':generateHmac(raw+':'+ts,phone.body.signingKey)});assert.equal(accepted.body.status,'SUCCESS');
  const terminal=await call('/api/v1/checkout/'+session.id+'/state');assert.equal(terminal.status,200);assert.equal(terminal.body.merchantName,'Example Games');steps.push('Signed synthetic notification accepts payment; terminal response preserves merchantName');
  const premium=fs.readFileSync('apps/checkout-portal/src/views/checkout-premium.html','utf8');assert.ok(premium.includes('{{APP_NAME}}'));assert.ok(premium.includes('{{MERCHANT_LOGO}}'));assert.ok(premium.includes('Powered by Dynamo Pay'));
  const openapi=JSON.parse(fs.readFileSync('apps/merchant-admin/public/dynamo-openapi.json','utf8'));assert.ok(openapi.paths['/v1/payments']);
  const report={checkedAt:new Date().toISOString(),scope:'In-memory synthetic merchant; mocked email/mobile delivery; seeded root MFA session; no physical phone, real bank or customer data',stepsPassed:steps,positiveChecks:{invitation:true,ownerLogin:true,mobileVerification:true,onboardingSubmission:true,approval:true,notificationRouteSetup:true,activation:true,scopedKey:true,paymentCreation:true,activeMerchantName:true},fixedChecks:{directUpiReturnUrlPersisted:true,terminalMerchantName:true,premiumBranding:true,canonicalOpenApi:true},callbackReservationCount:db.queryOne('SELECT COUNT(*) AS n FROM webhook_deliveries WHERE payment_id=?',[session.id]).n};
  fs.writeFileSync('output/testing/merchant-onboarding-check-2026-11-01.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{app.destroy();app.rawServer.closeAllConnections();await new Promise(r=>app.rawServer.close(r));db.close();}
});
