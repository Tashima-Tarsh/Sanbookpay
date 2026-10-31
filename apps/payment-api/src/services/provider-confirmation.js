import { PaymentOrderRepository, LedgerRepository } from '@youpi/db';

// The state, journal and callback queue commit together; network delivery happens afterwards.
export function confirmProviderCollection(ctx, orderId, evidence) {
  const { db, providerWebhookEngine } = ctx;
  return db.transaction(() => {
    const orders = new PaymentOrderRepository(db);
    const order = db.queryOne(`SELECT * FROM payment_orders WHERE id=?${db.dialect==='postgres'?' FOR UPDATE':''}`, [orderId]);
    if (!order) throw new Error('Payment order not found');
    if (evidence.amountPaise !== Number(order.amount_paise) || evidence.currency !== order.currency) throw new Error('Provider amount or currency does not match the order');
    if (order.status === 'SUCCESS') {
      if(order.provider_payment_id && order.provider_payment_id!==evidence.providerPaymentId) throw new Error('A different successful payment already exists for this order; reconciliation required');
      return { order, changed:false };
    }
    if (!evidence.providerPaymentId) throw new Error('Provider payment reference is required');
    const claim = db.queryOne('SELECT payment_order_id FROM provider_payment_claims WHERE provider_name=? AND provider_payment_id=?', [order.provider_name,evidence.providerPaymentId]);
    const legacyClaim = db.queryOne('SELECT id FROM payment_orders WHERE provider_name=? AND provider_payment_id=? AND id<>?', [order.provider_name,evidence.providerPaymentId,order.id]);
    if (legacyClaim || (claim && claim.payment_order_id!==order.id)) throw new Error('Provider payment reference is already assigned to another order');
    if (!claim) db.execute('INSERT INTO provider_payment_claims(provider_name,provider_payment_id,payment_order_id) VALUES(?,?,?)', [order.provider_name,evidence.providerPaymentId,order.id]);
    const confirmedAt = new Date().toISOString();
    const updated = orders.update(order.id,{status:'SUCCESS',bankReference:evidence.bankReference||null,providerPaymentId:evidence.providerPaymentId,confirmedAt,confirmationTimeMs:Math.max(0,Date.now()-new Date(order.created_at).getTime()),actorType:evidence.actorType,providerResponse:evidence.rawResponse});
    new LedgerRepository(db).recordDoubleEntry(order.merchant_id,'COLLECTION',order.id,`Provider confirmed collection. Bank reference: ${evidence.bankReference||'not supplied'}`,'PROVIDER_CLEARING','MERCHANT_RECEIVABLES',Number(order.amount_paise));
    if (order.payment_session_id) db.execute("UPDATE payment_sessions SET status='SUCCESS',completed_at=? WHERE id=?", [confirmedAt,order.payment_session_id]);
    const attemptId=JSON.parse(order.metadata||'{}').attemptId;if(attemptId)db.execute('UPDATE pp_payment_attempts SET status=?,updated_at=? WHERE id=? AND payment_order_id=?',['SUCCESS',confirmedAt,attemptId,order.id]);
    const queued = providerWebhookEngine.enqueue('SUCCESS',{
      id:order.id,merchantId:order.merchant_id,orderId:order.merchant_order_id,amountPaise:Number(order.amount_paise),currency:order.currency,method:order.payment_method||'UPI',bankReference:evidence.bankReference||null,confirmationSource:'PROVIDER',completedAt:new Date(confirmedAt),metadata:JSON.parse(order.metadata||'{}'),attemptId:JSON.parse(order.metadata||'{}').attemptId,providerTransactionId:evidence.providerPaymentId
    });
    return { order:updated, changed:true, deliveryId:queued.deliveryId };
  });
}

export function publishProviderCollection(server,ctx,result) {
  if (!result.changed) return;
  const order=result.order;
  server.broadcastSse('platform:operations','invalidate',{changed:true});
  server.broadcastSse('platform:merchant:'+order.merchant_id,'invalidate',{changed:true});
  const update={status:order.status,bankReference:order.bank_reference,orderId:order.merchant_order_id};
  server.broadcastSse(order.id,'payment_status',update);
  if(order.payment_session_id) server.broadcastSse(order.payment_session_id,'status_change',update);
  server.broadcastSse(`console_${order.merchant_id}`,'activity',{paymentId:order.id,status:order.status});
  ctx.eventEmitter?.emit('PAYMENT.PROVIDER_SUCCESS',{paymentOrderId:order.id});
  if(result.deliveryId) ctx.providerWebhookEngine.retryPending(result.deliveryId).catch(error=>console.error('[Provider callback delivery]',error.message));
}
