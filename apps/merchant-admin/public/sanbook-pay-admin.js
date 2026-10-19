/**
 * Sanbook Pay — Merchant Console Production Frontend Engine
 * Connects all admin views to authoritative backend APIs.
 */

// Global State
let currentMerchantId = '00000000-0000-0000-0000-000000000001';
let cachedConnections = [];
let cachedBeneficiaries = [];

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatInr(paise) {
  if (paise === null || paise === undefined) return '₹0.00';
  const rupees = (Number(paise) / 100).toFixed(2);
  return '₹' + rupees.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ----------------------------------------------------
// SECTION 1: OVERVIEW
// ----------------------------------------------------
async function loadOverviewData() {
  try {
    const [settleRes, collRes, connRes, balanceRes] = await Promise.all([
      fetch('/api/v1/settlements/overview').then(r => r.json()).catch(() => ({})),
      fetch('/api/v1/collections?limit=5').then(r => r.json()).catch(() => ({ collections: [] })),
      fetch('/api/v1/banking/connections').then(r => r.json()).catch(() => ({ connections: [] })),
      fetch('/api/v1/banking/balance').then(r => r.json()).catch(() => ({ availableBalancePaise: 0 }))
    ]);

    // KPI Cards
    const grossEl = document.getElementById('ovGrossCollections');
    if (grossEl) grossEl.textContent = settleRes.grossCollections ? `₹${settleRes.grossCollections}` : '₹0.00';

    const netEl = document.getElementById('ovNetPayable');
    if (netEl) netEl.textContent = settleRes.netPayable ? `₹${settleRes.netPayable}` : '₹0.00';

    const balanceEl = document.getElementById('ovAvailableBalance');
    if (balanceEl) balanceEl.textContent = formatInr(balanceRes.availableBalancePaise);

    const settledBankEl = document.getElementById('ovConfirmedSettled');
    if (settledBankEl) settledBankEl.textContent = settleRes.confirmedBankCredit ? `₹${settleRes.confirmedBankCredit}` : '₹0.00';

    // Provider Badge
    const provBadge = document.getElementById('ovProviderBadge');
    if (provBadge) {
      const activeConn = (connRes.connections || []).find(c => c.isActive && c.status.includes('LIVE'));
      if (activeConn) {
        provBadge.className = 'badge-live';
        provBadge.innerHTML = `● ${escapeHtml(activeConn.providerName)} (${escapeHtml(activeConn.status)})`;
      } else {
        provBadge.className = 'badge-no-bank';
        provBadge.innerHTML = '⚠️ NO LIVE BANK CONNECTION';
      }
    }

    // Recent Collections Table
    const tbody = document.getElementById('ovRecentTxBody');
    if (tbody) {
      const items = collRes.collections || [];
      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No payment transactions yet. Create your first collection order.</td></tr>`;
      } else {
        tbody.innerHTML = items.map(c => `
          <tr>
            <td><strong>${escapeHtml(c.merchantOrderId)}</strong></td>
            <td>₹${escapeHtml(c.amount)}</td>
            <td><span class="status-pill status-${(c.status || '').toLowerCase()}">${escapeHtml(c.status)}</span></td>
            <td>${escapeHtml(c.bankReference || '—')}</td>
            <td>${escapeHtml(new Date(c.createdAt).toLocaleTimeString())}</td>
            <td><button class="btn-sm" onclick="viewCollectionModal('${escapeHtml(c.paymentId)}')">Details</button></td>
          </tr>
        `).join('');
      }
    }
  } catch (err) {
    console.error('[SanbookPay Overview] Failed to load:', err);
  }
}

// ----------------------------------------------------
// SECTION 2: COLLECTIONS
// ----------------------------------------------------
async function loadCollectionsData() {
  try {
    const res = await fetch('/api/v1/collections?limit=50');
    const data = await res.json();
    const tbody = document.getElementById('collectionsTableBody');
    if (!tbody) return;

    const list = data.collections || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No collection records found. Click "+ Create Collection" to create an order.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(c => `
      <tr>
        <td><strong>${escapeHtml(c.merchantOrderId)}</strong><br><small style="color:var(--text-muted);">${escapeHtml(c.paymentId)}</small></td>
        <td><strong>₹${escapeHtml(c.amount)}</strong></td>
        <td><span class="status-pill status-${(c.status || '').toLowerCase()}">${escapeHtml(c.status)}</span></td>
        <td>${escapeHtml(c.method || 'UPI')}</td>
        <td><code>${escapeHtml(c.bankReference || 'AWAITING BANK')}</code></td>
        <td>${new Date(c.createdAt).toLocaleString()}</td>
        <td>
          <button class="btn-sm" onclick="viewCollectionModal('${escapeHtml(c.paymentId)}')">View</button>
          <button class="btn-sm btn-outline" onclick="refreshCollectionStatus('${escapeHtml(c.paymentId)}')">Refresh</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('[Collections] Load failed:', err);
  }
}

async function handleCreateCollectionSubmit(e) {
  if (e) e.preventDefault();
  const orderId = document.getElementById('collInputOrderId').value.trim();
  const amount = parseFloat(document.getElementById('collInputAmount').value);
  const customerName = document.getElementById('collInputCustName').value.trim();
  const customerPhone = document.getElementById('collInputCustPhone').value.trim();
  const customerEmail = document.getElementById('collInputCustEmail').value.trim();

  if (!orderId || !amount || isNaN(amount)) {
    alert('Please enter valid Order ID and Amount');
    return;
  }

  try {
    const res = await fetch('/api/v1/collections', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': 'idem_' + Date.now()
      },
      body: JSON.stringify({
        orderId,
        amount,
        customerName,
        customerPhone,
        customerEmail
      })
    });
    const result = await res.json();
    if (!res.ok) {
      alert(`Error creating collection: ${result.error || 'Failed'}`);
      return;
    }
    alert(`Collection order created successfully! Status: ${result.status}`);
    closeModal('createCollectionModal');
    loadCollectionsData();
  } catch (err) {
    alert(`Network error: ${err.message}`);
  }
}

