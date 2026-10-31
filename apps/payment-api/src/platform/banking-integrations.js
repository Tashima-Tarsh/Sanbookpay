import crypto from 'node:crypto';
import {encrypt,decrypt,resolveSecret,safeEqual,toPaise,validateOutboundWebhookUrl} from '@youpi/common';
import {HttpServer} from '../server.js';
import {BankingConnector,BANKING_CONNECTOR_KINDS} from '../services/banking-connector.js';
import {validateUpiChannel} from '../upi-channel.js';

const now=()=>new Date().toISOString();
const failure=(statusCode,message)=>Object.assign(Error(message),{statusCode});

export function registerBankingIntegrations(server,ctx,{get,post,tenant,identity}){
 const {db,accountRepo,sessionRepo}=ctx;
 db.execute(`CREATE TABLE IF NOT EXISTS pp_banking_integrations(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),kind TEXT NOT NULL,base_url TEXT NOT NULL,secrets_encrypted TEXT NOT NULL,bank_account_name TEXT,receiving_account_id TEXT NOT NULL REFERENCES payment_receiving_accounts(id),is_default INTEGER NOT NULL DEFAULT 0,last_tested_at TEXT,test_status TEXT NOT NULL DEFAULT 'NOT_TESTED',created_at TEXT NOT NULL)`);
 db.execute('CREATE TABLE IF NOT EXISTS pp_external_collections(session_id TEXT PRIMARY KEY REFERENCES payment_sessions(id),integration_id TEXT NOT NULL REFERENCES pp_banking_integrations(id),external_id TEXT NOT NULL,UNIQUE(integration_id,external_id))');
 db.execute('CREATE TABLE IF NOT EXISTS pp_banking_events(fingerprint TEXT PRIMARY KEY,integration_id TEXT NOT NULL,session_id TEXT,received_at TEXT NOT NULL)');
 const key=()=>resolveSecret('encryption_master_key','ENCRYPTION_MASTER_KEY');
 const view=r=>({id:r.id,kind:r.kind,baseUrl:r.base_url,receivingAccountId:r.receiving_account_id,bankAccountName:r.bank_account_name,isDefault:Boolean(r.is_default),lastTestedAt:r.last_tested_at,testStatus:r.test_status});
 const owned=(req,id)=>{const r=db.queryOne('SELECT * FROM pp_banking_integrations WHERE id=? AND merchant_id=?',[id,tenant(req)]);if(!r)throw failure(404,'Banking integration not found.');return r;};
 function connector(row){return new BankingConnector({kind:row.kind,baseUrl:row.base_url,bankAccountName:row.bank_account_name,...JSON.parse(decrypt(row.secrets_encrypted,key()))});}
 function allowedUrl(value){
  const checked=validateOutboundWebhookUrl(value);
  if(!checked.valid)throw failure(400,checked.error);
  const url=checked.url;
  if(url.pathname!=='/'||url.search||url.hash)throw failure(400,'Use the service origin without a path or query.');
  const allowed=(process.env.BANKING_CONNECTOR_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(process.env.NODE_ENV!=='test'&&!allowed.includes(url.origin))throw failure(400,'The platform operator must add this origin to BANKING_CONNECTOR_ORIGINS before connecting it.');
  if(url.protocol!=='https:'&&process.env.NODE_ENV!=='test'&&process.env.YOUPI_ALLOW_PRIVATE_WEBHOOKS!=='true')throw failure(400,'Banking connections require HTTPS.');
  return url.origin;
 }
 get('/banking-integrations','connections.manage',(req,res)=>HttpServer.json(res,200,{integrations:db.query('SELECT * FROM pp_banking_integrations WHERE merchant_id=? ORDER BY created_at',[tenant(req)]).map(view)}));
 post('/banking-integrations','connections.manage',async(req,res)=>{
  const b=await HttpServer.parseBody(req),mid=tenant(req);
  if(!BANKING_CONNECTOR_KINDS.includes(b.kind))throw failure(400,'Select PayGate, Django/n8n or India Banking.');
  const account=accountRepo.findById(b.receivingAccountId);
  if(!account||account.merchantId!==mid)throw failure(400,'Select this merchant’s receiving account.');
  if(typeof b.apiKey!=='string'||!b.apiKey.trim()||b.apiKey.length>1000)throw failure(400,'An upstream API key is required.');
  for(const field of ['apiSecret','webhookSecret'])if(b[field]!==undefined&&(typeof b[field]!=='string'||b[field].length>2000))throw failure(400,'Service secrets must be text of at most 2,000 characters.');
  if(b.kind==='INDIA_BANKING'&&(typeof b.apiSecret!=='string'||!b.apiSecret.trim()||typeof b.bankAccountName!=='string'||!b.bankAccountName.trim()||b.bankAccountName.length>200))throw failure(400,'India Banking requires its API secret and ERPNext Bank Account document name.');
  const baseUrl=allowedUrl(b.baseUrl),id=crypto.randomUUID();
  if(db.queryOne('SELECT id FROM pp_banking_integrations WHERE merchant_id=? AND kind=? AND base_url=?',[mid,b.kind,baseUrl]))throw failure(409,'This service is already connected.');
  db.execute('INSERT INTO pp_banking_integrations(id,merchant_id,kind,base_url,secrets_encrypted,bank_account_name,receiving_account_id,created_at) VALUES(?,?,?,?,?,?,?,?)',[id,mid,b.kind,baseUrl,encrypt(JSON.stringify({apiKey:b.apiKey.trim(),apiSecret:b.apiSecret||'',webhookSecret:b.webhookSecret||''}),key()),b.bankAccountName||null,account.id,now()]);
  identity.audit(req,'BANKING_INTEGRATION_ADDED',id,{kind:b.kind});
  HttpServer.json(res,201,{integration:view(db.queryOne('SELECT * FROM pp_banking_integrations WHERE id=?',[id]))});
 });
 post('/banking-integrations/:id/test','connections.manage',async(req,res,p)=>{
  const row=owned(req,p.id);let status='FAILED';
  try{
   const client=connector(row);
   if(row.kind==='INDIA_BANKING')await client.getBalance();
   else await client.checkCredentials();
   status='CONNECTED';
  }finally{db.execute('UPDATE pp_banking_integrations SET last_tested_at=?,test_status=? WHERE id=?',[now(),status,row.id]);}
  identity.audit(req,'BANKING_INTEGRATION_TESTED',row.id,{status});
  HttpServer.json(res,200,{status});
 });
 post('/banking-integrations/:id/default','connections.manage',async(req,res,p)=>{
  const row=owned(req,p.id),b=await HttpServer.parseBody(req);
  if(typeof b.enabled!=='boolean'||row.kind==='INDIA_BANKING')throw failure(400,'Choose a collection connector and enabled true or false.');
  db.transaction(()=>{db.execute('UPDATE pp_banking_integrations SET is_default=0 WHERE merchant_id=?',[row.merchant_id]);if(b.enabled)db.execute('UPDATE pp_banking_integrations SET is_default=1 WHERE id=?',[row.id]);identity.audit(req,'COLLECTION_CONNECTOR_SELECTED',row.id,{enabled:b.enabled});});
  HttpServer.json(res,200,{enabled:b.enabled});
 });
 post('/banking-integrations/:id/statements','connections.manage',async(req,res,p)=>{
  const row=owned(req,p.id),b=await HttpServer.parseBody(req);
  if(row.kind!=='INDIA_BANKING')throw failure(400,'Select an India Banking connection.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(b.fromDate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(b.toDate||'')||!Number.isFinite(Date.parse(b.fromDate))||!Number.isFinite(Date.parse(b.toDate))||b.fromDate>b.toDate||(Date.parse(b.toDate)-Date.parse(b.fromDate))>31*86400000)throw failure(400,'Choose a valid statement range of at most 31 days.');
  const statements=await connector(row).getStatements(b.fromDate,b.toDate);
  identity.audit(req,'BANK_STATEMENTS_REQUESTED',row.id,{fromDate:b.fromDate,toDate:b.toDate});
  HttpServer.json(res,200,{statements,source:'ERPNEXT_BANK_TRANSACTIONS',bankRefreshVerified:false,requiresReconciliation:true});
 });
 const getDefault=mid=>db.queryOne('SELECT * FROM pp_banking_integrations WHERE merchant_id=? AND is_default=1',[mid]);
 const getForSession=session=>db.queryOne('SELECT * FROM pp_banking_integrations WHERE id=? AND merchant_id=?',[session.metadata.externalCollection.integrationId,session.merchantId]);
 function prepare(row,account,amount){
  if(amount>BigInt(Number.MAX_SAFE_INTEGER)-199n)throw failure(400,'Amount exceeds the supported range including adjustment headroom.');
  if(row.receiving_account_id!==account.id)throw failure(400,'Activate the receiving account assigned to the selected collection connector.');
  if(row.kind==='PAYGATE'&&amount%100n!==0n)throw failure(400,'The connected PayGate service accepts whole INR amounts.');
  const denied=validateUpiChannel(ctx.merchantRepo.findById(account.merchantId),amount+199n,account.upiId);
  if(denied)throw failure(400,'Allow up to INR 1.99 of amount-adjustment headroom within your UPI payment limit.');
  if(sessionRepo.findCurrentActiveOrProcessing(account.id))throw failure(409,'Another checkout is using this receiving account. Complete it before creating an external payment.');
 }
 async function issue(session,row){
  const account=accountRepo.findById(session.receivingAccountId);
  try{
   const result=await connector(row).createPayment({amountPaise:session.amountPaise,payeeName:account.payeeName,upiId:account.upiId,reference:session.id,callbackUrl:(process.env.DYNAMO_PUBLIC_URL||ctx.checkoutBaseUrl||'').replace(/\/$/,'')+'/api/v1/banking-integrations/'+row.id+'/events'});
   db.transaction(()=>{
    const current=sessionRepo.findById(session.id);
    if(current.status!=='ACTIVE')throw failure(409,'Checkout is no longer active; reconcile the upstream request.');
    const metadata={...current.metadata,externalCollection:{...current.metadata.externalCollection,stage:'PAYABLE',externalId:result.externalId,upiUri:result.upiUri,expiresAt:result.expiresAt.toISOString()}};
    db.execute('UPDATE payment_sessions SET amount_paise=?,expires_at=?,metadata=?,updated_at=? WHERE id=?',[Number(result.amountPaise),result.expiresAt.toISOString(),JSON.stringify(metadata),now(),session.id]);
    db.execute('INSERT INTO pp_external_collections(session_id,integration_id,external_id) VALUES(?,?,?)',[session.id,row.id,result.externalId]);
   });
   return sessionRepo.findById(session.id);
  }catch{
   const current=sessionRepo.findById(session.id);
   db.execute('UPDATE payment_sessions SET metadata=?,updated_at=? WHERE id=?',[JSON.stringify({...current.metadata,externalCollection:{...current.metadata.externalCollection,stage:'UNKNOWN'}}),now(),session.id]);
   throw Object.assign(failure(502,'Collection outcome is uncertain. Keep payment '+session.id+' and reconcile it before making another payment.'),{paymentId:session.id});
  }
 }
 const inFlight=new Map();
 async function refresh(session,force=false){
  const ext=session.metadata?.externalCollection;
  if(!ext?.externalId||session.status==='SUCCESS')return session;
  if(inFlight.has(session.id)){await inFlight.get(session.id);if(!force)return sessionRepo.findById(session.id);}
  if(!force&&ext.lastCheckedAt&&Date.now()-Date.parse(ext.lastCheckedAt)<15000)return session;
  const task=(async()=>{
   const row=db.queryOne('SELECT * FROM pp_banking_integrations WHERE id=? AND merchant_id=?',[ext.integrationId,session.merchantId]);if(!row)return;
   let evidenceStatus='UNAVAILABLE',bankReference=null;
   try{
    const result=await connector(row).getPayment(ext.externalId);
    if(String(result.id??result.payment_id)!==ext.externalId||toPaise(result.requested_amount??result.amount)!==BigInt(ext.requestedAmountPaise)||toPaise(result.payable_amount??result.unique_amount)!==session.amountPaise)throw Error('Evidence identity or amount mismatch');
    evidenceStatus=String(result.status||'UNKNOWN').toUpperCase();bankReference=typeof result.bank_reference==='string'?result.bank_reference.slice(0,150):null;
   }catch{/* Preserve pending state if the upstream is unreachable or inconsistent. */}
   let released=false;
   db.transaction(()=>{
    const current=sessionRepo.findById(session.id);
    const evidence={...current.metadata.externalCollection,evidenceStatus,bankReference,lastCheckedAt:now()};
   if(evidenceStatus==='PAID')evidence.stage='EVIDENCE_RECEIVED';
    db.execute('UPDATE payment_sessions SET metadata=?,updated_at=? WHERE id=?',[JSON.stringify({...current.metadata,externalCollection:evidence}),now(),session.id]);
    if(evidenceStatus==='PAID'&&['ACTIVE','PROCESSING'].includes(current.status)){
     db.execute('UPDATE payment_sessions SET status=?,updated_at=? WHERE id=?',['VERIFICATION_PENDING',now(),session.id]);
     accountRepo.setSlotStatus(current.receivingAccountId,false,null);
     released=true;
    }
   });
   if(released)ctx.queueEngine.promoteNext?.(session.receivingAccountId);
  })();
  inFlight.set(session.id,task);try{await task;}finally{if(inFlight.get(session.id)===task)inFlight.delete(session.id);}
  return sessionRepo.findById(session.id);
 }
 // Django's HMAC authenticates the notification service, not the underlying bank credit.
 server.post('/api/v1/banking-integrations/:id/events',async(req,res,p)=>{
  try{
   const row=db.queryOne('SELECT * FROM pp_banking_integrations WHERE id=?',[p.id]);if(!row)throw failure(404,'Connection not found.');
   const raw=await HttpServer.parseRawBody(req),secrets=JSON.parse(decrypt(row.secrets_encrypted,key()));
   if(!secrets.webhookSecret)throw failure(401,'Webhook secret is not configured.');
   const ts=req.headers['paygate-timestamp'];
   const signed=row.kind==='PAYGATE'?String(ts)+'.'+raw:raw;
   const signature=row.kind==='PAYGATE'?String(req.headers['paygate-signature']||'').replace(/^v1=/,''):req.headers['x-gateway-signature'];
   if(row.kind==='PAYGATE'&&(!/^\d+$/.test(String(ts))||Math.abs(Date.now()-Number(ts)*1000)>300000))throw failure(401,'Stale event.');
   if(!safeEqual(String(signature||''),crypto.createHmac('sha256',secrets.webhookSecret).update(signed).digest('hex')))throw failure(401,'Invalid event signature.');
   const event=JSON.parse(raw);
   const mapping=row.kind==='PAYGATE'
    ?db.queryOne('SELECT session_id FROM pp_external_collections WHERE integration_id=? AND external_id=?',[row.id,String(event.data?.payment?.id||'')])
    :db.queryOne('SELECT session_id FROM pp_external_collections WHERE integration_id=? AND session_id=?',[row.id,String(event.client_reference||'')]);
   const fingerprint=crypto.createHash('sha256').update(row.id+':'+raw).digest('hex');
   const seen=db.queryOne('SELECT fingerprint FROM pp_banking_events WHERE fingerprint=?',[fingerprint]);
   if(!seen){
    if(mapping){
     const fresh=await refresh(sessionRepo.findById(mapping.session_id),true);
     if(fresh.metadata?.externalCollection?.evidenceStatus==='UNAVAILABLE')throw failure(503,'Evidence inquiry unavailable; retry this signed callback.');
    }
    db.execute('INSERT INTO pp_banking_events(fingerprint,integration_id,session_id,received_at) VALUES(?,?,?,?) ON CONFLICT(fingerprint) DO NOTHING',[fingerprint,row.id,mapping?.session_id||null,now()]);
   }
   // Callback authentication establishes the external source only, not bank settlement.
   HttpServer.json(res,202,{accepted:true,settled:false,confirmationSource:'NOTIFICATION_EVIDENCE'});
  }catch(e){HttpServer.json(res,e.statusCode||400,{error:e.statusCode?e.message:'Invalid integration event.'});}
 });
 post('/banking-integrations/payments/:id/refresh','payments.read',async(req,res,p)=>{
  const session=sessionRepo.findById(p.id);if(!session||session.merchantId!==tenant(req))throw failure(404,'Payment not found.');
  const fresh=await refresh(session);HttpServer.json(res,200,{paymentId:fresh.id,status:fresh.status,evidence:fresh.metadata?.externalCollection?.evidenceStatus||null,settled:fresh.status==='SUCCESS'});
 });
 return {getDefault,getForSession,prepare,issue,refresh};
}
