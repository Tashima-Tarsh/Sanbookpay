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
