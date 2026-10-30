/**
 * YOUPI PG / Sanbook Pay — Quick Cloudflare Tunnel Runner
 * Starts all gateway services and bridges them via a Unified Reverse Proxy
 * to a live public HTTPS endpoint on trycloudflare.com.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runMigrations } from '../packages/db/src/migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from .env
try {
  const rootEnv = path.resolve(rootDir, '.env');
  if (fs.existsSync(rootEnv) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(rootEnv);
  }
} catch {}

process.env.YOUPI_MODE = 'localhost';
process.env.NODE_ENV = 'production';

console.log('====================================================');
console.log('🚀 Starting Sanbook Pay with Cloudflare Quick Tunnel');
console.log('====================================================');

// 1. Run migrations and verify DB
console.log('[1/4] Checking database schema & merchant setup...');
const migrationResult = runMigrations();
console.log(`   ✓ Database ready. Default merchant: ${migrationResult.defaultMerchant.businessName}`);

// 2. Start core services
console.log('[2/4] Starting core backend services...');

const services = [
  { name: 'Payment Core API',   entry: 'apps/payment-api/src/index.js',      port: 6100 },
  { name: 'Checkout Portal',    entry: 'apps/checkout-portal/src/index.js',   port: 7000 },
  { name: 'Merchant Admin',     entry: 'apps/merchant-admin/src/index.js',    port: 6001 },
  { name: 'Gmail Observer',     entry: 'apps/gmail-observer/src/index.js', port: 6003 }
];

const processes = [];
for (const svc of services) {
  const child = spawn(process.execPath, [svc.entry], {
    cwd: rootDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      YOUPI_BIND_HOST: '127.0.0.1',
      DYNAMO_UNIFIED_GATEWAY: 'true',
      NODE_ENV: 'production'
    }
  });

  processes.push({ name: svc.name, port: svc.port, child });

  child.stdout.on('data', (d) => {
    const lines = d.toString().trim().split('\n');
    for (const l of lines) {
      if (l.trim()) console.log(`   [${svc.name}] ${l.trim()}`);
    }
  });

  child.stderr.on('data', (d) => {
    const lines = d.toString().trim().split('\n');
    for (const l of lines) {
      if (l.trim()) console.error(`   [${svc.name} ERR] ${l.trim()}`);
    }
  });
}

// Wait for services to bind
await new Promise(r => setTimeout(r, 2000));

// 3. Unified Ingress Gateway on Port 8080
console.log('[3/4] Launching Unified Ingress Gateway on port 8080...');

const proxyRequest = (targetPort, req, res) => {
  const options = {
    hostname: '127.0.0.1',
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${targetPort}`, 'x-forwarded-host': req.headers.host || '', 'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'http' }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Service Unavailable', targetPort, message: err.message }));
    }
  });

  req.pipe(proxyReq, { end: true });
};

const gatewayServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8080');
  const p = url.pathname;

  // Route to Demo Store
  if (p === '/store' || p.startsWith('/store/') || p.startsWith('/wallet') || p.startsWith('/order-') || p === '/api/checkout' || p === '/api/verify-payment' || p === '/api/wallet-balance') {
    res.writeHead(404,{'Content-Type':'text/plain'});res.end('Demo store is disabled.');return;
  }

  // Route to Checkout Portal
  if (p.startsWith('/checkout') || p.startsWith('/pay/') || p.startsWith('/qr/') || p.startsWith('/youpi.js') || p.startsWith('/sdk/') || p.startsWith('/icons/')) {
    return proxyRequest(7000, req, res);
  }

  // Route to Payment Core REST API
  if (p.startsWith('/api/v1/') || p.startsWith('/v1/dynamo/') || p === '/health') {
    return proxyRequest(6100, req, res);
  }

  // Default: Route to Merchant Admin Hub (all admin views and /api/admin/*)
  return proxyRequest(6001, req, res);
});

await new Promise(resolve => gatewayServer.listen(8080, '127.0.0.1', resolve));
console.log('   ✓ Unified Ingress Gateway listening at http://127.0.0.1:8080\n');

// 4. Start Cloudflare Quick Tunnel
console.log('[4/4] Starting Cloudflare Quick Tunnel on trycloudflare.com...');

const cloudflaredPath = path.resolve(rootDir, 'cloudflared.exe');
const cfArgs = [
  'tunnel',
  '--no-autoupdate',
  '--no-prechecks',
  '--protocol', 'http2',
  '--url', 'http://127.0.0.1:8080'
];

const cf = spawn(cloudflaredPath, cfArgs, {
  cwd: rootDir,
  stdio: 'pipe'
});

let publicTunnelUrl = null;

cf.stderr.on('data', (d) => {
  const text = d.toString();
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (match && !publicTunnelUrl) {
    publicTunnelUrl = match[0];
    fs.mkdirSync(path.join(rootDir,'data/.secrets'),{recursive:true});
    fs.writeFileSync(path.join(rootDir,'data/.secrets/quick_tunnel_url'),publicTunnelUrl);
    console.log('\n====================================================');
    console.log('🎉 LIVE CLOUDFLARE PUBLIC URL ESTABLISHED!');
    console.log('====================================================');
    console.log(`🌐 Public Base URL:   ${publicTunnelUrl}`);
    console.log(`🛠️ Merchant Admin:    ${publicTunnelUrl}/admin`);
    console.log(`💳 Live Health Probe: ${publicTunnelUrl}/health`);
    console.log('====================================================\n');
  }
});

cf.on('exit', (code, signal) => {
  console.log(`[Cloudflare Tunnel] exited (code=${code}, signal=${signal})`);
});

// Graceful shutdown handling
const cleanup = () => {
  console.log('\nStopping all services...');
  try { cf.kill('SIGTERM'); } catch {}
  gatewayServer.close();
  for (const p of processes) {
    try { p.child.kill('SIGTERM'); } catch {}
  }
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
