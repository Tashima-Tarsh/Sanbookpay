import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

test('production launcher serves the canonical payment API on its public origin',{timeout:45000},async()=>{
 const reservations=await Promise.all(Array.from({length:5},async()=>{const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');return s;}));
 const [port,api,checkout,admin,gmail]=reservations.map(s=>s.address().port);
 await Promise.all(reservations.map(s=>new Promise(r=>s.close(r))));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sanbook-hosted-'));
 const env={...process.env,DATABASE_URL:'',PORT:String(port),PAYMENT_API_PORT:String(api),CHECKOUT_PORTAL_PORT:String(checkout),MERCHANT_ADMIN_PORT:String(admin),GMAIL_OBSERVER_PORT:String(gmail),DYNAMO_PUBLIC_URL:`http://127.0.0.1:${port}`,SQLITE_DB_PATH:path.join(dir,'test.sqlite'),INITIAL_ADMIN_EMAIL:'hosted@example.test',INITIAL_ADMIN_PASSWORD:crypto.randomBytes(24).toString('hex'),ENCRYPTION_MASTER_KEY:crypto.randomBytes(32).toString('hex'),JWT_SECRET:crypto.randomBytes(32).toString('hex'),GMAIL_CLIENT_ID:'',GMAIL_CLIENT_SECRET:'',GMAIL_REFRESH_TOKEN:'',SMS_GATEWAY_URL:'',REDIS_URL:''};
 const child=spawn(process.execPath,['scripts/start-hosted.js'],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 const closed=once(child,'close');
 try{
  for(let i=0;i<150&&!output.includes('hosted gateway ready');i++){
   if(child.exitCode!==null)assert.fail('Hosted launcher exited before readiness');
   await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(output.includes('hosted gateway ready'),'Hosted launcher did not become ready');
  const base=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/_ready')).status,200);
  assert.equal((await fetch(base+'/platform')).status,200);
  for(const route of ['/v1/payments','/v1/refunds']){
   const r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:'{}',redirect:'manual'});
   assert.equal(r.status,401,route+' must reach the scoped API authentication guard');
  }
 }finally{child.kill();await closed;}
});
