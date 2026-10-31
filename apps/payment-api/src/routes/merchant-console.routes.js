import crypto from 'node:crypto';
import { upiChannelSettings } from '../upi-channel.js';
import { HttpServer } from '../server.js';
import { isValidVpa, resolveSecret } from '@youpi/common';
import { SplitSettlementRepository } from '@youpi/db';

export function allocateRecipients(amountPaise, recipients) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) throw new Error('Invalid amount');
  if (!recipients.length || recipients.some(r => !Number.isInteger(r.shareBps) || r.shareBps <= 0) || recipients.reduce((n,r) => n + r.shareBps, 0) !== 10000) throw new Error('Recipient shares must total 100%');
  const rows = recipients.map(r => ({ ...r, amountPaise: Math.floor(amountPaise * r.shareBps / 10000) }));
  let remainder = amountPaise - rows.reduce((n,r) => n + r.amountPaise, 0);
  const ranked = rows.map((r,i) => ({ i, fraction: amountPaise * r.shareBps % 10000 })).sort((a,b) => b.fraction - a.fraction);
  for (let i = 0; i < remainder; i++) rows[ranked[i].i].amountPaise++;
  return rows;
}

export function registerMerchantConsoleRoutes(server, ctx) {
  const { db, merchantRepo } = ctx;
  db.execute(`CREATE TABLE IF NOT EXISTS console_refund_requests (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), payment_id TEXT NOT NULL, amount_paise INTEGER NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING_MANUAL', bank_reference TEXT, created_at TEXT NOT NULL)`);
  db.execute(`CREATE TABLE IF NOT EXISTS console_split_allocations (payment_id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), gross_paise INTEGER NOT NULL, fee_paise INTEGER NOT NULL, gst_paise INTEGER NOT NULL, recipients TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'AWAITING_TRANSFER', created_at TEXT NOT NULL)`);
  db.execute(`CREATE TABLE IF NOT EXISTS console_split_transfers (payment_id TEXT NOT NULL REFERENCES console_split_allocations(payment_id), recipient_vpa TEXT NOT NULL, bank_reference TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(payment_id,recipient_vpa))`);
  const merchant = req => (req.headers['x-merchant-id'] ? merchantRepo.findById(req.headers['x-merchant-id']) : null) || merchantRepo.getDefault();
  const root = '/api/v1/admin/console';
  server.get(root+'/stream',(req,res)=>{
    server.initSse(`console_${merchant(req).id}`,res);
    const expiry=setTimeout(()=>res.end(),300000);expiry.unref?.();res.on('close',()=>clearTimeout(expiry));
  });
  server.get(root+'/operations',(req,res)=>{
    const mid=merchant(req).id;
    const callbacks=['webhook_deliveries','provider_webhook_deliveries'].map(table=>db.queryOne(`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN is_successful=1 THEN 1 ELSE 0 END),0) AS delivered,COALESCE(SUM(CASE WHEN is_successful=0 AND attempt_count>=5 THEN 1 ELSE 0 END),0) AS exhausted FROM ${table} WHERE merchant_id=?`,[mid]));
    const total=callbacks.reduce((n,r)=>n+Number(r.total),0),delivered=callbacks.reduce((n,r)=>n+Number(r.delivered),0),exhausted=callbacks.reduce((n,r)=>n+Number(r.exhausted),0);
    const unmatched=Number(db.queryOne("SELECT COUNT(*) AS n FROM payment_observations o JOIN payment_receiving_accounts a ON a.id=o.receiving_account_id WHERE a.merchant_id=? AND o.attribution_status='UNATTRIBUTED'",[mid]).n);
    const timing=db.queryOne("SELECT COUNT(*) AS samples,AVG(confirmation_time_ms) AS average FROM payment_orders WHERE merchant_id=? AND status='SUCCESS' AND confirmation_time_ms>0",[mid]);
    HttpServer.json(res,200,{callbacks:{total,delivered,pending:total-delivered-exhausted,exhausted},unmatchedObservations:unmatched,providerConfirmation:{samples:Number(timing.samples),averageMs:timing.average===null?null:Math.round(Number(timing.average))}});
  });
  server.get(root+'/upi-channel',(req,res)=>HttpServer.json(res,200,upiChannelSettings(merchant(req))));
  server.post(root+'/upi-channel',async(req,res)=>{
    const body=await HttpServer.parseBody(req),m=merchant(req);
    if(typeof body.enabled!=='boolean'||!Number.isSafeInteger(body.minAmountPaise)||!Number.isSafeInteger(body.maxAmountPaise)||body.minAmountPaise<1||body.maxAmountPaise<body.minAmountPaise||!Array.isArray(body.allowedVpas)||body.allowedVpas.length>100||body.allowedVpas.some(v=>typeof v!=='string'||!isValidVpa(v)))return HttpServer.json(res,400,{error:'Provide valid amount limits, channel state, and UPI IDs.'});
    const upiChannel={enabled:body.enabled,minAmountPaise:body.minAmountPaise,maxAmountPaise:body.maxAmountPaise,allowedVpas:[...new Set(body.allowedVpas.map(v=>v.trim().toLowerCase()))]};
    merchantRepo.update(m.id,{branding:{...m.branding,upiChannel}});HttpServer.json(res,200,upiChannel);
  });
  const config = m => m.branding?.splitConfig || { platformFeeBps: 0, gstPercent: 18, recipients: [] };
  const fail = (res, message) => HttpServer.json(res, 400, { error: message });
  function payments(mid) {
    const sessions = db.query(`SELECT ps.*, c.name AS customer_name, COALESCE(obs.bank_reference_number,po.bank_reference) AS bank_reference,po.id AS provider_order_id FROM payment_sessions ps LEFT JOIN payment_orders po ON po.payment_session_id=ps.id AND po.status='SUCCESS' LEFT JOIN customers c ON ps.customer_id=c.id LEFT JOIN payment_observations obs ON ps.attributed_observation_id=obs.id WHERE ps.merchant_id=? ORDER BY ps.created_at DESC`, [mid]);
    const orders = db.query(`SELECT * FROM payment_orders WHERE merchant_id=? AND (payment_session_id IS NULL OR payment_session_id NOT IN (SELECT id FROM payment_sessions WHERE merchant_id=?)) ORDER BY created_at DESC`, [mid, mid]);
    return [...sessions.map(p => ({ id:p.id, orderId:p.order_id, amountPaise:Number(p.amount_paise), method:p.method, status:p.status, customer:p.customer_name || '', utr:p.bank_reference || '', reportedUtr:JSON.parse(p.metadata || '{}').reportedUtr||'', failureReason:JSON.parse(p.metadata || '{}').cancelledReason || '', createdAt:p.created_at, completedAt:p.completed_at, confirmationSource:p.method==='COD'?'ORDER_PLACED':p.provider_order_id?'PROVIDER':p.verification_tag==='MERCHANT_CONFIRMED'?'MERCHANT':p.attributed_observation_id?'BANK_OBSERVER':null, source:'SESSION' })), ...orders.map(p => ({ id:p.id, orderId:p.merchant_order_id, amountPaise:Number(p.amount_paise), method:p.payment_method, status:p.status, customer:p.customer_name || '', utr:p.bank_reference || '', failureReason:'', createdAt:p.created_at, completedAt:p.confirmed_at, confirmationSource:p.status==='SUCCESS'?'PROVIDER':null, source:'PROVIDER' }))].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }
  server.get(root + '/summary', (req,res) => {
    const list = payments(merchant(req).id);
    const paid = list.filter(p => p.status === 'SUCCESS' && p.method !== 'COD');
    HttpServer.json(res,200,{ total:list.length, collectedPaise:paid.reduce((n,p)=>n+p.amountPaise,0), paid:paid.length, cod:list.filter(p=>p.method==='COD'&&p.status==='SUCCESS').length, failed:list.filter(p=>['FAILED','EXPIRED','CANCELLED','SUSPICIOUS'].includes(p.status)).length, pending:list.filter(p=>!['SUCCESS','FAILED','EXPIRED','CANCELLED','SUSPICIOUS'].includes(p.status)).length });
  });
  server.get(root + '/payments', (req,res) => HttpServer.json(res,200,{ payments:payments(merchant(req).id) }));
  server.get(root + '/credentials', (req,res) => {
    const m=merchant(req);
    HttpServer.json(res,200,{ merchantId:m.id, publishableKey:m.id, clientId:`dp_client_${m.id}`, serviceId:m.id, clientSecret:crypto.createHmac('sha256',resolveSecret('dynamo_client_master_key')).update(m.id).digest('hex'), webhookUrl:m.webhookUrl || '', webhookSecret:m.webhookSecret || '' });
  });
  server.get(root + '/splits', (req,res) => HttpServer.json(res,200,config(merchant(req))));
  server.post(root + '/splits', async (req,res) => {
    const body=await HttpServer.parseBody(req); const m=merchant(req);
    if (!Number.isInteger(body.platformFeeBps) || body.platformFeeBps<0 || body.platformFeeBps>10000 || !Number.isFinite(body.gstPercent) || body.gstPercent<0 || body.gstPercent>100 || body.platformFeeBps*(1+body.gstPercent/100)>10000) return fail(res,'Fee plus tax cannot exceed the payment amount.');
    if (!Array.isArray(body.recipients) || body.recipients.length>20) return fail(res,'Provide up to 20 recipients.');
    const recipients=body.recipients.map(r=>({ name:String(r.name || '').trim(), vpa:String(r.vpa || '').trim(), shareBps:r.shareBps }));
    if (recipients.some(r=>!r.name || r.name.length>120 || !isValidVpa(r.vpa)) || new Set(recipients.map(r=>r.vpa.toLowerCase())).size!==recipients.length) return fail(res,'Each recipient needs a name and a unique valid UPI ID.');
    try { if(recipients.length) allocateRecipients(100,recipients); } catch(e) { return fail(res,e.message); }
    const splitConfig={ platformFeeBps:body.platformFeeBps, gstPercent:body.gstPercent, recipients };
    db.transaction(()=>{
      merchantRepo.update(m.id,{ branding:{ ...m.branding, splitConfig } });
      new SplitSettlementRepository(db).createOrUpdateRule({ merchantId:m.id, platformFeePercent:body.platformFeeBps/10, merchantSharePercent:1000-body.platformFeeBps/10, gstPercent:body.gstPercent });
    });
    HttpServer.json(res,200,splitConfig);
  });
  function recordAllocation(payment) {
    if(payment.status!=='SUCCESS' || payment.method==='COD') return;
    const m=merchantRepo.findById(payment.merchantId); if(!m) return;
    if(!m.branding?.splitConfig) return;
    const c=config(m);
    const gross=Number(payment.amountPaise);
    const split=new SplitSettlementRepository(db).calculateSplit(gross,m.id),fee=split.platformFeePaise,gst=split.gstOnFeePaise;
    const recipients=c.recipients.length?allocateRecipients(gross-fee-gst,c.recipients):[{ name:m.businessName, vpa:'Merchant receiving account', shareBps:10000, amountPaise:gross-fee-gst }];
    db.execute(`INSERT OR IGNORE INTO console_split_allocations (payment_id,merchant_id,gross_paise,fee_paise,gst_paise,recipients,status,created_at) VALUES (?,?,?,?,?,?,?,?)`,[payment.id,m.id,gross,fee,gst,JSON.stringify(recipients),c.recipients.length&&recipients.some(r=>r.amountPaise>0)?'AWAITING_TRANSFER':'ALLOCATED',new Date().toISOString()]);
  }
  ctx.eventEmitter?.on('PAYMENT.SUCCESS', data=>{
    try { const p=ctx.sessionRepo.findById(data.sessionId || data.paymentId); if(p) recordAllocation(p); } catch(e) { console.error('[Split allocation]',e.message); }
  });
  ctx.eventEmitter?.on('PAYMENT.PROVIDER_SUCCESS',data=>{
    try {
      const p=db.queryOne('SELECT * FROM payment_orders WHERE id=?',[data.paymentOrderId]);
      if(p)recordAllocation({id:p.payment_session_id||p.id,merchantId:p.merchant_id,amountPaise:p.amount_paise,status:p.status,method:p.payment_method});
    }catch(e){console.error('[Provider split allocation]',e.message);}
  });
  server.get(root + '/allocations', (req,res) => HttpServer.json(res,200,{ allocations:db.query('SELECT * FROM console_split_allocations WHERE merchant_id=? ORDER BY created_at DESC',[merchant(req).id]).map(r=>({ ...r, recipients:JSON.parse(r.recipients), transfers:db.query('SELECT * FROM console_split_transfers WHERE payment_id=?',[r.payment_id]) })) }));
  server.post(root + '/allocations/:id/transfer',async(req,res,params)=>{
    const m=merchant(req), body=await HttpServer.parseBody(req);
    const row=db.queryOne('SELECT * FROM console_split_allocations WHERE payment_id=? AND merchant_id=?',[params.id,m.id]);
    if(!row || row.status!=='AWAITING_TRANSFER') return fail(res,'Pending recipient allocation not found.');
    const recipients=JSON.parse(row.recipients);
    if(!recipients.some(r=>r.vpa===body.vpa&&r.amountPaise>0) || !/^[A-Za-z0-9-]{6,64}$/.test(body.bankReference||'')) return fail(res,'Choose a recipient with a positive allocation and provide a bank reference.');
    try{db.transaction(()=>{
      db.execute('INSERT INTO console_split_transfers (payment_id,recipient_vpa,bank_reference,created_at) VALUES (?,?,?,?)',[params.id,body.vpa,body.bankReference,new Date().toISOString()]);
      const count=db.queryOne('SELECT COUNT(*) AS n FROM console_split_transfers WHERE payment_id=?',[params.id]).n;
      if(count===recipients.filter(r=>r.amountPaise>0).length)db.execute("UPDATE console_split_allocations SET status='MANUALLY_CONFIRMED' WHERE payment_id=?",[params.id]);
    });}catch{return fail(res,'A transfer reference is already recorded for this recipient.');}
    HttpServer.json(res,200,{recorded:true});
  });
  server.get(root + '/refunds', (req,res) => HttpServer.json(res,200,{ refunds:db.query('SELECT * FROM console_refund_requests WHERE merchant_id=? ORDER BY created_at DESC',[merchant(req).id]) }));
  server.post(root + '/refunds', async (req,res) => {
    const body=await HttpServer.parseBody(req), m=merchant(req);
    const p=payments(m.id).find(p=>p.id===body.paymentId || p.orderId===body.paymentId);
    const amount=String(body.amount ?? '');
    if(!/^\d+(\.\d{1,2})?$/.test(amount)) return fail(res,'Enter an amount with at most two decimal places.');
    const amountPaise=Math.round(Number(amount)*100);
    if(!p || p.status!=='SUCCESS' || p.method==='COD') return fail(res,'Select a successful prepaid payment.');
    if(!Number.isSafeInteger(amountPaise) || amountPaise<=0 || !String(body.reason || '').trim()) return fail(res,'Enter a positive amount and a refund reason.');
    let result;
    try { result=db.transaction(()=>{
      const reserved=Number(db.queryOne("SELECT COALESCE(SUM(amount_paise),0) AS total FROM console_refund_requests WHERE payment_id=? AND status!='REJECTED'",[p.id]).total);
      const providerRefunds=Number(db.queryOne("SELECT COALESCE(SUM(amount_paise),0) AS total FROM refunds WHERE (payment_order_id=? OR payment_order_id IN (SELECT id FROM payment_orders WHERE payment_session_id=?)) AND status NOT IN ('FAILED','REJECTED')",[p.id,p.id]).total);
      if(reserved+providerRefunds+amountPaise>p.amountPaise) throw new Error('Amount exceeds the remaining refundable balance.');
      const id=crypto.randomUUID(), createdAt=new Date().toISOString();
      db.execute('INSERT INTO console_refund_requests (id,merchant_id,payment_id,amount_paise,reason,created_at) VALUES (?,?,?,?,?,?)',[id,m.id,p.id,amountPaise,String(body.reason).trim().slice(0,500),createdAt]);
      return { id, status:'PENDING_MANUAL', amountPaise, createdAt };
    }); } catch(e) { return fail(res,e.message); }
    HttpServer.json(res,201,result);
  });
  server.post(root + '/refunds/:id/confirm', async (req,res,params) => {
    const body=await HttpServer.parseBody(req), m=merchant(req);
    if(!/^[A-Za-z0-9-]{6,64}$/.test(body.bankReference || '')) return fail(res,'Enter the bank transfer reference (6–64 letters or digits).');
    const result=db.execute("UPDATE console_refund_requests SET status='MANUALLY_CONFIRMED',bank_reference=? WHERE id=? AND merchant_id=? AND status='PENDING_MANUAL'",[body.bankReference,params.id,m.id]);
    if(!result.changes) return fail(res,'Pending refund request not found.');
    HttpServer.json(res,200,{ status:'MANUALLY_CONFIRMED' });
  });
}
