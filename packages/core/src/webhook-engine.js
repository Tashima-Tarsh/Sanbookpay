import crypto from 'node:crypto';
import { generateHmac, toRupeesString, validateOutboundWebhookUrl, fetchPublic } from '@youpi/common';
import { isTerminalStatus, toPublicOutcome } from './state-machine.js';

export class WebhookEngine {
  /**
   * @param {{
   *   db: import('@youpi/db').Database,
   *   merchantRepo: import('@youpi/db').MerchantRepository,
   *   maxRetries?: number,
   *   deliveryTable?: string
   * }} options
   */
  constructor(options) {
    this.db = options.db;
    this.merchantRepo = options.merchantRepo;
    this.maxRetries = options.maxRetries || 5;
    this.deliveryTable = options.deliveryTable === 'provider_webhook_deliveries' ? 'provider_webhook_deliveries' : 'webhook_deliveries';
    this.inFlight = new Set();
    this.controllers = new Set();
    this.timeouts = new Set();
    this.stopped = false;
    this.transport=options.transport||fetchPublic;
    this.maxConcurrency=20;
    this.perMerchantConcurrency=5;
    this.merchantInFlight=new Map();
  }

  stop() { this.stopped=true;for(const timeout of this.timeouts)clearTimeout(timeout);this.timeouts.clear();for(const controller of this.controllers)controller.abort(); }

  /**
   * Formats and dispatches a signed webhook for a payment event.
   * @param {string} event E.g. 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED'
   * @param {any} session The payment session entity
   * @returns {Promise<{ delivered: boolean, deliveryId: string, status?: number, error?: string }>}
   */
  async dispatch(event, session) {
    const queued = this.enqueue(event, session);
    if (!queued.deliveryId) return queued;
    const result = await this.retryPending(queued.deliveryId);
    const sent = result[0];
    return { delivered:sent?.success || false, deliveryId:queued.deliveryId, status:sent?.status, error:sent?.error };
  }

  enqueue(event, session) {
    if(this.stopped) throw new Error('Webhook engine is stopped');
    const merchant = this.merchantRepo.findById(session.merchantId);
    if (!merchant) throw Error('Callback merchant no longer exists');
    // Reserve even while configuration is missing; a later URL repair must have an event to recover.
    const endpointCheck=merchant.webhookUrl?validateOutboundWebhookUrl(merchant.webhookUrl):{valid:false};
    const endpoint=endpointCheck.valid?merchant.webhookUrl:'';

    const publicOutcome = isTerminalStatus(event) ? toPublicOutcome(event) : event;

    const bank=session.attributedObservationId?this.db.queryOne('SELECT bank_reference_number,sender_vpa FROM payment_observations WHERE id=?',[session.attributedObservationId]):null;
    const snapshot=session.metadata?.receivingAccountSnapshot||{};
    const payloadObj = {
      event: publicOutcome,
      merchantId:session.merchantId,
      amountPaise:String(session.amountPaise),
      attemptId:session.attemptId||session.metadata?.attemptId||null,
      playerReference:session.metadata?.playerReference||null,
      providerTransactionId:session.providerTransactionId||null,
      paymentId: session.id,
      orderId: session.orderId,
      amount: toRupeesString(session.amountPaise),
      amountPaise: Number(session.amountPaise),
      currency: session.currency || 'INR',
      method: session.method || 'UPI',
      transaction:session.id,
      uniquetransactionid:session.orderId,
      status:publicOutcome==='SUCCESS'?'SUCCESS':publicOutcome==='PAYMENT_DETECTED'?'PENDING':'FAILED',
      bankReferenceNumber:bank?.bank_reference_number||session.bankReference||null,
      utr:bank?.bank_reference_number||session.bankReference||null,
      senderVpa:bank?.sender_vpa||null,
      payeeVpa:snapshot.upiId||null,
      beneficiary:{name:snapshot.payeeName||null,upiId:snapshot.upiId||null},
      confirmationSource:session.confirmationSource||(session.verificationTag==='NOTIFICATION_CONFIRMED'?'NOTIFICATION':session.verificationTag==='MERCHANT_CONFIRMED'?'MERCHANT':session.verificationLevel?'BANK_OBSERVER':null),
      ...(session.confirmationSource==='NOTIFICATION'||session.verificationTag==='NOTIFICATION_CONFIRMED'?{bankVerified:false}:{}),
      completedAt: publicOutcome==='PAYMENT_DETECTED'?null:session.completedAt ? session.completedAt.toISOString() : new Date().toISOString(),
      metadata: session.metadata || {}
    };

    const payloadString = JSON.stringify(payloadObj);
    const deliveryId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    this.db.execute(`
      INSERT INTO ${this.deliveryTable} (
        id, merchant_id, payment_id, event_type, payload, endpoint_url,
        response_status, response_body, attempt_count, is_successful, next_retry_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `, [
      deliveryId,
      merchant.id,
      session.id,
      publicOutcome,
      payloadString,
      endpoint,
      null,
      null,
      0,
      nowIso,
      nowIso
    ]);

    return {
      delivered: false,
      deliveryId
    };
  }

