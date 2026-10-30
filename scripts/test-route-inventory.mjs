import fs from 'node:fs';
import assert from 'node:assert/strict';
import '../scripts/test-support.js';
import {Database} from '@youpi/db';
const {createPaymentApp}=await import('../apps/payment-api/src/index.js');
const db=new Database({inMemory:true}),app=createPaymentApp(db);app.server._rateLimitEnabled=false;
const server=app.rawServer;await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const results=[],keys=new Set();
try{
 for(const route of app.server.routes){
   const key=route.method+' '+route.regex.source;assert.ok(!keys.has(key),'Duplicate route '+key);keys.add(key);
   const path=route.regex.source.replace(/^\^/,'').replace(/\$$/,'').replaceAll('([^/]+)','missing-test-id').replaceAll('\\/','/').replaceAll('\\.','.');
   const start=performance.now();
   try{
     const r=await fetch(base+path,{method:route.method,headers:{'Content-Type':'application/json'},body:['GET','HEAD'].includes(route.method)?undefined:'{}',signal:AbortSignal.timeout(6000)});
     const text=await r.text();results.push({method:route.method,path,status:r.status,durationMs:Math.round(performance.now()-start),mode:'Anonymous / empty-body / nonexistent-ID smoke',error:r.status>=500?text.slice(0,200):undefined});
   }catch(error){results.push({method:route.method,path,status:0,error:error.message});}
 }
}finally{app.destroy();server.closeAllConnections?.();await new Promise(r=>server.close(r));db.close();}
fs.mkdirSync('output/testing',{recursive:true});fs.writeFileSync('output/testing/routes-results.json',JSON.stringify({testedAt:new Date().toISOString(),total:results.length,duplicateRegistrations:0,scope:'Route inventory and invalid/anonymous smoke, not successful-path business coverage for every endpoint.',results},null,2));
console.log(JSON.stringify({total:results.length,errors:results.filter(r=>r.status===0||r.status>=500)},null,2));
if(results.some(r=>r.status===0||r.status>=500))process.exitCode=1;
