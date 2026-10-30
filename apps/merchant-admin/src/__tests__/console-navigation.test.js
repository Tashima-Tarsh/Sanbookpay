import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('every sidebar destination shows one matching content view and API settings save to the server',async()=>{
  const elements=new Map(),listeners={},requests=[];
  function element(id){if(!elements.has(id)){
    const classes=new Set();
    elements.set(id,{id,hidden:false,value:'',dataset:{},classList:{toggle(c,on){on?classes.add(c):classes.delete(c);},remove(c){classes.delete(c);}},addEventListener(event,fn){this[event]=fn;},setAttribute(){},removeAttribute(){},insertAdjacentHTML(){},replaceChildren(){},closest(){return this;},focus(){},showModal(){},close(){}});
  }return elements.get(id);}
  const names=['overview','transactions','failures','refunds','splits','settlements','upi','merchants','api','alerts'];
  const nav=names.map(name=>Object.assign(element('nav-'+name),{dataset:{page:name}}));
  const views=names.map(name=>element('page-'+name));
  const data={
    'v1/admin/console/summary':{total:1,paid:1,failed:0,pending:0,cod:0,collectedPaise:400},
    'v1/admin/console/payments':{payments:[{id:'receipt-4',orderId:'ORDER-REAL',amountPaise:400,status:'SUCCESS',method:'UPI',source:'SESSION',createdAt:new Date().toISOString()}]},'v1/admin/console/refunds':{refunds:[{id:'refund-4',payment_id:'receipt-4',amount_paise:400,status:'PENDING_MANUAL',reason:'Return'}]},'v1/refunds':{refunds:[]},
    'v1/admin/console/splits':{platformFeeBps:500,gstPercent:18,recipients:[]},'v1/admin/console/allocations':{allocations:[]},
    'v1/admin/console/credentials':{merchantId:'merchant-1',clientId:'client-1',clientSecret:'protected-secret',webhookSecret:'protected-webhook'},
    'v1/admin/merchant-settings':{businessName:'Dynamo merchant'},'v1/admin/upi-accounts':{accounts:[]},
    'v1/settlements':{settlements:[]},'v1/settlements/overview':{},'v1/operations/alerts':{alerts:[]},'v1/admin/observers':{gmail:{status:'STANDBY'},sms:{status:'STANDBY'},android:{devices:[]}}
  };
  const document={getElementById:element,querySelectorAll:q=>q==='.dp-view'?views:q==='[data-page]'?nav:[],addEventListener:(event,fn)=>listeners[event]=fn,body:element('body'),hidden:false};
  const location={origin:'https://pay.example',hash:'',assign(url){this.destination=url;}};
  const context={document,location,history:{replaceState(a,b,hash){location.hash=hash;}},navigator:{clipboard:{writeText:async()=>{}}},setTimeout:()=>1,setInterval:()=>1,clearTimeout(){},clearInterval(){},URL,Intl,console,fetch:async(url,init)=>{requests.push({url,init});return{ok:true,status:200,json:async()=>url==='/api/console/session'?{authenticated:true}:data[url.replace('/api/console/','')]||{}};}};
  const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
  vm.runInNewContext(fs.readFileSync(new URL('../../public/dynamo-console.js',import.meta.url),'utf8'),context);
  await flush();
  assert.equal(element('statTotal').textContent,'1');
  assert.ok(element('collectionChart').innerHTML.includes('has-value'));
  assert.equal(element('dashboardAttention').hidden,false);
  assert.ok(element('dashboardAttention').innerHTML.includes('A refund needs your attention'));
  for(const item of nav){await listeners.click({target:item});await flush();
    assert.equal(element('page-'+item.dataset.page).hidden,false,item.dataset.page);
    assert.equal(views.filter(v=>!v.hidden).length,1,item.dataset.page);
    assert.equal(location.hash,'#'+item.dataset.page);
    assert.equal(element('loadError').hidden,true,item.dataset.page);
  }
  assert.equal(element('clientSecret').value,'protected-secret');
  element('webhookUrl').value='https://store.example/webhook';
  await element('webhookForm').submit({preventDefault(){},submitter:element('saveWebhook')});
  const saved=requests.find(r=>r.url.endsWith('/merchant-settings')&&r.init?.method==='POST');
  assert.equal(JSON.parse(saved.init.body).webhookUrl,'https://store.example/webhook');
  data['v1/payments']={paymentId:'one-click-payment'};
  await element('paymentForm').submit({preventDefault(){},submitter:element('createSubmit')});
  assert.equal(location.destination,'/checkout/one-click-payment');
  element('gmailClientId').value='google-client.apps.googleusercontent.com';element('gmailClientSecret').value='google-client-secret';element('gmailRefreshToken').value='';
  await element('gmailForm').submit({preventDefault(){},submitter:element('gmailSave')});
  const gmailSaved=requests.find(r=>r.url.endsWith('/gmail/credentials')&&r.init?.method==='POST');
  assert.equal(JSON.parse(gmailSaved.init.body).clientSecret,'google-client-secret');assert.equal(JSON.parse(gmailSaved.init.body).refreshToken,undefined);
  assert.ok(requests.some(r=>r.url.endsWith('/gmail/start-observer')));assert.equal(element('gmailClientSecret').value,'');
  data['v1/admin/gmail/oauth/start']={authUrl:'https://accounts.google.com/o/oauth2/v2/auth?client_id=client'};
  await element('connectGmail').click();assert.ok(location.destination.startsWith('https://accounts.google.com/'));
});
