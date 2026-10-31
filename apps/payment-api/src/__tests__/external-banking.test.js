import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {Database, ReceivingAccountRepository, MerchantRepository, PaymentSessionRepository, runMigrations} from '@youpi/db';
import {QueueEngine} from '@youpi/core';
import {HttpServer} from '../server.js';
import {registerPlatformPayments} from '../platform/payments.js';
import {registerPaymentRoutes} from '../routes/payments.routes.js';
import {BankingConnector} from '../services/banking-connector.js';

process.env.NODE_ENV='test';
process.env.YOUPI_ALLOW_PRIVATE_WEBHOOKS='true';
process.env.ENCRYPTION_MASTER_KEY=crypto.randomBytes(32).toString('hex');

test('receiving bank details are validated, encrypted and returned masked',()=>{
 const db=new Database({inMemory:true});
 runMigrations(db);
 const merchants=new MerchantRepository(db),accounts=new ReceivingAccountRepository(db);
 try{
  const m=merchants.create({businessName:'Bank test',slug:'bank-details',contactEmail:'bank@example.test',contactPhone:'9000000000'});
  const details={merchantId:m.id,upiId:'business@bank',payeeName:'Bank test',bankName:'Test Bank',accountHolderName:'Bank test',accountNumber:'123456789012',ifsc:'TEST0000001'};
  const a=accounts.create(details);
  assert.equal(a.bankDetails.accountNumberMasked,'********9012');
  assert.equal(a.bankDetails.ifsc,'TEST0000001');
  assert.ok(!JSON.stringify(a).includes(details.accountNumber));
  assert.ok(!JSON.stringify(db.query('SELECT * FROM receiving_bank_details')).includes(details.accountNumber));
  assert.throws(()=>accounts.create({...details,ifsc:'INVALID'}),/IFSC/);
  assert.throws(()=>accounts.create({...details,accountHolderName:''}),/holder/);
  assert.equal(accounts.findById(a.id).isActive,true);
 }finally{db.close();}
});

