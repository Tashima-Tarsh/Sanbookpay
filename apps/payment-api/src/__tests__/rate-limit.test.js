import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HttpServer,resolveClientIp} from '../server.js';
import {getInternalServiceToken} from '@youpi/common';
test('proxy IP is accepted only from an authenticated loopback proxy',()=>{
 const req={socket:{remoteAddress:'127.0.0.1'},headers:{'cf-connecting-ip':'203.0.113.11','x-forwarded-for':'203.0.113.12'}};
 assert.equal(resolveClientIp(req),'127.0.0.1');req.headers['x-gateway-token']=getInternalServiceToken();assert.equal(resolveClientIp(req),'203.0.113.11');
 req.socket.remoteAddress='198.51.100.22';assert.equal(resolveClientIp(req),'198.51.100.22');
});
test('1000 requests are accepted per IP; 1001 is blocked and window resets',()=>{
 const s=new HttpServer();s._rateLimitMaxRequests=1000;s._rateLimitWindowMs=60000;s._rateLimitEnabled=true;
 for(let i=0;i<1000;i++)assert.equal(s.checkRateLimit('client-a').allowed,true);
 assert.equal(s.checkRateLimit('client-a').allowed,false);assert.equal(s.checkRateLimit('client-b').allowed,true);
 s._rateLimitHits.get('client-a').resetAt=Date.now()-1;assert.equal(s.checkRateLimit('client-a').allowed,true);
});
test('HTTP overload returns 429 with Retry-After; authenticated proxy IPs have separate budgets',async()=>{
 const s=new HttpServer();s._rateLimitMaxRequests=3;s._rateLimitEnabled=true;s.get('/probe',(req,res)=>HttpServer.json(res,200,{ok:true}));
 const server=s.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
 const headers={'x-gateway-token':getInternalServiceToken(),'cf-connecting-ip':'203.0.113.1'};
 for(let i=0;i<3;i++)assert.equal((await fetch(base+'/probe',{headers})).status,200);
 const limited=await fetch(base+'/probe',{headers});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
 assert.equal((await fetch(base+'/probe',{headers:{...headers,'cf-connecting-ip':'203.0.113.2'}})).status,200);
 }finally{await new Promise(r=>server.close(r));}
});