async function refreshCollectionStatus(paymentId) {
  try {
    const res = await fetch(`/api/v1/collections/${encodeURIComponent(paymentId)}/refresh-status`, {
      method: 'POST'
    });
    const data = await res.json();
    alert(`Status updated: ${data.status}${data.bankReference ? ' (UTR: ' + data.bankReference + ')' : ''}`);
    loadCollectionsData();
  } catch (err) {
    alert(`Failed to refresh status: ${err.message}`);
  }
}

async function viewCollectionModal(paymentId) {
  try {
    const res = await fetch(`/api/v1/collections/${encodeURIComponent(paymentId)}`);
    const data = await res.json();
    if (!res.ok) {
      alert('Order not found');
      return;
    }

    const modalBody = document.getElementById('collectionDetailsBody');
    if (!modalBody) return;

    modalBody.innerHTML = `
      <div class="details-grid">
        <div><strong>Payment ID:</strong> ${escapeHtml(data.paymentId)}</div>
        <div><strong>Order ID:</strong> ${escapeHtml(data.merchantOrderId)}</div>
        <div><strong>Amount:</strong> ₹${escapeHtml(data.amount)} (${escapeHtml(data.amountPaise)} paise)</div>
        <div><strong>Status:</strong> <span class="status-pill status-${(data.status||'').toLowerCase()}">${escapeHtml(data.status)}</span></div>
        <div><strong>Bank UTR:</strong> <code>${escapeHtml(data.bankReference || 'None')}</code></div>
        <div><strong>Provider Payment ID:</strong> ${escapeHtml(data.providerPaymentId || 'None')}</div>
        <div><strong>Created At:</strong> ${escapeHtml(data.createdAt)}</div>
        <div><strong>Confirmed At:</strong> ${escapeHtml(data.confirmedAt || 'Not confirmed yet')}</div>
        <div><strong>Confirmation Latency:</strong> ${data.confirmationTimeMs ? (data.confirmationTimeMs / 1000).toFixed(2) + 's' : 'N/A'}</div>
      </div>
      <h4 style="margin-top:1.5rem;">Audit Lifecycle Events</h4>
      <table class="data-table">
        <thead><tr><th>Event</th><th>Status</th><th>Timestamp</th><th>Latency</th></tr></thead>
        <tbody>
          ${(data.events || []).map(e => `
            <tr>
              <td><code>${escapeHtml(e.eventType)}</code></td>
              <td>${escapeHtml(e.status)}</td>
              <td>${new Date(e.timestamp).toLocaleTimeString()}</td>
              <td>${e.latencyMs ? e.latencyMs + 'ms' : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    openModal('collectionDetailsModal');
  } catch (err) {
    alert(`Failed to load details: ${err.message}`);
  }
}

// ----------------------------------------------------
// SECTION 3: PAYOUTS
// ----------------------------------------------------
async function loadPayoutsData() {
  try {
    const [payoutsRes, benesRes] = await Promise.all([
      fetch('/api/v1/payouts').then(r => r.json()).catch(() => ({ payouts: [] })),
      fetch('/api/v1/beneficiaries').then(r => r.json()).catch(() => ({ beneficiaries: [] }))
    ]);

    cachedBeneficiaries = benesRes.beneficiaries || [];

    // Populate Beneficiary Dropdown in Send Money form
    const beneSelect = document.getElementById('payoutSelectBene');
    if (beneSelect) {
      if (cachedBeneficiaries.length === 0) {
        beneSelect.innerHTML = `<option value="">-- No Beneficiaries Registered --</option>`;
      } else {
        beneSelect.innerHTML = `<option value="">-- Select Registered Beneficiary --</option>` +
          cachedBeneficiaries.map(b => `
            <option value="${escapeHtml(b.id)}">${escapeHtml(b.name)} (${b.type === 'UPI_ID' ? escapeHtml(b.upiId) : escapeHtml(b.bankAccount) + ' - ' + escapeHtml(b.ifsc)}) [${b.verificationStatus}]</option>
          `).join('');
      }
    }

    // Beneficiaries Table
    const benesTbody = document.getElementById('payoutsBenesTableBody');
    if (benesTbody) {
      if (cachedBeneficiaries.length === 0) {
        benesTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No beneficiaries registered yet. Click "+ Add Beneficiary".</td></tr>`;
      } else {
        benesTbody.innerHTML = cachedBeneficiaries.map(b => `
          <tr>
            <td><strong>${escapeHtml(b.name)}</strong></td>
            <td>${escapeHtml(b.type)}</td>
            <td><code>${escapeHtml(b.bankAccount || b.upiId)}</code> ${b.ifsc ? `(${escapeHtml(b.ifsc)})` : ''}</td>
            <td><span class="status-pill status-${(b.verificationStatus || '').toLowerCase()}">${escapeHtml(b.verificationStatus)}</span></td>
            <td><button class="btn-sm btn-outline" onclick="verifyBeneficiaryAction('${escapeHtml(b.id)}')">Verify</button></td>
          </tr>
        `).join('');
      }
    }

    // Payouts Transfer History Table
    const payoutsTbody = document.getElementById('payoutsTableBody');
    if (payoutsTbody) {
      const list = payoutsRes.payouts || [];
      if (list.length === 0) {
        payoutsTbody.innerHTML = `<tr><td colspan="6" class="empty-state">No money transfers issued yet.</td></tr>`;
      } else {
        payoutsTbody.innerHTML = list.map(p => `
          <tr>
            <td><strong>${escapeHtml(p.transferId)}</strong></td>
            <td><strong>₹${escapeHtml(p.amount)}</strong></td>
            <td>${escapeHtml(p.payoutRail)}</td>
            <td><span class="status-pill status-${(p.status || '').toLowerCase()}">${escapeHtml(p.status)}</span></td>
            <td><code>${escapeHtml(p.utr || 'PENDING')}</code></td>
            <td>
              ${p.status === 'APPROVAL_REQUIRED' ? `
                <button class="btn-sm btn-success" onclick="approvePayoutAction('${escapeHtml(p.id)}')">Approve</button>
              ` : `
                <button class="btn-sm btn-outline" onclick="refreshPayoutStatusAction('${escapeHtml(p.id)}')">Status</button>
              `}
            </td>
          </tr>
        `).join('');
      }
    }
  } catch (err) {
    console.error('[Payouts] Load failed:', err);
  }
}

async function handleSendMoneySubmit(e) {
  if (e) e.preventDefault();
  const beneId = document.getElementById('payoutSelectBene').value;
  const amount = parseFloat(document.getElementById('payoutInputAmount').value);
  const rail = document.getElementById('payoutSelectRail').value;
  const remarks = document.getElementById('payoutInputRemarks').value.trim();
  const requireApproval = document.getElementById('payoutCheckApproval').checked;

  if (!beneId || !amount || isNaN(amount) || amount <= 0) {
    alert('Please select a beneficiary and enter a positive transfer amount');
    return;
  }

  try {
    const res = await fetch('/api/v1/payouts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': 'payout_' + Date.now()
      },
      body: JSON.stringify({
        beneficiaryId: beneId,
        amount,
        payoutRail: rail,
        remarks: remarks || 'Sanbook Pay Transfer',
        requireApproval
      })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Payout failed: ${data.error || 'Submission error'}`);
      return;
    }
    alert(`Transfer initiated successfully! Ref: ${data.transferId} (Status: ${data.status})`);
    loadPayoutsData();
  } catch (err) {
    alert(`Error submitting payout: ${err.message}`);
  }
}

async function handleAddBeneficiarySubmit(e) {
  if (e) e.preventDefault();
  const type = document.getElementById('beneInputType').value;
  const name = document.getElementById('beneInputName').value.trim();
  const bankAccount = document.getElementById('beneInputAccount').value.trim();
  const ifsc = document.getElementById('beneInputIfsc').value.trim();
  const upiId = document.getElementById('beneInputUpi').value.trim();

  if (!name) {
    alert('Beneficiary name is required');
    return;
  }
  if (type === 'BANK_ACCOUNT' && (!bankAccount || !ifsc)) {
    alert('Bank account number and IFSC are required for bank transfer');
    return;
  }
  if (type === 'UPI_ID' && !upiId) {
    alert('UPI ID is required');
    return;
  }

  try {
    const res = await fetch('/api/v1/beneficiaries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        beneficiaryType: type,
        bankAccount: type === 'BANK_ACCOUNT' ? bankAccount : undefined,
        ifsc: type === 'BANK_ACCOUNT' ? ifsc : undefined,
        upiId: type === 'UPI_ID' ? upiId : undefined
      })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Failed to add beneficiary: ${data.error || 'Unknown error'}`);
      return;
    }
    alert('Beneficiary registered successfully!');
    closeModal('addBeneficiaryModal');
    loadPayoutsData();
  } catch (err) {
    alert(`Network error: ${err.message}`);
  }
}

async function verifyBeneficiaryAction(beneId) {
  try {
    const res = await fetch('/api/v1/beneficiaries/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beneficiaryId: beneId })
    });
    const data = await res.json();
    alert(`Verification result: ${data.message || (data.verified ? 'VERIFIED' : 'FAILED')}${data.registeredName ? ' (Name: ' + data.registeredName + ')' : ''}`);
    loadPayoutsData();
  } catch (err) {
    alert(`Verification error: ${err.message}`);
  }
}

async function approvePayoutAction(payoutId) {
  if (!confirm('Authorize and release real-money payout disbursement?')) return;
  try {
    const res = await fetch(`/api/v1/payouts/${encodeURIComponent(payoutId)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVED', approverId: 'CONSOLE_ADMIN' })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Approval error: ${data.error}`);
      return;
    }
    alert(`Payout approved and submitted! Status: ${data.status}`);
    loadPayoutsData();
  } catch (err) {
    alert(`Network error: ${err.message}`);
  }
}

