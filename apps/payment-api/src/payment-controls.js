import crypto from 'node:crypto';
import {HttpServer} from './server.js';
import {isValidVpa} from '@youpi/common';

const kinds=['MERCHANT','RECEIVING_VPA','CUSTOMER_VPA','CUSTOMER','PROVIDER'];
export function enforcePaymentControls(ctx,merchantId,targets) {
 const merchant=ctx.merchantRepo.findById(merchantId);
 if(!merchant)return {error:'Merchant not found',code:'MERCHANT_NOT_FOUND'};
 const now=Date.now();
 const rules=(merchant.branding?.paymentRules||[]).filter(r=>r.active&&(!r.expiresAt||Date.parse(r.expiresAt)>now));
 const values={MERCHANT:merchantId,...targets};
 for(const targetType of kinds){
  const value=String(values[targetType]||'').trim().toLowerCase();
  const applicable=rules.filter(r=>r.targetType===targetType);
  const match=applicable.filter(r=>r.target.toLowerCase()===value);
  if(match.some(r=>r.ruleType==='BLOCK'))return {error:'Payment acceptance is blocked by a merchant rule.',code:'PAYMENT_RULE_BLOCKED'};
  if(applicable.some(r=>r.ruleType==='ALLOW')&&!match.some(r=>r.ruleType==='ALLOW'))return {error:'Payment does not match the merchant acceptance allowlist.',code:'PAYMENT_RULE_NOT_ALLOWED'};
  for(const r of match.filter(r=>r.ruleType==='WATCH'))ctx.auditRepo.log({merchantId,entityType:'PAYMENT_RULE',entityId:r.id,action:'WATCHLIST_MATCH',actorType:'SYSTEM',details:{targetType,target:value}});
 }
 return null;
}

export function registerPaymentControls(server,ctx){
 const root='/api/v1/admin/console/payment-rules';
 const merchant=req=>(req.headers['x-merchant-id']?ctx.merchantRepo.findById(req.headers['x-merchant-id']):null)||ctx.merchantRepo.getDefault();
 server.get(root,(req,res)=>HttpServer.json(res,200,{rules:merchant(req).branding?.paymentRules||[]}));
 server.post(root,async(req,res)=>{
  const body=await HttpServer.parseBody(req),m=merchant(req);
  if(!['ALLOW','BLOCK','WATCH'].includes(body.ruleType)||!kinds.includes(body.targetType)||typeof body.target!=='string'||!body.target.trim()||body.target.length>150||typeof body.reason!=='string'||body.reason.trim().length<5||body.reason.length>1000)return HttpServer.json(res,400,{error:'Choose a rule, target type, identifier and reason of at least five characters.'});
  const target=body.target.trim().toLowerCase();
  if(body.targetType.endsWith('_VPA')&&!isValidVpa(target))return HttpServer.json(res,400,{error:'Enter a valid UPI ID.'});
  if(body.expiresAt&&(!Number.isFinite(Date.parse(body.expiresAt))||Date.parse(body.expiresAt)<=Date.now()))return HttpServer.json(res,400,{error:'Expiry must be in the future.'});
  const rule={id:crypto.randomUUID(),merchantId:m.id,ruleType:body.ruleType,targetType:body.targetType,target,reason:body.reason.trim(),createdBy:'OWNER',createdAt:new Date().toISOString(),expiresAt:body.expiresAt?new Date(body.expiresAt).toISOString():null,active:true};
  dbUpdate(m,rule,'PAYMENT_RULE_CREATED');HttpServer.json(res,201,rule);
 });
 server.post(root+'/:id/state',async(req,res,params)=>{
  const body=await HttpServer.parseBody(req),m=merchant(req),existing=m.branding?.paymentRules?.find(r=>r.id===params.id);
  if(!existing)return HttpServer.json(res,404,{error:'Rule not found'});
  if(typeof body.active!=='boolean'||typeof body.reason!=='string'||body.reason.trim().length<5)return HttpServer.json(res,400,{error:'Provide the active state and a reason of at least five characters.'});
  const rule={...existing,active:body.active,updatedAt:new Date().toISOString(),updateReason:body.reason.trim().slice(0,1000)};
  dbUpdate(m,rule,'PAYMENT_RULE_STATE_CHANGED');HttpServer.json(res,200,rule);
 });
 function dbUpdate(m,rule,action){
  ctx.db.transaction(()=>{
   // Lock before reading the JSON configuration, avoiding lost concurrent edits.
   if(ctx.db.dialect==='postgres')ctx.db.queryOne('SELECT id FROM merchants WHERE id=? FOR UPDATE',[m.id]);
   const current=ctx.merchantRepo.findById(m.id),rules=current.branding?.paymentRules||[];
   if(!rules.some(r=>r.id===rule.id)&&rules.length>=200)throw Error('A merchant can store up to 200 rules. Disable or review existing rules first.');
   ctx.merchantRepo.update(m.id,{branding:{...current.branding,paymentRules:[...rules.filter(r=>r.id!==rule.id),rule]}});
   ctx.auditRepo.log({merchantId:m.id,entityType:'PAYMENT_RULE',entityId:rule.id,action,actorType:'ADMIN',details:rule});
  });
 }
}
