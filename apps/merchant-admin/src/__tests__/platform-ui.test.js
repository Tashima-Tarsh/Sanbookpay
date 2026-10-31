import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../public/platform.js', import.meta.url), 'utf8');
const markup = fs.readFileSync(new URL('../../public/platform.html', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

function harness(authenticated = true, platformOwner = false) {
  const elements = new Map(), requests = [], windowEvents = {};
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.events = {}; this.attributes = {}; this.nodeType = 1; this.hidden = false; this.value = ''; this._text = ''; this.classList = { toggle() {}, contains() { return false; } }; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set id(value) { this.attributes.id = value; elements.set(value, this); }
    get id() { return this.attributes.id; }
    setAttribute(key, value) { this.attributes[key] = value; if (key === 'id') this.id = value; if (key === 'value') this.value = value; }
    addEventListener(name, listener) { this.events[name] = listener; }
    append(...children) { for (const child of children.flat()) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
    replaceWith(child) { if (this.parent) this.parent.children[this.parent.children.indexOf(this)] = child; child.parent = this.parent; if (this.id) elements.set(this.id, child); }
    find(predicate) { if (predicate(this)) return this; for (const child of this.children) { const match = child.find?.(predicate); if (match) return match; } }
    querySelector(selector) { return this.find(node => node.tagName === selector); }
    querySelectorAll() { return []; }
    get elements() { return { namedItem: name => this.find(node => node.attributes?.name === name) }; }
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    reset() {}
  }
  const get = id => { if (!elements.has(id)) { const element = new Element(); element.id = id; } return elements.get(id); };
  const auth = get('auth'); auth.append(get('authForm'));
  const user = { id: 'owner', merchantId: 'merchant-a', email: '<img src=x onerror=alert(1)>', role: 'OWNER', permissions: ['*'], platform: false };
  if(platformOwner)Object.assign(user,{role:'SUPER_ADMIN',merchantId:null,platform:true});
  const responses = {
    '/me': { user, csrfToken: 'session-csrf' }, '/analytics': { transactions: 1, successful: 1, pending: 0, successfulAmountPaise: '450' },
    '/balance': { accounts: [{ code: 'CASH', balancePaise: '450' }] }, '/api-keys': { keys: [] }, '/webhook-deliveries': { deliveries: [] },
    '/transactions': { items: [], total: 0 }, '/settings': { businessName: 'Business', apiIpWhitelist: [], channel: { allowedVpas: [] } },
    '/staff': { users: [] }, '/connections': { connections: [] }, '/receiving-accounts': { accounts: [] }, '/rules': { rules: [] },
    '/onboarding': { profile: {}, status: 'PROFILE_INCOMPLETE' }, '/cases': { items: [] }, '/operations/health': {},
    '/billing/invoices': { items: [] }, '/billing/subscriptions': { items: [] }, '/billing/plans': {items:[]},
    '/merchants': {merchants:[{merchant_id:'merchant-a',profile:{businessName:'Independent A'},status:'EMAIL_PENDING'}],total:1},
    '/payments': {checkoutUrl:'/checkout/created-payment'}
  };
  const context = {
    document: { getElementById: get, createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('#text'), { textContent: text }), addEventListener() {}, body: new Element('body') },
    location: { hash: '' }, window: { location:{assign:value=>requests.push({navigation:value})},addEventListener: (name, listener) => { windowEvents[name] = listener; } }, URLSearchParams, Intl, console, crypto: { randomUUID: () => 'stable-test-key' },
    fetch: async (url, init) => { requests.push({ url, init }); const path = url.replace('/api/platform/v1', '').split('?')[0]; if (path === '/me' && !authenticated) return { ok: false, status: 401, json: async () => ({ error: 'Platform login required' }) }; return { ok: true, status: 200, json: async () => path === '/api-keys' && init.method === 'POST' ? { secret: 'one-time-created-secret' } : responses[path] || {} }; }
  };
  vm.runInNewContext(source, context);
  return { get, requests, context, windowEvents, responses };
}

test('connections collect bank details and save a merchant-owned external service with CSRF',async()=>{
 const app=harness();await flush();
 app.responses['/receiving-accounts']={accounts:[{id:'account-a',upiId:'business@bank',payeeName:'Business',bankDetails:{bankName:'Test Bank',accountNumberMasked:'********9012',ifsc:'TEST0000001'}}]};
 app.context.location.hash='#connections';app.windowEvents.hashchange();await flush();
 const bankForm=app.get('view').find(node=>node.tagName==='form'&&node.elements.namedItem('accountNumber'));
 assert.ok(bankForm.elements.namedItem('bankName'));assert.ok(bankForm.elements.namedItem('ifsc'));
 const form=app.get('view').find(node=>node.tagName==='form'&&node.elements.namedItem('apiKey'));
 const select=form.elements.namedItem('receivingAccountId');
 assert.equal(select.children[0].value,'account-a');
 for(const [name,value] of Object.entries({kind:'DJANGO_N8N',baseUrl:'https://collections.example.test',receivingAccountId:'account-a',apiKey:'test-only-secret'}))form.elements.namedItem(name).value=value;
 await form.events.submit({preventDefault(){}});await flush();
 const request=app.requests.find(r=>r.url.endsWith('/banking-integrations')&&r.init.method==='POST');
 assert.equal(request.init.headers['X-CSRF-Token'],'session-csrf');
 assert.equal(JSON.parse(request.init.body).receivingAccountId,'account-a');
 assert.match(app.get('view').textContent,/India Banking/);
});

test('platform renders role-scoped routes with safe text and numeric-string ledger balances', async () => {
  const app = harness(); await flush();
  assert.match(app.get('view').textContent, /4\.50/);
  assert.equal(app.get('accountName').textContent, '<img src=x onerror=alert(1)>');
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|localStorage|sessionStorage|document\.cookie/);
  for (const route of ['transactions', 'keys', 'settings', 'onboarding', 'staff', 'connections', 'operations', 'billing']) {
    app.context.location.hash = '#' + route; app.windowEvents.hashchange(); await flush();
    assert.doesNotMatch(app.get('view').textContent, /Could not load this view/, route);
  }
  assert.ok(app.requests.every(request => request.init.credentials === 'same-origin'));
});