async function refreshPayoutStatusAction(payoutId) {
  try {
    const res = await fetch(`/api/v1/payouts/${encodeURIComponent(payoutId)}/refresh-status`, {
      method: 'POST'
    });
    const data = await res.json();
    alert(`Status: ${data.status}${data.utr ? ' (UTR: ' + data.utr + ')' : ''}`);
    loadPayoutsData();
  } catch (err) {
    alert(`Error checking status: ${err.message}`);
  }
}

// ----------------------------------------------------
// SECTION 4: BANKING & CONNECTIONS
// ----------------------------------------------------
async function loadBankingData() {
  try {
    const [connRes, balRes] = await Promise.all([
      fetch('/api/v1/banking/connections').then(r => r.json()).catch(() => ({ connections: [] })),
      fetch('/api/v1/banking/balance').then(r => r.json()).catch(() => ({ balancePaise: 0, availableBalancePaise: 0 }))
    ]);

    cachedConnections = connRes.connections || [];

    // Update Balance Display
    const balDisplay = document.getElementById('bankingLiveBalance');
    if (balDisplay) balDisplay.textContent = formatInr(balRes.availableBalancePaise);

    // Populate active connection fields if present
    const cfConn = cachedConnections.find(c => c.providerName === 'CASHFREE');
    const statusPill = document.getElementById('bankingConnStatusPill');
    const diagPanel = document.getElementById('bankingDiagnosticsText');

    if (cfConn) {
      document.getElementById('bankFormConnId').value = cfConn.id;
      document.getElementById('bankFormEnv').value = cfConn.environment || 'PRODUCTION';
      document.getElementById('bankFormClientId').value = cfConn.clientId || '';
      document.getElementById('bankFormVpa').value = cfConn.merchantVpa || '';

      if (statusPill) {
        statusPill.className = `status-pill status-${cfConn.status.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        statusPill.textContent = cfConn.status;
      }
      if (diagPanel) {
        diagPanel.textContent = JSON.stringify(cfConn.diagnostics || { status: cfConn.status, lastTested: cfConn.lastTestedAt }, null, 2);
      }
    } else {
      if (statusPill) {
        statusPill.className = 'status-pill status-unconfigured';
        statusPill.textContent = 'NOT CONFIGURED';
      }
      if (diagPanel) {
        diagPanel.textContent = 'No banking connections configured yet. Enter Client ID and Secret and click "Save Connection".';
      }
    }
  } catch (err) {
    console.error('[Banking] Load failed:', err);
  }
}

async function handleSaveConnectionSubmit(e) {
  if (e) e.preventDefault();
  const connId = document.getElementById('bankFormConnId').value;
  const provider = document.getElementById('bankFormSelectProvider').value;
  const env = document.getElementById('bankFormEnv').value;
  const clientId = document.getElementById('bankFormClientId').value.trim();
  const clientSecret = document.getElementById('bankFormClientSecret').value.trim();
  const webhookSecret = document.getElementById('bankFormWebhookSecret').value.trim();
  const vpa = document.getElementById('bankFormVpa').value.trim();

  try {
    const res = await fetch('/api/v1/banking/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: connId || undefined,
        providerName: provider,
        environment: env,
        clientId,
        clientSecret: clientSecret || undefined,
        webhookSecret: webhookSecret || undefined,
        merchantVpa: vpa
      })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Save error: ${data.error}`);
      return;
    }
    alert('Bank connection saved securely! Credentials encrypted with AES-256-GCM.');
    document.getElementById('bankFormClientSecret').value = '';
    document.getElementById('bankFormWebhookSecret').value = '';
    loadBankingData();
  } catch (err) {
    alert(`Failed to save: ${err.message}`);
  }
}

