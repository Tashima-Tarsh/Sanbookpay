import http from 'node:http';
import { URL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.SUPER_ADMIN_PORT || 9000);
const PAYMENT_API_URL = process.env.PAYMENT_API_URL || 'http://127.0.0.1:6100';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

function htmlPage(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Sanbook Pay Super Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/app.css">
</head>
<body class="bg-gray-50 text-gray-900">
  ${bodyContent}
  <script src="/js/app.js"></script>
  <script>
    window.SA_CONFIG = { apiUrl: '${PAYMENT_API_URL}' };
  </script>
</body>
</html>`;
}

function sidebar(currentPage) {
  const navItems = [
    { key: 'command-center', label: 'Command Center', icon: '🎯' },
    { key: 'merchant-directory', label: 'Merchant Directory', icon: '🏢' },
    { key: 'create-merchant', label: 'Create Merchant', icon: '➕' },
    { key: 'merchant-access', label: 'Merchant Access & Users', icon: '👥' },
    { key: 'receiving-banks', label: 'Receiving Bank Settings', icon: '🏦' },
    { key: 'upi-management', label: 'Receiving UPI Management', icon: '📱' },
    { key: 'smart-routing', label: 'Smart UPI Routing', icon: '🧠' },
    { key: 'automatic-failover', label: 'Automatic Failover', icon: '🔄' },
    { key: 'payment-links', label: 'Global Payment Links', icon: '🔗' },
    { key: 'global-transactions', label: 'Global Transactions', icon: '💳' },
    { key: 'payment-verification', label: 'Payment Verification', icon: '✅' },
    { key: 'api-management', label: 'API Management', icon: '🔑' },
    { key: 'webhook-control', label: 'Callback & Webhook Control', icon: '🪝' },
    { key: 'gaming-wallet', label: 'Gaming Wallet Integration', icon: '🎮' },
    { key: 'settlement-reconciliation', label: 'Settlement & Reconciliation', icon: '📊' },
    { key: 'pricing-billing', label: 'Merchant Pricing & Billing', icon: '💰' },
    { key: 'risk-policies', label: 'Risk & UPI Policies', icon: '🛡️' },
    { key: 'diagnostics', label: 'Payment Diagnostic Center', icon: '🔍' },
    { key: 'operations-incidents', label: 'Operations & Incidents', icon: '🚨' },
    { key: 'platform-analytics', label: 'Platform Analytics', icon: '📈' },
    { key: 'staff-permissions', label: 'Staff & Permissions', icon: '👤' },
    { key: 'security-audit', label: 'Security & Audit Logs', icon: '🔐' },
    { key: 'system-config', label: 'System Configuration', icon: '⚙️' },
    { key: 'documentation', label: 'Documentation & Support', icon: '📚' }
  ];

  const itemsHtml = navItems.map(n => {
    const active = currentPage === n.key ? 'active' : '';
    return `<a href="/super-admin/${n.key}" class="sidebar-item ${active} flex items-center gap-3 px-4 py-3 text-gray-700 hover:text-gray-900 rounded-lg transition-colors text-sm font-medium no-underline">${n.icon} <span>${n.label}</span></a>`;
  }).join('');

  return `
  <aside class="fixed left-0 top-0 h-full w-64 bg-white border-r border-gray-200 z-50">
    <div class="p-6 border-b border-gray-200">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center text-white font-bold">S</div>
        <div>
          <div class="font-bold text-gray-900 text-sm">Sanbook Pay</div>
          <div class="text-xs text-gray-500">Super Admin Control Center</div>
        </div>
      </div>
    </div>
    <nav class="p-3 space-y-1">
      ${itemsHtml}
    </nav>
    <div class="absolute bottom-0 left-0 w-full p-4 border-t border-gray-200">
      <div class="text-xs text-gray-500 text-center">Platform Owner Portal</div>
    </div>
  </aside>`;
}

function topbar() {
  return `
  <header class="fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 z-40 flex items-center justify-between px-6">
    <div class="flex items-center gap-4">
      <button id="menuToggle" class="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg">☰</button>
      <h1 class="font-semibold text-gray-900">Sanbook Pay Super Admin</h1>
    </div>
    <div class="flex items-center gap-4">
      <div class="hidden md:flex items-center gap-3 px-3 py-1.5 bg-gray-50 rounded-full text-xs font-medium">
        <span class="w-2 h-2 rounded-full bg-green-500"></span>
        <span>Platform Owner Session</span>
      </div>
      <div class="flex items-center gap-3 pl-4 border-l border-gray-200">
        <div class="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">PO</div>
      </div>
    </div>
  </header>`;
}

function loginPage() {
  return htmlPage('Login', `
    <div class="min-h-screen flex items-center justify-center bg-gray-100">
      <div class="w-full max-w-md">
        <div class="bg-white p-8 rounded-xl shadow-lg border border-gray-200">
          <div class="flex items-center gap-2 mb-6">
            <div class="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center text-white font-bold">S</div>
            <div class="font-bold text-gray-900 text-lg">Sanbook Pay</div>
          </div>
          <h2 class="text-2xl font-bold text-gray-900 mb-2">Super Admin Sign In</h2>
          <p class="text-gray-600 mb-6">Platform Owner Control Center</p>
          <form id="loginForm" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <input type="email" name="email" required class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all" placeholder="superadmin@sanbookpay.com">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" name="password" required class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all" placeholder="••••••••">
            </div>
            <button type="submit" class="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors shadow-md">Sign In</button>
          </form>
          <p class="mt-6 text-xs text-gray-500 text-center">Default: superadmin@sanbookpay.com / SanbookPayAdmin_ChangeMe!</p>
        </div>
      </div>
    </div>
  `);
}

function commandCenterPage() {
  return htmlPage('Command Center', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Command Center</h1>
            <p class="text-gray-600">Platform overview and merchant health summary</p>
          </div>
          <div class="flex gap-3">
            <button onclick="app.navigate('create-merchant')" class="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors shadow-md">+ Create Merchant</button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-500 font-medium">Total Merchants</p>
                <h3 class="text-2xl font-bold text-gray-900 mt-1" id="statMerchants">--</h3>
              </div>
              <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600">🏢</div>
            </div>
          </div>
          <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-500 font-medium">Active Merchants</p>
                <h3 class="text-2xl font-bold text-gray-900 mt-1" id="statActive">--</h3>
              </div>
              <div class="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center text-green-600">✅</div>
            </div>
          </div>
          <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-500 font-medium">Pending Payments</p>
                <h3 class="text-2xl font-bold text-gray-900 mt-1" id="statPending">--</h3>
              </div>
              <div class="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center text-yellow-600">⏳</div>
            </div>
          </div>
          <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-gray-500 font-medium">Failed Payments</p>
                <h3 class="text-2xl font-bold text-gray-900 mt-1" id="statFailed">--</h3>
              </div>
              <div class="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center text-red-600">❌</div>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-xl shadow-sm border border-gray-200">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">Recent Activity</h2>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left">
              <thead>
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4">Time</th>
                  <th class="p-4">Event</th>
                  <th class="p-4">Merchant</th>
                  <th class="p-4">Status</th>
                </tr>
              </thead>
              <tbody id="activityTable" class="text-sm divide-y divide-gray-100">
                <tr><td colspan="4" class="p-8 text-center text-gray-500">Loading...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function merchantDirectoryPage() {
  return htmlPage('Merchant Directory', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Merchant Directory</h1>
            <p class="text-gray-600">Manage all merchant accounts on the platform</p>
          </div>
          <button onclick="app.navigate('create-merchant')" class="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors shadow-md flex items-center gap-2">➕ Create Merchant</button>
        </div>

        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200 flex flex-col md:flex-row justify-between items-center gap-4">
            <div class="relative">
              <input type="text" id="merchantSearch" placeholder="Search merchants..." class="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none w-64">
              <div class="absolute left-3 top-2 text-gray-400">🔍</div>
            </div>
            <select id="statusFilter" class="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none">
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Merchant ID</th>
                  <th class="p-4 text-left">Business Name</th>
                  <th class="p-4 text-left">Owner Email</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">Created</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="merchantTableBody" class="divide-y divide-gray-100">
                <tr><td colspan="6" class="p-8 text-center text-gray-500">Loading merchants...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function createMerchantPage() {
  return htmlPage('Create Merchant', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6 max-w-3xl">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Create Merchant</h1>
            <p class="text-gray-600">Provision a new independent merchant account</p>
          </div>
          <button onclick="app.navigate('merchant-directory')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back to Directory</button>
        </div>

        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">Merchant Creation Wizard</h2>
            <p class="text-sm text-gray-500 mt-1">Step-by-step merchant provisioning</p>
          </div>
          <form id="createMerchantForm" class="p-6 space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Business / Merchant Name</label>
                <input type="text" name="businessName" required class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Business Display Name</label>
                <input type="text" name="displayName" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Business Category</label>
                <select name="category" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none">
                  <option>Gaming</option>
                  <option>E-Commerce</option>
                  <option>SaaS</option>
                  <option>Services</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Business Website / Domain</label>
                <input type="url" name="website" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none" placeholder="https://example.com">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                <input type="email" name="contactEmail" required class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Contact Mobile</label>
                <input type="tel" name="contactPhone" required class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none">
              </div>
              <div class="md:col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-1">Business Address</label>
                <textarea name="address" rows="2" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"></textarea>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Merchant Status</label>
                <select name="status" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none">
                  <option value="ACTIVE">Active</option>
                  <option value="PENDING">Pending Activation</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              </div>
              <div class="md:col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-1">Internal Notes</label>
                <textarea name="internalNotes" rows="2" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"></textarea>
              </div>
            </div>

            <div class="bg-blue-50 p-4 rounded-lg border border-blue-200 mb-6">
              <h3 class="text-sm font-bold text-blue-900 mb-2">📋 What happens next:</h3>
              <ul class="text-sm text-blue-800 space-y-1 list-disc list-inside">
                <li>A unique Merchant ID (SBM-XXXXXXXX) will be auto-generated</li>
                <li>A merchant owner account will be created with a secure activation invitation</li>
                <li>The merchant will receive onboarding instructions for dashboard access</li>
                <li>Platform Owner can then assign receiving banks, UPI routes, and API credentials</li>
              </ul>
            </div>

            <div class="flex gap-3 pt-4 border-t border-gray-200">
              <button type="button" onclick="app.navigate('merchant-directory')" class="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors">Cancel</button>
              <button type="submit" class="px-8 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors shadow-md">Create Merchant Account</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `);
}

