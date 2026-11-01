import crypto from 'node:crypto';
import { PaymentProvider } from './payment-provider.interface.js';

// v1 hosted links keep card and bank-login inputs on Hyperswitch's payment page.
export class HyperswitchProvider extends PaymentProvider {
  constructor(config={}) {
    super({...config,providerName:'HYPERSWITCH'});
    if(!['SANDBOX','PRODUCTION'].includes(this.environment))throw Error('Invalid Hyperswitch environment');
    this.baseUrl=this.environment==='SANDBOX'?'https://sandbox.hyperswitch.io':'https://api.hyperswitch.io';
    const configured=process.env[`HYPERSWITCH_${this.environment}_BASE_URL`];
    if(configured)this.baseUrl=this.operatorOrigin(configured);
    this.checkoutOrigin=this.operatorOrigin(process.env[`HYPERSWITCH_${this.environment}_CHECKOUT_ORIGIN`]||this.baseUrl);
    this.transport=config.transport||globalThis.fetch;
  }
  operatorOrigin(value) {
    const url=new URL(value),loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(this.environment==='SANDBOX'&&loopback&&url.protocol==='http:')))throw Error('Hyperswitch operator endpoint must be an HTTPS origin; local HTTP is sandbox-only');
    return url.origin;
  }
  async request(path,{method='GET',body}={}) {
    if(!this.clientId||!this.clientSecret||!this.extra.profileId)throw Object.assign(Error('Hyperswitch merchant, profile and API key are required'),{definitiveRejection:true});
    const response=await this.transport(this.baseUrl+path,{method,headers:{'Content-Type':'application/json','api-key':this.clientSecret},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok){await response.body?.cancel();throw Object.assign(Error(`Hyperswitch HTTP ${response.status}`),{httpStatus:response.status,definitiveRejection:[400,401,403,422].includes(response.status)});}
    try{return await response.json();}catch{throw Error('Malformed Hyperswitch response; reconcile the original attempt');}
  }
  evidence(data,id) {
    if(data.payment_id!==id||data.merchant_id!==this.clientId||data.profile_id!==this.extra.profileId)throw Error('Hyperswitch payment ownership does not match this connection');
    if(!Number.isSafeInteger(data.amount)||data.amount<=0||data.currency!=='INR')throw Error('Invalid Hyperswitch amount or currency');
    if(data.status==='succeeded'&&data.amount_received!==data.amount)throw Error('Hyperswitch payment is not fully captured');
    const paymentMethod=data.payment_method==='card'?'CARD':data.payment_method==='bank_redirect'?'NETBANKING':data.payment_method==='upi'?'UPI':'PROVIDER_CHECKOUT';
    const safe={payment_id:data.payment_id,merchant_id:data.merchant_id,profile_id:data.profile_id,amount:data.amount,currency:data.currency,status:data.status,amount_received:data.amount_received,payment_method:data.payment_method};
    return {status:data.status==='succeeded'?'SUCCESS':data.status==='failed'?'FAILED':data.status==='cancelled'?'CANCELLED':'PENDING',amountPaise:data.amount,currency:data.currency,providerPaymentId:data.payment_id,paymentMethod,bankReference:null,rawResponse:safe};
  }
  async createCollection(order) {
    if(!Number.isSafeInteger(order.amountPaise)||order.amountPaise<=0||order.currency!=='INR')throw Object.assign(Error('Use positive integer INR paise'),{definitiveRejection:true});
    let returnUrl;try{returnUrl=new URL(order.returnUrl);}catch{throw Object.assign(Error('Hyperswitch checkout requires a return URL'),{definitiveRejection:true});}
    if(returnUrl.protocol!=='https:'||returnUrl.username||returnUrl.password)throw Object.assign(Error('Return URL must use HTTPS'),{definitiveRejection:true});
    const data=await this.request('/payments',{method:'POST',body:{payment_id:order.merchantOrderId,amount:order.amountPaise,currency:'INR',profile_id:this.extra.profileId,payment_link:true,confirm:false,capture_method:'automatic',return_url:returnUrl.href}});
    const evidence=this.evidence(data,order.merchantOrderId);
    if(evidence.amountPaise!==order.amountPaise)throw Error('Hyperswitch create amount mismatch');
    return {providerOrderId:data.payment_id,checkoutUrl:this.hostedLink(data),rawResponse:evidence.rawResponse};
  }
  hostedLink(data) {
    const checkoutUrl=data.payment_link?.secure_link||data.payment_link?.link;
    let link;try{link=new URL(checkoutUrl);}catch{throw Error('Hyperswitch did not return a hosted payment link');}
    if(link.username||link.password||link.origin!==this.checkoutOrigin)throw Error('Untrusted Hyperswitch checkout URL');
    return link.href;
  }
  async getCollectionStatus(id) {const data=await this.request(`/payments/${encodeURIComponent(id)}?force_sync=true`);return {...this.evidence(data,id),...(data.payment_link?{checkoutUrl:this.hostedLink(data)}:{})};}
  verifyCollectionWebhook({rawBody,headers}) {
    const signature=headers['x-webhook-signature-512'];
    if(!this.webhookSecret||typeof signature!=='string'||!/^[0-9a-f]{128}$/i.test(signature))return false;
    const actual=crypto.createHmac('sha512',this.webhookSecret).update(rawBody).digest();
    return crypto.timingSafeEqual(actual,Buffer.from(signature,'hex'));
  }
  async validateCredentials() {
    const started=Date.now();
    try{await this.request('/payments/list?limit=1');return {reachable:true,authenticated:true,latencyMs:Date.now()-started};}
    catch(error){return {reachable:Boolean(error.httpStatus),authenticated:false,httpStatus:error.httpStatus||null,latencyMs:Date.now()-started};}
  }
}