test('merchant-owned integration creates one exact-amount checkout and notification evidence never settles it',async()=>{
 const db=new Database({inMemory:true});runMigrations(db);
 const merchantRepo=new MerchantRepository(db),accountRepo=new ReceivingAccountRepository(db),sessionRepo=new PaymentSessionRepository(db);
 const merchant=merchantRepo.create({businessName:'Connector merchant',slug:'connector-merchant',contactEmail:'connector@example.test',contactPhone:'9000000000'});
 const other=merchantRepo.create({businessName:'Other merchant',slug:'other-connector',contactEmail:'other@example.test',contactPhone:'9000000001'});
 const account=accountRepo.create({merchantId:merchant.id,upiId:'business@bank',payeeName:'Business'});
 db.execute('CREATE TABLE pp_merchants(merchant_id TEXT PRIMARY KEY,status TEXT)');
 db.execute('INSERT INTO pp_merchants VALUES(?,?)',[merchant.id,'ACTIVE']);
 let creates=0,unavailable=false,failReads=false;
 const upstream=http.createServer(async(req,res)=>{
  for await(const part of req){};
  res.setHeader('content-type','application/json');
  if(req.method==='POST'){creates++;if(unavailable){res.writeHead(503);return res.end('{}');}return res.end(JSON.stringify({id:'pay_owned',requested_amount:'200.00',payable_amount:'200.37',upi_uri:'upi://pay?pa=business%40bank&pn=Business&am=200.37&cu=INR'}));}
  if(failReads){res.writeHead(503);return res.end('{}');}
  res.end(JSON.stringify({id:'pay_owned',status:'paid',requested_amount:'200.00',payable_amount:'200.37'}));
 });await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=new HttpServer();
 server.use(req=>{req.platform={merchantId:req.headers['x-test-other']?other.id:merchant.id,userId:'owner',platform:false,permissions:['*'],environment:'PRODUCTION'};return false;});
 const identity={authorize:()=>true,tenant:req=>req.platform.merchantId,audit(){}};
 const ctx={db,merchantRepo,accountRepo,sessionRepo,auditRepo:{log(){}},queueEngine:new QueueEngine({sessionRepo,accountRepo}),timingEngine:{startActiveTimer(){}},checkoutBaseUrl:'https://gateway.example.test'};
 registerPlatformPayments(server,ctx,identity);
 registerPaymentRoutes(server,ctx);
 const api=server.createServer();await new Promise(r=>api.listen(0,'127.0.0.1',r));
 const call=async(path,body,extra={})=>{const response=await fetch('http://127.0.0.1:'+api.address().port+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','idempotency-key':'one-request',...extra},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 try{
  const ordinary=await call('/api/platform/v1/payments',{orderId:'old-ordinary',amount:'200.00'},{'idempotency-key':'old-key'});
  assert.equal(ordinary.status,201);
  const legacyCanonical={orderId:'old-ordinary',amountPaise:'20000',currency:'INR',mode:'UPI',connectionId:null,customer:null,returnUrl:null,payerVpa:null,playerReference:null};
  const legacyFingerprint=crypto.createHash('sha256').update(JSON.stringify(legacyCanonical)).digest('hex');
  assert.equal(db.queryOne('SELECT fingerprint FROM pp_request_claims WHERE merchant_id=? AND request_key=?',[merchant.id,'old-key']).fingerprint,legacyFingerprint);
  sessionRepo.transitionToTerminal(ordinary.body.paymentId,'CANCELLED');
  const saved=await call('/api/platform/v1/banking-integrations',{kind:'PAYGATE',baseUrl:'http://127.0.0.1:'+upstream.address().port,apiKey:'connector-secret',webhookSecret:'event-secret',receivingAccountId:account.id});
  assert.equal(saved.status,201,JSON.stringify(saved.body));const id=saved.body.integration.id;
  assert.ok(!JSON.stringify(saved.body).includes('connector-secret'));
  assert.equal((await call('/api/platform/v1/banking-integrations/'+id+'/default',{enabled:true},{'x-test-other':'yes'})).status,404);
  assert.equal((await call('/api/platform/v1/banking-integrations/'+id+'/default',{enabled:true})).status,200);
  assert.equal((await call('/api/platform/v1/payments',{orderId:'old-ordinary',amount:'200.00'},{'idempotency-key':'old-key'})).body.paymentId,ordinary.body.paymentId);
  const counter=await call('/api/v1/payments',{orderId:'cash-counter',amount:'200.00',method:'CASH_COUNTER'},{'x-merchant-id':merchant.id,'x-merchant-key':merchant.webhookSecret,'idempotency-key':'cash-counter'});
  assert.equal(counter.status,201,JSON.stringify(counter.body));
  assert.equal(sessionRepo.findById(counter.body.paymentId).method,'CASH_COUNTER');assert.equal(creates,0);
  const created=await call('/api/platform/v1/payments',{amount:'200.00'});
  assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.body.amount,'200.37');
  assert.match(created.body.intent,/am=200.37/);assert.match(created.body.intent,/business%40bank/);
  assert.equal((await call('/api/platform/v1/payments',{amount:'200.00'})).body.paymentId,created.body.paymentId);
  assert.equal(creates,1);
  await call('/api/platform/v1/banking-integrations/'+id+'/default',{enabled:false});
  assert.equal((await call('/api/platform/v1/payments',{amount:'200.00'})).body.paymentId,created.body.paymentId);
  await call('/api/platform/v1/banking-integrations/'+id+'/default',{enabled:true});
  const refreshed=await call('/api/platform/v1/banking-integrations/payments/'+created.body.paymentId+'/refresh',{});
  assert.equal(refreshed.body.evidence,'PAID');assert.equal(refreshed.body.settled,false);
  assert.equal(sessionRepo.findById(created.body.paymentId).status,'VERIFICATION_PENDING');
  assert.equal((await call('/api/platform/v1/payments',{amount:'200.00'})).body.intent,null);
  assert.equal(db.query('SELECT * FROM ledger_transactions').length,0);
  const unsigned=await call('/api/v1/banking-integrations/'+id+'/events',{status:'paid'});
  assert.equal(unsigned.status,401);
  const event={id:'evt_test',data:{payment:{id:'pay_owned',status:'paid'}}};
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature=crypto.createHmac('sha256','event-secret').update(timestamp+'.'+JSON.stringify(event)).digest('hex');
  const signedHeaders={'paygate-timestamp':timestamp,'paygate-signature':'v1='+signature};
  assert.equal((await call('/api/v1/banking-integrations/'+id+'/events',event,signedHeaders)).status,202);
  assert.equal((await call('/api/v1/banking-integrations/'+id+'/events',event,signedHeaders)).status,202);
  assert.equal(db.query('SELECT * FROM pp_banking_events').length,1);
  db.execute('UPDATE payment_sessions SET status=? WHERE id=?',['EXPIRED',created.body.paymentId]);
  const late={...event,id:'evt_late'};
  const lateHeaders={'paygate-timestamp':timestamp,'paygate-signature':'v1='+crypto.createHmac('sha256','event-secret').update(timestamp+'.'+JSON.stringify(late)).digest('hex')};
  failReads=true;
  assert.equal((await call('/api/v1/banking-integrations/'+id+'/events',late,lateHeaders)).status,503);
  assert.equal(db.query('SELECT * FROM pp_banking_events').length,1);
  failReads=false;
  assert.equal((await call('/api/v1/banking-integrations/'+id+'/events',late,lateHeaders)).status,202);
  assert.equal(db.query('SELECT * FROM pp_banking_events').length,2);
  assert.equal(sessionRepo.findById(created.body.paymentId).status,'EXPIRED');
  await call('/api/platform/v1/banking-integrations/'+id+'/default',{enabled:false});
  const legacyReplay=await call('/api/v1/payments',{orderId:created.body.orderId,amount:'200.00'},{'x-merchant-id':merchant.id,'x-merchant-key':merchant.webhookSecret});
  assert.equal(legacyReplay.body.paymentId,created.body.paymentId,JSON.stringify(legacyReplay.body));assert.equal(creates,1);
  await call('/api/platform/v1/banking-integrations/'+id+'/default',{enabled:true});
  const limits=merchantRepo.findById(merchant.id).branding||{};
  merchantRepo.update(merchant.id,{branding:{...limits,upiChannel:{enabled:true,minAmountPaise:1,maxAmountPaise:20000,allowedVpas:[]}}});
  assert.equal((await call('/api/platform/v1/payments',{amount:'200.00'},{'idempotency-key':'ceiling'})).status,400);
  assert.equal(creates,1);
  merchantRepo.update(merchant.id,{branding:{...limits,upiChannel:{enabled:true,minAmountPaise:1,maxAmountPaise:2000000,allowedVpas:[]}}});
  unavailable=true;
  const uncertain=await call('/api/platform/v1/payments',{amount:'200.00'},{'idempotency-key':'uncertain'});
  assert.equal(uncertain.status,502);assert.ok(uncertain.body.paymentId);
  const retry=await call('/api/platform/v1/payments',{amount:'200.00'},{'idempotency-key':'uncertain'});
  assert.equal(retry.body.paymentId,uncertain.body.paymentId);assert.equal(retry.body.intent,null);assert.equal(creates,2);
 }finally{await new Promise(r=>api.close(r));await new Promise(r=>upstream.close(r));db.close();}
});