const routes = {
  'login': loginPage,
  'command-center': commandCenterPage,
  'merchant-directory': merchantDirectoryPage,
  'create-merchant': createMerchantPage
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  try {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    // Serve static assets
    if (pathname.startsWith('/js/') || pathname.startsWith('/css/')) {
      const filePath = path.join(publicDir, pathname);
      try {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath);
        const contentType = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' });
        res.end(content);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
      return;
    }

    // API proxy to payment-api
    if (pathname.startsWith('/api/')) {
      let body = null;
      if (method !== 'GET' && method !== 'HEAD') {
        body = await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', chunk => data += chunk);
          req.on('end', () => resolve(data || undefined));
          req.on('error', reject);
        });
      }

      try {
        const apiRes = await fetch(`${PAYMENT_API_URL}${pathname}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': req.headers['authorization'] || ''
          },
          body: body ? body : undefined
        });
        const data = await apiRes.text();
        res.writeHead(apiRes.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Backend unavailable' }));
      }
      return;
    }

    // Route pages
    let pageKey = 'login';
    if (pathname === '/' || pathname === '/super-admin') {
      pageKey = 'login';
    } else if (pathname.startsWith('/super-admin/')) {
      pageKey = pathname.replace('/super-admin/', '').split('?')[0];
    }

    // Check auth for non-login pages
    const token = req.headers['authorization'] || '';
    const hasToken = token.includes('Bearer ');
    if (pageKey !== 'login' && !hasToken) {
      res.writeHead(302, { 'Location': '/super-admin/login' });
      res.end();
      return;
    }

    const pageFn = routes[pageKey] || loginPage;
    const html = pageFn();

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);

  } catch (err) {
    console.error('Server error:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<h1>Server Error</h1><p>' + err.message + '</p>');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Super Admin] Control Center listening on http://127.0.0.1:${PORT}`);
  console.log(`[Super Admin] Proxying API to ${PAYMENT_API_URL}`);
});
