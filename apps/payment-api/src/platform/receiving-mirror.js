import {HttpServer} from '../server.js';
import {generateQrSvg} from '@youpi/core';
import {createReceivingMirror} from '../services/receiving-mirror.js';

export function registerReceivingMirror(server,ctx,{get,post,tenant,identity}){
 const mirror=createReceivingMirror(server,ctx);ctx.receivingMirror=mirror;
 get('/receiving-mirror','transactions.read',(req,res)=>{
  const mid=tenant(req);
  const devices=ctx.db.query('SELECT d.id,d.device_name,d.device_model,d.is_active,d.last_heartbeat_at,d.last_observation_at,b.account_id,b.detected_callbacks FROM android_devices d JOIN pp_receiver_devices b ON b.device_id=d.id WHERE b.merchant_id=? ORDER BY d.created_at DESC',[mid]).map(d=>({...d,status:!Number(d.is_active)?'REVOKED':Date.now()-(d.last_heartbeat_at instanceof Date?d.last_heartbeat_at.getTime():Date.parse(/Z$|[+-]\d\d:\d\d$/.test(d.last_heartbeat_at)?d.last_heartbeat_at:d.last_heartbeat_at+'Z'))<90000?'CONNECTED':'OFFLINE'}));
  const events=ctx.db.query("SELECT e.id,e.source,e.amount_paise,e.bank_reference,e.payment_id,e.match_status,e.observed_at,e.received_at,e.delivery_id,a.upi_id AS receiving_upi,w.is_successful,w.attempt_count,s.order_id,s.status AS payment_status,(SELECT MAX(c.is_successful) FROM webhook_deliveries c WHERE c.payment_id=e.payment_id AND c.event_type='SUCCESS') AS success_callback_delivered FROM pp_receiver_events e LEFT JOIN payment_receiving_accounts a ON a.id=e.account_id LEFT JOIN webhook_deliveries w ON w.id=e.delivery_id LEFT JOIN payment_sessions s ON s.id=e.payment_id WHERE e.merchant_id=? ORDER BY e.received_at DESC LIMIT 100",[mid]);
  const merchant=ctx.merchantRepo.findById(mid),account=ctx.accountRepo.findActiveForMerchant(mid);
  const policy=ctx.db.queryOne('SELECT account_id,auto_success,reason,updated_at FROM pp_receiver_policies WHERE merchant_id=?',[mid]);
  HttpServer.json(res,200,{devices,events,setup:{receivingUpi:account?.upiId||null,receivingAccountId:account?.id||null,callbackConfigured:Boolean(merchant.webhookUrl),phonePaired:devices.some(d=>Number(d.is_active)),notificationAutoSuccess:Boolean(policy?.auto_success)&&policy.account_id===account?.id,verificationMode:policy?.auto_success?'NOTIFICATION_ACCEPTANCE':'PROVIDER_OR_AUTHORIZED_BANK_REVIEW'},confirmationPolicy:'When enabled by Super Admin, a unique receiving alert with an unused UTR completes the payment as NOTIFICATION-confirmed. It is not bank/provider verification.'});
 });
 post('/receiving-mirror/policy','connections.manage',async(req,res)=>{
  if(!req.platform.platform||req.platform.role!=='SUPER_ADMIN')throw Object.assign(Error('Only Super Admin may change notification payment acceptance'),{statusCode:403});
  const body=await HttpServer.parseBody(req),mid=tenant(req);
  ctx.db.transaction(()=>{mirror.setPolicy(mid,body.receivingAccountId,body.autoSuccess,body.reason,req.platform.userId);identity.audit(req,'NOTIFICATION_PAYMENT_POLICY_CHANGED',body.receivingAccountId,{merchantId:mid,autoSuccess:body.autoSuccess,reason:body.reason});});
  HttpServer.json(res,200,{saved:true,autoSuccess:body.autoSuccess,confirmationSource:body.autoSuccess?'NOTIFICATION':null,bankVerified:false});
 });
 post('/receiving-mirror/pair','connections.manage',async(req,res)=>{
  if(!req.platform.platform)throw Object.assign(Error('Only Super Admin can assign receiving phones'),{statusCode:403});
  const body=await HttpServer.parseBody(req),mid=tenant(req);
  if(typeof body.detectedCallbacks!=='boolean')throw Object.assign(Error('Choose whether to send PAYMENT_DETECTED callbacks'),{statusCode:400});
  const origin=new URL(process.env.DYNAMO_PUBLIC_URL||ctx.checkoutBaseUrl);
  if(origin.protocol!=='https:'&&process.env.NODE_ENV!=='test')throw Object.assign(Error('Configure the platform public HTTPS origin'),{statusCode:503});
  const p=mirror.issuePairing(mid,body.receivingAccountId,body.detectedCallbacks);
  const payload={version:'v1',type:'YOUPI_SMS_GATEWAY_PAIR',serverUrl:origin.origin,gatewayUrl:origin.origin,apiBaseUrl:origin.origin,merchantId:mid,token:p.token,enrollmentToken:p.token,expiresAt:Date.parse(p.expiresAt)};
  identity.audit(req,'RECEIVING_PHONE_PAIRING_ISSUED',body.receivingAccountId,{merchantId:mid,detectedCallbacks:body.detectedCallbacks});
  res.setHeader('Cache-Control','no-store');HttpServer.json(res,201,{expiresAt:p.expiresAt,qrSvg:generateQrSvg(JSON.stringify(payload),260),pairingPayload:payload});
 });
 post('/receiving-mirror/devices/:id/revoke','connections.manage',(req,res,p)=>{
  if(!req.platform.platform)throw Object.assign(Error('Only Super Admin can revoke receiving phones'),{statusCode:403});
  const mid=tenant(req),bound=mirror.binding(p.id);if(!bound||bound.merchant_id!==mid)throw Object.assign(Error('Receiving phone not found'),{statusCode:404});
  ctx.db.execute('UPDATE android_devices SET is_active=0 WHERE id=? AND merchant_id=?',[p.id,mid]);identity.audit(req,'RECEIVING_PHONE_REVOKED',p.id,{merchantId:mid});HttpServer.json(res,200,{revoked:true});
 });
 return mirror;
}