test('connectors use upstream contracts and reject mismatched QR amounts or destinations',async()=>{
 const requests=[];
 const upstream=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;
  requests.push({url:req.url,headers:req.headers,body:raw?JSON.parse(raw):null});
  res.setHeader('content-type','application/json');
  if(req.url==='/v1/payments')return res.end(JSON.stringify({id:'pay_one',requested_amount:'200.00',payable_amount:'200.37',upi_uri:'upi://pay?pa=business%40bank&pn=Bank&am=200.37&cu=INR',expires_at:new Date(Date.now()+300000).toISOString()}));
  if(req.url==='/api/v1/payments/create')return res.end(JSON.stringify({payment_id:12,amount:'200.00',unique_amount:'200.07',upi_link:'upi://pay?pa=business%40bank&pn=Bank&am=200.07&cu=INR'}));
  if(req.url.includes('get_bank_balance'))return res.end(JSON.stringify({message:{balance:123}}));
  if(req.url.startsWith('/api/resource/Bank%20Account/'))return res.end(JSON.stringify({data:{bank_balance:123,bank_account_no:'private-account'}}));
  if(req.url.includes('get_bank_statements'))return res.end(JSON.stringify({message:null}));
  if(req.url.startsWith('/api/resource/Bank%20Transaction?'))return res.end(JSON.stringify({data:[{name:'bank-tx-1',deposit:200.37,reference_number:'synthetic-reference'}]}));
  if(req.url==='/v1/payments/pay_one')return res.end(JSON.stringify({id:'pay_one',status:'paid',requested_amount:'200.00',payable_amount:'200.37'}));
  res.writeHead(503);res.end('{}');
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const baseUrl='http://127.0.0.1:'+upstream.address().port;
 const config={baseUrl,apiKey:'test-key',apiSecret:'test-secret',bankAccountName:'Business - Test'};
 try{
  const paygate=new BankingConnector({...config,kind:'PAYGATE'});
  const p=await paygate.createPayment({amountPaise:20000n,payeeName:'Bank test',upiId:'business@bank',reference:'order-1',callbackUrl:'https://gateway.example.test/callback'});
  assert.equal(p.amountPaise,20037n);assert.equal(p.externalId,'pay_one');
  assert.equal(requests[0].headers.authorization,'Bearer test-key');
  assert.equal(requests[0].headers['idempotency-key'],'order-1');
  assert.equal(requests[0].body.name,'Bank test');
  assert.equal((await paygate.getPayment('pay_one')).status,'paid');
  await assert.rejects(()=>paygate.createPayment({amountPaise:20001n,payeeName:'Bank',upiId:'business@bank',reference:'fraction'}),/whole/);
  await assert.rejects(()=>paygate.createPayment({amountPaise:20000n,payeeName:'Bank',upiId:'wrong@bank',reference:'wrong'}),/destination/);
  const django=new BankingConnector({...config,kind:'DJANGO_N8N'});
  const d=await django.createPayment({amountPaise:20000n,upiId:'business@bank',reference:'order-2',callbackUrl:'https://gateway.example.test/callback'});
  assert.equal(d.amountPaise,20007n);
  const sent=requests.find(r=>r.url==='/api/v1/payments/create');
  assert.equal(sent.headers['x-gateway-key'],'test-key');assert.equal(sent.body.client_reference,'order-2');
  const bank=new BankingConnector({...config,kind:'INDIA_BANKING'});
  assert.deepEqual(await bank.getBalance(),{bankAccountName:'Business - Test',balance:123,source:'ERPNEXT_BANK_ACCOUNT',bankRefreshVerified:false});
  assert.equal(requests.at(-1).headers.authorization,'token test-key:test-secret');
  assert.equal((await bank.getStatements('2026-10-01','2026-10-31')).transactions[0].name,'bank-tx-1');
  assert.deepEqual(JSON.parse(new URL(requests.at(-1).url,baseUrl).searchParams.get('filters'))[0],['bank_account','=','Business - Test']);
  await assert.rejects(()=>django.getPayment('missing'),/unavailable/);
 }finally{await new Promise(r=>upstream.close(r));}
});