  /**
   * Retries overdue pending webhook deliveries with exponential backoff.
   * Backoff strategy: 5s, 30s, 2m, 10m, 1h
   */
  async retryPending(deliveryId = null) {
    if(this.stopped)return [];
    const pending=this.db.query(`SELECT * FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY merchant_id ORDER BY created_at,id) AS merchant_rank FROM ${this.deliveryTable} WHERE is_successful=0 AND attempt_count<? AND next_retry_at<=? ${deliveryId?'AND id=?':''}) due WHERE merchant_rank<=5 ORDER BY merchant_rank,created_at,id LIMIT 100`,deliveryId?[this.maxRetries,new Date().toISOString(),deliveryId]:[this.maxRetries,new Date().toISOString()]);
    const backoffs=[5000,30000,120000,600000,3600000];
    const results=await Promise.all(pending.map(async item=>{
      const count=this.merchantInFlight.get(item.merchant_id)||0;
      if(this.stopped||this.inFlight.has(item.id)||this.inFlight.size>=this.maxConcurrency||count>=this.perMerchantConcurrency)return null;
      const merchant=this.merchantRepo.findById(item.merchant_id);if(!merchant)return null;
      const endpoint=item.endpoint_url||merchant.webhookUrl;
      const checked=endpoint?validateOutboundWebhookUrl(endpoint):{valid:false};
      if(!checked.valid){
        this.db.execute(`UPDATE ${this.deliveryTable} SET response_body=?,next_retry_at=? WHERE id=?`,['Waiting for a valid merchant callback URL',new Date(Date.now()+30000).toISOString(),item.id]);
        return null;
      }
      if(!item.endpoint_url)this.db.execute(`UPDATE ${this.deliveryTable} SET endpoint_url=? WHERE id=?`,[endpoint,item.id]);
      this.inFlight.add(item.id);this.merchantInFlight.set(item.merchant_id,count+1);
      const controller=new AbortController();this.controllers.add(controller);
      const timeout=setTimeout(()=>controller.abort(),10000);this.timeouts.add(timeout);
      try{
        let success=false,status=null,body=null;
        try{
          const response=await this.transport(checked.url.toString(),{method:'POST',headers:{'Content-Type':'application/json','X-Gateway-Event':item.event_type,'X-Gateway-Signature':'sha256='+generateHmac(item.payload,merchant.webhookSecret),'X-Gateway-Delivery-Id':item.id,'X-Gateway-Timestamp':String(Date.now())},body:item.payload,redirect:'manual',signal:controller.signal,maxResponseBytes:65536});
          status=response.status;body=(await response.text()).substring(0,1000);success=response.ok;
        }catch(error){body=error.message;}
        if(this.stopped)return null;
        const attempt=item.attempt_count+1,next=success||attempt>=this.maxRetries?null:new Date(Date.now()+backoffs[Math.min(attempt-1,backoffs.length-1)]).toISOString();
        this.db.execute(`UPDATE ${this.deliveryTable} SET attempt_count=?,is_successful=?,response_status=?,response_body=?,next_retry_at=? WHERE id=?`,[attempt,success?1:0,status,body,next,item.id]);
        return {id:item.id,success,attempt,status,error:success?undefined:body};
      }finally{
        clearTimeout(timeout);this.timeouts.delete(timeout);this.controllers.delete(controller);this.inFlight.delete(item.id);
        const remaining=(this.merchantInFlight.get(item.merchant_id)||1)-1;if(remaining)this.merchantInFlight.set(item.merchant_id,remaining);else this.merchantInFlight.delete(item.merchant_id);
      }
    }));
    return results.filter(Boolean);
  }
}
