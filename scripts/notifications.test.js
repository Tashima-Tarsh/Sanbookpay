import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';

test('owner test CLI submits an SMS using an isolated initialized database',async t=>{
  const received=[];
  const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push(JSON.parse(body));res.writeHead(202,{'Content-Type':'application/json'});res.end('{"id":"local-test"}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const child=spawn(process.execPath,['scripts/notifications.js','--test','--phone','+919876543210'],{env:{...process.env,ENCRYPTION_MASTER_KEY:'ab'.repeat(32),NTFY_TOPIC:'',GMAIL_SEND_CLIENT_ID:'',GMAIL_SEND_CLIENT_SECRET:'',GMAIL_SEND_REFRESH_TOKEN:'',SMS_GATEWAY_URL:`http://127.0.0.1:${server.address().port}`,SMS_GATEWAY_USERNAME:'test',SMS_GATEWAY_PASSWORD:'test'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  assert.equal(code,0,output);assert.equal(received.length,1);assert.deepEqual(received[0].phoneNumbers,['+919876543210']);assert.match(output,/SUBMITTED/);assert.ok(!output.includes('no such table'));
});

test('owner test CLI fails if a requested SMS was skipped even when push succeeds',async t=>{
  let pushes=0;const server=http.createServer((req,res)=>{pushes++;req.resume();res.writeHead(200);res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const child=spawn(process.execPath,['scripts/notifications.js','--test','--phone','invalid'],{env:{...process.env,ENCRYPTION_MASTER_KEY:'ab'.repeat(32),NTFY_TOPIC:'local-test',NTFY_BASE_URL:`http://127.0.0.1:${server.address().port}`,SMS_GATEWAY_URL:'',GMAIL_SEND_CLIENT_ID:''},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  assert.equal(pushes,1,output);assert.equal(code,1,output);
});
