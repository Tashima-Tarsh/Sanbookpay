const SA_CONFIG = window.SA_CONFIG || { apiUrl: 'http://127.0.0.1:6100' };
const app = {
  token: localStorage.getItem('sa_token') || '',

  async api(endpoint, options = {}) {
    const url = `${SA_CONFIG.apiUrl}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    try {
      const res = await fetch(url, { ...options, headers });
      if (res.status === 401) {
        localStorage.removeItem('sa_token');
        this.token = '';
        window.location.href = '/super-admin/login';
        return null;
      }
      return await res.json();
    } catch (err) {
      console.error('API error:', err);
      return null;
    }
  },

  async loadStats() {
    const stats = await this.api('/api/v1/admin/payments');
    if (stats && stats.payments) {
      document.getElementById('statMerchants').textContent = stats.payments.length || 0;
      document.getElementById('statActive').textContent = stats.payments.filter(p => p.status === 'SUCCESS').length || 0;
      document.getElementById('statPending').textContent = stats.payments.filter(p => p.status === 'ACTIVE' || p.status === 'PROCESSING').length || 0;
      document.getElementById('statFailed').textContent = stats.payments.filter(p => p.status === 'FAILED').length || 0;
    }
  },

  async loadActivity() {
    const payments = await this.api('/api/v1/admin/payments?limit=10');
    const tbody = document.getElementById('activityTable');
    if (payments && payments.payments) {
      tbody.innerHTML = payments.payments.map(p => `
        <tr class="fade-in">
          <td class="p-4 text-gray-500 text-xs">${new Date(p.createdAt).toLocaleString()}</td>
          <td class="p-4 font-medium text-gray-900">Payment ${p.orderId}</td>
          <td class="p-4 text-gray-700">Merchant</td>
          <td class="p-4"><span class="status-badge status-${p.status.toLowerCase()}">${p.status}</span></td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-500">No activity data</td></tr>';
    }
  },

  async loadMerchants() {
    const merchants = await this.api('/api/v1/admin/payments?limit=100');
    const tbody = document.getElementById('merchantTableBody');
    const searchInput = document.getElementById('merchantSearch');
    const statusFilter = document.getElementById('statusFilter');
    let allMerchants = [];

    if (merchants && merchants.payments) {
      allMerchants = merchants.payments.map(p => ({
        id: p.id,
        name: p.orderId,
        email: 'merchant@sanbookpay.com',
        status: p.status,
        createdAt: p.createdAt
      }));
    }

    function render() {
      const search = searchInput.value.toLowerCase();
      const status = statusFilter.value;
      const filtered = allMerchants.filter(m =>
        (!search || m.name.toLowerCase().includes(search) || m.id.toLowerCase().includes(search)) &&
        (!status || m.status === status)
      );
      tbody.innerHTML = filtered.length > 0 ? filtered.map(m => `
        <tr class="fade-in">
          <td class="p-4 font-mono text-sm text-gray-900">${m.id}</td>
          <td class="p-4 text-gray-900 font-medium">${m.name}</td>
          <td class="p-4 text-gray-600 text-sm">${m.email}</td>
          <td class="p-4"><span class="status-badge status-${m.status.toLowerCase()}">${m.status}</span></td>
          <td class="p-4 text-gray-500 text-xs">${new Date(m.createdAt).toLocaleDateString()}</td>
          <td class="p-4">
            <button onclick="app.navigate('merchant-access?mid=' + encodeURIComponent(m.id))" class="text-sm text-green-600 hover:text-green-800 font-medium">Manage</button>
          </td>
        </tr>
      `).join('') : '<tr><td colspan="6" class="p-8 text-center text-gray-500">No merchants found</td></tr>';
    }

    if (searchInput) searchInput.addEventListener('input', render);
    if (statusFilter) statusFilter.addEventListener('change', render);
    render();
  },

  async handleLogin(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const res = await fetch(`${SA_CONFIG.apiUrl}/api/v1/super-admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: formData.get('email'), password: formData.get('password') })
    });
    const data = await res.json();
    if (data.success) {
      this.token = data.token;
      localStorage.setItem('sa_token', data.token);
      window.location.href = '/super-admin/command-center';
    } else {
      alert(data.error || 'Login failed');
    }
  },

  async handleCreateMerchant(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    const res = await fetch(`${SA_CONFIG.apiUrl}/api/v1/super-admin/merchants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (res.ok && result.success) {
      alert('Merchant created successfully! Merchant ID: ' + result.merchantId);
      this.navigate('merchant-directory');
    } else {
      alert(result.error || 'Failed to create merchant');
    }
  },

  navigate(page) {
    window.location.href = '/super-admin/' + page;
  },

  init() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    }

    const createForm = document.getElementById('createMerchantForm');
    if (createForm) {
      createForm.addEventListener('submit', (e) => this.handleCreateMerchant(e));
    }

    // Auto-load page-specific data
    const path = window.location.pathname;
    if (path.includes('command-center')) {
      this.loadStats();
      this.loadActivity();
    }
    if (path.includes('merchant-directory')) {
      this.loadMerchants();
    }
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());
