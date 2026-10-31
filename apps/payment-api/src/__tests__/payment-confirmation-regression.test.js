import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {Database,runMigrations,PaymentOrderRepository,LedgerRepository,MerchantRepository,PayoutRepository} from '@youpi/db';
import {ProviderRegistry,WebhookEngine} from '@youpi/core';
import {CashfreeProvider} from '../../../../packages/core/src/providers/cashfree-provider.js';
import {ReceiptNotificationService} from '../services/receipt-notification.service.js';
import {createPaymentApp} from '../index.js';
import {authHeaders} from '../../../../scripts/test-support.js';

test('provider confirmation, durable callbacks, receipts and merchant live updates',async t=>{
  const db=new Database({inMemory:true});runMigrations(db);
  const app=createPaymentApp(db),ctx=app.context;
  await new Promise(r=>app.rawServer.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${app.rawServer.address().port}`;
  const merchants=new MerchantRepository(db),merchant=merchants.getDefault(),orders=new PaymentOrderRepository(db);
  let callbackStatus=500;const received=[];
  const receiver=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;received.push({raw,headers:req.headers});res.writeHead(callbackStatus);res.end('received');});
  await new Promise(r=>receiver.listen(0,'127.0.0.1',r));
  merchants.update(merchant.id,{webhookUrl:`http://127.0.0.1:${receiver.address().port}/callback`,webhookSecret:'merchant-test-secret'});
  const secret='provider-test-secret',provider=new CashfreeProvider({clientSecret:secret,environment:'SANDBOX'});
  const original=ProviderRegistry.prototype.getProvider;ProviderRegistry.prototype.getProvider=()=>provider;
  t.after(async()=>{ProviderRegistry.prototype.getProvider=original;app.destroy();app.rawServer.closeAllConnections();receiver.closeAllConnections();await Promise.all([new Promise(r=>app.rawServer.close(r)),new Promise(r=>receiver.close(r))]);db.close();});
  const create=(name,extra={})=>orders.create({merchantId:merchant.id,merchantOrderId:name,providerOrderId:name,amountPaise:20100,...extra});
  const send=async(order,payment={},extra={},valid=true)=>{
    const raw=JSON.stringify({type:'PAYMENT_SUCCESS_WEBHOOK',data:{order:{order_id:order.provider_order_id},payment:{payment_status:'SUCCESS',payment_amount:'201.00',payment_currency:'INR',cf_payment_id:'cf-'+order.id,bank_reference:'900000000123',...payment}},...extra});
    const timestamp=Date.now().toString(),signature=crypto.createHmac('sha256',secret).update(timestamp+raw).digest('base64');
    return fetch(base+'/api/v1/webhooks/cashfree/collections',{method:'POST',headers:{'Content-Type':'application/json','x-webhook-timestamp':timestamp,'x-webhook-signature':valid?signature:'bad'},body:raw});
  };
  await t.test('nested financial work rolls back and duplicate journal entries reuse the original posting',()=>{
    const ledger=new LedgerRepository(db),post=amount=>ledger.recordDoubleEntry(merchant.id,'TEST','reference','Test','PROVIDER_CLEARING','MERCHANT_RECEIVABLES',amount);
    assert.throws(()=>db.transaction(()=>{post(400);throw Error('rollback');}),/rollback/);
    assert.equal(db.queryOne("SELECT COUNT(*) AS n FROM ledger_transactions WHERE reference_type='TEST'").n,0);
    const first=post(400);assert.equal(post(400).transactionId,first.transactionId);
    assert.throws(()=>post(401),/different entries/);assert.throws(()=>post(0.5),/Invalid ledger/);
    db.transaction(()=>{assert.throws(()=>db.transaction(()=>{throw Error('inner');}),/inner/);post(400);});
  });
  await t.test('rejects unsigned, wrong-amount, wrong-currency and missing-reference confirmations',async()=>{
    const order=create('BAD-EVIDENCE');
    assert.equal((await send(order,{}, {},false)).status,401);
    for(const payment of [{payment_amount:'202.00'},{payment_currency:'USD'},{cf_payment_id:null}])assert.equal((await send(order,payment)).status,409);
    assert.notEqual(orders.findById(order.id).status,'SUCCESS');
    assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM provider_webhook_deliveries').n,0);
  });
  await t.test('ledger failures roll back status, provider claim and callback queue, then a retry succeeds',async()=>{
    const order=create('ROLLBACK');const execute=db.execute.bind(db);
    db.execute=(sql,params)=>{if(sql.includes('INSERT INTO ledger_entries'))throw Error('synthetic journal failure');return execute(sql,params);};
    try{assert.equal((await send(order)).status,409);}finally{db.execute=execute;}
    assert.notEqual(orders.findById(order.id).status,'SUCCESS');
    assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM provider_payment_claims WHERE payment_order_id=?',[order.id]).n,0);
    assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM provider_webhook_deliveries WHERE payment_id=?',[order.id]).n,0);
    assert.equal((await send(order)).status,200);
    assert.equal(orders.findById(order.id).status,'SUCCESS');
  });
  let paid;
  await t.test('concurrent duplicate callbacks post once; a late failure never replaces success',async()=>{
    paid=create('DUPLICATES');
    const responses=await Promise.all(Array.from({length:6},()=>send(paid)));assert.ok(responses.every(r=>r.status===200));
    assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM ledger_transactions WHERE reference_id=?',[paid.id]).n,1);
    assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM provider_webhook_deliveries WHERE payment_id=?',[paid.id]).n,1);
    assert.equal((await send(paid,{payment_status:'FAILED'})).status,200);
    assert.equal(orders.findById(paid.id).status,'SUCCESS');
    const other=create('REUSED-REFERENCE');assert.equal((await send(other,{cf_payment_id:'cf-'+paid.id})).status,409);
  });
  await t.test('durable callback queue recovers after engine restart, preserving delivery ID and payload',async()=>{
    // Wait for the first asynchronous attempt before simulating a process restart.
    for(let i=0;i<100&&ctx.providerWebhookEngine.inFlight.size;i++)await new Promise(r=>setTimeout(r,5));
    const before=db.queryOne('SELECT * FROM provider_webhook_deliveries WHERE payment_id=?',[paid.id]);assert.equal(before.attempt_count,1);assert.equal(before.is_successful,0);
    callbackStatus=200;db.execute('UPDATE provider_webhook_deliveries SET next_retry_at=? WHERE id=?',[new Date(0).toISOString(),before.id]);
    const restarted=new WebhookEngine({db,merchantRepo:merchants,deliveryTable:'provider_webhook_deliveries'});
    const result=await restarted.retryPending(before.id);assert.equal(result[0].success,true);
    const attempts=received.filter(r=>r.headers['x-gateway-delivery-id']===before.id);assert.equal(attempts.length,2);assert.equal(attempts[0].raw,attempts[1].raw);
    const body=JSON.parse(attempts[1].raw);assert.equal(body.confirmationSource,'PROVIDER');assert.equal(body.utr,'900000000123');
  });
  await t.test('a type label cannot turn a failed payment attempt into success',async()=>{
    const order=create('CONTRADICTORY');assert.equal((await send(order,{payment_status:'FAILED'})).status,200);assert.equal(orders.findById(order.id).status,'FAILED');
    assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM ledger_transactions WHERE reference_id=?',[order.id]).n,0);
  });
  await t.test('provider status recovery uses the merchant order reference and the same atomic confirmation path',async()=>{
    const order=create('STATUS-RECOVERY',{providerOrderId:'old-numeric-provider-order'});
    const request=provider._request;
    provider._request=async url=>{assert.ok(url.endsWith('/orders/STATUS-RECOVERY/payments'));return {ok:true,data:[{payment_status:'SUCCESS',payment_amount:201,payment_currency:'INR',cf_payment_id:'status-payment',payment_gateway_details:{gateway_order_id:'not-a-bank-utr'}}]};};
    try{
      const res=await fetch(base+`/api/v1/collections/${order.id}/refresh-status`,{method:'POST',headers:authHeaders({'x-merchant-id':merchant.id})});
      assert.equal(res.status,200);assert.equal((await res.json()).status,'SUCCESS');
      assert.equal(orders.findById(order.id).bank_reference,null);
      assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM ledger_transactions WHERE reference_id=?',[order.id]).n,1);
    }finally{provider._request=request;}
  });
  await t.test('receipts require final status, never invent a UTR/contact/delivery, survive restart and escape HTML',async()=>{
    const pending=ctx.sessionRepo.create({merchantId:merchant.id,orderId:'PENDING-RECEIPT',amountPaise:400,status:'QUEUED'});
    assert.equal((await fetch(base+`/api/v1/payments/${pending.id}/receipt?format=json`)).status,409);
    const session=ctx.sessionRepo.create({merchantId:merchant.id,orderId:'<script>alert(1)</script>',amountPaise:400,status:'SUCCESS',verificationTag:'MERCHANT_CONFIRMED'});
    const receipt=await ctx.receiptService.sendPaymentReceipt(session,null,merchant);
    assert.equal(receipt.utr,null);assert.equal(receipt.maskedPhone,null);assert.equal(receipt.smsStatus,'NOT_CONFIGURED');assert.equal(receipt.emailStatus,'NOT_CONFIGURED');assert.equal(receipt.dispatchedAt,null);
    assert.ok(!receipt.emailHtml.includes('<script>'));assert.ok(receipt.emailHtml.includes('&lt;script&gt;'));
    const restarted=new ReceiptNotificationService(db,ctx.auditRepo);assert.equal((await restarted.getOrCreateReceipt(session)).receiptId,receipt.receiptId);
    const cod=ctx.sessionRepo.create({merchantId:merchant.id,orderId:'COD-RECEIPT',amountPaise:400,status:'SUCCESS',method:'COD'});
    assert.match((await restarted.sendPaymentReceipt(cod)).emailHtml,/cash due on delivery/);
  });
  await t.test('authenticated merchant stream sends canonical refresh notifications and removes closed clients',async()=>{
    assert.equal((await fetch(base+'/api/v1/admin/console/stream')).status,401);
    const controller=new AbortController();const res=await fetch(base+'/api/v1/admin/console/stream',{headers:authHeaders(),signal:controller.signal});assert.equal(res.status,200);
    const reader=res.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/event: connected/);
    const session=ctx.sessionRepo.findByOrderId(merchant.id,'PENDING-RECEIPT');ctx.eventEmitter.emit('SESSION.PROCESSING',{sessionId:session.id});
    const next=new TextDecoder().decode((await reader.read()).value);assert.match(next,/event: activity/);assert.match(next,new RegExp(session.id));
    controller.abort();await reader.cancel().catch(()=>{});
    for(let i=0;i<50&&app.server.sseClients.has(`console_${merchant.id}`);i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(app.server.sseClients.has(`console_${merchant.id}`),false);
    const ops=await fetch(base+'/api/v1/admin/console/operations',{headers:authHeaders()});assert.equal(ops.status,200);assert.ok((await ops.json()).callbacks.total>=2);
  });
  await t.test('payout journal errors roll back status; duplicate and late conflicting callbacks do not repost',async()=>{
    const payouts=new PayoutRepository(db);
    const payout=payouts.create({merchantId:merchant.id,transferId:'ATOMIC-PAYOUT',idempotencyKey:'ATOMIC-PAYOUT',amountPaise:400,status:'PROCESSING'});
    const callback=async status=>{
      const raw=JSON.stringify({transferId:payout.transfer_id,status,utr:'900000000456'}),timestamp=Date.now().toString();
      return fetch(base+'/api/v1/webhooks/cashfree/payouts',{method:'POST',headers:{'Content-Type':'application/json','x-webhook-timestamp':timestamp,'x-cf-signature':crypto.createHmac('sha256',secret).update(raw).digest('hex')},body:raw});
    };
    const execute=db.execute.bind(db);db.execute=(sql,params)=>{if(sql.includes('INSERT INTO ledger_entries'))throw Error('synthetic payout journal failure');return execute(sql,params);};
    try{assert.equal((await callback('SUCCESS')).status,500);}finally{db.execute=execute;}
    assert.equal(payouts.findById(payout.id).status,'PROCESSING');
    assert.equal((await callback('SUCCESS')).status,200);assert.equal((await callback('SUCCESS')).status,200);assert.equal((await callback('FAILED')).status,200);
    assert.equal(payouts.findById(payout.id).status,'SUCCESS');assert.equal(db.queryOne('SELECT COUNT(*) AS n FROM ledger_transactions WHERE reference_id=?',[payout.id]).n,1);
  });
});
