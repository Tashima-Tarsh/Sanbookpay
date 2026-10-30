import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Database,runMigrations,MerchantRepository,PaymentSessionRepository,ReceivingAccountRepository} from '@youpi/db';
import {resolveSecret} from '@youpi/common';
import {HttpServer} from '../server.js';
import {registerDynamoPayRoutes} from '../routes/dynamopay.routes.js';
import {validateUpiChannel} from '../upi-channel.js';
let db,server,base,headers,ctx;
before(async()=>{
 db=new Database({inMemory:true});runMigrations(db);const merchantRepo=new MerchantRepository(db),m=merchantRepo.getDefault();
 ctx={db,merchantRepo,sessionRepo:new PaymentSessionRepository(db),accountRepo:new ReceivingAccountRepository(db),queueEngine:{enqueueOrActivate(id,account){return ctx.sessionRepo.acquireSlotAtomic(id,account);}},timingEngine:{startActiveTimer(){}}};
 headers={'Content-Type':'application/json','Client-ID':`dp_client_${m.id}`,'Client-Secret':crypto.createHmac('sha256',resolveSecret('dynamo_client_master_key')).update(m.id).digest('hex'),'Service-Id':m.id};
 const router=new HttpServer();registerDynamoPayRoutes(router,ctx);server=router.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await new Promise(r=>server.close(r));db.close();});
const post=(path,body={})=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
test('versioned collection is exact, idempotent, and refuses a changed amount',async()=>{
 const r=await post('/v1.0/collect/upi',{amount:101,uniquetransactionid:'CUSTOMER-1'});assert.equal(r.status,201);const p=await r.json();assert.ok(p.intent.includes('am=101.00'));assert.ok(p.qr.endsWith('/qr.svg'));assert.ok(p.checkoutUrl.includes('/checkout/'));
 const replay=await post('/v1.0/collect/upi',{amount:101,uniquetransactionid:'CUSTOMER-1'});assert.equal(replay.status,200);assert.equal((await replay.json()).transaction,p.transaction);
 assert.equal((await post('/v1.0/collect/upi',{amount:102,uniquetransactionid:'CUSTOMER-1'})).status,409);
 const queued=await(await post('/v1.0/collect/upi',{amount:102,uniquetransactionid:'CUSTOMER-2'})).json();assert.equal(queued.intent,null);assert.equal(queued.qr,null);
});
test('reject invalid amounts and credentials',async()=>{
 for(const amount of ['NaN','Infinity','101.001',0,-1])assert.equal((await post('/v1.0/collect/upi',{amount,uniquetransactionid:'BAD'})).status,400);
 assert.equal((await fetch(base+'/v1.0/wallet',{method:'POST',headers:{...headers,'Client-Secret':'bad'},body:'{}'})).status,401);
});
test('wallet and checkstatus use paise correctly and expose pending separately',async()=>{
 const w=await post('/v1.0/wallet');assert.equal(w.status,200);assert.equal((await w.json()).currency,'INR');
 const p=ctx.sessionRepo.findByOrderId(headers['Service-Id'],'CUSTOMER-1');ctx.sessionRepo.transitionToProcessing(p.id,1);ctx.sessionRepo.transitionToVerificationPending(p.id);
 const s=await(await post('/v1.0/payin/checkstatus',{uniquetransactionid:'CUSTOMER-1'})).json();assert.equal(s.status,'PENDING');assert.equal(s.internalStatus,'VERIFICATION_PENDING');assert.equal(s.intent,null);
 assert.equal((await post('/v1.0/ifsc/INVALID')).status,400);
});
test('configured UPI channel enforces toggle, limits and beneficiary allowlist',()=>{
 const merchant={branding:{upiChannel:{enabled:true,minAmountPaise:20000,maxAmountPaise:2000000,allowedVpas:['business@upi']}}};
 assert.equal(validateUpiChannel(merchant,20000n,'business@upi'),null);
 assert.equal(validateUpiChannel(merchant,19999n,'business@upi').code,'AMOUNT_OUT_OF_RANGE');
 assert.equal(validateUpiChannel(merchant,2000001n,'business@upi').code,'AMOUNT_OUT_OF_RANGE');
 assert.equal(validateUpiChannel(merchant,20100n,'another@upi').code,'UPI_NOT_WHITELISTED');
 merchant.branding.upiChannel.enabled=false;assert.equal(validateUpiChannel(merchant,20100n,'business@upi').code,'UPI_CHANNEL_DISABLED');
});
test('webhook/IP policy persists and version paths do not accept arbitrary dot characters',async()=>{
 assert.equal((await post('/v1x0/wallet')).status,404);
 assert.equal((await post('/v1.0/merchant/webhook',{webhookUrl:'http://localhost/internal'})).status,400);
 assert.equal((await post('/v1.0/merchant/webhook',{webhookUrl:'https://merchant.example.com/callback',ipWhitelist:['not-an-ip']})).status,400);
 const r=await post('/v1.0/merchant/webhook',{webhookUrl:'https://merchant.example.com/callback',ipWhitelist:['127.0.0.1']});assert.equal(r.status,200);
 assert.deepEqual(ctx.merchantRepo.getDefault().branding.apiIpWhitelist,['127.0.0.1']);
});
test('public collection enforces saved merchant channel policy without breaking old status queries',async()=>{
 const m=ctx.merchantRepo.getDefault(),account=ctx.accountRepo.findActiveForMerchant(m.id);
 const channel={enabled:true,minAmountPaise:20000,maxAmountPaise:2000000,allowedVpas:[account.upiId]};
 const save=()=>ctx.merchantRepo.update(m.id,{branding:{...ctx.merchantRepo.findById(m.id).branding,upiChannel:channel}});save();
 for(const amount of ['199.99','20000.01']){const r=await post('/v1.0/collect/upi',{amount,uniquetransactionid:'LIMIT-'+amount.replace('.','-')});assert.equal(r.status,400);assert.equal((await r.json()).code,'AMOUNT_OUT_OF_RANGE');}
 channel.enabled=false;save();assert.equal((await(await post('/v1.0/collect/upi',{amount:'200.00',uniquetransactionid:'OFF'})).json()).code,'UPI_CHANNEL_DISABLED');
 assert.equal((await post('/v1.0/payin/checkstatus',{uniquetransactionid:'CUSTOMER-1'})).status,200);
 channel.enabled=true;channel.allowedVpas=['another@upi'];save();assert.equal((await(await post('/v1.0/collect/upi',{amount:'200.00',uniquetransactionid:'VPA-BLOCKED'})).json()).code,'UPI_NOT_WHITELISTED');
});
