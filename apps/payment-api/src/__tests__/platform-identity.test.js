import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '@youpi/db';
import { MerchantRepository } from '@youpi/db';
import { HttpServer } from '../server.js';
import { initializePlatform } from '../platform/schema.js';
import { registerPlatformIdentity, hashPlatformPassword, verifyPlatformPassword, totp } from '../platform/identity.js';

test('platform passwords use scrypt and TOTP accepts known RFC vector', () => {
  const hash = hashPlatformPassword('very-long-password');
  assert.match(hash, /^scrypt:/);
  assert.equal(verifyPlatformPassword('very-long-password', hash), true);
  assert.equal(verifyPlatformPassword('wrong', hash), false);
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082');
});

test('tenant sessions persist through registration restart and cannot cross tenant or bypass CSRF', async () => {
  const db=new Database({inMemory:true});
  const { runMigrations }=await import('../../../../packages/db/src/migrate.js');
  runMigrations(db); initializePlatform(db);
  const repo=new MerchantRepository(db); const delivered=[];
  let server=new HttpServer(); let identity=registerPlatformIdentity(server,{db,merchantRepo:repo,platformDelivery:async message=>delivered.push(message)});server.use(identity.guard);
  let http=server.createServer(); await new Promise(r=>http.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${http.address().port}`;
  let cookie='',csrf='';
  const call=async(path,body,extra={})=>fetch(base+'/api/platform/v1'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
  try {
    for(const email of ['one@example.test','two@example.test'])assert.equal((await call('/register',{email,password:'safe-password-123',businessName:email,mobile:'919876543210',contactName:'Owner'})).status,201);
    const login=await call('/login',{email:'one@example.test',password:'safe-password-123'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).csrfToken;
    const me=await(await call('/me')).json();assert.ok(me.user.merchantId);
    const verification=delivered.filter(m=>m.to==='one@example.test'||m.to==='919876543210');
    const emailToken=verification.find(m=>m.channel==='email').token;
    assert.equal((await call('/verify',{channel:'email',token:emailToken})).status,200);
    assert.equal((await call('/verify',{channel:'email',token:emailToken})).status,400);
    assert.equal((await call('/onboarding',{category:'Services',address:'Example address',submit:true})).status,400);
    assert.equal((await call('/verify',{channel:'mobile',token:delivered.find(m=>m.channel==='mobile').token})).status,200);
    assert.equal((await call('/onboarding',{category:'Services',address:'Example address',submit:true})).status,200);
    assert.equal(db.queryOne('SELECT status FROM pp_merchants WHERE merchant_id = ?', [me.user.merchantId]).status,'UNDER_REVIEW');
    assert.equal((await call('/staff/invite',{email:'helper@example.test',role:'ADMIN'})).status,403);
    const enrollment=await(await call('/mfa/enroll',{})).json();assert.ok(enrollment.secret);
    assert.equal((await call('/mfa/confirm',{code:totp(enrollment.secret)})).status,200);
    assert.equal((await call('/staff/invite',{email:'helper@example.test',role:'VIEWER'})).status,201);
    const invitation=delivered.find(m=>m.kind==='invitation');
    assert.equal((await call('/invitations/accept',{token:invitation.token,password:'new-safe-password-123'})).status,201);
    assert.equal(db.queryOne('SELECT merchant_id FROM pp_users WHERE email = ?', ['helper@example.test']).merchant_id,me.user.merchantId);
    const helper=db.queryOne('SELECT id FROM pp_users WHERE email = ?', ['helper@example.test']);
    assert.equal((await call('/staff/'+helper.id,{role:'OWNER'})).status,403);
    assert.equal((await call('/staff/'+helper.id,{role:'VIEWER',permissions:['payments.read']})).status,200);
    const mfaLogin=await(await call('/login',{email:'one@example.test',password:'safe-password-123'})).json();assert.equal(mfaLogin.mfaRequired,true);assert.ok(mfaLogin.challenge);
    assert.equal((await call('/login/mfa',{challenge:mfaLogin.challenge,code:'000000'})).status,401);
    assert.equal((await call('/onboarding',{businessName:'One'}, {'X-CSRF-Token':'wrong'})).status,403);
    assert.equal((await call('/merchants')).status,403);
    const other=db.queryOne('SELECT merchant_id FROM pp_users WHERE email = ?', ['two@example.test']).merchant_id;
    assert.equal((await call('/merchants/'+other)).status,403);
    await new Promise(r=>http.close(r));server=new HttpServer();identity=registerPlatformIdentity(server,{db,merchantRepo:repo,platformDelivery:async message=>delivered.push(message)});server.use(identity.guard);http=server.createServer();await new Promise(r=>http.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${http.address().port}`;
    assert.equal((await call('/me')).status,200);
    assert.equal((await call('/password-reset/request',{email:'one@example.test'})).status,200);
    const reset=delivered.find(m=>m.kind==='password_reset');assert.ok(reset.token);
    assert.equal((await call('/password-reset/confirm',{token:reset.token,password:'replacement-password-123'})).status,200);
    assert.equal((await call('/password-reset/confirm',{token:reset.token,password:'replacement-password-123'})).status,400);
    assert.equal((await call('/me')).status,401);
    assert.equal(Number(db.queryOne('SELECT COUNT(*) AS n FROM payment_receiving_accounts WHERE merchant_id = ?', [me.user.merchantId]).n),0);
  } finally {await new Promise(r=>http.close(r));db.close();}
});

