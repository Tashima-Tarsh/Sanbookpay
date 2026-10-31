import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function checkout(status='ACTIVE') {
  const html=fs.readFileSync(new URL('../views/checkout-premium.html',import.meta.url),'utf8');
  const elements=new Map();
  function element(id) {if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',value:'',addEventListener(name,fn){this[name]=fn;},setAttribute(name,v){this[name]=v;},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);}
  const apps=['gpay','phonepe','paytm','generic'].map(app=>({...element(app),dataset:{app}}));
  const state={paymentId:'payment-1',orderId:'ORDER-1',merchantName:'Merchant',amount:'123.45',status,payeeVpa:'merchant@upi',upiUri:'upi://pay?pa=merchant%40upi&pn=Merchant&am=123.45&tr=ORDER-1&cu=INR',enabledMethods:['UPI','COD'],timeRemainingSeconds:300};
  const messages=[],requests=[];
  const window={parent:{postMessage:(...args)=>messages.push(args)},addEventListener(){}};
  const context={window,document:{getElementById:element,querySelectorAll:()=>apps,referrer:'https://store.example/product',addEventListener(){}},navigator:{userAgent:'Android',clipboard:{writeText:async()=>{}}},location:{href:'',assign(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,URL,Intl,console,fetch:async(url,init)=>{requests.push({url,init});return {ok:true,json:async()=>state};}};
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('{{INITIAL_STATE_JSON}}',JSON.stringify(state)),context);
  return {context,window,element,apps,messages,requests,state};
}
test('UPI app links preserve the exact session amount, payee and reference',()=>{
  const {window,state}=checkout();
  const gpay=window.dynamoUpiLink('gpay',state.upiUri,'Android');
  assert.ok(gpay.includes('package=com.google.android.apps.nbu.paisa.user'));
  assert.ok(gpay.includes('am=123.45&tr=ORDER-1'));
  assert.equal(window.dynamoUpiLink('generic',state.upiUri,'Android'),state.upiUri);
  assert.ok(window.dynamoUpiLink('gpay',state.upiUri,'iPhone').startsWith('gpay://upi/pay?'));
  assert.throws(()=>window.dynamoUpiLink('gpay','https://malicious.example','Android'));
});
test('queued sessions disable payment actions and never launch a UPI app',()=>{
  const {apps,context}=checkout('QUEUED');
  assert.ok(apps.every(app=>app.disabled));apps[0].click();assert.equal(context.location.href,'');
});
test('verified success notifies the parent store with an explicit origin',()=>{
  const {messages,element}=checkout('SUCCESS');
  assert.equal(messages[0][0].event,'youpi.payment_success');assert.equal(messages[0][1],'https://store.example');
  assert.equal(element('payView').hidden,true);assert.equal(element('statusTitle').textContent,'Payment confirmed');
});
test('COD stays distinct from received funds',()=>{
  const {element}=checkout();assert.equal(element('codOption').hidden,false);
});
test('checkout polls the actual public payment state API',()=>{
  const {requests}=checkout();
  assert.equal(requests[0].url,'/api/v1/checkout/payment-1/state');
});

test('payment-done requires no customer-supplied bank reference and does not confirm payment',async()=>{
  const html=fs.readFileSync(new URL('../views/checkout-premium.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/reportedUtr|saveReference|verify-utr|referenceBox/);
  const {element,requests,messages}=checkout();await element('paymentDone').click();
  const request=requests.find(r=>r.url.endsWith('/payment-done'));
  assert.deepEqual(JSON.parse(request.init.body),{});assert.equal(messages.length,0);
});
test('unconfirmed payments remain pending and do not emit a failed or successful result',()=>{
  const {element,messages}=checkout('VERIFICATION_PENDING');
  assert.equal(element('statusTitle').textContent,'Awaiting bank verification');
  assert.equal(element('payView').hidden,true);assert.equal(element('retryPayment').hidden,true);
  assert.equal(messages.length,0);
});
test('both browser SDK entrypoints resolve gateway-relative checkout links against the gateway origin',async()=>{
  for(const filename of ['youpi.js','youpi-checkout.js']){
    const window={location:{href:'https://merchant.example/product',protocol:'https:',hostname:'merchant.example'}};
    const document={currentScript:{src:'https://gateway.example/youpi.js',getAttribute:()=>null},addEventListener(){}};
    const context={window,document,URL,console,fetch:async()=>({ok:true,json:async()=>({paymentId:'payment-1',checkoutUrl:'/checkout/payment-1'})})};
    vm.runInNewContext(fs.readFileSync(new URL('../sdk/'+filename,import.meta.url),'utf8'),context);
    window.Youpi.prototype.open=function(){};
    const instance=await window.Youpi.pay({amount:123.45,order_id:'ORDER-1'});
    assert.equal(instance.options.checkoutUrl,'https://gateway.example/checkout/payment-1',filename);
  }
});