async function testConnectionAction() {
  const connId = document.getElementById('bankFormConnId').value;
  if (!connId) {
    alert('Please save the connection first.');
    return;
  }

  const btn = document.getElementById('btnTestConnection');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`/api/v1/banking/connections/${encodeURIComponent(connId)}/test`, {
      method: 'POST'
    });
    const data = await res.json();
    alert(`Connection Test Result: ${data.valid ? 'PASSED ✅' : 'FAILED ❌'}\nStatus: ${data.status}\n${data.error || 'Authorized credentials confirmed.'}`);
    loadBankingData();
  } catch (err) {
    alert(`Test error: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function checkCapabilitiesAction() {
  const connId = document.getElementById('bankFormConnId').value;
  if (!connId) {
    alert('Please save connection first.');
    return;
  }
  try {
    const res = await fetch(`/api/v1/banking/connections/${encodeURIComponent(connId)}/capabilities`);
    const data = await res.json();
    const caps = (data.capabilities || []).map(c => `• ${c.code}: ${c.description} [${c.enabled ? 'ENABLED' : 'DISABLED'}]`).join('\n');
    alert(`Available Provider Capabilities:\n\n${caps}`);
  } catch (err) {
    alert(`Failed to check capabilities: ${err.message}`);
  }
}

async function activateCollectionsAction() {
  const connId = document.getElementById('bankFormConnId').value;
  if (!connId) return alert('Save connection first.');
  try {
    const res = await fetch(`/api/v1/banking/connections/${encodeURIComponent(connId)}/activate-collections`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return alert(`Activation error: ${data.error}`);
    alert(`Collections Activated! Status: ${data.status}`);
    loadBankingData();
  } catch (err) {
    alert(`Failed: ${err.message}`);
  }
}

async function activatePayoutsAction() {
  const connId = document.getElementById('bankFormConnId').value;
  if (!connId) return alert('Save connection first.');
  try {
    const res = await fetch(`/api/v1/banking/connections/${encodeURIComponent(connId)}/activate-payouts`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return alert(`Activation error: ${data.error}`);
    alert(`Payouts Activated! Status: ${data.status}`);
    loadBankingData();
  } catch (err) {
    alert(`Failed: ${err.message}`);
  }
}

async function checkWebhookConfigAction() {
  const connId = document.getElementById('bankFormConnId').value;
  if (!connId) return alert('Save connection first.');
  try {
    const res = await fetch(`/api/v1/banking/connections/${encodeURIComponent(connId)}/webhook-check`);
    const data = await res.json();
    alert(`Webhook Configuration Details:\n\nEndpoint URL:\n${data.configuredWebhookUrl}\n\nAlgorithm: ${data.signatureAlgorithm}\n\n${data.instructions}`);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function disconnectConnectionAction() {
  const connId = document.getElementById('bankFormConnId').value;
  if (!connId) return;
  if (!confirm('Safely disconnect this provider? New transactions will be halted, but all historical records are preserved.')) return;
  try {
    const res = await fetch(`/api/v1/banking/connections/${encodeURIComponent(connId)}/disconnect`, { method: 'POST' });
    const data = await res.json();
    alert(`Disconnected. Status: ${data.status}`);
    loadBankingData();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// ----------------------------------------------------
// SECTION 5: SETTLEMENTS & FINANCIAL LEDGER
// ----------------------------------------------------
async function loadSettlementsData() {
  try {
    const [overviewRes, batchesRes, ledgerRes, exceptionsRes] = await Promise.all([
      fetch('/api/v1/settlements/overview').then(r => r.json()).catch(() => ({})),
      fetch('/api/v1/settlements').then(r => r.json()).catch(() => ({ settlements: [] })),
      fetch('/api/v1/ledger/accounts').then(r => r.json()).catch(() => ({ accounts: [] })),
      fetch('/api/v1/reconciliation/exceptions').then(r => r.json()).catch(() => ({ exceptions: [] }))
    ]);

    // KPI row
    const gEl = document.getElementById('settleGrossText');
    if (gEl) gEl.textContent = overviewRes.grossCollections ? `₹${overviewRes.grossCollections}` : '₹0.00';
    const fEl = document.getElementById('settleFeeText');
    if (fEl) fEl.textContent = overviewRes.processingFees ? `₹${overviewRes.processingFees}` : '₹0.00';
    const nEl = document.getElementById('settleNetText');
    if (nEl) nEl.textContent = overviewRes.netPayable ? `₹${overviewRes.netPayable}` : '₹0.00';
    const cEl = document.getElementById('settleConfirmedText');
    if (cEl) cEl.textContent = overviewRes.confirmedBankCredit ? `₹${overviewRes.confirmedBankCredit}` : '₹0.00';
    const pEl = document.getElementById('settlePendingText');
    if (pEl) pEl.textContent = overviewRes.settlementPending ? `₹${overviewRes.settlementPending}` : '₹0.00';

    // Settlement Batches Table
    const batchesTbody = document.getElementById('settlementBatchesBody');
    if (batchesTbody) {
      const list = batchesRes.settlements || [];
      if (list.length === 0) {
        batchesTbody.innerHTML = `<tr><td colspan="7" class="empty-state">No settlement batches recorded yet.</td></tr>`;
      } else {
        batchesTbody.innerHTML = list.map(b => `
          <tr>
            <td><strong>${escapeHtml(b.settlementId)}</strong></td>
            <td>₹${escapeHtml(b.grossAmount)}</td>
            <td>₹${escapeHtml(b.feeAmount)}</td>
            <td><strong>₹${escapeHtml(b.netAmount)}</strong></td>
            <td><span class="status-pill status-${(b.status || '').toLowerCase()}">${escapeHtml(b.status)}</span></td>
            <td><code>${escapeHtml(b.bankUtr || 'PENDING')}</code></td>
            <td>${b.settledAt ? new Date(b.settledAt).toLocaleDateString() : 'Pending'}</td>
          </tr>
        `).join('');
      }
    }

    // Ledger Accounts Table
    const ledgerTbody = document.getElementById('ledgerAccountsBody');
    if (ledgerTbody) {
      const accs = ledgerRes.accounts || [];
      ledgerTbody.innerHTML = accs.map(a => `
        <tr>
          <td><code>${escapeHtml(a.code)}</code></td>
          <td>${escapeHtml(a.name)}</td>
          <td><span class="badge-neutral">${escapeHtml(a.type)}</span></td>
          <td><strong>₹${escapeHtml(a.balance)}</strong> (${escapeHtml(a.balancePaise)} paise)</td>
        </tr>
      `).join('');
    }

    // Reconciliation Exceptions Table
    const excTbody = document.getElementById('reconciliationExceptionsBody');
    if (excTbody) {
      const excs = exceptionsRes.exceptions || [];
      if (excs.length === 0) {
        excTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No reconciliation discrepancies detected. All records balanced.</td></tr>`;
      } else {
        excTbody.innerHTML = excs.map(x => `
          <tr>
            <td><strong>${escapeHtml(x.exception_type)}</strong></td>
            <td>${escapeHtml(x.expected_value || '—')}</td>
            <td>${escapeHtml(x.actual_value || '—')}</td>
            <td><span class="status-pill status-${(x.status || '').toLowerCase()}">${escapeHtml(x.status)}</span></td>
            <td>
              ${x.status === 'OPEN' ? `
                <button class="btn-sm" onclick="resolveExceptionAction('${escapeHtml(x.id)}')">Resolve</button>
              ` : `<span>Resolved</span>`}
            </td>
          </tr>
        `).join('');
      }
    }
  } catch (err) {
    console.error('[Settlements] Load failed:', err);
  }
}

