import {validateOutboundWebhookUrl} from '@youpi/common';

export function merchantIntegrationReadiness(ctx,mid){
 const merchant=ctx.merchantRepo.findById(mid),db=ctx.db,account=ctx.accountRepo.findActiveForMerchant(mid);
 const state=db.queryOne('SELECT status FROM pp_merchants WHERE merchant_id=?',[mid]);
 const owner=db.queryOne("SELECT email_verified,mobile_verified FROM pp_users WHERE merchant_id=? AND role='OWNER'",[mid]);
 const callback=merchant?.webhookUrl&&validateOutboundWebhookUrl(merchant.webhookUrl);
 const checks=[
  {id:'owner',label:'Owner email and mobile verified',ready:Boolean(owner?.email_verified&&owner?.mobile_verified),next:'Complete owner invitation and contact verification'},
  {id:'active',label:'Merchant approved and active',ready:state?.status==='ACTIVE',next:'Review the submitted profile, approve and activate the merchant'},
  {id:'callback',label:'Public HTTPS merchant callback configured',ready:Boolean(callback?.valid&&callback.url.protocol==='https:'),next:'Save the game backend HTTPS callback URL'},
  {id:'route',label:'Collection route configured',ready:Boolean(ctx.canActivateMerchant?.(mid)),next:'Configure an approved provider, or receiving account, approved notification source, policy and paired phone'}
 ];
 return {merchantId:mid,businessName:merchant.businessName,status:state?.status||'UNKNOWN',checks,configurationReady:checks.every(c=>c.ready),receivingUpi:account?.upiId||null,liveAcceptance:'REQUIRED: genuine payment, actual bank credit and customer wallet/callback acceptance are separate from configuration checks'};
}

export function merchantIntegrationDetails(ctx,mid){
 const merchant=ctx.merchantRepo.findById(mid),base=(process.env.DYNAMO_PUBLIC_URL||ctx.checkoutBaseUrl||'').replace(/\/$/,'');
 const provider=ctx.db.queryOne("SELECT c.id FROM provider_connections c JOIN pp_connection_policy p ON p.connection_id=c.id WHERE c.merchant_id=? AND c.environment='PRODUCTION' AND c.is_active=1 AND p.approved=1 AND p.enabled=1 ORDER BY p.priority,c.id LIMIT 1",[mid]);
 return {merchantId:mid,businessName:merchant.businessName,loginUrl:base+'/merchant/'+encodeURIComponent(mid),apiBaseUrl:base,createPayment:{method:'POST',url:base+'/v1/payments',headers:{Authorization:'Bearer <YOUR_API_SECRET>','Content-Type':'application/json','Idempotency-Key':'deposit-1001'},body:{...(provider?{connectionId:provider.id,customer:{id:'player-123',name:'REPLACE_WITH_ACTUAL_CUSTOMER_NAME',email:'REPLACE_WITH_ACTUAL_CUSTOMER_EMAIL',phone:'REPLACE_WITH_ACTUAL_CUSTOMER_PHONE'}}:{}),orderId:'deposit-1001',amount:'100.00',currency:'INR',playerReference:'player-123',returnUrl:'https://YOUR-GAME-BACKEND/deposit/result'}},status:{method:'GET',url:base+'/v1/payments/<PAYMENT_ID>'},callback:{url:merchant.webhookUrl,signatureHeader:'X-Gateway-Signature',signature:'sha256=<HMAC-SHA256 of exact raw body using your webhook signing secret>',deliveryIdHeader:'X-Gateway-Delivery-Id',creditRule:'Verify signature, merchant, order, amount, currency and accepted source; atomically deduplicate delivery/payment and credit the mapped player once before returning 2xx',notificationSource:{confirmationSource:'NOTIFICATION',bankVerified:false},maxAttempts:5},openApiUrl:base+'/developers/openapi.json',flow:['Game backend creates a payment using its own key','Game opens the returned checkoutUrl; queued orders await an active QR','Player pays the assigned receiving UPI','Dynamo accepts the configured evidence and reserves a signed callback','Game backend verifies the callback and credits the player once'],secrets:'Server-side only. This pack contains this merchant\'s credentials; never share platform, database, Gmail or phone keys.'};
}
