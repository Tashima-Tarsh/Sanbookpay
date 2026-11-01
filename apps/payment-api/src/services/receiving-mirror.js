import crypto from 'node:crypto';
import {LedgerRepository} from '@youpi/db';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};

export function createReceivingMirror(server,ctx){
 const {db,accountRepo,sessionRepo,webhookEngine}=ctx;
 db.execute('CREATE TABLE IF NOT EXISTS pp_receiver_pairings(token_hash TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,account_id TEXT NOT NULL,detected_callbacks INTEGER NOT NULL,expires_at TEXT NOT NULL)');
 db.execute('CREATE TABLE IF NOT EXISTS pp_receiver_devices(device_id TEXT PRIMARY KEY REFERENCES android_devices(id),merchant_id TEXT NOT NULL,account_id TEXT NOT NULL,detected_callbacks INTEGER NOT NULL)');
 db.execute('CREATE TABLE IF NOT EXISTS pp_receiver_events(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,account_id TEXT NOT NULL,device_id TEXT,source TEXT NOT NULL,amount_paise BIGINT NOT NULL,bank_reference TEXT,payment_id TEXT,match_status TEXT NOT NULL,observed_at TEXT NOT NULL,received_at TEXT NOT NULL,delivery_id TEXT)');
 db.execute('CREATE INDEX IF NOT EXISTS pp_receiver_events_merchant_time ON pp_receiver_events(merchant_id,received_at)');
 db.execute('CREATE TABLE IF NOT EXISTS pp_receiver_policies(merchant_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,auto_success INTEGER NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,updated_at TEXT NOT NULL)');
 db.execute('CREATE TABLE IF NOT EXISTS pp_receiver_reference_claims(receiving_vpa TEXT NOT NULL,bank_reference TEXT NOT NULL,payment_id TEXT NOT NULL,PRIMARY KEY(receiving_vpa,bank_reference))');
 db.execute('CREATE TABLE IF NOT EXISTS pp_receiver_source_policies(merchant_id TEXT PRIMARY KEY,trusted_sources TEXT NOT NULL)');
 db.execute('CREATE TABLE IF NOT EXISTS pp_receiver_discovered_sources(merchant_id TEXT NOT NULL,device_id TEXT NOT NULL,package_name TEXT NOT NULL,certificate_sha256 TEXT NOT NULL,last_seen_at TEXT NOT NULL,PRIMARY KEY(merchant_id,device_id,package_name,certificate_sha256))');
 function sourcePolicy(mid){const row=db.queryOne('SELECT trusted_sources FROM pp_receiver_source_policies WHERE merchant_id=?',[mid]);return row?JSON.parse(row.trusted_sources):{android:[],smsSenders:[]};}
 function sourceTrusted(mid,evidence){
  const policy=sourcePolicy(mid);if(!evidence)return false;
  if(evidence.kind==='SMS')return policy.smsSenders.includes(String(evidence.sender||'').toUpperCase());
  return evidence.kind==='NOTIFICATION'&&policy.android.some(s=>s.packageName===evidence.packageName&&s.sha256===String(evidence.certificateSha256||'').toUpperCase());
 }
 function observeSource(mid,deviceId,evidence){
  if(evidence?.kind==='NOTIFICATION'&&/^[A-Za-z][\w]*(?:\.[\w]+)+$/.test(evidence.packageName||'')&&/^[a-f0-9]{64}$/i.test(evidence.certificateSha256||''))db.execute('INSERT INTO pp_receiver_discovered_sources VALUES(?,?,?,?,?) ON CONFLICT(merchant_id,device_id,package_name,certificate_sha256) DO UPDATE SET last_seen_at=excluded.last_seen_at',[mid,deviceId,evidence.packageName,evidence.certificateSha256.toUpperCase(),new Date().toISOString()]);
 }
 function setPolicy(mid,accountId,autoSuccess,reason,actorId,trustedSources){
  const account=accountRepo.findById(accountId);if(!account||account.merchantId!==mid)fail('Receiving account does not belong to merchant',404);
  if(typeof autoSuccess!=='boolean'||typeof reason!=='string'||reason.trim().length<10||reason.length>1000)fail('Choose the confirmation policy and give a reason of 10-1000 characters');
  if(trustedSources!==undefined){
   if(!trustedSources||!Array.isArray(trustedSources.android)||!Array.isArray(trustedSources.smsSenders)||trustedSources.android.length>20||trustedSources.smsSenders.length>30||trustedSources.android.some(s=>!s||typeof s.packageName!=='string'||s.packageName.length>200||!/^[A-Za-z][\w]*(?:\.[\w]+)+$/.test(s.packageName)||!/^[a-f0-9]{64}$/i.test(s.sha256||''))||trustedSources.smsSenders.some(s=>typeof s!=='string'||!/^[-A-Za-z0-9]{3,25}$/.test(s)||/^\d+$/.test(s)))fail('Supply exact trusted app packages with SHA-256 certificates, and bank SMS sender IDs');
   const normalized={android:trustedSources.android.map(s=>({packageName:s.packageName,sha256:s.sha256.toUpperCase()})),smsSenders:[...new Set(trustedSources.smsSenders.map(s=>s.toUpperCase()))]};
   db.execute('INSERT INTO pp_receiver_source_policies VALUES(?,?) ON CONFLICT(merchant_id) DO UPDATE SET trusted_sources=excluded.trusted_sources',[mid,JSON.stringify(normalized)]);
  }
  db.execute('INSERT INTO pp_receiver_policies VALUES(?,?,?,?,?,?) ON CONFLICT(merchant_id) DO UPDATE SET account_id=excluded.account_id,auto_success=excluded.auto_success,reason=excluded.reason,actor_id=excluded.actor_id,updated_at=excluded.updated_at',[mid,accountId,autoSuccess?1:0,reason.trim(),actorId,new Date().toISOString()]);
 }
 function issuePairing(mid,accountId,detectedCallbacks=false){
  const account=accountRepo.findById(accountId);if(!account||account.merchantId!==mid)fail('Receiving account does not belong to this merchant',404);
  const token=crypto.randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+600000).toISOString();
  db.transaction(()=>{db.execute('DELETE FROM pp_receiver_pairings WHERE merchant_id=? AND account_id=?',[mid,accountId]);db.execute('INSERT INTO pp_receiver_pairings VALUES(?,?,?,?,?)',[hash(token),mid,accountId,detectedCallbacks?1:0,expiresAt]);});
  return {token,expiresAt,receivingAccountId:accountId};
 }
 function consumePairing(token,mid){return db.transaction(()=>{
  const row=db.queryOne('SELECT * FROM pp_receiver_pairings WHERE token_hash=? AND merchant_id=? AND expires_at>?',[hash(token),mid,new Date().toISOString()]);
  if(!row||db.execute('DELETE FROM pp_receiver_pairings WHERE token_hash=?',[hash(token)]).changes!==1)fail('Pairing QR is expired or already used',401);
  return {merchantId:mid,receivingAccountId:row.account_id,detectedCallbacks:Boolean(row.detected_callbacks)};
 });}
 function bindDevice(deviceId,binding){db.execute('INSERT INTO pp_receiver_devices VALUES(?,?,?,?)',[deviceId,binding.merchantId,binding.receivingAccountId,binding.detectedCallbacks?1:0]);}
 function binding(deviceId){return db.queryOne('SELECT * FROM pp_receiver_devices WHERE device_id=?',[deviceId]);}
 function record({device=null,accountId,source,rawText,observedAt,amountPaise,bankReference=null,sourceEvidence=null}){
  const amount=Number(amountPaise),time=new Date(observedAt);
  if(!Number.isSafeInteger(amount)||amount<=0||!Number.isFinite(time.getTime())||time.getTime()>Date.now()+60000)fail('Invalid receiving observation amount or timestamp');
  const account=accountRepo.findById(accountId);if(!account)fail('Receiving account not found',404);
  let bound=null;
  if(device){
   const active=db.queryOne('SELECT id FROM android_devices WHERE id=? AND is_active=1',[device.id]);if(!active)fail('Receiving device is inactive or revoked',401);
   bound=binding(device.id);if(!bound||bound.account_id!==accountId||bound.merchant_id!==device.merchant_id)fail('Device is not bound to this receiving account',403);
  }
  const reference=bankReference&&String(bankReference).trim();
  if(reference&&reference.length>150)fail('Invalid bank reference');
  // Same reference across email/phone is one receipt; without one, only an exact source event is deduplicated.
  const id=hash(account.upiId.toLowerCase()+':'+amount+':'+(reference||source+':'+time.toISOString()+':'+hash(String(rawText))));
  const result=db.transaction(()=>{
   const existing=db.queryOne('SELECT * FROM pp_receiver_events WHERE id=?',[id]);if(existing)return {duplicate:true,id,matchStatus:existing.match_status,paymentId:existing.payment_id,deliveryId:existing.delivery_id};
   const candidates=db.query("SELECT s.* FROM payment_sessions s JOIN payment_receiving_accounts a ON a.id=s.receiving_account_id WHERE lower(a.upi_id)=? AND s.amount_paise=? AND s.status IN ('ACTIVE','PROCESSING','VERIFICATION_PENDING')",[account.upiId.toLowerCase(),amount]).filter(s=>{
    const snapshot=JSON.parse(s.metadata||'{}').receivingAccountSnapshot;
    if(snapshot?.upiId&&snapshot.upiId.toLowerCase()!==account.upiId.toLowerCase())return false;
    // A pending order retains its original payable deadline, not the short processing cutoff.
    const created=Date.parse(s.created_at),expires=Date.parse(s.expires_at);
    return Number.isFinite(created)&&time.getTime()>=created-1000&&time.getTime()<=created+600000&&(!Number.isFinite(expires)||time.getTime()<=expires);
   });
   // Shared VPA amounts must be unique across all merchants; never guess a tenant.
   const match=candidates.length===1?candidates[0]:null;
   let status=match?'DETECTED':candidates.length?'AMBIGUOUS':'UNMATCHED';
   const mid=match?.merchant_id||account.merchantId;
   let deliveryId=null;
   const callbackEnabled=bound?Boolean(bound.detected_callbacks):Boolean(db.queryOne('SELECT b.device_id FROM pp_receiver_devices b JOIN android_devices d ON d.id=b.device_id WHERE b.account_id=? AND b.detected_callbacks=1 AND d.is_active=1',[accountId]));
   const policy=match&&db.queryOne('SELECT * FROM pp_receiver_policies WHERE merchant_id=? AND account_id=? AND auto_success=1',[mid,match.receiving_account_id]);
   // Notification acceptance is an explicit platform policy, never bank/provider verification.
   if(match&&policy&&/^\d{12}$/.test(reference||'')&&/\b(credited|received|deposit|paid you)\b/i.test(String(rawText))&&(source==='GMAIL'||source==='ANDROID_OBSERVER'&&sourceTrusted(mid,sourceEvidence))){
    const vpa=account.upiId.toLowerCase();
    const claim=db.queryOne('SELECT payment_id FROM pp_receiver_reference_claims WHERE receiving_vpa=? AND bank_reference=?',[vpa,reference]);
    const historical=db.queryOne("SELECT s.id FROM payment_sessions s JOIN payment_receiving_accounts a ON a.id=s.receiving_account_id WHERE lower(a.upi_id)=? AND s.status='SUCCESS' AND s.id<>? AND json_extract(s.metadata,'$.reportedUtr')=?",[vpa,match.id,reference]);
    const observed=db.queryOne("SELECT s.id FROM payment_observations o JOIN payment_sessions s ON s.id=o.attributed_payment_id JOIN payment_receiving_accounts a ON a.id=s.receiving_account_id WHERE lower(a.upi_id)=? AND o.bank_reference_number=? AND s.id<>? AND s.status='SUCCESS'",[vpa,reference,match.id]);
    const provider=db.queryOne("SELECT id FROM payment_orders WHERE status='SUCCESS' AND bank_reference=?",[reference]);
    if(historical||observed||provider||(claim&&claim.payment_id!==match.id))status='REFERENCE_REUSED';
    else{
     const current=db.queryOne(`SELECT * FROM payment_sessions WHERE id=?${db.dialect==='postgres'?' FOR UPDATE':''}`,[match.id]);
     if(!['ACTIVE','PROCESSING','VERIFICATION_PENDING'].includes(current.status))fail('Order changed while receiving the notification; retry',409);
     if(!claim)db.execute('INSERT INTO pp_receiver_reference_claims VALUES(?,?,?)',[vpa,reference,match.id]);
     const stamp=new Date().toISOString(),metadata={...JSON.parse(current.metadata||'{}'),reportedUtr:reference,notificationConfirmation:{eventId:id,source,sourceEvidence,deviceId:device?.id||null,policyActorId:policy.actor_id,bankVerified:false}};
     db.execute("UPDATE payment_sessions SET verification_tag='NOTIFICATION_CONFIRMED',verification_level=0,metadata=? WHERE id=?",[JSON.stringify(metadata),match.id]);
     const session=sessionRepo.transitionToTerminal(match.id,'SUCCESS');
     new LedgerRepository(db).recordDoubleEntry(mid,'NOTIFICATION_COLLECTION',match.id,'Platform accepted receiving notification; not independently bank verified','NOTIFICATION_CLEARING','MERCHANT_RECEIVABLES',amount);
     ctx.auditRepo?.log({merchantId:mid,entityType:'PAYMENT_SESSION',entityId:match.id,action:'NOTIFICATION_ACCEPTED_AS_PAID',actorType:'SYSTEM',details:{bankReference:reference,source,sourceEvidence,deviceId:device?.id||null,policyActorId:policy.actor_id,bankVerified:false,confirmedAt:stamp}});
     deliveryId=webhookEngine.enqueue('SUCCESS',{...session,confirmationSource:'NOTIFICATION',bankReference:reference}).deliveryId||null;
     status='NOTIFICATION_CONFIRMED';
    }
   }
   if(match&&callbackEnabled&&status==='DETECTED'){
    const prior=db.queryOne("SELECT id FROM pp_receiver_events WHERE payment_id=? AND match_status='DETECTED'",[match.id]);
    if(!prior){const session=sessionRepo.findById(match.id);const queued=webhookEngine.enqueue('PAYMENT_DETECTED',{...session,bankReference:reference||null,confirmationSource:'OBSERVER_EVIDENCE'});deliveryId=queued.deliveryId||null;}
   }
   db.execute('INSERT INTO pp_receiver_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[id,mid,accountId,device?.id||null,source,amount,reference||null,match?.id||null,status,time.toISOString(),new Date().toISOString(),deliveryId]);
   return {id,duplicate:false,matchStatus:status,paymentId:match?.id||null,deliveryId,merchantId:mid};
  });
  if(!result.duplicate){
   try{server.broadcastSse('platform:operations','invalidate',{changed:true});server.broadcastSse('platform:merchant:'+result.merchantId,'invalidate',{changed:true});}catch{}
   if(result.deliveryId)webhookEngine.retryPending(result.deliveryId).catch(e=>console.error('[Detection callback]',e.message));
   if(result.matchStatus==='NOTIFICATION_CONFIRMED'){
    try{ctx.eventEmitter?.emit('PAYMENT.SUCCESS',{paymentId:result.paymentId,webhookQueued:true,verificationLevel:0,verificationTag:'NOTIFICATION_CONFIRMED',confirmationSource:'NOTIFICATION'});}catch(e){console.error('[Notification confirmation publication]',e.message);}
   }
  }
  return result;
 }
 return {issuePairing,consumePairing,bindDevice,binding,record,setPolicy,sourcePolicy,sourceTrusted,observeSource};
}
