import crypto from 'node:crypto';
import { encryptAtRest } from '@youpi/common';
import { ProviderRegistry } from '@youpi/core';
import { HttpServer } from '../server.js';
import { confirmProviderCollection,publishProviderCollection } from '../services/provider-confirmation.js';

export function registerHyperswitchWebhooks(server,ctx) {
  const {db}=ctx,registry=new ProviderRegistry({db});
  server.post('/api/v1/webhooks/hyperswitch/:connectionId',async(req,res,params)=>{
    const connection=db.queryOne("SELECT * FROM provider_connections WHERE id=? AND provider_name='HYPERSWITCH'",[params.connectionId]);
    if(!connection)return HttpServer.json(res,404,{error:'Connection not found'});
    let raw,provider,event;
    try{raw=await HttpServer.parseRawBody(req);provider=registry.getProvider(connection.merchant_id,'HYPERSWITCH',connection.id);}
    catch{return HttpServer.json(res,400,{error:'Unable to read webhook or connection'});}
    if(!provider.verifyCollectionWebhook({rawBody:raw,headers:req.headers}))return HttpServer.json(res,401,{error:'Invalid provider signature'});
    try{event=JSON.parse(raw);}catch{return HttpServer.json(res,400,{error:'Malformed JSON'});}
    if(typeof event.event_id!=='string'||!event.event_id||event.event_id.length>128||event.merchant_id!==connection.client_id)return HttpServer.json(res,409,{error:'Webhook merchant or event reference mismatch'});
    if(event.content?.type!=='payment_details')return HttpServer.json(res,200,{received:true,ignored:true});
    const object=event.content.object;
    if(!object||typeof object.payment_id!=='string')return HttpServer.json(res,400,{error:'Missing payment reference'});
    const orders=db.query("SELECT * FROM payment_orders WHERE provider_name='HYPERSWITCH' AND provider_order_id=? AND merchant_id=?",[object.payment_id,connection.merchant_id]);
    if(orders.length!==1)return HttpServer.json(res,404,{error:'Payment not found for this connection'});
    const order=orders[0],metadata=JSON.parse(order.metadata||'{}');
    if(metadata.connectionId!==connection.id||metadata.environment!==connection.environment)return HttpServer.json(res,409,{error:'Payment connection or environment mismatch'});
    let result;
    try{
      const evidence=provider.evidence({...object,merchant_id:object.merchant_id??event.merchant_id},order.provider_order_id);
      if(evidence.amountPaise!==Number(order.amount_paise)||evidence.currency!==order.currency)throw Error('Payment amount mismatch');
      if(!['payment_succeeded','payment_captured'].includes(event.event_type)||evidence.status!=='SUCCESS')return HttpServer.json(res,200,{received:true,ignored:true});
      db.transaction(()=>{
        const eventId=crypto.createHash('sha256').update(connection.id+':'+event.event_id).digest('hex');
        const prior=db.queryOne('SELECT payment_order_id FROM pp_provider_events WHERE id=?',[eventId]);
        if(prior&&prior.payment_order_id!==order.id)throw Error('Reused event reference');
        result=confirmProviderCollection(ctx,order.id,{...evidence,actorType:'PROVIDER_WEBHOOK'});
        db.execute('INSERT INTO pp_provider_events(id,merchant_id,payment_order_id,provider_name,provider_payment_id,event_type,payload_encrypted,status,received_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
          [eventId,order.merchant_id,order.id,'HYPERSWITCH',evidence.providerPaymentId,event.event_type,encryptAtRest(JSON.stringify(evidence.rawResponse)),'PROCESSED',new Date().toISOString()]);
      });
    }catch{return HttpServer.json(res,409,{error:'Payment evidence rejected; reconcile the original payment'});}
    publishProviderCollection(server,ctx,result);
    return HttpServer.json(res,200,{received:true,status:result.order.status});
  });
}
