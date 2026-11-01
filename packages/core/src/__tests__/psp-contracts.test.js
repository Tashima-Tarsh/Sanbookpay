import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PhonePeProvider } from '../providers/phonepe-provider.js';
import { PaytmProvider } from '../providers/paytm-provider.js';
import { IpAllowlist } from '../security-middleware.js';
import PaytmChecksum from 'paytmchecksum';

const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const phone = () => new PhonePeProvider({merchantId:'tenant',clientId:'PSP-MID',environment:'SANDBOX',extra:{saltKey:'test-salt',saltIndex:2}});

test('PhonePe sends the base64 request and retains signature with idempotency', async()=>{
 const provider=phone();let sent;
 provider._request=async(path,options)=>{sent={path,...options};return {ok:true,data:{code:'PAYMENT_INITIATED',data:{merchantTransactionId:'order'}}};};
 await provider.createCollection({merchantOrderId:'order',amountPaise:20100,idempotencyKey:'stable',returnUrl:'https://example.test/return'});
 const envelope=JSON.parse(sent.body);assert.equal(typeof envelope.request,'string');
 const payload=JSON.parse(Buffer.from(envelope.request,'base64'));
 assert.equal(payload.merchantId,'PSP-MID');assert.equal(payload.amount,20100);
 assert.equal(payload.redirectUrl,'https://example.test/return');
 assert.equal(sent.headers['X-VERIFY'],sha(envelope.request+'/pg/v1/pay'+'test-salt')+'###2');
 assert.equal(sent.headers['X-IDempotency-Key'],'stable');
 await assert.rejects(()=>provider.createCollection({merchantOrderId:'bad',amountPaise:1.5}),/integer/);
});

test('PhonePe verifies callback base64, complete salt index and provider merchant',()=>{
 const provider=phone();const data={merchantId:'PSP-MID',merchantTransactionId:'order',transactionId:'payment',amount:20100,state:'COMPLETED'};
 const response=Buffer.from(JSON.stringify({code:'PAYMENT_SUCCESS',data})).toString('base64');
 const rawBody=JSON.stringify({response}),signature=sha(response+'test-salt')+'###2';
 assert.equal(provider.verifyCollectionWebhook({rawBody,headers:{'x-verify':signature}}),true);
 assert.equal(provider.verifyCollectionWebhook({rawBody,headers:{'x-verify':signature.replace('###2','###9')}}),false);
 assert.equal(provider.verifyCollectionWebhook({rawBody,headers:{}}),false);
 assert.equal(provider.verifyCollectionWebhook({rawBody:rawBody.replace(response,response+'x'),headers:{'x-verify':signature}}),false);
 assert.equal(provider.decodeWebhookResponse(rawBody).merchantTransactionId,'order');
 assert.equal(provider.decodeWebhookResponse(rawBody).state,'SUCCESS');
 const foreign=Buffer.from(JSON.stringify({data:{...data,merchantId:'OTHER'}})).toString('base64');
 assert.equal(provider.verifyCollectionWebhook({rawBody:JSON.stringify({response:foreign}),headers:{'x-verify':sha(foreign+'test-salt')+'###2'}}),false);
});

test('PhonePe status requests sign the path and reject foreign or missing payment references',async()=>{
 const provider=phone();let data={merchantId:'PSP-MID',merchantTransactionId:'order',amount:20100,transactionId:'payment',state:'COMPLETED'};
 provider._request=async(path,options)=>{assert.equal(path,'/pg/v1/status/PSP-MID/order');assert.equal(options.headers['X-VERIFY'],sha(path+'test-salt')+'###2');return {ok:true,data:{data}};};
 assert.equal((await provider.getCollectionStatus('order')).status,'SUCCESS');
 data={...data,merchantTransactionId:'foreign'};await assert.rejects(()=>provider.getCollectionStatus('order'),/ownership/i);
 data={...data,merchantTransactionId:'order',transactionId:null};await assert.rejects(()=>provider.getCollectionStatus('order'),/reference/i);
});

// Independent fixed-salt implementation of Paytm's published AES checksum contract.
function checksum(value,key){const salt='abcd',plain=sha(value+'|'+salt)+salt,cipher=crypto.createCipheriv('aes-128-cbc',key,'@@@@&&&&####$$$$');return Buffer.concat([cipher.update(plain,'utf8'),cipher.final()]).toString('base64');}
test('Paytm accepts official form checksum and rejects altered amount',()=>{
 const key='1234567890123456',provider=new PaytmProvider({merchantId:'tenant',clientId:'MID',extra:{merchantKey:key}});
 const payload={MID:'MID',ORDERID:'order',STATUS:'TXN_SUCCESS',TXNAMOUNT:'201.00',TXNID:'payment'};
 payload.CHECKSUMHASH=checksum('MID|order|TXN_SUCCESS|201.00|payment',key);
 const rawBody=new URLSearchParams(payload).toString();
 assert.equal(provider.verifyCollectionWebhook({rawBody,headers:{'content-type':'application/x-www-form-urlencoded'}}),true);
 assert.equal(provider.verifyCollectionWebhook({rawBody:rawBody.replace('201.00','202.00'),headers:{}}),false);
 assert.equal(provider.decodeWebhookResponse(rawBody).state,'SUCCESS');
});

test('IP allowlist honors exact hosts and CIDR without accepting malformed IPs',()=>{
 const list=new IpAllowlist(['203.0.113.5','198.51.100.0/24']);
 assert.equal(list.isAllowed('203.0.113.5'),true);assert.equal(list.isAllowed('203.0.113.6'),false);
 assert.equal(list.isAllowed('198.51.100.42'),true);assert.equal(list.isAllowed('198.51.101.42'),false);
 assert.equal(list.isAllowed('garbage'),false);assert.equal(new IpAllowlist(['0.0.0.0/0']).isAllowed('8.8.8.8'),true);
});

test('Paytm signs the nested initiation body and verifies bound status responses',async()=>{
 const key='1234567890123456',provider=new PaytmProvider({merchantId:'tenant',clientId:'MID',environment:'SANDBOX',extra:{merchantKey:key}});
 let sent;provider._request=async(path,options)=>{sent={path,...options};return {ok:true,data:{body:{resultInfo:{resultCode:'0000',resultStatus:'S'},txnToken:'token'}}};};
 const created=await provider.createCollection({merchantOrderId:'order',amountPaise:20100});
 const request=JSON.parse(sent.body);
 assert.equal(PaytmChecksum.verifySignature(JSON.stringify(request.body),key,request.head.signature),true);
 assert.deepEqual(request.body.txnAmount,{value:'201.00',currency:'INR'});assert.equal(request.body.mid,'MID');
 assert.ok(sent.path.startsWith('/theia/api/v1/initiateTransaction?mid=MID&orderId=order'));
 assert.equal(created.checkoutUrl,null);assert.equal(created.paymentSessionId,'token');
 const body={mid:'MID',orderId:'order',txnAmount:'201.00',txnId:'payment',bankTxnId:'bank',resultInfo:{resultStatus:'TXN_SUCCESS'}};
 provider._request=async(path,options)=>{assert.equal(path,'/v3/order/status');assert.equal(options.method,'POST');return {ok:true,data:{body,head:{signature:checksum(JSON.stringify(body),key)}}};};
 const status=await provider.getCollectionStatus('order');assert.equal(status.status,'SUCCESS');assert.equal(status.amountPaise,20100);assert.equal(status.providerPaymentId,'payment');
 body.orderId='foreign';await assert.rejects(()=>provider.getCollectionStatus('order'),/order|ownership/i);
});
