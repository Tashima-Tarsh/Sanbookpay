import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { HyperswitchProvider } from '../providers/hyperswitch-provider.js';

const config={merchantId:'local-merchant',clientId:'merchant_owner',clientSecret:'private-api-key',webhookSecret:'private-webhook-key',environment:'SANDBOX',extra:{profileId:'pro_owner'}};
const payment={payment_id:'pay_sb123',merchant_id:'merchant_owner',profile_id:'pro_owner',amount:100,currency:'INR',status:'requires_payment_method',payment_link:{link:'https://sandbox.hyperswitch.io/payment_link/owner/pay_sb123'},client_secret:'never-store-me'};
test('creates a real API payment link with stable ID and no card data or exposed secrets',async()=>{
  const calls=[];const p=new HyperswitchProvider({...config,transport:async(url,options)=>{calls.push({url,...options});return new Response(JSON.stringify(payment),{status:200});}});
  const result=await p.createCollection({merchantOrderId:'pay_sb123',amountPaise:100,currency:'INR',returnUrl:'https://merchant.example/return'});
  assert.equal(calls[0].url,'https://sandbox.hyperswitch.io/payments');assert.equal(calls[0].headers['api-key'],config.clientSecret);
  const sent=JSON.parse(calls[0].body);assert.equal(sent.payment_id,'pay_sb123');assert.equal(sent.amount,100);assert.equal(sent.payment_link,true);assert.equal(sent.profile_id,'pro_owner');assert.equal(sent.confirm,false);
  assert.equal(result.providerOrderId,'pay_sb123');assert.equal(result.checkoutUrl,payment.payment_link.link);assert.ok(!JSON.stringify(result).includes('never-store-me'));
});
test('status inquiry binds payment, merchant and profile and only full captured success is paid',async()=>{
  let data={...payment,status:'succeeded',amount_received:100,payment_method:'card'};
  const p=new HyperswitchProvider({...config,transport:async()=>new Response(JSON.stringify(data))});
  const result=await p.getCollectionStatus('pay_sb123');assert.equal(result.status,'SUCCESS');assert.equal(result.amountPaise,100);assert.equal(result.paymentMethod,'CARD');
  for(const status of ['requires_capture','partially_captured','processing','requires_customer_action']){data={...payment,status,amount_received:50};assert.notEqual((await p.getCollectionStatus('pay_sb123')).status,'SUCCESS');}
  for(const patch of [{payment_id:'another'},{merchant_id:'another'},{profile_id:'another'},{amount:1.5},{status:'succeeded',amount_received:50}]){data={...payment,...patch};await assert.rejects(p.getCollectionStatus('pay_sb123'));}
});
test('webhook verification uses raw SHA512 and fails on absent, malformed or changed signatures',()=>{
  const p=new HyperswitchProvider(config),raw=Buffer.from('{"amount":100}');
  const signature=crypto.createHmac('sha512',config.webhookSecret).update(raw).digest('hex');
  assert.equal(p.verifyCollectionWebhook({rawBody:raw,headers:{'x-webhook-signature-512':signature}}),true);
  for(const sig of ['',signature.slice(2),'x'.repeat(128)])assert.equal(p.verifyCollectionWebhook({rawBody:raw,headers:{'x-webhook-signature-512':sig}}),false);
  assert.equal(p.verifyCollectionWebhook({rawBody:Buffer.from('{ "amount":100}'),headers:{'x-webhook-signature-512':signature}}),false);
});
test('malformed create results and timeouts stay uncertain; explicit invalid credentials are rejected',async()=>{
  for(const patch of [{payment_id:'different'},{profile_id:'other'},{payment_link:null},{payment_link:{link:'http://unsafe.example/pay'}}]){
    const p=new HyperswitchProvider({...config,transport:async()=>new Response(JSON.stringify({...payment,...patch}))});
    await assert.rejects(p.createCollection({merchantOrderId:'pay_sb123',amountPaise:100,currency:'INR',returnUrl:'https://example.test/return'}),e=>!e.definitiveRejection);
  }
  const p=new HyperswitchProvider({...config,transport:async()=>new Response('{"error":"private-api-key"}',{status:401})});
  await assert.rejects(p.createCollection({merchantOrderId:'pay_sb123',amountPaise:100,currency:'INR',returnUrl:'https://example.test/return'}),e=>e.definitiveRejection&&!e.message.includes(config.clientSecret));
});

test('operator-configured self-hosted sandbox accepts only its configured checkout origin',async()=>{
  const before={api:process.env.HYPERSWITCH_SANDBOX_BASE_URL,checkout:process.env.HYPERSWITCH_SANDBOX_CHECKOUT_ORIGIN};
  process.env.HYPERSWITCH_SANDBOX_BASE_URL='http://localhost:8080';process.env.HYPERSWITCH_SANDBOX_CHECKOUT_ORIGIN='http://localhost:8080';
  try{
    const p=new HyperswitchProvider(config);assert.equal(p.baseUrl,'http://localhost:8080');
    assert.equal(p.hostedLink({payment_link:{link:'http://localhost:8080/pay/test'}}),'http://localhost:8080/pay/test');
    assert.throws(()=>p.hostedLink({payment_link:{link:'http://localhost:9999/pay/test'}}));
    assert.equal(new HyperswitchProvider({...config,environment:'PRODUCTION'}).baseUrl,'https://api.hyperswitch.io');
  }finally{for(const [name,value] of Object.entries({HYPERSWITCH_SANDBOX_BASE_URL:before.api,HYPERSWITCH_SANDBOX_CHECKOUT_ORIGIN:before.checkout}))if(value===undefined)delete process.env[name];else process.env[name]=value;}
});
