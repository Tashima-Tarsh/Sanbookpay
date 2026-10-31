import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Database,runMigrations,MerchantRepository,PaymentOrderRepository,ReceivingAccountRepository,PayoutRepository} from '@youpi/db';
import {ObservationNormalizer,ProviderRegistry} from '@youpi/core';
import {createPaymentApp} from '../index.js';
import {authHeaders} from '../../../../scripts/test-support.js';
import {CashfreeProvider} from '../../../../packages/core/src/providers/cashfree-provider.js';

test('production payment boundaries, observer isolation and refund reservations',async t=>{
 const db=new Database({inMemory:true});runMigrations(db);const app=createPaymentApp(db);
 await new Promise(r=>app.rawServer.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.rawServer.address().port}`;
 const merchants=new MerchantRepository(db),merchant=merchants.getDefault(),ctx=app.context;
 merchants.update(merchant.id,{webhookUrl:null});
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
 t.after(async()=>{process.env.NODE_ENV=previous;app.destroy();app.rawServer.closeAllConnections();await new Promise(r=>app.rawServer.close(r));db.close();});
 const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 await t.test('legacy card/netbanking cannot generate production success; settlement never invents a bank credit',async()=>{
  const session=ctx.sessionRepo.create({merchantId:merchant.id,orderId:'NO-FAKE-SUCCESS',amountPaise:400,status:'QUEUED'});
  for(const method of ['card-pay','netbanking-pay'])assert.equal((await post(`/api/v1/checkout/${session.id}/${method}`,{cardNumber:'4111111111111111',bankCode:'HDFC'})).status,503);
  assert.equal(ctx.sessionRepo.findById(session.id).status,'QUEUED');
  for(const path of ['/api/v1/settlements/trigger','/api/v1/split-settlements/settle'])assert.equal((await post(path,{},authHeaders())).status,503);
  assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM settlements').n,0);
 });
 await t.test('production observer evidence is stored and deduplicated without marking a customer paid',()=>{
  const account=ctx.accountRepo.findActiveForMerchant(merchant.id);
  const session=ctx.sessionRepo.create({merchantId:merchant.id,receivingAccountId:account.id,orderId:'SUPPLEMENTARY',amountPaise:20100,status:'ACTIVE'});
  const evidence=ObservationNormalizer.normalize({source:'SMS_GATEWAY',receivingAccountId:account.id,amount:'201.00',bankReferenceNumber:'900000000101',observedAt:new Date(),rawPayload:{text:'synthetic isolated test'}});
  const result=ctx.attributionEngine.processObservation(evidence);assert.equal(result.attributed,false);assert.equal(result.outcomeStatus,'VERIFICATION_PENDING');
  assert.notEqual(ctx.sessionRepo.findById(session.id).status,'SUCCESS');assert.equal(ctx.attributionEngine.processObservation(evidence).duplicate,true);
  const alternate=ObservationNormalizer.normalize({...evidence,source:'MANUAL_COUNTER',bankReferenceNumber:'900000000104'});
  assert.equal(ctx.attributionEngine.processObservation(alternate).attributed,false);
  assert.notEqual(ctx.sessionRepo.findById(session.id).status,'SUCCESS');
 });
 await t.test('rejected Gmail evidence cannot bypass validation using a supplied amount and UTR',async()=>{
  const account=ctx.accountRepo.findActiveForMerchant(merchant.id);
  const before=db.queryOne('SELECT COUNT(*) AS n FROM payment_observations').n;
  const res=await post('/api/v1/pollers/events',{source:'GMAIL',receivingAccountId:account.id,sender:'attacker@example.com',rawText:'INR 201.00 credited UTR 900000000102',amountPaise:20100,bankReferenceNumber:'900000000102'},authHeaders());
  assert.equal(res.status,200);assert.equal((await res.json()).accepted,false);assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM payment_observations').n,before);
 });
 await t.test('bank review is admin-only, requires explicit review, records a real reference once and rolls back journal errors',async()=>{
  const session=ctx.sessionRepo.findByOrderId(merchant.id,'SUPPLEMENTARY');
  const path=`/api/v1/admin/console/payments/${session.id}/confirm-reviewed`;
  const review={bankReference:'900000000101',reason:'Reviewed exact credit in receiving bank account',bankReviewed:true};
  assert.equal((await post(path,review)).status,401);
  assert.equal((await post(path,{...review,bankReviewed:false},authHeaders())).status,400);
  const execute=db.execute.bind(db);db.execute=(sql,params)=>{if(sql.includes('INSERT INTO ledger_entries'))throw Error('synthetic journal failure');return execute(sql,params);};
  try{assert.equal((await post(path,review,authHeaders())).status,409);}finally{db.execute=execute;}
  assert.notEqual(ctx.sessionRepo.findById(session.id).status,'SUCCESS');
  assert.equal((await post(path,review,authHeaders())).status,200);
  assert.equal((await post(path,review,authHeaders())).status,200);
  assert.equal(ctx.sessionRepo.findById(session.id).verificationTag,'MERCHANT_CONFIRMED');
  assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM ledger_transactions WHERE reference_id=?',[session.id]).n,1);
  const other=ctx.sessionRepo.create({merchantId:merchant.id,orderId:'REUSED-BANK-REVIEW',amountPaise:20100,status:'EXPIRED'});
  assert.equal((await post(`/api/v1/admin/console/payments/${other.id}/confirm-reviewed`,review,authHeaders())).status,409);
 });
 await t.test('Android heartbeat requires a paired signature and device account ownership',async()=>{
  const deviceId='hardened-test-device',key='isolated-device-signing-key';
  db.execute('INSERT INTO android_devices(id,merchant_id,device_name,signing_key_hash) VALUES(?,?,?,?)',[deviceId,merchant.id,'Test',key]);
  assert.equal((await post('/api/v1/observers/heartbeat',{deviceId})).status,401);
  const body={deviceId},raw=JSON.stringify(body),timestamp=Date.now().toString();
  const signature=crypto.createHmac('sha256',key).update(raw+':'+timestamp).digest('hex');
  assert.equal((await post('/api/v1/observers/heartbeat',body,{'x-device-id':deviceId,'x-timestamp':timestamp,'x-signature':signature})).status,200);
  const other=merchants.create({businessName:'Other',slug:'other-hardened',contactEmail:'other@example.test',contactPhone:''});
  const account=new ReceivingAccountRepository(db).create({merchantId:other.id,upiId:'other@bank',payeeName:'Other'});
  const message={deviceId,receivingAccountId:account.id,amount:201,body:'INR 201 credited UTR 900000000103',sender:'HDFCBK'},messageRaw=JSON.stringify(message);
  const denied=await post('/api/v1/observers/sms',message,{'x-device-id':deviceId,'x-timestamp':timestamp,'x-signature':crypto.createHmac('sha256',key).update(messageRaw+':'+timestamp).digest('hex')});assert.equal(denied.status,403);
 });
 await t.test('refund limits are reserved before network calls, replay is idempotent, uncertain provider results stay reserved',async()=>{
  const order=new PaymentOrderRepository(db).create({merchantId:merchant.id,merchantOrderId:'REFUND-BOUNDS',amountPaise:10000,status:'SUCCESS'});
  let calls=0;const original=ProviderRegistry.prototype.getProvider;
  ProviderRegistry.prototype.getProvider=()=>({createRefund:async()=>{calls++;return{providerRefundId:'provider-refund',status:'PENDING'};}});
  const headers=authHeaders({'x-api-key':merchant.id});
  try{
   const first=await post('/api/v1/refunds',{paymentId:order.id,refundId:'ONE-REFUND',amount:60},headers);assert.equal(first.status,201);
   assert.equal((await post('/api/v1/refunds',{paymentId:order.id,refundId:'ONE-REFUND',amount:60},headers)).status,200);assert.equal(calls,1);
   assert.equal((await post('/api/v1/refunds',{paymentId:order.id,refundId:'OVER-REFUND',amount:60},headers)).status,409);assert.equal(calls,1);
   ProviderRegistry.prototype.getProvider=()=>({createRefund:async()=>{throw Error('synthetic lost response');}});
   const uncertain=await post('/api/v1/refunds',{paymentId:order.id,refundId:'UNKNOWN-REFUND',amount:40},headers);assert.equal(uncertain.status,502);
   assert.equal(db.queryOne("SELECT status FROM refunds WHERE refund_id='UNKNOWN-REFUND'").status,'RECONCILIATION_REQUIRED');
   assert.equal((await post('/api/v1/refunds',{paymentId:order.id,refundId:'NO-REMAINING',amount:1},headers)).status,409);
  }finally{ProviderRegistry.prototype.getProvider=original;}
 });
 await t.test('payout signatures use the payout contract, not the PG timestamp signature',()=>{
  const provider=new CashfreeProvider({clientSecret:'payout-test-secret'}),raw='{"status":"SUCCESS"}';
  const signature=crypto.createHmac('sha256','payout-test-secret').update(raw).digest('hex');
  assert.equal(provider.verifyPayoutWebhook({rawBody:raw,headers:{'x-cf-signature':signature}}),true);
  assert.equal(provider.verifyPayoutWebhook({rawBody:raw+' ',headers:{'x-cf-signature':signature}}),false);
  assert.equal(provider.verifyPayoutWebhook({rawBody:raw,headers:{'x-webhook-signature':signature}}),false);
 });
 await t.test('HTTP 200 with an invalid provider body does not create an accepted financial instruction',async()=>{
  const provider=new CashfreeProvider({clientSecret:'isolated-test'});
  provider._request=async()=>({ok:true,status:200,data:{status:'ERROR'}});
  await assert.rejects(provider.createPayout({transferId:'INVALID-TRANSFER',beneficiaryId:'test',amountPaise:400}),/recognized transfer status/);
  await assert.rejects(provider.createCollection({merchantOrderId:'INVALID-ORDER',amountPaise:400,customerPhone:'9000000000'}),/valid payable collection/);
 });
 await t.test('provider rejection reverses a reserved refund journal and releases the refundable balance',async()=>{
  const order=new PaymentOrderRepository(db).create({merchantId:merchant.id,merchantOrderId:'REFUND-REJECTED',amountPaise:5000,status:'SUCCESS'});
  const before=Number(db.queryOne("SELECT balance_paise FROM ledger_accounts WHERE merchant_id=? AND account_code='PROVIDER_CLEARING'",[merchant.id]).balance_paise);
  const original=ProviderRegistry.prototype.getProvider;ProviderRegistry.prototype.getProvider=()=>({createRefund:async()=>({status:'FAILED'})});
  try{
   const response=await post('/api/v1/refunds',{paymentId:order.id,refundId:'PROVIDER-DECLINED',amount:50},authHeaders({'x-api-key':merchant.id}));assert.equal(response.status,201);assert.equal((await response.json()).status,'FAILED');
   assert.equal(Number(db.queryOne("SELECT balance_paise FROM ledger_accounts WHERE merchant_id=? AND account_code='PROVIDER_CLEARING'",[merchant.id]).balance_paise),before);
  }finally{ProviderRegistry.prototype.getProvider=original;}
 });
 await t.test('payout approval response or lost response cannot downgrade an earlier success callback',async()=>{
  const payouts=new PayoutRepository(db),original=ProviderRegistry.prototype.getProvider;
  try{
   for(const throws of [false,true]){
    const payout=payouts.create({merchantId:merchant.id,transferId:'APPROVAL-RACE-'+throws,idempotencyKey:'APPROVAL-RACE-'+throws,amountPaise:400,status:'APPROVAL_REQUIRED'});
    ProviderRegistry.prototype.getProvider=()=>({createPayout:async()=>{payouts.update(payout.id,{status:'SUCCESS',utr:'900000000111'});if(throws)throw Error('synthetic lost response');return{status:'PROCESSING',providerTransferId:'race'};}});
    const response=await post(`/api/v1/payouts/${payout.id}/approve`,{approverId:'TEST-OWNER',decision:'APPROVED'},authHeaders({'x-api-key':merchant.id}));
    assert.equal(response.status,throws?502:200);assert.equal(payouts.findById(payout.id).status,'SUCCESS');
    if(!throws)assert.equal((await response.json()).status,'SUCCESS');
   }
  }finally{ProviderRegistry.prototype.getProvider=original;}
 });
 await t.test('merchant acceptance rules are authorized, enforced, auditable and reversible',async()=>{
  const account=ctx.accountRepo.findActiveForMerchant(merchant.id),root='/api/v1/admin/console/payment-rules';
  const rule={ruleType:'BLOCK',targetType:'RECEIVING_VPA',target:account.upiId,reason:'Temporarily reviewing this bank account'};
  assert.equal((await post(root,rule)).status,401);
  const saved=await post(root,rule,authHeaders());assert.equal(saved.status,201);const block=await saved.json();
  const make=()=>post('/api/v1/payments',{orderId:'RULE-TEST-'+crypto.randomUUID(),amount:'201.00',merchantId:merchant.id},{'x-merchant-id':merchant.id,'x-merchant-key':merchant.webhookSecret});
  assert.equal((await make()).status,403);
  assert.equal((await post(root,{...rule,ruleType:'ALLOW'},authHeaders())).status,201);
  assert.equal((await make()).status,403);
  assert.equal((await post(root+'/'+block.id+'/state',{active:false,reason:'Bank review completed'},authHeaders())).status,200);
  assert.equal((await post(root,{...rule,ruleType:'WATCH'},authHeaders())).status,201);
  assert.equal((await make()).status,201);
  assert.ok(db.queryOne("SELECT COUNT(*) AS n FROM audit_logs WHERE action='WATCHLIST_MATCH'").n>0);
  assert.ok(db.queryOne("SELECT COUNT(*) AS n FROM audit_logs WHERE action='PAYMENT_RULE_STATE_CHANGED'").n>0);
  assert.equal((await post(root,{...rule,expiresAt:'2000-01-01T00:00:00Z'},authHeaders())).status,400);
 });
});
