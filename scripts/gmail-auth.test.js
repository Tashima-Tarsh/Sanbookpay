import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startGmailAuthorization } from './gmail-auth.js';

test('loopback OAuth checks state, saves refresh token privately and requests only send scope',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gmail-send-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let exchanges=0;
  const auth={generateAuthUrl:options=>{assert.deepEqual(options.scope,['https://www.googleapis.com/auth/gmail.send']);return `https://accounts.google.com/?state=${options.state}`;},getToken:async code=>{exchanges++;assert.equal(code,'accepted');return {tokens:{refresh_token:'private-test-token'}};}};
  const tokenPath=path.join(dir,'token.json');
  const flow=await startGmailAuthorization({clientId:'id',clientSecret:'secret',port:0,tokenPath,createClient:()=>auth});
  t.after(()=>flow.server.close());
  const state=new URL(flow.authUrl).searchParams.get('state');
  assert.equal((await fetch(`${flow.redirectUri}?code=accepted&state=wrong`)).status,400);assert.equal(exchanges,0);assert.equal(fs.existsSync(tokenPath),false);
  const done=flow.done;
  assert.equal((await fetch(`${flow.redirectUri}?code=accepted&state=${state}`)).status,200);await done;
  assert.equal(exchanges,1);assert.equal(JSON.parse(fs.readFileSync(tokenPath)).refresh_token,'private-test-token');
});

test('OAuth token exchange failure is not reported as authorization success',async t=>{
  const flow=await startGmailAuthorization({clientId:'id',clientSecret:'secret',port:0,createClient:()=>({generateAuthUrl:o=>`https://accounts.google.com/?state=${o.state}`,getToken:async()=>{throw Error('sensitive token response');}})});
  t.after(()=>flow.server.close());
  const result=flow.done.catch(error=>error);
  const state=new URL(flow.authUrl).searchParams.get('state');
  const response=await fetch(`${flow.redirectUri}?code=bad&state=${state}`);assert.equal(response.status,502);
  assert.ok(!(await response.text()).includes('sensitive'));assert.match((await result).message,/Token exchange failed/);
});
