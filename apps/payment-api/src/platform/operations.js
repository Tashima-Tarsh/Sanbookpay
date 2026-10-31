import { randomUUID } from 'node:crypto';
import { HttpServer } from '../server.js';

const PREFIX = '/api/platform/v1';
const FAIL = (status, message) => { throw Object.assign(new Error(message), { status }); };
const now = () => new Date().toISOString();
const text = (value, name, max = 4000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) FAIL(400, `Valid ${name} required`);
  return value.trim();
};
function integer(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > max) FAIL(400, `Invalid ${name}`);
  return Number(value);
}
function money(value, name) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value)) || (typeof value === 'number' && !Number.isSafeInteger(value))) FAIL(400, `Invalid ${name}`);
  const result = BigInt(value);
  if (result > 9223372036854775807n) FAIL(400, `${name} exceeds supported amount`);
  return result;
}
function date(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) FAIL(400, `Invalid ${name}; use YYYY-MM-DD`);
  return value;
}
function pricing(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) FAIL(400, 'Invalid pricing');
  const result = {};
  for (const key of ['subscriptionPaise','perTransactionPaise']) if (body[key] !== undefined || !partial) result[key] = money(body[key] ?? '0',key).toString();
  for (const key of ['percentageBps','taxBps']) if (body[key] !== undefined || !partial) result[key] = integer(body[key] ?? 0,key,10000);
  if (body.tiers !== undefined) {
    if (!Array.isArray(body.tiers) || body.tiers.length > 100) FAIL(400,'Invalid tiers');
    let previous = 0;
    result.tiers = body.tiers.map((tier,index) => {
      if (!tier || typeof tier !== 'object') FAIL(400,'Invalid tier');
      const upTo = tier.upTo === null ? null : integer(tier.upTo,'tier upTo');
      if (upTo === null ? index !== body.tiers.length - 1 : upTo <= previous) FAIL(400,'Tiers must increase and only the final tier can be unbounded');
      previous = upTo;
      return { upTo, perTransactionPaise:money(tier.perTransactionPaise ?? '0','tier fee').toString(), percentageBps:integer(tier.percentageBps ?? 0,'tier percentage',10000) };
    });
    if (result.tiers.length && result.tiers.at(-1).upTo !== null) FAIL(400,'Final tier must be unbounded');
  } else if (!partial) result.tiers=[];
  return result;
}
const roundBps = (amount,bps) => (amount*BigInt(bps)+5000n)/10000n;
const parse = value => JSON.parse(value || '{}');

