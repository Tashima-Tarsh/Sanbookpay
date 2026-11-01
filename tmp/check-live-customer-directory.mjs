import fs from 'node:fs';import assert from 'node:assert/strict';
const base='https://dynamo-pay.onrender.com',platformId='00000000-0000-0000-0000-000000000001';
const login=await fetch(base+'/api/v1/admin/platform-session',{method:'POST',headers:{authorization:'Bearer '+fs.readFileSync('data/.secrets/admin_api_token','utf8').trim(),'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)});
assert.equal(login.status,200,'Existing platform administrator authentication required');const session=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
try{
 const response=await fetch(base+'/api/platform/v1/merchants',{headers:{cookie},signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);const data=await response.json();assert.ok(data.merchants.every(m=>m.merchant_id!==platformId));
 const old=await fetch(base+'/merchant/'+platformId,{redirect:'manual',signal:AbortSignal.timeout(20000)});assert.equal(old.status,302);assert.equal(old.headers.get('location'),'/platform');
 const result={checkedAt:new Date().toISOString(),customerCount:data.total,platformExcluded:true,oldMerchantUrlRedirect:'/platform',financialRecordsChanged:false};fs.writeFileSync('output/testing/live-platform-customer-separation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await fetch(base+'/api/platform/v1/logout',{method:'POST',headers:{cookie,'x-csrf-token':session.csrfToken,'content-type':'application/json'},body:'{}'});}