test('sidebar separates the payment product, merchant account and platform administration',async()=>{
 const merchant=harness();await flush();
 assert.equal(merchant.get('workspaceType').textContent,'Merchant dashboard');
 assert.match(merchant.get('navigation').textContent,/Payments/);
 assert.match(merchant.get('navigation').textContent,/Integration/);
 assert.match(merchant.get('navigation').textContent,/Subscription & billing/);
 assert.doesNotMatch(merchant.get('navigation').textContent,/Merchant directory|Platform overview/);
 const owner=harness(true,true);await flush();
 assert.equal(owner.get('workspaceType').textContent,'Super Admin control center');
 assert.match(owner.get('navigation').textContent,/Platform overview/);
 assert.match(owner.get('navigation').textContent,/Merchant directory/);
 assert.match(owner.get('navigation').textContent,/Plans & subscriptions/);
});

test('platform owner can find merchant creation and open a scoped dashboard without impersonation',async()=>{
  const app=harness(true,true);await flush();
  assert.ok(app.get('pageActions').find(node=>node.textContent==='Add merchant'));
  const nav=app.get('navigation').textContent;assert.match(nav,/Merchant directory/);assert.doesNotMatch(nav,/Your business at a glance|Connections & acceptance/);
  app.context.location.hash='#merchants';app.windowEvents.hashchange();await flush();
  assert.match(app.get('view').textContent,/Independent A/);
  await app.get('view').find(node=>node.tagName==='button'&&node.textContent==='Open dashboard').events.click();
  app.windowEvents.hashchange();await flush();
  assert.match(app.get('merchantContext').textContent,/Independent A/);
  assert.equal(app.get('pageTitle').textContent,'Merchant dashboard');
  assert.ok(app.requests.some(r=>r.url.endsWith('/analytics?merchantId=merchant-a')));
  for(const route of ['transactions','keys','connections','operations','billing']){
    app.context.location.hash='#'+route;app.windowEvents.hashchange();await flush();
    assert.doesNotMatch(app.get('view').textContent,/Could not load this view/,route);
  }
  for(const path of ['/transactions?','/api-keys?','/connections?','/cases?','/billing/invoices?'])assert.ok(app.requests.some(r=>r.url.includes(path)&&r.url.includes('merchantId=merchant-a')),path);
  assert.equal(app.get('accountRole').textContent,'SUPER_ADMIN');
});

test('merchant workspace creates a payment with amount only and a stable automatic order ID',async()=>{
  const app=harness();await flush();
  app.get('pageActions').find(node=>node.tagName==='button'&&node.textContent==='Create payment').events.click();
  const form=app.get('resultBody').find(node=>node.tagName==='form');
  assert.equal(form.elements.namedItem('customerName'),undefined);assert.equal(form.elements.namedItem('phone'),undefined);
  form.elements.namedItem('amount').value='201.00';await form.events.submit({preventDefault(){}});await flush();
  const request=app.requests.find(r=>r.url.endsWith('/payments')&&r.init.method==='POST');
  assert.deepEqual(JSON.parse(request.init.body),{amount:201,orderId:'ORDER-stable-test-key',currency:'INR'});
  assert.equal(request.init.headers['Idempotency-Key'],'ORDER-stable-test-key');assert.equal(request.init.headers['X-CSRF-Token'],'session-csrf');
  assert.ok(app.requests.some(r=>r.navigation==='/checkout/created-payment'));
});

test('key issuance uses session CSRF, reveals a secret only after POST, and discards it when dialog closes', async () => {
  const app = harness(); await flush(); app.context.location.hash = '#keys'; app.windowEvents.hashchange(); await flush();
  assert.doesNotMatch(app.get('view').textContent, /one-time-created-secret/);
  const form = app.get('view').find(node => node.tagName === 'form');
  form.elements.namedItem('label').value = 'Backend';
  await form.events.submit({ preventDefault() {} }); await flush();
  const request = app.requests.find(request => request.url.endsWith('/api-keys') && request.init.method === 'POST');
  assert.equal(request.init.headers['X-CSRF-Token'], 'session-csrf');
  assert.deepEqual(JSON.parse(request.init.body).scopes, ['payments.create','payments.read','reports.read']);
  assert.match(app.get('resultBody').textContent, /one-time-created-secret/);
  app.get('closeResult').events.click();
  assert.equal(app.get('resultBody').textContent, '');
});

test('unauthenticated access shows login and preserves incumbent styles and accessible landmarks', async () => {
  const app = harness(false); await flush();
  assert.equal(app.get('auth').hidden, false); assert.equal(app.get('console').hidden, true);
  assert.match(markup, /href="\/dynamo-console.css"/);
  assert.match(markup, /aria-live="polite"/); assert.match(markup, /aria-expanded="false"/);
  assert.match(source, /\/login\/mfa/); assert.match(source, /\/invitations\/accept/);
});