export function registerPlatformOperations(server, ctx, identity) {
  const db=ctx.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS pp_cases (id TEXT PRIMARY KEY, merchant_id TEXT REFERENCES merchants(id), kind TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, payment_id TEXT, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS pp_cases_merchant ON pp_cases(merchant_id,kind,status);
    CREATE TABLE IF NOT EXISTS pp_case_events (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES pp_cases(id), actor_id TEXT NOT NULL, previous_status TEXT, status TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pp_pricing_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, pricing TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pp_subscriptions (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), plan_id TEXT NOT NULL REFERENCES pp_pricing_plans(id), effective_from TEXT NOT NULL, pricing TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(merchant_id,effective_from));
    CREATE TABLE IF NOT EXISTS pp_invoices (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), period TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, subscription_id TEXT NOT NULL REFERENCES pp_subscriptions(id), pricing TEXT NOT NULL, usage_count INTEGER NOT NULL, subtotal_paise TEXT NOT NULL, tax_paise TEXT NOT NULL, total_paise TEXT NOT NULL, status TEXT NOT NULL, external_reference TEXT, created_at TEXT NOT NULL, paid_at TEXT, UNIQUE(merchant_id,period));
    CREATE UNIQUE INDEX IF NOT EXISTS pp_invoice_external_reference ON pp_invoices(external_reference);
    CREATE TABLE IF NOT EXISTS pp_invoice_usage (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES pp_invoices(id), merchant_id TEXT NOT NULL REFERENCES merchants(id), order_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, amount_paise TEXT NOT NULL, fee_paise TEXT NOT NULL, confirmed_at TEXT NOT NULL, UNIQUE(source_type,source_id), UNIQUE(merchant_id,order_id));
    CREATE TABLE IF NOT EXISTS pp_credit_notes (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES pp_invoices(id), amount_paise TEXT NOT NULL, reason TEXT NOT NULL, idempotency_key TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(invoice_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS pp_finance_audit (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), invoice_id TEXT REFERENCES pp_invoices(id), action TEXT NOT NULL, actor_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  const audit = (merchantId,invoiceId,action,req,details) => db.execute('INSERT INTO pp_finance_audit (id,merchant_id,invoice_id,action,actor_id,details,created_at) VALUES (?,?,?,?,?,?,?)',[randomUUID(),merchantId,invoiceId,action,req.platform.userId,JSON.stringify(details),now()]);
  function route(method,path,permission,handler,{platform=false}={}) {
    server.register(method,PREFIX+path,async(req,res,params)=>{
      try {
        if (!req.platform?.userId) FAIL(401,'Authentication required');
        if (!await identity.authorize(req,permission) || (platform && !req.platform.platform)) FAIL(403,'Forbidden');
        const query=new URL(req.url,'http://localhost').searchParams;
        const body=method==='GET'?{}:await HttpServer.parseBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) FAIL(400,'JSON object required');
        const result=await handler(req,params,query,body,res);
        if (result !== undefined) HttpServer.json(res,result.statusCode || 200,result.data ?? result);
      } catch(error) {
        const status=error.status || (/Malformed JSON|Payload Too Large/.test(error.message)?400:500);
        if(status===500) ctx.log?.error?.('Platform operations request failed', {error:error.message});
        HttpServer.json(res,status,{error:status===500?'Internal server error':error.message});
      }
    });
  }
  function scope(req,requested) {
    if (!req.platform.platform) {
      if (!req.platform.merchantId || (requested && requested!==req.platform.merchantId)) FAIL(403,'Merchant scope denied');
      return req.platform.merchantId;
    }
    return requested || null;
  }
  function merchant(req,requested) {
    const id=scope(req,requested);
    if (!id) FAIL(400,'merchantId required');
    if (!db.queryOne('SELECT id FROM merchants WHERE id=?',[id])) FAIL(404,'Merchant not found');
    return id;
  }
  function pagination(q) {
    const page=integer(q.get('page')??1,'page'),limit=integer(q.get('limit')??25,'limit',100);
    if (!page || !limit || !Number.isSafeInteger((page-1)*limit)) FAIL(400,'Invalid pagination');
    return {page,limit,offset:(page-1)*limit};
  }
  const normalized=`SELECT po.id,po.merchant_id,po.merchant_order_id AS order_id,po.amount_paise,po.currency,po.status,po.payment_method AS method,po.created_at,po.confirmed_at,po.payment_session_id,'ORDER' AS source_type FROM payment_orders po
    UNION ALL SELECT ps.id,ps.merchant_id,ps.order_id,ps.amount_paise,ps.currency,ps.status,ps.method,ps.created_at,ps.completed_at AS confirmed_at,ps.id AS payment_session_id,'SESSION' AS source_type FROM payment_sessions ps WHERE NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.merchant_id=ps.merchant_id AND (po.payment_session_id=ps.id OR po.merchant_order_id=ps.order_id))`;
  function filters(req,q) {
    const clauses=[],args=[],id=scope(req,q.get('merchantId'));
    if(id){clauses.push('t.merchant_id=?');args.push(id);}
    if(q.has('status')){clauses.push('t.status=?');args.push(text(q.get('status'),'status',80));}
    for(const [key,operator] of [['from','>='],['to','<']]) if(q.has(key)){clauses.push(`SUBSTR(t.created_at,1,10) ${operator} ?`);args.push(date(q.get(key),key));}
    if(q.has('from')&&q.has('to')&&q.get('from')>=q.get('to')) FAIL(400,'from must be before to');
    for(const [key,operator] of [['minAmount','>='],['maxAmount','<=']]) if(q.has(key)){clauses.push(`t.amount_paise ${operator} ?`);args.push(integer(q.get(key),key));}
    if(q.has('search')){const search=text(q.get('search'),'search',160).toLowerCase();clauses.push('(LOWER(t.id) LIKE ? OR LOWER(t.order_id) LIKE ? OR LOWER(t.merchant_id) LIKE ?)');args.push(...Array(3).fill(`%${search}%`));}
    return {where:clauses.length?' WHERE '+clauses.join(' AND '):'',args};
  }
  function transaction(req,id) {
    const merchantId=scope(req);
    const row=db.queryOne(`SELECT * FROM (${normalized}) t WHERE t.id=?${merchantId?' AND t.merchant_id=?':''}`,[id,...merchantId?[merchantId]:[]]);
    if(!row) FAIL(404,'Transaction not found');return row;
  }
  route('GET','/transactions','transactions.read',(req,p,q)=>{
    const {where,args}=filters(req,q),{page,limit,offset}=pagination(q);
    return {items:db.query(`SELECT * FROM (${normalized}) t${where} ORDER BY t.created_at DESC,t.id LIMIT ? OFFSET ?`,[...args,limit,offset]),total:Number(db.queryOne(`SELECT COUNT(*) AS n FROM (${normalized}) t${where}`,args).n),page,limit};
  });
  route('GET','/transactions/:id','transactions.read',(req,p)=>{
    const row=transaction(req,p.id), timeline=[];
    if(row.source_type==='ORDER') timeline.push(...db.query('SELECT id,event_type,previous_status,new_status,actor_type,actor_id,created_at FROM collection_events WHERE payment_order_id=? ORDER BY created_at,id',[row.id]));
    const sessionId=row.payment_session_id;
    const ids=[row.id,...sessionId&&sessionId!==row.id?[sessionId]:[]];
    for(const id of ids) timeline.push(...db.query('SELECT id,action AS event_type,actor_type,actor_id,created_at FROM audit_logs WHERE merchant_id=? AND entity_id=? ORDER BY created_at,id',[row.merchant_id,id]));
    if(sessionId) {
      timeline.push(...db.query("SELECT o.id,'SUPPLEMENTARY_OBSERVATION' AS event_type,o.source,o.amount_paise,o.observed_at,o.ingested_at,o.bank_reference_number,o.attribution_status,o.created_at FROM payment_observations o JOIN payment_sessions s ON s.id=o.attributed_payment_id JOIN payment_receiving_accounts a ON a.id=o.receiving_account_id WHERE s.id=? AND s.merchant_id=? AND a.merchant_id=?",[sessionId,row.merchant_id,row.merchant_id]));
      timeline.push(...db.query("SELECT id,'CALLBACK_DELIVERY' AS event_type,event_type AS outcome,attempt_count,is_successful,response_status,next_retry_at,created_at FROM webhook_deliveries WHERE merchant_id=? AND payment_id=?",[row.merchant_id,sessionId]));
    }
    if(row.source_type==='ORDER') timeline.push(...db.query("SELECT id,'CALLBACK_DELIVERY' AS event_type,event_type AS outcome,attempt_count,is_successful,response_status,next_retry_at,created_at FROM provider_webhook_deliveries WHERE merchant_id=? AND payment_id=?",[row.merchant_id,row.id]));
    return {transaction:row,timeline:timeline.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))};
  });
  route('GET','/analytics','transactions.read',(req,p,q)=>{
    const {where,args}=filters(req,q);
    const rows=db.query(`SELECT status,amount_paise,method FROM (${normalized}) t${where}`,args);
    let successful=0,failed=0,pending=0,amount=0n,successAmount=0n;
    for(const row of rows){const value=money(row.amount_paise,'recorded amount');amount+=value;if(row.status==='SUCCESS'){successful++;if(row.method!=='COD')successAmount+=value;}else if(['FAILED','EXPIRED','CANCELLED'].includes(row.status))failed++;else pending++;}
    return {transactions:rows.length,successful,failed,pending,amountPaise:amount.toString(),successfulAmountPaise:successAmount.toString()};
  });
  route('GET','/operations/health','operations.read',(req,p,q)=>{
    const id=scope(req,q.get('merchantId')),where=id?' WHERE merchant_id=?':'',args=id?[id]:[];
    const providers=db.query(`SELECT id,merchant_id,provider_name,status,is_active,last_tested_at,test_result,updated_at FROM provider_connections${where}`,args);
    const observers=db.query(`SELECT id,merchant_id,device_name,device_model,is_active,last_heartbeat_at,last_observation_at FROM android_devices${where}`,args);
    const callbacks={pending:0,failed:0,successful:0};
    for(const table of ['webhook_deliveries','provider_webhook_deliveries']) {
      const counts=db.query(`SELECT is_successful,next_retry_at,COUNT(*) AS n FROM ${table}${where} GROUP BY is_successful,next_retry_at`,args);
      for(const row of counts) callbacks[row.is_successful?'successful':row.next_retry_at?'pending':'failed']+=Number(row.n);
    }
    return {providers,observers,callbacks,checkedAt:now()};
  });
  function caseRow(req,id) {
    const merchantId=scope(req);const row=db.queryOne(`SELECT * FROM pp_cases WHERE id=?${merchantId?' AND merchant_id=?':''}`,[id,...merchantId?[merchantId]:[]]);
    if(!row) FAIL(404,'Case not found');return row;
  }
  const caseDetail=row=>({case:row,timeline:db.query('SELECT * FROM pp_case_events WHERE case_id=? ORDER BY created_at,id',[row.id])});
  route('GET','/cases','operations.read',(req,p,q)=>{
    const id=scope(req,q.get('merchantId')),clauses=[],args=[];
    if(id){clauses.push('merchant_id=?');args.push(id);}
    for(const key of ['kind','status'])if(q.has(key)){clauses.push(`${key}=?`);args.push(text(q.get(key),key,40));}
    const where=clauses.length?' WHERE '+clauses.join(' AND '):'',{page,limit,offset}=pagination(q);
    return {items:db.query(`SELECT * FROM pp_cases${where} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`,[...args,limit,offset]),total:Number(db.queryOne(`SELECT COUNT(*) AS n FROM pp_cases${where}`,args).n),page,limit};
  });
  route('POST','/cases','operations.write',(req,p,q,b)=>{
    const merchantId=scope(req,b.merchantId),kind=text(b.kind,'kind',40);
    if(!['SUPPORT','DISPUTE','RECONCILIATION','INCIDENT'].includes(kind)) FAIL(400,'Invalid case kind');
    if(kind==='INCIDENT'&&!req.platform.platform) FAIL(403,'Platform incident permission required');
    if(!merchantId&&kind!=='INCIDENT') FAIL(400,'merchantId required');
    if(merchantId)merchant(req,merchantId);
    if(b.paymentId){const payment=transaction(req,text(b.paymentId,'paymentId',160));if(payment.merchant_id!==merchantId)FAIL(404,'Transaction not found');}
    const id=randomUUID(),created=now(),title=text(b.title,'title',200),description=text(b.description,'description');
    db.transaction(()=>{
      db.execute('INSERT INTO pp_cases (id,merchant_id,kind,title,description,payment_id,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[id,merchantId,kind,title,description,b.paymentId||null,'OPEN',req.platform.userId,created,created]);
      db.execute('INSERT INTO pp_case_events (id,case_id,actor_id,previous_status,status,note,created_at) VALUES (?,?,?,?,?,?,?)',[randomUUID(),id,req.platform.userId,null,'OPEN',description,created]);
    });return {statusCode:201,data:caseDetail(caseRow(req,id))};
  });
  route('GET','/cases/:id','operations.read',(req,p)=>caseDetail(caseRow(req,p.id)));
  route('POST','/cases/:id/events','operations.write',(req,p,q,b)=>db.transaction(()=>{
    const row=caseRow(req,p.id),status=b.status??row.status,note=text(b.note,'note');
    if(row.kind==='INCIDENT'&&!req.platform.platform)FAIL(403,'Platform incident permission required');
    const transitions={OPEN:['INVESTIGATING','WAITING','RESOLVED'],INVESTIGATING:['WAITING','RESOLVED'],WAITING:['INVESTIGATING','RESOLVED'],RESOLVED:['INVESTIGATING','CLOSED'],CLOSED:[]};
    if(row.status==='CLOSED'||(status!==row.status&&!transitions[row.status]?.includes(status)))FAIL(409,'Invalid case transition');
    const created=now();db.execute('INSERT INTO pp_case_events (id,case_id,actor_id,previous_status,status,note,created_at) VALUES (?,?,?,?,?,?,?)',[randomUUID(),row.id,req.platform.userId,row.status,status,note,created]);
    db.execute('UPDATE pp_cases SET status=?,updated_at=? WHERE id=?',[status,created,row.id]);return caseDetail(caseRow(req,row.id));
  }));

  route('GET','/billing/plans','finance.read',()=>({items:db.query('SELECT * FROM pp_pricing_plans ORDER BY created_at,id').map(r=>({...r,pricing:parse(r.pricing)}))}),{platform:true});
  route('POST','/billing/plans','finance.write',(req,p,q,b)=>{
    const id=randomUUID(),name=text(b.name,'name',120),value=pricing(b),created=now();
    db.execute('INSERT INTO pp_pricing_plans (id,name,pricing,created_by,created_at) VALUES (?,?,?,?,?)',[id,name,JSON.stringify(value),req.platform.userId,created]);
    return {statusCode:201,data:{plan:{id,name,pricing:value,created_at:created}}};
  },{platform:true});
  route('GET','/billing/subscriptions','finance.read',(req,p,q)=>{
    const id=scope(req,q.get('merchantId'));return {items:db.query(`SELECT * FROM pp_subscriptions${id?' WHERE merchant_id=?':''} ORDER BY effective_from DESC`,id?[id]:[]).map(r=>({...r,pricing:parse(r.pricing)}))};
  });
  route('POST','/billing/subscriptions','finance.write',(req,p,q,b)=>{
    const merchantId=merchant(req,b.merchantId),effective=date(b.effectiveFrom,'effectiveFrom');if(!effective.endsWith('-01'))FAIL(400,'Subscription effectiveFrom must start a month');
    const plan=db.queryOne('SELECT * FROM pp_pricing_plans WHERE id=?',[text(b.planId,'planId',160)]);if(!plan)FAIL(404,'Plan not found');
    const value={...parse(plan.pricing),...pricing(b.overrides??{},true)},id=randomUUID();
    return db.transaction(()=>{
      if(db.queryOne('SELECT id FROM pp_invoices WHERE merchant_id=? AND period_start>=?',[merchantId,effective]))FAIL(409,'An issued invoice already snapshots this period');
      if(db.queryOne('SELECT id FROM pp_subscriptions WHERE merchant_id=? AND effective_from=?',[merchantId,effective]))FAIL(409,'Subscription already assigned for this period');
      db.execute('INSERT INTO pp_subscriptions (id,merchant_id,plan_id,effective_from,pricing,created_by,created_at) VALUES (?,?,?,?,?,?,?)',[id,merchantId,plan.id,effective,JSON.stringify(value),req.platform.userId,now()]);
      audit(merchantId,null,'SUBSCRIPTION_ASSIGNED',req,{subscriptionId:id,effectiveFrom:effective,pricing:value});
      return {statusCode:201,data:{subscription:db.queryOne('SELECT * FROM pp_subscriptions WHERE id=?',[id])}};
    });
  },{platform:true});
  function invoiceRow(req,id) {
    const merchantId=scope(req),row=db.queryOne(`SELECT * FROM pp_invoices WHERE id=?${merchantId?' AND merchant_id=?':''}`,[id,...merchantId?[merchantId]:[]]);if(!row)FAIL(404,'Invoice not found');return row;
  }
  route('GET','/billing/invoices','finance.read',(req,p,q)=>{
    const id=scope(req,q.get('merchantId')),where=id?' WHERE merchant_id=?':'',args=id?[id]:[],{page,limit,offset}=pagination(q);
    return {items:db.query(`SELECT * FROM pp_invoices${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,[...args,limit,offset]),total:Number(db.queryOne(`SELECT COUNT(*) AS n FROM pp_invoices${where}`,args).n),page,limit};
  });
  route('POST','/billing/invoices','finance.write',(req,p,q,b)=>{
    const merchantId=merchant(req,b.merchantId),period=text(b.period,'period',7);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))FAIL(400,'Invalid period; use YYYY-MM');
    const start=date(period+'-01','period'),endDate=new Date(start+'T00:00:00.000Z');
    endDate.setUTCMonth(endDate.getUTCMonth()+1);const end=endDate.toISOString().slice(0,10);
    if(start>now().slice(0,10))FAIL(400,'Future invoice period is not allowed');
    return db.transaction(()=>{
      const existing=db.queryOne('SELECT * FROM pp_invoices WHERE merchant_id=? AND period=?',[merchantId,period]);if(existing)return {invoice:existing,replayed:true};
      const subscription=db.queryOne('SELECT * FROM pp_subscriptions WHERE merchant_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1',[merchantId,start]);if(!subscription)FAIL(409,'No pricing subscription for this period');
      const rate=pricing(parse(subscription.pricing));
      const rows=db.query(`SELECT * FROM (${normalized}) t WHERE t.merchant_id=? AND t.status='SUCCESS' AND UPPER(t.method)<>'COD' AND t.currency='INR' AND SUBSTR(t.confirmed_at,1,10)>=? AND SUBSTR(t.confirmed_at,1,10)<? AND NOT EXISTS (SELECT 1 FROM pp_invoice_usage u WHERE u.merchant_id=t.merchant_id AND u.order_id=t.order_id) ORDER BY t.confirmed_at,t.id`,[merchantId,start,end]);
      let subtotal=BigInt(rate.subscriptionPaise);const usage=rows.map((row,index)=>{
        const tier=rate.tiers?.find(t=>t.upTo===null||index+1<=t.upTo)??rate;
        const fee=BigInt(tier.perTransactionPaise)+roundBps(money(row.amount_paise,'recorded amount'),tier.percentageBps);subtotal+=fee;return {row,fee};
      });
      const tax=roundBps(subtotal,rate.taxBps),id=randomUUID(),created=now();
      db.execute('INSERT INTO pp_invoices (id,merchant_id,period,period_start,period_end,subscription_id,pricing,usage_count,subtotal_paise,tax_paise,total_paise,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,merchantId,period,start,end,subscription.id,JSON.stringify(rate),rows.length,subtotal.toString(),tax.toString(),(subtotal+tax).toString(),'ISSUED',created]);
      for(const {row,fee} of usage)db.execute('INSERT INTO pp_invoice_usage (id,invoice_id,merchant_id,order_id,source_type,source_id,amount_paise,fee_paise,confirmed_at) VALUES (?,?,?,?,?,?,?,?,?)',[randomUUID(),id,merchantId,row.order_id,row.source_type,row.id,String(row.amount_paise),fee.toString(),row.confirmed_at]);
      audit(merchantId,id,'INVOICE_ISSUED',req,{period,usageCount:rows.length,subtotalPaise:subtotal.toString(),taxPaise:tax.toString()});
      return {statusCode:201,data:{invoice:invoiceRow(req,id)}};
    });
  },{platform:true});
  route('GET','/billing/invoices/:id','finance.read',(req,p)=>({invoice:invoiceRow(req,p.id),usage:db.query('SELECT * FROM pp_invoice_usage WHERE invoice_id=? ORDER BY confirmed_at,source_id',[p.id]),creditNotes:db.query('SELECT * FROM pp_credit_notes WHERE invoice_id=? ORDER BY created_at,id',[p.id]),audit:db.query('SELECT * FROM pp_finance_audit WHERE invoice_id=? ORDER BY created_at,id',[p.id])}));
  route('POST','/billing/invoices/:id/payments','finance.write',(req,p,q,b)=>{
    const reference=text(b.externalReference,'externalReference',200),reason=text(b.reason,'reason');
    return db.transaction(()=>{
      const invoice=invoiceRow(req,p.id);
      if(invoice.status==='PAID') {if(invoice.external_reference!==reference)FAIL(409,'Invoice already paid with another reference');return {invoice,replayed:true};}
      if(db.queryOne('SELECT id FROM pp_invoices WHERE external_reference=?',[reference]))FAIL(409,'External reference already used');
      db.execute("UPDATE pp_invoices SET status='PAID',external_reference=?,paid_at=? WHERE id=?",[reference,now(),invoice.id]);
      audit(invoice.merchant_id,invoice.id,'EXTERNAL_PAYMENT_RECORDED',req,{externalReference:reference,reason});return {invoice:invoiceRow(req,invoice.id)};
    });
  },{platform:true});
  route('POST','/billing/invoices/:id/credit-notes','finance.write',(req,p,q,b)=>{
    const amount=money(b.amountPaise,'amountPaise');if(amount===0n)FAIL(400,'Positive credit amount required');
    const reason=text(b.reason,'reason'),key=text(b.idempotencyKey,'idempotencyKey',160);
    return db.transaction(()=>{
      const invoice=invoiceRow(req,p.id),existing=db.queryOne('SELECT * FROM pp_credit_notes WHERE invoice_id=? AND idempotency_key=?',[invoice.id,key]);
      if(existing){if(existing.amount_paise!==amount.toString()||existing.reason!==reason)FAIL(409,'Idempotency key reused with different content');return {creditNote:existing,replayed:true};}
      const credited=db.query('SELECT amount_paise FROM pp_credit_notes WHERE invoice_id=?',[invoice.id]).reduce((sum,row)=>sum+BigInt(row.amount_paise),0n);
      if(credited+amount>BigInt(invoice.total_paise))FAIL(409,'Credit exceeds invoice total');
      const id=randomUUID();db.execute('INSERT INTO pp_credit_notes (id,invoice_id,amount_paise,reason,idempotency_key,actor_id,created_at) VALUES (?,?,?,?,?,?,?)',[id,invoice.id,amount.toString(),reason,key,req.platform.userId,now()]);
      audit(invoice.merchant_id,invoice.id,'CREDIT_NOTE_ISSUED',req,{creditNoteId:id,amountPaise:amount.toString(),reason});
      return {statusCode:201,data:{creditNote:db.queryOne('SELECT * FROM pp_credit_notes WHERE id=?',[id])}};
    });
  },{platform:true});
  route('GET','/billing/statements.csv','finance.read',(req,p,q,b,res)=>{
    const id=scope(req,q.get('merchantId')),rows=db.query(`SELECT * FROM pp_invoices${id?' WHERE merchant_id=?':''} ORDER BY period,id`,id?[id]:[]);
    const columns=['id','merchant_id','period','status','subtotal_paise','tax_paise','total_paise','credit_paise','balance_paise','external_reference'];
    const escape=value=>'"'+String(value??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"';
    const lines=[columns.join(',')];
    for(const row of rows){const credit=db.query('SELECT amount_paise FROM pp_credit_notes WHERE invoice_id=?',[row.id]).reduce((sum,c)=>sum+BigInt(c.amount_paise),0n);row.credit_paise=credit.toString();row.balance_paise=row.status==='PAID'?'0':(BigInt(row.total_paise)-credit).toString();lines.push(columns.map(c=>escape(row[c])).join(','));}
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="platform-billing-statement.csv"','Cache-Control':'no-store'});res.end(lines.join('\r\n')+'\r\n');
  });
}
