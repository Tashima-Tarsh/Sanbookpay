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

function merchantAccessPage() {
  const mid = new URLSearchParams(window.location.search).get('mid') || '';
  return htmlPage('Merchant Access & Users', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Merchant Access & Users</h1>
            <p class="text-gray-600">Manage merchant staff accounts and permissions</p>
          </div>
          <button onclick="app.navigate('merchant-directory')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back to Directory</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div class="mb-6">
            <h2 class="text-lg font-bold text-gray-900">Merchant Staff Users</h2>
            <p class="text-gray-600">View and manage all users with access to this merchant dashboard</p>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Name</th>
                  <th class="p-4 text-left">Email</th>
                  <th class="p-4 text-left">Role</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">MFA</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="merchantUsersTable" class="divide-y divide-gray-100">
                <tr><td colspan="6" class="p-8 text-center text-gray-500">Loading users...</td></tr>
              </tbody>
            </table>
          </div>
          <div class="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 class="text-sm font-bold text-gray-900 mb-3">Invite New Staff Member</h3>
            <form id="inviteUserForm" class="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div><label class="block text-sm font-medium text-gray-700 mb-1">Full Name</label><input type="text" name="fullName" required class="w-full px-4 py-2 border border-gray-300 rounded-lg"></div>
              <div><label class="block text-sm font-medium text-gray-700 mb-1">Email</label><input type="email" name="email" required class="w-full px-4 py-2 border border-gray-300 rounded-lg"></div>
              <div><label class="block text-sm font-medium text-gray-700 mb-1">Role</label><select name="role" class="w-full px-4 py-2 border border-gray-300 rounded-lg"><option value="ADMIN">Admin</option><option value="DEVELOPER">Developer</option><option value="FINANCE">Finance</option><option value="SUPPORT">Operations</option><option value="VIEWER">Viewer</option></select></div>
              <div class="flex items-end"><button type="submit" class="w-full bg-green-600 text-white py-2 rounded-lg font-medium hover:bg-green-700">Invite User</button></div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `);
}

function receivingBanksPage() {
  return htmlPage('Receiving Bank Settings', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Receiving Bank Settings</h1>
            <p class="text-gray-600">Manage approved receiving bank and UPI connections across all merchants</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 class="text-lg font-bold text-gray-900">Bank Connections</h2>
              <p class="text-gray-600 text-sm">Provider connections assigned to merchants</p>
            </div>
            <button onclick="app.showToast('Use the payment-api receiving-banks endpoint to manage connections')" class="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">Add Connection</button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Merchant</th>
                  <th class="p-4 text-left">Provider</th>
                  <th class="p-4 text-left">Environment</th>
                  <th class="p-4 text-left">VPA</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">Last Tested</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="bankConnectionsTable" class="divide-y divide-gray-100">
                <tr><td colspan="7" class="p-8 text-center text-gray-500">Loading connections...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function upiManagementPage() {
  return htmlPage('Receiving UPI Management', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Receiving UPI Management</h1>
            <p class="text-gray-600">Registry of approved receiving VPAs with routing configuration</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">Approved Receiving VPAs</h2>
            <p class="text-gray-600 text-sm">Central registry of receiving UPI addresses across all merchants</p>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">VPA ID</th>
                  <th class="p-4 text-left">UPI Address</th>
                  <th class="p-4 text-left">Merchant</th>
                  <th class="p-4 text-left">Priority</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">Health</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="vpaRegistryTable" class="divide-y divide-gray-100">
                <tr><td colspan="7" class="p-8 text-center text-gray-500">Loading VPAs...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function smartRoutingPage() {
  return htmlPage('Smart UPI Routing', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Smart UPI Routing</h1>
            <p class="text-gray-600">Configure routing strategies, priorities, and weights for each merchant</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">Routing Rules</h2>
            <p class="text-gray-600 text-sm">Define how payments are routed to eligible receiving accounts</p>
          </div>
          <div class="overflow-x-auto p-6">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Merchant</th>
                  <th class="p-4 text-left">Route ID</th>
                  <th class="p-4 text-left">Strategy</th>
                  <th class="p-4 text-left">Priority</th>
                  <th class="p-4 text-left">Weight</th>
                  <th class="p-4 text-left">Amount Range</th>
                  <th class="p-4 text-left">Enabled</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="routingRulesTable" class="divide-y divide-gray-100">
                <tr><td colspan="8" class="p-8 text-center text-gray-500">Loading routing rules...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function automaticFailoverPage() {
  return htmlPage('Automatic Failover', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Automatic Failover</h1>
            <p class="text-gray-600">Monitor route failover events and manage backup route activation</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Primary Failures</p>
              <h3 class="text-2xl font-bold text-gray-900" id="failoverPrimaryCount">--</h3>
            </div>
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Successful Failovers</p>
              <h3 class="text-2xl font-bold text-gray-900" id="failoverSuccessCount">--</h3>
            </div>
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">All Routes Down</p>
              <h3 class="text-2xl font-bold text-gray-900" id="failoverAllDownCount">--</h3>
            </div>
          </div>
          <div class="p-6 overflow-x-auto">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Order ID</th>
                  <th class="p-4 text-left">From Route</th>
                  <th class="p-4 text-left">To Route</th>
                  <th class="p-4 text-left">Reason</th>
                  <th class="p-4 text-left">Trigger</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">Created</th>
                </tr>
              </thead>
              <tbody id="failoverEventsTable" class="divide-y divide-gray-100">
                <tr><td colspan="7" class="p-8 text-center text-gray-500">Loading failover events...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function paymentLinksPage() {
  return htmlPage('Global Payment Links', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Global Payment Links</h1>
            <p class="text-gray-600">View all payment links created across every merchant</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">Payment Links</h2>
            <p class="text-gray-600 text-sm">All dynamically created payment links across the platform</p>
          </div>
          <div class="overflow-x-auto p-6">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Order ID</th>
                  <th class="p-4 text-left">Merchant</th>
                  <th class="p-4 text-left">Amount</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">Route</th>
                  <th class="p-4 text-left">Created</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="paymentLinksTable" class="divide-y divide-gray-100">
                <tr><td colspan="7" class="p-8 text-center text-gray-500">Loading payment links...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function globalTransactionsPage() {
  return htmlPage('Global Transactions', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Global Transactions</h1>
            <p class="text-gray-600">View every payment order, attempt and transaction across all merchants</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">Transactions</h2>
            <p class="text-gray-600 text-sm">Complete transaction history across the platform</p>
          </div>
          <div class="overflow-x-auto p-6">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Order ID</th>
                  <th class="p-4 text-left">Merchant</th>
                  <th class="p-4 text-left">Amount</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">Method</th>
                  <th class="p-4 text-left">Created</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="globalTransactionsTable" class="divide-y divide-gray-100">
                <tr><td colspan="7" class="p-8 text-center text-gray-500">Loading transactions...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function paymentVerificationPage() {
  return htmlPage('Payment Verification', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Payment Verification</h1>
            <p class="text-gray-600">Monitor provider callbacks and payment verification status</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">Verification Events</h2>
            <p class="text-gray-600 text-sm">Authoritative provider callbacks and verification results</p>
          </div>
          <div class="overflow-x-auto p-6">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Event ID</th>
                  <th class="p-4 text-left">Provider</th>
                  <th class="p-4 text-left">Order ID</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">UTR / Reference</th>
                  <th class="p-4 text-left">Received</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="verificationEventsTable" class="divide-y divide-gray-100">
                <tr><td colspan="7" class="p-8 text-center text-gray-500">Loading verification events...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function apiManagementPage() {
  return htmlPage('API Management', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">API Management</h1>
            <p class="text-gray-600">Manage merchant API credentials, scopes, quotas and rate limits</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">API Keys</h2>
            <p class="text-gray-600 text-sm">Merchant API credentials across the platform</p>
          </div>
          <div class="overflow-x-auto p-6">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Merchant</th>
                  <th class="p-4 text-left">Label</th>
                  <th class="p-4 text-left">Environment</th>
                  <th class="p-4 text-left">Scopes</th>
                  <th class="p-4 text-left">Rate Limit</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="apiKeysTable" class="divide-y divide-gray-100">
                <tr><td colspan="7" class="p-8 text-center text-gray-500">Loading API keys...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function webhookControlPage() {
  return htmlPage('Callback & Webhook Control', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Callback & Webhook Control</h1>
            <p class="text-gray-600">Manage merchant webhook endpoints, signing and delivery retries</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">Webhook Endpoints</h2>
            <p class="text-gray-600 text-sm">Registered merchant callback URLs and delivery health</p>
          </div>
          <div class="overflow-x-auto p-6">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Merchant</th>
                  <th class="p-4 text-left">Callback URL</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">Deliveries</th>
                  <th class="p-4 text-left">Failed</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="webhookEndpointsTable" class="divide-y divide-gray-100">
                <tr><td colspan="6" class="p-8 text-center text-gray-500">Loading webhook endpoints...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function gamingWalletPage() {
  return htmlPage('Gaming Wallet Integration', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Gaming Wallet Integration</h1>
            <p class="text-gray-600">Monitor gaming wallet fulfillment and player credit tracking</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200 grid grid-cols-1 md:grid-cols-4 gap-6">
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Active Wallets</p>
              <h3 class="text-2xl font-bold text-gray-900" id="walletActiveCount">--</h3>
            </div>
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Total Balance</p>
              <h3 class="text-2xl font-bold text-gray-900" id="walletTotalBalance">--</h3>
            </div>
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Credits Today</p>
              <h3 class="text-2xl font-bold text-gray-900" id="walletCreditsToday">--</h3>
            </div>
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Pending Fulfillment</p>
              <h3 class="text-2xl font-bold text-gray-900" id="walletPendingCount">--</h3>
            </div>
          </div>
          <div class="p-6 overflow-x-auto">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Player Reference</th>
                  <th class="p-4 text-left">Merchant</th>
                  <th class="p-4 text-left">Balance</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">Last Credit</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="gamingWalletsTable" class="divide-y divide-gray-100">
                <tr><td colspan="6" class="p-8 text-center text-gray-500">Loading gaming wallets...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function settlementReconciliationPage() {
  return htmlPage('Settlement & Reconciliation', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Settlement & Reconciliation</h1>
            <p class="text-gray-600">Monitor bank settlement records and reconciliation cases</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Settled Today</p>
              <h3 class="text-2xl font-bold text-gray-900" id="settlementToday">--</h3>
            </div>
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Unmatched Credits</p>
              <h3 class="text-2xl font-bold text-gray-900" id="settlementUnmatched">--</h3>
            </div>
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Reconciliation Cases</p>
              <h3 class="text-2xl font-bold text-gray-900" id="settlementCases">--</h3>
            </div>
          </div>
          <div class="p-6 overflow-x-auto">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Case ID</th>
                  <th class="p-4 text-left">Merchant</th>
                  <th class="p-4 text-left">Type</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">Created</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="reconciliationCasesTable" class="divide-y divide-gray-100">
                <tr><td colspan="6" class="p-8 text-center text-gray-500">Loading reconciliation cases...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function pricingBillingPage() {
  return htmlPage('Merchant Pricing & Billing', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Merchant Pricing & Billing</h1>
            <p class="text-gray-600">Configure pricing plans, subscriptions and billing per merchant</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">Pricing Plans</h2>
            <p class="text-gray-600 text-sm">Platform pricing plans and merchant subscriptions</p>
          </div>
          <div class="overflow-x-auto p-6">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Plan Name</th>
                  <th class="p-4 text-left">Monthly Fee</th>
                  <th class="p-4 text-left">Transaction Fee %</th>
                  <th class="p-4 text-left">Fixed Fee</th>
                  <th class="p-4 text-left">API Quota</th>
                  <th class="p-4 text-left">Active Merchants</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="pricingPlansTable" class="divide-y divide-gray-100">
                <tr><td colspan="7" class="p-8 text-center text-gray-500">Loading pricing plans...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function riskPoliciesPage() {
  return htmlPage('Risk & UPI Policies', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Risk & UPI Policies</h1>
            <p class="text-gray-600">Configure merchant acceptance rules, blocks and watchlists</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">Acceptance Rules</h2>
            <p class="text-gray-600 text-sm">Merchant-scoped allow/block/watch rules for payments</p>
          </div>
          <div class="overflow-x-auto p-6">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Rule ID</th>
                  <th class="p-4 text-left">Merchant</th>
                  <th class="p-4 text-left">Type</th>
                  <th class="p-4 text-left">Target</th>
                  <th class="p-4 text-left">Reason</th>
                  <th class="p-4 text-left">Active</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="riskRulesTable" class="divide-y divide-gray-100">
                <tr><td colspan="7" class="p-8 text-center text-gray-500">Loading risk rules...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function diagnosticsPage() {
  return htmlPage('Payment Diagnostic Center', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Payment Diagnostic Center</h1>
            <p class="text-gray-600">Search and investigate payment lifecycle events</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">Diagnostic Search</h2>
            <p class="text-gray-600 text-sm">Search payments by Order ID, Payment ID, UTR, or Player Reference</p>
          </div>
          <div class="p-6">
            <div class="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-6">
              <form id="diagnosticSearchForm" class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Search Key</label>
                  <input type="text" name="searchKey" placeholder="Order ID, Payment ID, UTR, Player Reference" class="w-full px-4 py-2 border border-gray-300 rounded-lg">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Search Type</label>
                  <select name="searchType" class="w-full px-4 py-2 border border-gray-300 rounded-lg">
                    <option value="ORDER_ID">Order ID</option>
                    <option value="PAYMENT_ID">Payment ID</option>
                    <option value="UTR">UTR / RRN</option>
                    <option value="PLAYER_REF">Player Reference</option>
                  </select>
                </div>
                <div class="md:col-span-2 flex items-end">
                  <button type="submit" class="bg-green-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-700">Search</button>
                </div>
              </form>
            </div>
            <div id="diagnosticResults" class="overflow-x-auto">
              <table class="w-full text-left">
                <thead class="bg-gray-50">
                  <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                    <th class="p-4 text-left">Order ID</th>
                    <th class="p-4 text-left">Merchant</th>
                    <th class="p-4 text-left">Amount</th>
                    <th class="p-4 text-left">Status</th>
                    <th class="p-4 text-left">Receiving VPA</th>
                    <th class="p-4 text-left">UTR</th>
                    <th class="p-4 text-left">Created</th>
                  </tr>
                </thead>
                <tbody id="diagnosticResultsTable" class="divide-y divide-gray-100"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);
}

function operationsIncidentsPage() {
  return htmlPage('Operations & Incidents', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Operations & Incidents</h1>
            <p class="text-gray-600">Monitor platform incidents, outages and operational alerts</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200 grid grid-cols-1 md:grid-cols-4 gap-6">
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Open Incidents</p>
              <h3 class="text-2xl font-bold text-gray-900" id="incidentsOpenCount">--</h3>
            </div>
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Critical</p>
              <h3 class="text-2xl font-bold text-gray-900" id="incidentsCriticalCount">--</h3>
            </div>
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Resolved Today</p>
              <h3 class="text-2xl font-bold text-gray-900" id="incidentsResolvedCount">--</h3>
            </div>
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Avg Resolution Time</p>
              <h3 class="text-2xl font-bold text-gray-900" id="incidentsAvgTime">--</h3>
            </div>
          </div>
          <div class="p-6 overflow-x-auto">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Incident ID</th>
                  <th class="p-4 text-left">Title</th>
                  <th class="p-4 text-left">Severity</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">Assigned</th>
                  <th class="p-4 text-left">Created</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="incidentsTable" class="divide-y divide-gray-100">
                <tr><td colspan="7" class="p-8 text-center text-gray-500">Loading incidents...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function platformAnalyticsPage() {
  return htmlPage('Platform Analytics', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Platform Analytics</h1>
            <p class="text-gray-600">View platform-wide payment volume, success rates and trends</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200 grid grid-cols-1 md:grid-cols-4 gap-6">
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Total Volume</p>
              <h3 class="text-2xl font-bold text-gray-900" id="analyticsVolume">--</h3>
            </div>
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Success Rate</p>
              <h3 class="text-2xl font-bold text-gray-900" id="analyticsSuccessRate">--</h3>
            </div>
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Failed Payments</p>
              <h3 class="text-2xl font-bold text-gray-900" id="analyticsFailedCount">--</h3>
            </div>
            <div class="bg-white p-4 rounded-lg border border-gray-200">
              <p class="text-sm text-gray-500 mb-1">Active Merchants</p>
              <h3 class="text-2xl font-bold text-gray-900" id="analyticsActiveMerchants">--</h3>
            </div>
          </div>
          <div class="p-6">
            <div class="bg-gray-50 p-6 rounded-lg border border-gray-200">
              <h3 class="text-sm font-bold text-gray-900 mb-4">Transaction Trends</h3>
              <div class="h-64 bg-white border border-gray-200 rounded-lg flex items-center justify-center text-gray-400">
                <span>Analytics charts require charting library integration</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);
}

function staffPermissionsPage() {
  return htmlPage('Staff & Permissions', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Staff & Permissions</h1>
            <p class="text-gray-600">Manage platform staff roles and permissions</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">Platform Staff</h2>
            <p class="text-gray-600 text-sm">Platform Owner administrators and operations staff</p>
          </div>
          <div class="overflow-x-auto p-6">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Name</th>
                  <th class="p-4 text-left">Email</th>
                  <th class="p-4 text-left">Role</th>
                  <th class="p-4 text-left">Permissions</th>
                  <th class="p-4 text-left">Status</th>
                  <th class="p-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody id="staffTable" class="divide-y divide-gray-100">
                <tr><td colspan="6" class="p-8 text-center text-gray-500">Loading staff...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function securityAuditPage() {
  return htmlPage('Security & Audit Logs', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Security & Audit Logs</h1>
            <p class="text-gray-600">Review platform audit trails and security events</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-bold text-gray-900">Audit Logs</h2>
            <p class="text-gray-600 text-sm">Immutable audit trail of all platform actions</p>
          </div>
          <div class="overflow-x-auto p-6">
            <table class="w-full text-left">
              <thead class="bg-gray-50">
                <tr class="border-b border-gray-200 text-gray-500 text-xs uppercase font-semibold">
                  <th class="p-4 text-left">Time</th>
                  <th class="p-4 text-left">Actor</th>
                  <th class="p-4 text-left">Action</th>
                  <th class="p-4 text-left">Entity</th>
                  <th class="p-4 text-left">Merchant</th>
                  <th class="p-4 text-left">Details</th>
                </tr>
              </thead>
              <tbody id="auditLogsTable" class="divide-y divide-gray-100">
                <tr><td colspan="6" class="p-8 text-center text-gray-500">Loading audit logs...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `);
}

