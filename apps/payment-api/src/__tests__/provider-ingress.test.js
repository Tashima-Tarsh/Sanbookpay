import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Database,runMigrations,PaymentOrderRepository,ProviderConnectionRepository} from '@youpi/db';
import {createPaymentApp} from '../index.js';
import {ProviderRegistry} from '@youpi/core';
import {PhonePeProvider} from '../../../../packages/core/src/providers/phonepe-provider.js';
import PaytmChecksum from 'paytmchecksum';
import '../../../../scripts/test-support.js';

process.env.NODE_ENV='test';
process.env.ENCRYPTION_MASTER_KEY ||= crypto.randomBytes(32).toString('hex');
test('provider registry keeps PSP identity and credentials bound to the selected connection',()=>{
 const db=new Database({inMemory:true});runMigrations(db);
 try{
  const mid=db.queryOne('SELECT id FROM merchants LIMIT 1').id;
  const conn=new ProviderConnectionRepository(db).create({merchantId:mid,providerName:'PHONEPE',clientId:'client-id',businessMerchantId:'BUSINESS-MID',clientSecretEncrypted:'connection-salt',environment:'SANDBOX'});
  const provider=new ProviderRegistry({db}).getProvider(mid,'PHONEPE',conn.id);
  assert.equal(provider.providerMerchantId,'BUSINESS-MID');assert.equal(provider.saltKey,'connection-salt');
  const previous=process.env.PHONEPE_SALT_KEY;process.env.PHONEPE_SALT_KEY='unrelated-global-key';
  try{
   const empty=new ProviderConnectionRepository(db).create({merchantId:mid,providerName:'PHONEPE',clientId:'unconfigured',environment:'SANDBOX'});
   assert.equal(new ProviderRegistry({db}).getProvider(mid,'PHONEPE',empty.id).saltKey,'');
  }finally{if(previous===undefined)delete process.env.PHONEPE_SALT_KEY;else process.env.PHONEPE_SALT_KEY=previous;}
 }finally{db.close();}
});

