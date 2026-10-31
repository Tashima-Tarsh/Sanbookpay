import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase, MerchantRepository, SupportTicketRepository } from '@youpi/db';
import { getAdminToken, safeEqual, verifyPassword, getInternalServiceToken } from '@youpi/common';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Security headers applied to every response served by the merchant admin. */
const BASE_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'; object-src 'none'"
});

/** True when the caller presented the admin bearer token in constant time. */
function hasAdminToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers?.['authorization'] || '');
  if (!match) return false;
  return safeEqual(match[1].trim(), getAdminToken());
}

/**
 * Strips headers a browser must not be able to spoof when relaying to an internal service.
 */
function sanitizedForwardHeaders(req, targetHost) {
  const headers = { ...req.headers, host: targetHost };
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'x-internal-render' || lower === 'x-internal-token') {
      delete headers[name];
    }
  }
  headers['x-gateway-token']=getInternalServiceToken();
  return headers;
}

// In production, reliably ensure environment variables from .env are loaded if not already provided
if (!process.env.BASE_PAYMENT_API_URL && typeof process.loadEnvFile === 'function') {
  try {
    const rootEnv = path.resolve(__dirname, '../../../.env');
    if (fs.existsSync(rootEnv)) {
      process.loadEnvFile(rootEnv);
    }
  } catch {}
}

export class AdminServer {
  /**
   * @param {{
   *   db?: import('@youpi/db').Database,
   *   apiBaseUrl?: string,
   *   privateCredentialsPath?: string
   * }} options
   */
  constructor(options = {}) {
    this.db = options.db || getDatabase();
    this.apiBaseUrl = options.apiBaseUrl || process.env.BASE_PAYMENT_API_URL || 'http://localhost:6100';
    this.merchantRepo = new MerchantRepository(this.db);
    this.ticketRepo = new SupportTicketRepository(this.db);
    this.sessions = new Map();
    this.loginAttempts = new Map();
    this.privateCredentialsPath = options.privateCredentialsPath || path.resolve(__dirname, '../../../data/.secrets/Dynamo-Pay-Private-Credentials.pdf');
    this.htmlTemplatePath = path.join(__dirname, 'views', 'admin-premium.html');
    this.template = fs.readFileSync(this.htmlTemplatePath, 'utf8');
  }

  renderHtml() {
    try {
      this.template = fs.readFileSync(this.htmlTemplatePath, 'utf8');
    } catch {}

    let html = this.template;
    // Always use empty string '' so client fetch calls hit the merchant admin's own /api proxy!
    // This completely eliminates CORS errors, tunnel downtime 530s, and cross-origin failures.
    const clientApiBase = '';
    html = html.replaceAll('{{API_BASE_URL}}', clientApiBase);
    let tunnelUrl='';try{const candidate=fs.readFileSync(path.resolve(__dirname,'../../../data/.secrets/quick_tunnel_url'),'utf8').trim();if(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(candidate))tunnelUrl=candidate;}catch{}
    if(process.env.DYNAMO_PUBLIC_URL){try{const configured=new URL(process.env.DYNAMO_PUBLIC_URL);if(configured.protocol==='https:')tunnelUrl=configured.origin;}catch{}}
    html=html.replaceAll('{{PUBLIC_GATEWAY_URL}}',tunnelUrl);
    return html;
  }

