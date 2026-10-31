import {HttpServer} from '../server.js';

// All creation/status requests use the same key scopes, merchant policy and queue.
export function registerPaymentLinkRoutes(server,ctx){
 const base='/api/v1/payment-links';
 const handler=(method,path)=>server.routes.find(r=>r.method===method&&r.regex.test(path))?.handler;
 server.post(base+'/amount-only',async(req,res)=>{
  // The canonical handler generates IDs from the stable idempotency key when omitted.
  const target=handler('POST','/v1/payments');
  if(!target)return HttpServer.json(res,503,{error:'Payment service unavailable'});
  return target(req,res,{});
 });
 server.post(base+'/:id/failover',async(req,res,p)=>{
  const s=ctx.sessionRepo.findById(p.id);
  if(!s||s.merchantId!==req.platform.merchantId)return HttpServer.json(res,404,{error:'Payment not found'});
  HttpServer.json(res,409,{error:'An issued payment route is immutable. Reconcile its original attempt before creating a separately identified retry.',code:'ORIGINAL_ATTEMPT_PRESERVED',paymentId:s.id,status:s.status});
 });
 server.get(base+'/:id',async(req,res,p)=>{
  const target=handler('GET','/v1/payments/'+encodeURIComponent(p.id));
  if(!target)return HttpServer.json(res,503,{error:'Payment service unavailable'});
  return target(req,res,p);
 });
}
