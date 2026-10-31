import {toPaise, toRupeesString} from '@youpi/common';

export const BANKING_CONNECTOR_KINDS=['PAYGATE','DJANGO_N8N','INDIA_BANKING'];
const bankMethod='india_banking.india_banking.doctype.bank_connector.bank_connector.';

/** Protocol adapters; notification results are evidence, never settlement authority. */
export class BankingConnector {
 constructor(config){this.config=config;}

 async request(path,body,allowNotFound=false){
  const c=this.config;
  const headers={'accept':'application/json'};
  if(c.kind==='PAYGATE')headers.authorization='Bearer '+c.apiKey;
  else if(c.kind==='DJANGO_N8N')headers['x-gateway-key']=c.apiKey;
  else headers.authorization='token '+c.apiKey+':'+c.apiSecret;
  if(body!==undefined)headers['content-type']='application/json';
  if(c.kind==='PAYGATE'&&body)headers['idempotency-key']=body.external_id;
  let response;
  try{
   response=await fetch(c.baseUrl.replace(/\/$/,'')+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});
   if(response.status===404&&allowNotFound)return {authenticated:true};
   if(!response.ok)throw Error('Upstream unavailable');
   const data=await response.json();
   if(!data||typeof data!=='object')throw Error('Invalid upstream response');
   return data;
  }catch{throw Object.assign(Error('Banking service unavailable; reconcile the original request before retrying creation.'),{code:'UPSTREAM_UNAVAILABLE'});}
 }

 async createPayment({amountPaise,payeeName,upiId,reference,callbackUrl}){
  const c=this.config;
  if(typeof amountPaise!=='bigint'||amountPaise<=0n||amountPaise>BigInt(Number.MAX_SAFE_INTEGER)-199n)throw Error('Supply a positive INR amount within the safe supported range.');
  if(c.kind==='INDIA_BANKING')throw Error('India Banking supplies bank balance/statements; use a collection connector for QR payments.');
  if(c.kind==='PAYGATE'&&amountPaise%100n!==0n)throw Error('PayGate requires a whole INR amount.');
  const payload=c.kind==='PAYGATE'
   ?{amount:Number(amountPaise/100n),name:payeeName,external_id:reference,metadata:{dynamoReference:reference}}
   :{amount:toRupeesString(amountPaise),client_reference:reference,webhook_url:callbackUrl};
  const data=await this.request(c.kind==='PAYGATE'?'/v1/payments':'/api/v1/payments/create',payload);
  const externalId=data.id??data.payment_id;
  const payable=toPaise(data.payable_amount??data.unique_amount);
  if(toPaise(data.requested_amount??data.amount)!==amountPaise||payable<amountPaise||payable>amountPaise+199n||payable>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Upstream amount does not match the requested payment.');
  const uri=new URL(data.upi_uri??data.upi_link);
  if(uri.protocol!=='upi:'||uri.hostname!=='pay'||uri.searchParams.get('pa')?.toLowerCase()!==upiId.toLowerCase())throw Error('Upstream payment destination does not match the receiving account.');
  if(uri.searchParams.get('cu')!=='INR'||toPaise(uri.searchParams.get('am'))!==payable)throw Error('Upstream QR amount or currency does not match.');
  if(!externalId||String(externalId).length>150)throw Error('Upstream payment identifier is missing.');
  const expiresAt=data.expires_at?new Date(data.expires_at):new Date(Date.now()+300000);
  if(!Number.isFinite(expiresAt.getTime())||expiresAt.getTime()<=Date.now())throw Error('Upstream payment instruction has expired.');
  return {externalId:String(externalId),amountPaise:payable,upiUri:uri.href,expiresAt:new Date(Math.min(expiresAt.getTime(),Date.now()+300000))};
 }

 getPayment(id){return this.request(this.config.kind==='PAYGATE'?'/v1/payments/'+encodeURIComponent(id):'/api/v1/payments/'+encodeURIComponent(id)+'/status');}
 checkCredentials(){return this.request(this.config.kind==='PAYGATE'?'/v1/payments/pay_dynamo_connection_probe':'/api/v1/payments/0/status',undefined,true);}
 async getBalance(){
  await this.request('/api/method/'+bankMethod+'get_bank_balance',{bank_account_name:this.config.bankAccountName});
  const result=await this.request('/api/resource/Bank%20Account/'+encodeURIComponent(this.config.bankAccountName));
  return {bankAccountName:this.config.bankAccountName,balance:result.data?.bank_balance??null,source:'ERPNEXT_BANK_ACCOUNT',bankRefreshVerified:false};
 }
 async getStatements(fromDate,toDate){
  // Upstream updates ERPNext Bank Transaction documents; the method itself returns no rows.
  await this.request('/api/method/'+bankMethod+'get_bank_statements',{bank_account_name:this.config.bankAccountName,from_date:fromDate,to_date:toDate});
  const query=new URLSearchParams({fields:JSON.stringify(['name','bank_account','date','deposit','withdrawal','reference_number','currency']),filters:JSON.stringify([['bank_account','=',this.config.bankAccountName],['date','>=',fromDate],['date','<=',toDate]]),limit_page_length:'100',order_by:'date desc, name desc'});
  const result=await this.request('/api/resource/Bank%20Transaction?'+query);
  if(!Array.isArray(result.data))throw Error('Bank transactions are unavailable.');
  return {transactions:result.data,mayHaveMore:result.data.length===100,bankRefreshVerified:false};
 }
}
