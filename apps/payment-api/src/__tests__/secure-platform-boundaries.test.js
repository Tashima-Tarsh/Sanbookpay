import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Database,runMigrations,MerchantRepository,PaymentOrderRepository,ProviderConnectionRepository} from '@youpi/db';
import {ProviderRegistry} from '@youpi/core';
import {CashfreeProvider} from '../../../../packages/core/src/providers/cashfree-provider.js';
import {createPaymentApp} from '../index.js';
import '../../../../scripts/test-support.js';

process.env.NODE_ENV='test';
process.env.ENCRYPTION_MASTER_KEY ||= crypto.randomBytes(32).toString('hex');

test('legacy financial aliases enforce authoritative confirmation, ownership and exact-once wallet credit',async t=>{
 const db=new Database({inMemory:true});runMigrations(db);const app=createPaymentApp(db),ctx=app.context;
 await new Promise(r=>app.rawServer.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.rawServer.address().port}`;
 const merchants=new MerchantRepository(db),a=merchants.getDefault(),b=merchants.create({businessName:'Other tenant',slug:'other-tenant',contactEmail:'other@example.test',contactPhone:'9000000000'});
 merchants.update(a.id,{webhookUrl:null});
 const registry=ProviderRegistry.prototype.getProvider,secret='isolated-provider-secret';
 ProviderRegistry.prototype.getProvider=()=>new CashfreeProvider({clientSecret:secret,environment:'SANDBOX'});
 t.after(async()=>{ProviderRegistry.prototype.getProvider=registry;app.destroy();app.rawServer.closeAllConnections();await new Promise(r=>app.rawServer.close(r));db.close();});
 const addKey=(id,mid,scopes,extra={})=>{const key='dp_live_'+id;db.execute('INSERT INTO pp_api_keys(id,merchant_id,label,prefix,secret_hash,scopes,environment,expires_at,rate_limit,ip_allowlist,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[id,mid,id,key,crypto.createHash('sha256').update(key).digest('hex'),JSON.stringify(scopes),extra.environment||'PRODUCTION',extra.expiry||null,1000,'[]',new Date().toISOString()]);return key;};
 const key=addKey('keya',a.id,['payments.create','payments.read']),other=addKey('keyb',b.id,['payments.create','refunds.create']),readOnly=addKey('readonly',a.id,['payments.read']),expired=addKey('expired',a.id,['payments.create'],{expiry:'2000-01-01T00:00:00Z'});
 const call=(path,body,token,headers={})=>fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 const order=new PaymentOrderRepository(db).create({merchantId:a.id,merchantOrderId:'secure-order',providerOrderId:'secure-provider-order',amountPaise:20100,metadata:{playerReference:'player-one'}});
 const payload=payment=>({data:{order:{order_id:'secure-provider-order'},payment:{payment_status:'SUCCESS',payment_amount:'201.00',payment_currency:'INR',cf_payment_id:payment}}});
 const send=async payment=>{const data=payload(payment),timestamp=String(Date.now()),raw=JSON.stringify(data),signature=crypto.createHmac('sha256',secret).update(timestamp+raw).digest('base64');return call('/api/v1/callbacks/providers/cashfree',data,null,{'x-webhook-timestamp':timestamp,'x-webhook-signature':signature});};
 assert.equal(Number(db.queryOne('SELECT COUNT(*) AS n FROM super_admin_users').n),0,'no public default administrator');
 assert.equal((await call('/api/v1/super-admin/login',{email:'superadmin@sanbookpay.com',password:'SanbookPayAdmin_ChangeMe!'})).status,401);
 assert.equal((await call('/api/v1/callbacks/providers/cashfree',payload('payment-one'))).status,401);
 assert.equal(db.queryOne('SELECT status FROM payment_orders WHERE id=?',[order.id]).status,'CREATED');
 assert.equal((await send('payment-one')).status,200);const ledgerCount=Number(db.queryOne('SELECT COUNT(*) AS n FROM ledger_entries').n);assert.ok(ledgerCount>=2);
 assert.equal((await send('payment-one')).status,200);assert.equal(Number(db.queryOne('SELECT COUNT(*) AS n FROM ledger_entries').n),ledgerCount);
 assert.equal((await send('different-payment')).status,409);assert.ok(db.queryOne("SELECT id FROM pp_cases WHERE kind='RECONCILIATION' AND payment_id=?",[order.id]));
 const credit={paymentId:order.id,playerReference:'player-one',amountPaise:20100,idempotencyKey:'credit-one'};
 assert.equal((await call('/api/v1/callbacks/wallets/credit',credit)).status,401);
 assert.equal((await call('/api/v1/callbacks/wallets/credit',credit,other)).status,404);
 assert.equal((await call('/v1/refunds',{paymentId:order.id,amount:'1'},other,{'idempotency-key':'cross-tenant-refund'})).status,404);
 assert.equal((await call('/api/v1/callbacks/wallets/credit',{...credit,amountPaise:1},key)).status,400);
 assert.equal((await call('/api/v1/callbacks/wallets/credit',{...credit,playerReference:'other-player'},key)).status,409);
 assert.equal((await call('/api/v1/callbacks/wallets/credit',credit,key)).status,200);
 const repeated=await(await call('/api/v1/callbacks/wallets/credit',{...credit,idempotencyKey:'different-key'},key)).json();assert.equal(repeated.duplicate,true);
 assert.equal(Number(db.queryOne('SELECT balance_paise FROM gaming_wallets WHERE merchant_id=?',[a.id]).balance_paise),20100);
 assert.equal(Number(db.queryOne('SELECT COUNT(*) AS n FROM wallet_transactions').n),1);
 for(const token of [undefined,expired,readOnly])assert.equal((await call('/api/v1/payment-links/amount-only',{amount:'201'},token,{'idempotency-key':'stable'})).status,token===readOnly?403:401);
 for(const amount of ['12junk','1e3','0','-1','1.001','Infinity','99999999999999999999999'])assert.equal((await call('/api/v1/payment-links/amount-only',{amount},key,{'idempotency-key':'strict-'+amount.replace(/[^a-zA-Z0-9]/g,'')})).status,400,amount);
 const session=ctx.sessionRepo.create({merchantId:a.id,orderId:'preserve-route',amountPaise:20100,status:'QUEUED'});
 assert.equal((await call('/api/v1/payment-links/'+session.id+'/failover',{},key)).status,409);
 assert.equal(ctx.sessionRepo.findById(session.id).receivingAccountId,session.receivingAccountId);
});

test('provider selection uses the exact connection and rejects cross-merchant or ambiguous selection',()=>{
 const db=new Database({inMemory:true});runMigrations(db);const merchants=new MerchantRepository(db),a=merchants.getDefault(),b=merchants.create({businessName:'B',slug:'b',contactEmail:'b@example.test',contactPhone:'9000000000'}),connections=new ProviderConnectionRepository(db);
 try{
  const first=connections.create({merchantId:a.id,providerName:'CASHFREE',clientId:'first',environment:'SANDBOX'}),second=connections.create({merchantId:a.id,providerName:'CASHFREE',clientId:'second',environment:'PRODUCTION'}),registry=new ProviderRegistry({db});
  assert.equal(registry.getProvider(a.id,'CASHFREE',second.id).clientId,'second');
  assert.equal(registry.getProvider(a.id,'CASHFREE',first.id).environment,'SANDBOX');
  assert.throws(()=>registry.getProvider(b.id,'CASHFREE',first.id),/does not belong/);
  assert.throws(()=>registry.getProvider(a.id,'CASHFREE'),/exact provider connection/);
 }finally{db.close();}
});

test('Cashfree order contract rejects missing customer contact and ambiguous validation responses',async()=>{
 const provider=new CashfreeProvider({clientId:'test-client',clientSecret:'test-secret',environment:'SANDBOX'});
 await assert.rejects(()=>provider.createCollection({amountPaise:20100,merchantOrderId:'test-order'}),/requires a real customer phone/);
 provider._request=async()=>({ok:false,status:0});assert.equal((await provider.validateCredentials()).valid,false);
 provider._request=async()=>({ok:false,status:404});assert.equal((await provider.validateCredentials()).valid,false);
 let request;provider._request=async(url,options)=>(request={url,...options},{ok:true,data:{order_id:'test-order',payment_session_id:'real-provider-returned-session'}});
 const created=await provider.createCollection({amountPaise:20100,merchantOrderId:'test-order',customerPhone:'9000000000',idempotencyKey:'attempt-id'});
 assert.equal(created.checkoutUrl,null);assert.equal(request.headers['x-idempotency-key'],'attempt-id');assert.equal(JSON.parse(request.body).customer_details.customer_name,undefined);
});

test('provider timeout preserves its immutable attempt; only preissue health failure selects an approved backup',async t=>{
 const db=new Database({inMemory:true});runMigrations(db);const app=createPaymentApp(db);await new Promise(r=>app.rawServer.listen(0,'127.0.0.1',r));
 const mid=app.context.merchantRepo.getDefault().id,repo=new ProviderConnectionRepository(db),primary=repo.create({merchantId:mid,providerName:'CASHFREE',environment:'PRODUCTION'}),backup=repo.create({merchantId:mid,providerName:'CASHFREE',environment:'PRODUCTION'});
 for(const c of [primary,backup])db.execute('INSERT INTO pp_connection_policy(connection_id,approved,enabled,updated_at) VALUES(?,?,?,?)',[c.id,1,1,new Date().toISOString()]);
 const secret='dp_live_timeout',hash=crypto.createHash('sha256').update(secret).digest('hex');
 db.execute('INSERT INTO pp_api_keys(id,merchant_id,label,prefix,secret_hash,scopes,environment,rate_limit,ip_allowlist,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',['timeout-key',mid,'test','dp_live_',hash,'["payments.create","payments.read"]','PRODUCTION',1000,'[]',new Date().toISOString()]);
 const selected=[],original=ProviderRegistry.prototype.getProvider;let timeout=true;
 ProviderRegistry.prototype.getProvider=(merchant,provider,id)=>({createCollection:async()=>{selected.push(id);if(timeout)throw Error('synthetic lost response');return {providerOrderId:'issued-'+selected.length,paymentSessionId:'session',rawResponse:{}};}});
 t.after(async()=>{ProviderRegistry.prototype.getProvider=original;app.destroy();app.rawServer.closeAllConnections();await new Promise(r=>app.rawServer.close(r));db.close();});
 const call=orderId=>fetch(`http://127.0.0.1:${app.rawServer.address().port}/v1/payments`,{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json','idempotency-key':orderId},body:JSON.stringify({orderId,amount:'201',connectionId:primary.id,playerReference:'opaque-player'})});
 const unknown=await call('uncertain');assert.equal(unknown.status,502);const record=await unknown.json();assert.equal(record.status,'RECONCILIATION_REQUIRED');assert.deepEqual(selected,[primary.id]);
 const attempt=db.queryOne('SELECT * FROM pp_payment_attempts WHERE payment_order_id=?',[record.paymentId]);assert.equal(attempt.connection_id,primary.id);assert.equal(attempt.status,'UNKNOWN');assert.ok(attempt.provider_order_id.startsWith('SB-'));
 assert.equal((await call('uncertain')).status,200);assert.equal(selected.length,1,'retry reuses original order');
 timeout=false;db.execute('UPDATE pp_connection_policy SET open_until=? WHERE connection_id=?',[new Date(Date.now()+60000).toISOString(),primary.id]);
 assert.equal((await call('preissue')).status,201);assert.deepEqual(selected,[primary.id,backup.id]);
 assert.equal(db.queryOne('SELECT route_snapshot FROM pp_payment_attempts WHERE id=?',[attempt.id]).route_snapshot,attempt.route_snapshot);
 assert.ok(db.queryOne("SELECT id FROM pp_audit WHERE action='PREISSUE_ROUTE_SELECTED'"));
});
