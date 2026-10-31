import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Database,MerchantRepository,ReceivingAccountRepository,PaymentSessionRepository} from '@youpi/db';
import {HttpServer} from '../server.js';
import {registerPlatformPayments} from '../platform/payments.js';

process.env.NODE_ENV='test';
process.env.ENCRYPTION_MASTER_KEY=crypto.randomBytes(32).toString('hex');

test('scoped keys enforce tenant, revocation, suspension, idempotency and persisted quotas',async()=>{
 const db=new Database({inMemory:true});
 const {runMigrations}=await import('../../../../packages/db/src/migrate.js');runMigrations(db);
 const merchantRepo=new MerchantRepository(db), accountRepo=new ReceivingAccountRepository(db),sessionRepo=new PaymentSessionRepository(db);
 const a=merchantRepo.create({businessName:'Independent A',slug:'independent-a',contactEmail:'a@example.test',contactPhone:'9000000001'});
 const b=merchantRepo.create({businessName:'Independent B',slug:'independent-b',contactEmail:'b@example.test',contactPhone:'9000000002'});
 accountRepo.create({merchantId:a.id,upiId:'tenant-a@bank',payeeName:'Independent A'});
 db.execute('CREATE TABLE pp_merchants(merchant_id TEXT PRIMARY KEY,status TEXT,profile TEXT,created_at TEXT,updated_at TEXT)');
 db.execute('INSERT INTO pp_merchants VALUES(?,?,?,?,?)',[a.id,'ACTIVE','{}',new Date().toISOString(),new Date().toISOString()]);
 const server=new HttpServer();
 const identity={authorize:()=>true,tenant:req=>req.platform.merchantId,audit:()=>{}};
 server.use((req)=>{if(req.headers['x-test-owner'])req.platform={merchantId:a.id,userId:'test-owner',role:'OWNER',platform:false,permissions:['*']};return false;});
 const api=registerPlatformPayments(server,{db,merchantRepo,accountRepo,sessionRepo,auditRepo:{log(){}},queueEngine:{enqueueOrActivate:()=>({})},timingEngine:{startActiveTimer(){}},checkoutBaseUrl:'https://checkout.example.test'},identity);
 server.use(api.guard);
 const http=server.createServer();await new Promise(r=>http.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+http.address().port;
 const call=async(path,body,headers={})=>{const res=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
 try{
 const made=await call('/api/platform/v1/api-keys',{label:'Server',scopes:['payments.create','payments.read'],environment:'PRODUCTION',rateLimit:100},{'x-test-owner':'yes'});
 assert.equal(made.status,201);assert.match(made.body.secret,/^dp_live_/);
 assert.ok(!JSON.stringify(db.query('SELECT * FROM pp_api_keys')).includes(made.body.secret));
 const auth={authorization:'Bearer '+made.body.secret,'idempotency-key':'request-one'};
 let first=await call('/v1/payments',{orderId:'same-order',amount:'201.00',merchantId:b.id},auth);
 assert.equal(first.status,201);assert.equal(db.queryOne('SELECT merchant_id FROM payment_sessions WHERE id=?',[first.body.paymentId]).merchant_id,a.id);
 assert.equal((await call('/v1/payments',{orderId:'same-order',amount:'201.00'},auth)).body.paymentId,first.body.paymentId);
 assert.equal((await call('/v1/payments',{orderId:'different',amount:'201.00'},auth)).status,409);
 assert.equal((await call('/v1/payments',{orderId:'same-order',amount:'202.00'},{...auth,'idempotency-key':'other'})).status,409);
 assert.equal((await call('/v1/payments/not-owned',undefined,auth)).status,404);
 const consoleHeaders={'x-test-owner':'yes','idempotency-key':'console-request'};
 const consolePayment=await call('/api/platform/v1/payments',{orderId:'console-order',amount:'201.00'},consoleHeaders);
 assert.equal(consolePayment.status,201);
 assert.equal(db.queryOne('SELECT merchant_id FROM payment_sessions WHERE id=?',[consolePayment.body.paymentId]).merchant_id,a.id);
 assert.equal((await call('/api/platform/v1/payments',{orderId:'console-order',amount:'201.00'},consoleHeaders)).body.paymentId,consolePayment.body.paymentId);
 const authorize=identity.authorize;identity.authorize=()=>false;
 assert.equal((await call('/api/platform/v1/payments',{orderId:'denied-order',amount:'201.00'},consoleHeaders)).status,403);identity.authorize=authorize;
 assert.equal((await call('/v1/balance',undefined,auth)).status,403);
 db.execute("UPDATE pp_merchants SET status='SUSPENDED' WHERE merchant_id=?",[a.id]);
 assert.equal((await call('/v1/payments',{orderId:'new-order',amount:'201'}, {...auth,'idempotency-key':'new'})).status,403);
 assert.equal((await call('/v1/payments/'+first.body.paymentId,undefined,auth)).status,200);
 assert.equal((await call('/api/platform/v1/api-keys/'+made.body.key.id+'/revoke',{}, {'x-test-owner':'yes'})).status,200);
 assert.equal((await call('/v1/payments/'+first.body.paymentId,undefined,auth)).status,401);
 assert.equal((await call('/v1/payments',{orderId:'no-key',amount:'201'})).status,401);
 }finally{await new Promise(r=>http.close(r));db.close();}
});