test('missing delivery adapter preserves pending account without verification or default receiving config', async()=>{
  const db=new Database({inMemory:true});const {runMigrations}=await import('../../../../packages/db/src/migrate.js');runMigrations(db);
  const old=process.env.PLATFORM_VERIFICATION_URL;delete process.env.PLATFORM_VERIFICATION_URL;
  const server=new HttpServer(),repo=new MerchantRepository(db),identity=registerPlatformIdentity(server,{db,merchantRepo:repo});server.use(identity.guard);const http=server.createServer();await new Promise(r=>http.listen(0,'127.0.0.1',r));
  try{const response=await fetch(`http://127.0.0.1:${http.address().port}/api/platform/v1/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'pending@example.test',password:'safe-password-123',businessName:'Pending',contactName:'Owner',mobile:'919876543210'})});assert.equal(response.status,503);const body=await response.json();assert.equal(body.accountCreated,true);assert.equal(db.queryOne('SELECT status FROM pp_merchants WHERE merchant_id = ?',[body.merchantId]).status,'EMAIL_PENDING');assert.equal(db.queryOne('SELECT email_verified FROM pp_users WHERE email = ?',['pending@example.test']).email_verified,0);}finally{await new Promise(r=>http.close(r));db.close();if(old!==undefined)process.env.PLATFORM_VERIFICATION_URL=old;}
});

test('platform owner creates an isolated merchant login with MFA, CSRF and atomic onboarding',async()=>{
  const crypto=await import('node:crypto');const {encryptAtRest}=await import('@youpi/common');
  process.env.ENCRYPTION_MASTER_KEY ||= crypto.randomBytes(32).toString('hex');
  const db=new Database({inMemory:true}),{runMigrations}=await import('../../../../packages/db/src/migrate.js');runMigrations(db);
  const server=new HttpServer(),identity=registerPlatformIdentity(server,{db,merchantRepo:new MerchantRepository(db)});server.use(identity.guard);
  const stamp=new Date().toISOString(),raw=crypto.randomBytes(32).toString('hex');
  db.execute('INSERT INTO pp_users(id,email,password_hash,role,mfa_secret,created_at) VALUES(?,?,?,?,?,?)',['platform-owner','platform@example.test',hashPlatformPassword('owner-safe-password'),'SUPER_ADMIN',encryptAtRest('JBSWY3DPEHPK3PXP'),stamp]);
  db.execute('INSERT INTO pp_sessions(id,user_id,token_hash,csrf_token,mfa_verified,expires_at,created_at) VALUES(?,?,?,?,?,?,?)',['platform-session','platform-owner',crypto.createHash('sha256').update(raw).digest('hex'),'owner-csrf',0,new Date(Date.now()+60000).toISOString(),stamp]);
  const http=server.createServer();await new Promise(r=>http.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${http.address().port}/api/platform/v1`;
  const body={businessName:'Independent business',contactName:'Merchant Owner',email:'merchant-owner@example.test',mobile:'919876543210',password:'separate-owner-password',category:'Services'};
  const call=(path,data,cookie=`dp_platform_session=${raw}`,csrf='owner-csrf')=>fetch(base+path,{method:data?'POST':'GET',headers:{'content-type':'application/json',cookie,'x-csrf-token':csrf},...(data?{body:JSON.stringify(data)}:{})});
  try{
    assert.equal((await call('/merchants',body)).status,403,'MFA required');
    db.execute('UPDATE pp_sessions SET mfa_verified=1');
    assert.equal((await call('/merchants',body,undefined,'wrong')).status,403,'CSRF required');
    assert.equal((await call('/merchants',{...body,password:'short'})).status,400);
    const created=await call('/merchants',body);assert.equal(created.status,201);const record=await created.json();
    assert.equal(record.status,'EMAIL_PENDING');assert.equal(record.loginPath,'/platform');assert.ok(!JSON.stringify(record).includes(body.password));
    const owner=db.queryOne('SELECT * FROM pp_users WHERE merchant_id=?',[record.merchantId]);assert.equal(owner.role,'OWNER');assert.equal(owner.email_verified,0);assert.equal(owner.mobile_verified,0);assert.notEqual(owner.password_hash,body.password);
    assert.equal((await call('/merchants',body)).status,409);
    const login=await call('/login',{email:body.email,password:body.password},'');assert.equal(login.status,200);const merchantCookie=login.headers.get('set-cookie').split(';')[0];const merchantSession=await login.json();assert.equal(merchantSession.user.merchantId,record.merchantId);
    assert.equal((await call('/merchants',null,merchantCookie)).status,403);
    assert.equal((await call('/merchants',{...body,email:'forbidden@example.test'},merchantCookie,merchantSession.csrfToken)).status,403);
    const details=await(await call('/merchants/'+record.merchantId)).json();assert.equal(details.users[0].email,body.email);assert.ok(!JSON.stringify(details).includes(owner.password_hash));
    assert.equal((await call('/merchants/'+record.merchantId+'/state',{status:'ACTIVE',reason:'Skip review'})).status,409);
    const count=Number(db.queryOne('SELECT COUNT(*) AS n FROM merchants').n),execute=db.execute.bind(db);
    db.execute=(sql,args)=>{if(sql.startsWith('INSERT INTO pp_users'))throw Error('simulated user-write failure');return execute(sql,args);};
    assert.equal((await call('/merchants',{...body,email:'rollback@example.test'})).status,500);db.execute=execute;
    assert.equal(Number(db.queryOne('SELECT COUNT(*) AS n FROM merchants').n),count);
    assert.ok(db.queryOne("SELECT id FROM pp_audit WHERE action='MERCHANT_CREATED' AND entity_id=?",[record.merchantId]));
  }finally{await new Promise(r=>http.close(r));db.close();}
});
