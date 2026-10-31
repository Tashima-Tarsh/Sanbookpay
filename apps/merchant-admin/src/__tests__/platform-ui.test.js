import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../public/platform.js', import.meta.url), 'utf8');
const markup = fs.readFileSync(new URL('../../public/platform.html', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

function harness(authenticated = true) {
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
  const responses = {
    '/me': { user, csrfToken: 'session-csrf' }, '/analytics': { transactions: 1, successful: 1, pending: 0, successfulAmountPaise: '450' },
    '/balance': { accounts: [{ code: 'CASH', balancePaise: '450' }] }, '/api-keys': { keys: [] }, '/webhook-deliveries': { deliveries: [] },
    '/transactions': { items: [], total: 0 }, '/settings': { businessName: 'Business', apiIpWhitelist: [], channel: { allowedVpas: [] } },
    '/staff': { users: [] }, '/connections': { connections: [] }, '/receiving-accounts': { accounts: [] }, '/rules': { rules: [] },
    '/onboarding': { profile: {}, status: 'PROFILE_INCOMPLETE' }, '/cases': { items: [] }, '/operations/health': {},
    '/billing/invoices': { items: [] }, '/billing/subscriptions': { items: [] }
  };
  const context = {
    document: { getElementById: get, createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('#text'), { textContent: text }), addEventListener() {}, body: new Element('body') },
    location: { hash: '' }, window: { addEventListener: (name, listener) => { windowEvents[name] = listener; } }, URLSearchParams, Intl, console, crypto: { randomUUID: () => 'stable-test-key' },
    fetch: async (url, init) => { requests.push({ url, init }); const path = url.replace('/api/platform/v1', '').split('?')[0]; if (path === '/me' && !authenticated) return { ok: false, status: 401, json: async () => ({ error: 'Platform login required' }) }; return { ok: true, status: 200, json: async () => path === '/api-keys' && init.method === 'POST' ? { secret: 'one-time-created-secret' } : responses[path] || {} }; }
  };
  vm.runInNewContext(source, context);
  return { get, requests, context, windowEvents };
}

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
