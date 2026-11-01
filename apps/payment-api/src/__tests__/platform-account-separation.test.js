import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
process.env.NODE_ENV='test';process.env.BASE_CHECKOUT_URL='http://localhost';process.env.BASE_PAYMENT_API_URL='http://localhost';process.env.JWT_SECRET='isolated-platform-check-'+crypto.randomBytes(16).toString('hex');process.env.ENCRYPTION_MASTER_KEY=crypto.randomBytes(32).toString('hex');process.env.INITIAL_ADMIN_EMAIL='platform@separation.test';process.env.INITIAL_ADMIN_PASSWORD=crypto.randomBytes(24).toString('hex');
const {Database,runMigrations}=await import('@youpi/db');const {PLATFORM_ACCOUNT_ID}=await import('@youpi/common');const {initializePlatform}=await import('../platform/schema.js');const {createPaymentApp}=await import('../index.js');
test('platform bootstrap is preserved but never listed, counted or handed over as a customer merchant',async()=>{
 const db=new Database({inMemory:true});runMigrations(db);initializePlatform(db);const stamp=new Date().toISOString();
 // Reproduce an older live install that had promoted the bootstrap into the customer directory.
 db.execute("INSERT INTO pp_merchants VALUES(?,'ACTIVE',?,?,?)",[PLATFORM_ACCOUNT_ID,JSON.stringify({businessName:'Dynamo Pay',legacyInstallation:true}),stamp,stamp]);
 const app=createPaymentApp(db);app.context.platformDelivery=async()=>{};await new Promise(r=>app.rawServer.listen(0,'127.0.0.1',r));
 const token=crypto.randomBytes(24).toString('hex');db.execute('INSERT INTO pp_users(id,email,password_hash,role,active,email_verified,mobile_verified,mfa_secret,created_at) VALUES(?,?,?,?,1,1,1,?,?)',['separation-root','root@separation.test','unused','SUPER_ADMIN','test-mfa',stamp]);
 db.execute('INSERT INTO pp_sessions(id,user_id,token_hash,csrf_token,mfa_verified,expires_at,created_at) VALUES(?,?,?,?,1,?,?)',['separation-session','separation-root',crypto.createHash('sha256').update(token).digest('hex'),'csrf',new Date(Date.now()+60000).toISOString(),stamp]);
 const root='http://127.0.0.1:'+app.rawServer.address().port+'/api/platform/v1';const headers={cookie:'dp_platform_session='+token,'x-csrf-token':'csrf','content-type':'application/json'};
 const call=async(path,body)=>{const r=await fetch(root+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 try{
  const empty=await call('/merchants');assert.equal(empty.status,200);assert.equal(empty.body.total,0);assert.deepEqual(empty.body.merchants,[]);
  assert.equal((await call('/merchants?status=ACTIVE')).body.total,0);
  assert.equal((await call('/merchants/'+PLATFORM_ACCOUNT_ID)).status,409);
  assert.equal((await call('/merchants/'+PLATFORM_ACCOUNT_ID+'/state',{status:'SUSPENDED',reason:'Must not modify platform through customer controls'})).status,409);
  assert.equal((await call('/integration-pack?merchantId='+PLATFORM_ACCOUNT_ID,{})).status,409);
  const made=await call('/merchants',{businessName:'Actual Customer Games',contactName:'Customer owner',email:'owner@customer.test',mobile:'+919000000001',category:'Integration testing'});assert.equal(made.status,201);assert.notEqual(made.body.merchantId,PLATFORM_ACCOUNT_ID);
  const listed=await call('/merchants');assert.equal(listed.body.total,1);assert.equal(listed.body.merchants[0].merchant_id,made.body.merchantId);assert.equal(listed.body.merchants[0].profile.businessName,'Actual Customer Games');
  assert.ok(app.context.merchantRepo.findById(PLATFORM_ACCOUNT_ID),'internal technical account and its foreign-key references are preserved');assert.equal(db.queryOne('SELECT status FROM pp_merchants WHERE merchant_id=?',[PLATFORM_ACCOUNT_ID]).status,'ACTIVE');
 }finally{app.destroy();app.rawServer.closeAllConnections();await new Promise(r=>app.rawServer.close(r));db.close();}
});