for(const name of ['PAYTM','CASHFREE'])test(`${name} collection ingress rejects invalid evidence and binds tenant accounting`,async t=>{
 const db=new Database({inMemory:true});runMigrations(db);const app=createPaymentApp(db);
 await new Promise(r=>app.rawServer.listen(0,'127.0.0.1',r));
 t.after(async()=>{app.destroy();app.rawServer.closeAllConnections();await new Promise(r=>app.rawServer.close(r));db.close();});
 const mid=app.context.merchantRepo.getDefault().id,key='1234567890123456';
 app.context.merchantRepo.update(mid,{webhookUrl:'https://merchant.example.test/callback'});
 const conn=new ProviderConnectionRepository(db).create({merchantId:mid,providerName:name,clientId:'MID',clientSecretEncrypted:key,environment:'SANDBOX'});
 const orders=new PaymentOrderRepository(db),order=orders.create({merchantId:mid,merchantOrderId:name+'-order',providerOrderId:name+'-external',providerName:name,amountPaise:20100,metadata:{connectionId:conn.id}});
 const send=async({amount='201.00',valid=true,currency='INR',reference='payment',foreign=false}={})=>{
  let raw,headers={'content-type':'application/json'};
  if(name==='PAYTM'){
   const data={MID:foreign?'OTHER':'MID',ORDERID:name+'-external',TXNID:reference,TXNAMOUNT:amount,STATUS:'TXN_SUCCESS'};
   data.CHECKSUMHASH=valid?await PaytmChecksum.generateSignature({...data},key):'invalid';
   raw=new URLSearchParams(data).toString();headers['content-type']='application/x-www-form-urlencoded';
  }else{
   raw=JSON.stringify({type:'PAYMENT_SUCCESS_WEBHOOK',data:{order:{order_id:name+'-external'},payment:{payment_status:'SUCCESS',payment_amount:amount,payment_currency:currency,cf_payment_id:reference}}});
   headers['x-webhook-timestamp']=String(Date.now());headers['x-webhook-signature']=valid?crypto.createHmac('sha256',key).update(headers['x-webhook-timestamp']+raw).digest('base64'):'invalid';
  }
  return fetch(`http://127.0.0.1:${app.rawServer.address().port}/api/v1/webhooks/${name.toLowerCase()}/collections`,{method:'POST',headers,body:raw});
 };
 assert.equal((await send({valid:false})).status,401);
 assert.equal((await send({amount:'202.00'})).status,409);
 if(name==='PAYTM')assert.equal((await send({foreign:true})).status,401);
 else assert.equal((await send({currency:'USD'})).status,409);
 assert.equal(orders.findById(order.id).status,'CREATED');
 // Keep the outgoing callback in the durable queue rather than contacting a test domain.
 app.context.providerWebhookEngine.retryPending=async()=>[];
 assert.equal((await send()).status,200);assert.equal(orders.findById(order.id).status,'SUCCESS');
 assert.equal((await send()).status,200);
 assert.equal(Number(db.queryOne('SELECT COUNT(*) AS n FROM ledger_transactions WHERE reference_id=?',[order.id]).n),1);
 assert.equal(Number(db.queryOne('SELECT COUNT(*) AS n FROM provider_webhook_deliveries').n),1);
 const second=orders.create({merchantId:mid,merchantOrderId:name+'-second',providerOrderId:name+'-second-ext',providerName:name,amountPaise:20100,metadata:{connectionId:conn.id}});
 // Reference reuse is rejected even for a different owned order.
 const {confirmProviderCollection}=await import('../services/provider-confirmation.js');
 assert.throws(()=>confirmProviderCollection(app.context,second.id,{amountPaise:20100,currency:'INR',providerPaymentId:'payment',actorType:'PROVIDER_WEBHOOK'}),/already assigned/);
});
test('PhonePe ingress verifies before acknowledgement and journals exactly once',async t=>{
 const db=new Database({inMemory:true});runMigrations(db);const app=createPaymentApp(db);
 await new Promise(r=>app.rawServer.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${app.rawServer.address().port}`,mid=app.context.merchantRepo.getDefault().id;
 app.context.merchantRepo.update(mid,{webhookUrl:null});
 const connection=new ProviderConnectionRepository(db).create({merchantId:mid,providerName:'PHONEPE',clientId:'MID',environment:'SANDBOX'});
 const original=ProviderRegistry.prototype.getProvider;
 ProviderRegistry.prototype.getProvider=function(merchant,name,id){assert.equal(merchant,mid);assert.equal(id,connection.id);return new PhonePeProvider({merchantId:mid,clientId:'MID',extra:{saltKey:'test-salt',saltIndex:1}});};
 t.after(async()=>{ProviderRegistry.prototype.getProvider=original;app.destroy();app.rawServer.closeAllConnections();await new Promise(r=>app.rawServer.close(r));db.close();});
 for(const name of ['phonepe','paytm']){
  const response=await fetch(base+'/api/v1/payments/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({merchantId:mid,orderId:'bypass',amountPaise:20100})});
  assert.equal(response.status,410,'untracked provider creation must be retired');
 }
 const offsetRequest=await fetch(base+'/api/v1/payments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({merchantId:mid,orderId:'unsafe-offset',amount:'201',usePaiseOffset:true})});
 assert.equal(offsetRequest.status,503,'in-memory offset allocation must not issue payable sessions');
 const order=new PaymentOrderRepository(db).create({merchantId:mid,merchantOrderId:'order',providerOrderId:'external-order',providerName:'PHONEPE',amountPaise:20100,metadata:{connectionId:connection.id}});
 const send=async({amount=20100,signature=true,payment='provider-payment',orderReference='external-order'}={})=>{
  const response=Buffer.from(JSON.stringify({code:'PAYMENT_SUCCESS',data:{merchantId:'MID',merchantTransactionId:orderReference,transactionId:payment,amount,state:'COMPLETED'}})).toString('base64');
  return fetch(base+'/api/v1/webhooks/phonepe/collections',{method:'POST',headers:{'content-type':'application/json',...(signature?{'x-verify':crypto.createHash('sha256').update(response+'test-salt').digest('hex')+'###1'}:{})},body:JSON.stringify({response})});
 };
 const mismatched=new PaymentOrderRepository(db).create({merchantId:mid,merchantOrderId:'legacy-ref',providerOrderId:'owned-provider-ref',providerName:'PHONEPE',amountPaise:20100,metadata:{connectionId:connection.id}});
 assert.equal((await send({orderReference:'legacy-ref'})).status,404,'merchant reference is not the issued provider order reference');
 assert.equal(new PaymentOrderRepository(db).findById(mismatched.id).status,'CREATED');
 assert.equal((await send({signature:false})).status,401);
 assert.equal((await send({amount:20200})).status,409);
 assert.equal(db.queryOne('SELECT status FROM payment_orders WHERE id=?',[order.id]).status,'CREATED');
 assert.equal((await send()).status,200);
 assert.equal(db.queryOne('SELECT status FROM payment_orders WHERE id=?',[order.id]).status,'SUCCESS');
 const count=()=>Number(db.queryOne("SELECT COUNT(*) AS n FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id WHERE t.reference_id=?",[order.id]).n);
 assert.equal(count(),2);assert.equal((await send()).status,200);assert.equal(count(),2);
 assert.equal((await send({payment:'another-payment'})).status,409);
});