  createServer() {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const reply = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store', ...BASE_SECURITY_HEADERS, ...headers }); res.end(JSON.stringify(body)); };
      const cookie = /(?:^|;\s*)dynamo_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
      const session = cookie && this.sessions.get(cookie);
      const authenticated = hasAdminToken(req) || Boolean(session && session > Date.now());
      if (cookie && session && session <= Date.now()) this.sessions.delete(cookie);
      const origin = req.headers.origin;
      if (req.method !== 'GET' && req.method !== 'OPTIONS' && origin) {
        let originHost; try { originHost = new URL(origin).host; } catch { return reply(403,{error:'Invalid request origin.'}); }
        if(originHost !== (req.headers['x-forwarded-host'] || req.headers.host)) return reply(403, { error:'Request origin does not match the console.' });
      }
      if (pathname === '/downloads') {
        if (req.method !== 'GET') return reply(405, {error:'Method not allowed'});
        const page=fs.readFileSync(path.join(__dirname,'../public/dynamo-downloads.html'),'utf8').replaceAll('{{AUTHENTICATED}}',authenticated?'true':'false');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',...BASE_SECURITY_HEADERS});res.end(page);return;
      }
      if (pathname === '/downloads/manual.pdf' || pathname === '/downloads/developer-guide.pdf' || pathname === '/downloads/private-credentials.pdf') {
        if (req.method !== 'GET') return reply(405, {error:'Method not allowed'});
        const privateDocument=pathname === '/downloads/private-credentials.pdf';
        if(privateDocument && !authenticated){res.writeHead(302,{'Location':'/downloads','Cache-Control':'no-store',...BASE_SECURITY_HEADERS});res.end();return;}
        const developerGuide=pathname === '/downloads/developer-guide.pdf';
        const file=privateDocument?this.privateCredentialsPath:path.join(__dirname,'../public',developerGuide?'dynamo-developer-quick-guide.pdf':'dynamo-pay-manual.pdf');
        try {
          const data=privateDocument&&this.db.dialect==='postgres'?this.db.queryOne("SELECT contents FROM hosted_files WHERE path='.secrets/Dynamo-Pay-Private-Credentials.pdf'")?.contents:await fs.promises.readFile(file);
          if(!data)return reply(404,{error:'This document is unavailable. Contact your account administrator.'});
          res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${privateDocument?'Dynamo-Pay-Private-Credentials.pdf':developerGuide?'Dynamo-Pay-Developer-Quick-Guide.pdf':'Dynamo-Pay-User-Manual.pdf'}"`,'Cache-Control':'no-store','Pragma':'no-cache',...BASE_SECURITY_HEADERS});res.end(data);
        }catch(error){reply(error.code==='ENOENT'?404:503,{error:'This document is unavailable. Contact your account administrator.'});}
        return;
      }
      if (pathname === '/api/console/session') {
        if (req.method === 'GET') return reply(authenticated ? 200 : 401, { authenticated });
        if (req.method === 'DELETE') { if(cookie) this.sessions.delete(cookie); return reply(200, { ok:true }, { 'Set-Cookie':'dynamo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
        if(req.method !== 'POST') return reply(405, { error:'Method not allowed' });
        const ip = req.socket.remoteAddress;
        const attempts = this.loginAttempts.get(ip) || { count:0, until:Date.now()+60000 };
        if(attempts.until < Date.now()) { attempts.count=0; attempts.until=Date.now()+60000; }
        if(++attempts.count>10) return reply(429, { error:'Too many attempts. Try again in a minute.' });
        this.loginAttempts.set(ip, attempts);
        let raw=''; for await(const chunk of req) { raw+=chunk; if(raw.length>4096) return reply(413,{error:'Request too large'}); }
        let body; try { body=JSON.parse(raw); } catch { return reply(400,{error:'Invalid request'}); }
        let login;
        try { login=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../data/.secrets/console-login.json'),'utf8')); } catch {}
        const expectedEmail=process.env.ADMIN_LOGIN_EMAIL || login?.email;
        const expectedHash=process.env.ADMIN_LOGIN_PASSWORD_HASH || login?.passwordHash;
        const valid=expectedEmail && expectedHash && safeEqual(String(body.email || '').toLowerCase(),expectedEmail.toLowerCase()) && verifyPassword(String(body.password || ''),expectedHash);
        if(!valid && !(body.token && safeEqual(String(body.token),getAdminToken()))) return reply(401,{error:'Incorrect email or password.'});
        for(const [key,expires] of this.sessions) if(expires<Date.now()) this.sessions.delete(key);
        const id=crypto.randomBytes(32).toString('hex'); this.sessions.set(id,Date.now()+8*3600000);
        const secure=req.headers['x-forwarded-proto']==='https' ? '; Secure' : '';
        return reply(200,{authenticated:true},{ 'Set-Cookie':`dynamo_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}` });
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        res.end();
        return;
      }

      // Health
      if(pathname==='/oauth/callback' && req.method==='GET'){
        const upstream=http.request({hostname:'127.0.0.1',port:Number(process.env.GMAIL_OBSERVER_PORT||6003),path:req.url,method:'GET',headers:sanitizedForwardHeaders(req,'localhost:6003')},response=>{res.writeHead(response.statusCode,{...response.headers,'cache-control':'no-store'});response.pipe(res);});
        upstream.on('error',()=>{if(!res.headersSent)reply(502,{error:'Gmail observer is unavailable. Please try again.'});});upstream.end();return;
      }
      if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'UP', service: 'merchant-admin' }));
        return;
      }

      // Admin Tickets API: GET /api/admin/tickets
      if (pathname === '/api/admin/tickets') {
        if (!hasAdminToken(req)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }));
          return;
        }
        const merchants = this.merchantRepo.findAll();
        const mId = merchants[0]?.id || '00000000-0000-0000-0000-000000000001';
        const tickets = this.ticketRepo.findTicketsByMerchant(mId);

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          ...BASE_SECURITY_HEADERS
        });
        res.end(JSON.stringify(tickets));
        return;
      }

      // Merged Control Center Supervisor Proxy: /api/services/* and /api/logs/stream -> Control Center on port 8090
      // Relaying this unauthenticated would republish process control and every service's
      // stdout/stderr on the internet-facing admin host, so the admin token is required.
      if (pathname.startsWith('/api/services') || pathname === '/api/logs/stream') {
        if (!hasAdminToken(req)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }));
          return;
        }
        const ccPort = Number(process.env.CONTROL_CENTER_PORT || 8090);
        const proxyReq = http.request({
          hostname: '127.0.0.1',
          port: ccPort,
          path: req.url,
          method: req.method,
          headers: sanitizedForwardHeaders(req, `localhost:${ccPort}`)
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Control center supervisor unavailable', details: err.message }));
          }
        });

        req.on('data', chunk => proxyReq.write(chunk));
        req.on('end', () => proxyReq.end());
        return;
      }

      // Transparent API Proxy: /api/* -> Payment Core REST API
      if(pathname.startsWith('/v1.0/')){
        const upstream=http.request({hostname:'127.0.0.1',port:Number(process.env.PAYMENT_API_PORT||6100),path:req.url,method:req.method,headers:sanitizedForwardHeaders(req,'localhost:6100')},response=>{res.writeHead(response.statusCode,{...response.headers,'cache-control':'no-store'});response.pipe(res);});
        upstream.on('error',()=>{if(!res.headersSent)reply(502,{error:'Payment API unavailable.'});});req.pipe(upstream);return;
      }
      if (pathname.startsWith('/api/')) {
        if(!authenticated) return reply(401,{error:'Sign in to the merchant console.',code:'AUTH_REQUIRED'});
        const targetPort = Number(process.env.PAYMENT_API_PORT || 6100);
        const defaultMerchant = this.merchantRepo.getDefault ? this.merchantRepo.getDefault() : (this.merchantRepo.findById('00000000-0000-0000-0000-000000000001') || this.merchantRepo.findAll()[0]);
        const defaultMerchantId = defaultMerchant?.id || '00000000-0000-0000-0000-000000000001';
        const proxyReq = http.request({
          hostname: '127.0.0.1',
          port: targetPort,
          path: req.url.replace(/^\/api\/console\//, '/api/'),
          method: req.method,
          headers: {
            ...sanitizedForwardHeaders(req, `localhost:${targetPort}`),
            'authorization': `Bearer ${getAdminToken()}`,
            'x-admin-token': getAdminToken(),
            'x-merchant-id': req.headers['x-merchant-id'] || defaultMerchantId,
            host: `localhost:${targetPort}`,
            'x-forwarded-host': req.headers.host || '',
            'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'http'
          }
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, { ...proxyRes.headers, 'cache-control':'no-store' });
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Gateway API unavailable', details: err.message }));
          }
        });

        req.pipe(proxyReq);
        return;
      }

      // Download Android Companion APK
      if (pathname === '/youpi-sms-gateway.apk' || pathname === '/api/v1/admin/sms-gateway/download-apk') {
        const apkCandidates = [
          path.resolve(__dirname, '../public/youpi-sms-gateway.apk'),
          path.resolve(__dirname, '../../payment-api/public/youpi-sms-gateway.apk'),
          path.resolve(__dirname, '../../android-observer-app/youpi-sms-gateway.apk')
        ];
        let apkPath = null;
        for (const p of apkCandidates) {
          if (fs.existsSync(p)) {
            apkPath = p;
            break;
          }
        }
        if (apkPath) {
          const stat = fs.statSync(apkPath);
          res.writeHead(200, {
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Disposition': 'attachment; filename="youpi-sms-gateway.apk"',
            'Content-Length': stat.size,
            'Access-Control-Allow-Origin': '*'
          });
          const stream = fs.createReadStream(apkPath);
          stream.pipe(res);
          return;
        }
      }

      // Static assets from public/
      const customerDocs={ '/developers':'dynamo-api.html','/developers/openapi.json':'dynamo-openapi.json','/developers/guide.md':'dynamo-api-guide.md' };
      if(req.method==='GET'&&customerDocs[pathname]){
        const file=path.join(__dirname,'../public',customerDocs[pathname]);
        res.writeHead(200,{'Content-Type':pathname.endsWith('.json')?'application/json':pathname.endsWith('.md')?'text/markdown; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache',...BASE_SECURITY_HEADERS});
        fs.createReadStream(file).pipe(res);return;
      }
      const cleanPath = pathname.replace(/^\/+/, '');
      const publicFilePath = path.join(__dirname, '../public', cleanPath);
      if (cleanPath && fs.existsSync(publicFilePath) && fs.statSync(publicFilePath).isFile()) {
        const ext = path.extname(publicFilePath).toLowerCase();
        const mimeTypes = {
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.json': 'application/json',
          '.pdf': 'application/pdf',
          '.apk': 'application/vnd.android.package-archive'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType, ...BASE_SECURITY_HEADERS });
        fs.createReadStream(publicFilePath).pipe(res);
        return;
      }

      // Dashboard View: GET / or GET /admin
      if (pathname === '/' || pathname === '/admin') {
        const html = this.renderHtml();
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
          ...BASE_SECURITY_HEADERS
        });
        res.end(html);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Admin Route Not Found');
    });
  }
}
