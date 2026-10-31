import crypto from 'node:crypto';
import {HttpServer} from '../server.js';

export function registerCallbackWalletRoutes(server,ctx){
 const {db,walletRepo}=ctx,base='/api/v1/callbacks';
 db.execute(`CREATE TABLE IF NOT EXISTS pp_wallet_fulfillments(payment_order_id TEXT PRIMARY KEY REFERENCES payment_orders(id),merchant_id TEXT NOT NULL,player_reference TEXT NOT NULL,wallet_id TEXT NOT NULL REFERENCES gaming_wallets(id),transaction_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(merchant_id,idempotency_key))`);
 const fail=(statusCode,message)=>{throw Object.assign(new Error(message),{statusCode});};
 const wrap=fn=>async(req,res,p)=>{try{await fn(req,res,p);}catch(e){if(process.env.NODE_ENV==='test'&&!e.statusCode)console.error('[Isolated wallet test]',e.message);HttpServer.json(res,e.statusCode||500,{error:e.statusCode?e.message:'Financial operation unavailable; retry the same reference.'});}};
 server.use((req,res,path)=>{
  if(!path.startsWith(base+'/')||path.startsWith(base+'/providers/'))return false;
  const area=path.startsWith(base+'/wallets')?'payments':'transactions';
  return ctx.platformPayments.guard(req,res,'/v1/'+area);
 });
 server.post(base+'/providers/:provider',async(req,res,p)=>{
  if(p.provider.toUpperCase()!=='CASHFREE')return HttpServer.json(res,501,{error:'No approved callback adapter is configured for this provider.'});
  const route=server.routes.find(r=>r.method==='POST'&&r.regex.test('/api/v1/webhooks/cashfree/collections'));
  if(!route)return HttpServer.json(res,503,{error:'Verified provider callback service unavailable'});
  return route.handler(req,res,{});
 });
 server.post(base+'/wallets/credit',wrap(async(req,res)=>{
  const body=await HttpServer.parseBody(req),mid=req.platform.merchantId;
  ctx.platformPayments.requireActive(mid);
  const key=req.headers['idempotency-key']||body.idempotencyKey;
  if(typeof key!=='string'||!/^[-A-Za-z0-9_:]{1,120}$/.test(key)||typeof body.paymentId!=='string')fail(400,'A payment ID and stable Idempotency-Key are required');
  if(body.merchantId&&body.merchantId!==mid)fail(403,'Merchant scope denied');
  const result=db.transaction(()=>{
   const order=db.queryOne(`SELECT * FROM payment_orders WHERE id=? AND merchant_id=?${db.dialect==='postgres'?' FOR UPDATE':''}`,[body.paymentId,mid]);
   if(!order)fail(404,'Payment not found');
   const metadata=JSON.parse(order.metadata||'{}'),player=metadata.playerReference;
   if(typeof player!=='string'||!player||player!==body.playerReference)fail(409,'Player reference must match the authenticated order attribution');
   if(order.status!=='SUCCESS'||!order.provider_payment_id||!db.queryOne('SELECT payment_order_id FROM provider_payment_claims WHERE payment_order_id=? AND provider_payment_id=?',[order.id,order.provider_payment_id]))fail(409,'Authoritative provider confirmation is required');
   const amount=Number(order.amount_paise);if(!Number.isSafeInteger(amount)||amount<=0)fail(409,'Recorded amount is invalid');
   if(body.amountPaise!==undefined&&String(body.amountPaise)!==String(amount))fail(400,'Amount does not match the confirmed payment');
   const previous=db.queryOne('SELECT * FROM pp_wallet_fulfillments WHERE payment_order_id=? OR (merchant_id=? AND idempotency_key=?)',[order.id,mid,key]);
   if(previous){if(previous.payment_order_id!==order.id)fail(409,'Idempotency-Key belongs to another payment');return {transactionId:previous.transaction_id,walletId:previous.wallet_id,duplicate:true};}
   let wallet=walletRepo.findWalletByPlayer(mid,player);if(!wallet)wallet=walletRepo.createWallet({merchantId:mid,playerReference:player});
   if(wallet.status!=='ACTIVE')fail(403,'Wallet is not active');
   const transactionId=crypto.randomUUID(),stamp=new Date().toISOString();
   db.execute('INSERT INTO pp_wallet_fulfillments(payment_order_id,merchant_id,player_reference,wallet_id,transaction_id,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?)',[order.id,mid,player,wallet.id,transactionId,key,stamp]);
   db.execute('UPDATE gaming_wallets SET balance_paise=balance_paise+?,updated_at=? WHERE id=?',[amount,stamp,wallet.id]);
   const updated=walletRepo.findWalletById(wallet.id);
   db.execute('INSERT INTO wallet_transactions(id,wallet_id,payment_order_id,direction,amount_paise,balance_after_paise,narration,reference_type,reference_id,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[transactionId,wallet.id,order.id,'CREDIT',amount,updated.balancePaise,'Verified provider payment fulfillment','PAYMENT',order.id,mid+':'+key,stamp]);
   db.execute('INSERT INTO pp_audit(id,merchant_id,action,entity_id,details,created_at) VALUES(?,?,?,?,?,?)',[crypto.randomUUID(),mid,'WALLET_FULFILLED',order.id,JSON.stringify({playerReference:player,transactionId,amountPaise:amount}),stamp]);
   return {transactionId,walletId:wallet.id,balanceAfterPaise:updated.balancePaise,amountPaise:amount,duplicate:false};
  });
  HttpServer.json(res,200,{success:true,...result});
 }));
 server.get(base+'/wallets/:merchantId/:playerReference',wrap((req,res,p)=>{
  if(p.merchantId!==req.platform.merchantId)fail(403,'Merchant scope denied');
  const wallet=walletRepo.findWalletByPlayer(req.platform.merchantId,p.playerReference);if(!wallet)fail(404,'Wallet not found');
  HttpServer.json(res,200,{wallet,transactions:walletRepo.findTransactionsByWallet(wallet.id,20)});
 }));
 server.post(base+'/diagnostics/search',wrap(async(req,res)=>{
  const body=await HttpServer.parseBody(req);if(typeof body.searchKey!=='string'||body.searchKey.length>200)fail(400,'Valid search reference required');
  const rows=db.query('SELECT id,merchant_order_id,amount_paise,currency,status,provider_name,provider_payment_id,bank_reference,created_at FROM payment_orders WHERE merchant_id=? AND (id=? OR merchant_order_id=? OR provider_payment_id=? OR bank_reference=?)',[req.platform.merchantId,...Array(4).fill(body.searchKey)]);
  HttpServer.json(res,200,{results:rows,resultCount:rows.length});
 }));
}