async function triggerReconciliationAction() {
  try {
    const res = await fetch('/api/v1/reconciliation/run', { method: 'POST' });
    const data = await res.json();
    alert(`Reconciliation Completed!\nTotal Orders Checked: ${data.totalChecked}\nMatched: ${data.matched}\nDiscrepancies: ${data.discrepancies}`);
    loadSettlementsData();
  } catch (err) {
    alert(`Reconciliation error: ${err.message}`);
  }
}

async function resolveExceptionAction(id) {
  const notes = prompt('Enter resolution notes:');
  if (!notes) return;
  try {
    const res = await fetch(`/api/v1/reconciliation/exceptions/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes })
    });
    alert('Exception marked as resolved');
    loadSettlementsData();
  } catch (err) {
    alert(`Failed: ${err.message}`);
  }
}

function downloadReport(type) {
  window.open(`/api/v1/reports/${encodeURIComponent(type)}?format=csv`, '_blank');
}

// ----------------------------------------------------
// SECTION 6: REFUNDS
// ----------------------------------------------------
async function loadRefundsData() {
  try {
    const res = await fetch('/api/v1/refunds');
    const data = await res.json();
    const tbody = document.getElementById('refundsTableBody');
    if (!tbody) return;

    const list = data.refunds || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No refunds recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(r => `
      <tr>
        <td><strong>${escapeHtml(r.refundId)}</strong></td>
        <td>${escapeHtml(r.paymentOrderId)}</td>
        <td><strong>₹${escapeHtml(r.amount)}</strong></td>
        <td><span class="status-pill status-${(r.status || '').toLowerCase()}">${escapeHtml(r.status)}</span></td>
        <td>${escapeHtml(r.reason || '—')}</td>
        <td>${new Date(r.createdAt).toLocaleString()}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('[Refunds] Load failed:', err);
  }
}

async function handleInitiateRefundSubmit(e) {
  if (e) e.preventDefault();
  const paymentId = document.getElementById('refundInputPaymentId').value.trim();
  const amount = parseFloat(document.getElementById('refundInputAmount').value);
  const reason = document.getElementById('refundInputReason').value.trim();

  if (!paymentId || !amount || isNaN(amount) || amount <= 0) {
    alert('Please enter valid Payment Order ID and refund amount');
    return;
  }

  try {
    const res = await fetch('/api/v1/refunds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId, amount, reason })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Refund error: ${data.error}`);
      return;
    }
    alert(`Refund initiated! Ref: ${data.refundId} (Status: ${data.status})`);
    document.getElementById('refundInputPaymentId').value = '';
    document.getElementById('refundInputAmount').value = '';
    loadRefundsData();
  } catch (err) {
    alert(`Network error: ${err.message}`);
  }
}

// ----------------------------------------------------
// SECTION 7: OPERATIONS (60-SECOND ENGINE & ALERTS)
// ----------------------------------------------------
async function loadOperationsMetrics() {
  try {
    const [metricRes, alertRes] = await Promise.all([
      fetch('/api/v1/operations/metrics').then(r => r.json()).catch(() => ({})),
      fetch('/api/v1/operations/alerts').then(r => r.json()).catch(() => ({ alerts: [] }))
    ]);

    // SLA Badge
    const slaEl = document.getElementById('opsSlaPercentage');
    if (slaEl && metricRes.under60sPercentage !== undefined) {
      slaEl.textContent = `${metricRes.under60sPercentage}%`;
    }

    const p50El = document.getElementById('opsP50Latency');
    if (p50El && metricRes.latencies?.p50Seconds) p50El.textContent = `${metricRes.latencies.p50Seconds}s`;

    const p95El = document.getElementById('opsP95Latency');
    if (p95El && metricRes.latencies?.p95Seconds) p95El.textContent = `${metricRes.latencies.p95Seconds}s`;

    const p99El = document.getElementById('opsP99Latency');
    if (p99El && metricRes.latencies?.p99Seconds) p99El.textContent = `${metricRes.latencies.p99Seconds}s`;

    // Alerts
    const alertsBox = document.getElementById('opsAlertsList');
    if (alertsBox) {
      const list = alertRes.alerts || [];
      if (list.length === 0) {
        alertsBox.innerHTML = `<div style="color:var(--success); padding:1rem;">✅ All systems operational. Zero active security or operational alerts.</div>`;
      } else {
        alertsBox.innerHTML = list.map(a => `
          <div class="alert-item alert-${(a.severity || 'info').toLowerCase()}">
            <div>
              <strong>${escapeHtml(a.title)}</strong> [${escapeHtml(a.category)}]
              <p>${escapeHtml(a.message)}</p>
            </div>
            <button class="btn-sm" onclick="ackAlertAction('${escapeHtml(a.id)}')">Dismiss</button>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('[Operations] Metrics load error:', err);
  }
}

async function ackAlertAction(id) {
  try {
    await fetch(`/api/v1/operations/alerts/${encodeURIComponent(id)}/ack`, { method: 'POST' });
    loadOperationsMetrics();
  } catch {}
}

// ----------------------------------------------------
// MODAL HELPERS
// ----------------------------------------------------
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('active');
}

function toggleBeneFields() {
  const type = document.getElementById('beneInputType')?.value;
  const accGroup = document.getElementById('beneAccountGroup');
  const ifscGroup = document.getElementById('beneIfscGroup');
  const upiGroup = document.getElementById('beneUpiGroup');
  if (type === 'UPI_ID') {
    if (accGroup) accGroup.style.display = 'none';
    if (ifscGroup) ifscGroup.style.display = 'none';
    if (upiGroup) upiGroup.style.display = 'block';
  } else {
    if (accGroup) accGroup.style.display = 'block';
    if (ifscGroup) ifscGroup.style.display = 'block';
    if (upiGroup) upiGroup.style.display = 'none';
  }
}

// Global dispatcher hook called by switchSection
window.onSanbookPaySectionSwitch = function(sectionId) {
  if (sectionId === 'overview') loadOverviewData();
  if (sectionId === 'collections') loadCollectionsData();
  if (sectionId === 'payouts') loadPayoutsData();
  if (sectionId === 'banking') loadBankingData();
  if (sectionId === 'settlements') loadSettlementsData();
  if (sectionId === 'refunds') loadRefundsData();
  if (sectionId === 'operations') loadOperationsMetrics();
};