function systemConfigPage() {
  return htmlPage('System Configuration', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">System Configuration</h1>
            <p class="text-gray-600">Configure platform-wide system settings</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 class="text-lg font-bold text-gray-900 mb-4">Platform Configuration</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 class="text-sm font-bold text-gray-900 mb-2">General Settings</h3>
              <p class="text-sm text-gray-600">Platform name, timezone, default currency</p>
            </div>
            <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 class="text-sm font-bold text-gray-900 mb-2">Security Settings</h3>
              <p class="text-sm text-gray-600">Session TTL, MFA requirements, rate limits</p>
            </div>
            <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 class="text-sm font-bold text-gray-900 mb-2">Provider Settings</h3>
              <p class="text-sm text-gray-600">Default provider, retry policies, timeouts</p>
            </div>
            <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 class="text-sm font-bold text-gray-900 mb-2">Notifications</h3>
              <p class="text-sm text-gray-600">Alert channels, incident escalation</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);
}

function documentationPage() {
  return htmlPage('Documentation & Support', `
    <div class="pl-64 pt-16 pb-8">
      <div class="container mx-auto px-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 fade-in">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 mb-1">Documentation & Support</h1>
            <p class="text-gray-600">Platform manuals, API references and support resources</p>
          </div>
          <button onclick="app.navigate('command-center')" class="text-green-600 hover:text-green-800 font-medium text-sm">← Back</button>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 class="text-lg font-bold text-gray-900 mb-4">Documentation</h2>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 class="text-sm font-bold text-gray-900 mb-2">Super Admin Manual</h3>
              <p class="text-sm text-gray-600">Complete guide to platform owner operations</p>
            </div>
            <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 class="text-sm font-bold text-gray-900 mb-2">Merchant Onboarding</h3>
              <p class="text-sm text-gray-600">How merchants get started</p>
            </div>
            <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 class="text-sm font-bold text-gray-900 mb-2">Developer API</h3>
              <p class="text-sm text-gray-600">Integration reference for merchants</p>
            </div>
            <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 class="text-sm font-bold text-gray-900 mb-2">Webhook Integration</h3>
              <p class="text-sm text-gray-600">Merchant callback setup guide</p>
            </div>
            <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 class="text-sm font-bold text-gray-900 mb-2">Gaming Wallet</h3>
              <p class="text-sm text-gray-600">Player wallet integration guide</p>
            </div>
            <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 class="text-sm font-bold text-gray-900 mb-2">Reconciliation</h3>
              <p class="text-sm text-gray-600">Settlement and reconciliation procedures</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `);
}

const routes = {
  'login': loginPage,
  'command-center': commandCenterPage,
  'merchant-directory': merchantDirectoryPage,
  'create-merchant': createMerchantPage,
  'merchant-access': merchantAccessPage,
  'receiving-banks': receivingBanksPage,
  'upi-management': upiManagementPage,
  'smart-routing': smartRoutingPage,
  'automatic-failover': automaticFailoverPage,
  'payment-links': paymentLinksPage,
  'global-transactions': globalTransactionsPage,
  'payment-verification': paymentVerificationPage,
  'api-management': apiManagementPage,
  'webhook-control': webhookControlPage,
  'gaming-wallet': gamingWalletPage,
  'settlement-reconciliation': settlementReconciliationPage,
  'pricing-billing': pricingBillingPage,
  'risk-policies': riskPoliciesPage,
  'diagnostics': diagnosticsPage,
  'operations-incidents': operationsIncidentsPage,
  'platform-analytics': platformAnalyticsPage,
  'staff-permissions': staffPermissionsPage,
  'security-audit': securityAuditPage,
  'system-config': systemConfigPage,
  'documentation': documentationPage
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
