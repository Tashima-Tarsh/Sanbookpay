import { HttpServer } from '../server.js';
import {
  SettlementRepository,
  LedgerRepository,
  ReconciliationRepository,
  PaymentOrderRepository
} from '@youpi/db';

/**
 * Settlements, Double-Entry Financial Ledger, Reconciliation & Reports Routes
 */
export function registerSettlementsRoutes(server, ctx) {
  const db = ctx.db;
  const settlementRepo = new SettlementRepository(db);
  const ledgerRepo = new LedgerRepository(db);
  const reconRepo = new ReconciliationRepository(db);
  const poRepo = new PaymentOrderRepository(db);

  function getMerchantId(req) {
    const key = req.headers['x-api-key'] || req.headers['x-merchant-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    const directId = req.headers['x-merchant-id'];
    if (directId) {
      const merchant = db.queryOne(`SELECT id FROM merchants WHERE id = $1`, [directId]);
      if (merchant) return merchant.id;
    }
    if (!key) {
      const firstMerchant = db.queryOne(`SELECT id FROM merchants LIMIT 1`);
      return firstMerchant ? firstMerchant.id : null;
    }
    const merchant = db.queryOne(`SELECT id FROM merchants WHERE id = $1`, [key]);
    if (merchant) return merchant.id;
    const cred = db.queryOne(`SELECT merchant_id FROM merchant_credentials WHERE api_key = $1 AND status = 'ACTIVE'`, [key]);
    if (cred) return cred.merchant_id;
    const firstMerchant = db.queryOne(`SELECT id FROM merchants LIMIT 1`);
    return firstMerchant ? firstMerchant.id : null;
  }

  // --- SETTLEMENTS ---

  // 1. GET /api/v1/settlements/overview — Summary statistics
  server.get('/api/v1/settlements/overview', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const summary = settlementRepo.getOverview(merchantId);
    return HttpServer.json(res, 200, {
      grossCollections: (Number(summary.total_gross_paise) / 100).toFixed(2),
      processingFees: (Number(summary.total_fee_paise) / 100).toFixed(2),
      netPayable: (Number(summary.total_net_paise) / 100).toFixed(2),
      confirmedBankCredit: (Number(summary.confirmed_bank_credit_paise) / 100).toFixed(2),
      settlementPending: (Number(summary.pending_settlement_paise) / 100).toFixed(2),
      currency: 'INR'
    });
  });

  // 2. GET /api/v1/settlements — List settlement batches
  server.get('/api/v1/settlements', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const parsedUrl = new URL(req.url, 'http://localhost');
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
    const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);
    const status = parsedUrl.searchParams.get('status') || null;

    const list = settlementRepo.listByMerchant(merchantId, { limit, offset, status });
    return HttpServer.json(res, 200, {
      count: list.length,
      settlements: list.map(s => ({
        id: s.id,
        settlementId: s.settlement_id,
        grossAmount: (s.gross_amount_paise / 100).toFixed(2),
        feeAmount: (s.fee_paise / 100).toFixed(2),
        netAmount: (s.net_amount_paise / 100).toFixed(2),
        status: s.status,
        bankUtr: s.bank_utr,
        bankAccount: s.bank_account_number,
        settledAt: s.settled_at,
        bankConfirmedAt: s.bank_confirmed_at,
        createdAt: s.created_at
      }))
    });
  });

  // 2b. POST /api/v1/settlements/trigger — Execute immediate live settlement fallback
  server.post('/api/v1/settlements/trigger', async (req, res) => {
    return HttpServer.json(res,503,{error:'Automatic bank settlement is not configured. Use the existing transfer-recording workflow after a real bank transfer.',code:'SETTLEMENT_PROVIDER_NOT_CONFIGURED'});
  });

  // 3. GET /api/v1/settlements/:id — Details with individual transactions
  server.get('/api/v1/settlements/:id', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const id = params.id;
    const s = settlementRepo.findById(id) || settlementRepo.findBySettlementId(id);
    if (!s || s.merchant_id !== merchantId) {
      return HttpServer.json(res, 404, { error: 'Settlement record not found' });
    }

    const entries = settlementRepo.getEntries(s.id);

    return HttpServer.json(res, 200, {
      id: s.id,
      settlementId: s.settlement_id,
      grossAmount: (s.gross_amount_paise / 100).toFixed(2),
      feeAmount: (s.fee_paise / 100).toFixed(2),
      netAmount: (s.net_amount_paise / 100).toFixed(2),
      status: s.status,
      bankUtr: s.bank_utr,
      bankAccount: s.bank_account_number,
      settledAt: s.settled_at,
      bankConfirmedAt: s.bank_confirmed_at,
      entries: entries.map(e => ({
        paymentOrderId: e.payment_order_id,
        amount: (e.amount_paise / 100).toFixed(2),
        fee: (e.fee_paise / 100).toFixed(2),
        net: (e.net_paise / 100).toFixed(2)
      }))
    });
  });

  // --- DOUBLE-ENTRY FINANCIAL LEDGER ---

  // 4. GET /api/v1/ledger/accounts — Chart of accounts
  server.get('/api/v1/ledger/accounts', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const accounts = ledgerRepo.listAccounts(merchantId);
    return HttpServer.json(res, 200, {
      accounts: accounts.map(a => ({
        code: a.account_code,
        name: a.account_name,
        type: a.account_type,
        currency: a.currency,
        balancePaise: a.balance_paise,
        balance: (a.balance_paise / 100).toFixed(2)
      }))
    });
  });

  // 5. GET /api/v1/ledger/journal — General journal entries
  server.get('/api/v1/ledger/journal', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const parsedUrl = new URL(req.url, 'http://localhost');
    const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
    const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

    const journal = ledgerRepo.getJournal(merchantId, { limit, offset });
    return HttpServer.json(res, 200, { journal });
  });

  // 6. GET /api/v1/ledger/trial-balance — Trial balance
  server.get('/api/v1/ledger/trial-balance', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const tb = ledgerRepo.getTrialBalance(merchantId);
    return HttpServer.json(res, 200, {
      trialBalance: {
        accounts: tb.accounts.map(a => ({
          code: a.account_code,
          name: a.account_name,
          type: a.account_type,
          balance: (Number(a.balance_paise) / 100).toFixed(2)
        })),
        summary: tb.summary,
        totalAssets: (tb.summary.totalAssetsPaise / 100).toFixed(2),
        totalLiabilities: (tb.summary.totalLiabilitiesPaise / 100).toFixed(2),
        totalExpenses: (tb.summary.totalExpensesPaise / 100).toFixed(2)
      }
    });
  });

  // --- RECONCILIATION ---

  // 7. GET /api/v1/reconciliation/runs — List runs
  server.get('/api/v1/reconciliation/runs', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const runs = reconRepo.listRuns(merchantId);
    return HttpServer.json(res, 200, { runs });
  });

  // 8. GET /api/v1/reconciliation/exceptions — List discrepancies
  server.get('/api/v1/reconciliation/exceptions', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const parsedUrl = new URL(req.url, 'http://localhost');
    const status = parsedUrl.searchParams.get('status') || null;

    const exceptions = reconRepo.listExceptions(merchantId, status);
    return HttpServer.json(res, 200, { exceptions });
  });

  // 9. POST /api/v1/reconciliation/run — Trigger automated reconciliation
  server.post('/api/v1/reconciliation/run', async (req, res) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    // Audit successful orders against settlements
    const orders = poRepo.listByMerchant(merchantId, { limit: 100, status: 'SUCCESS' });
    let matched = 0;
    let discrepancies = 0;

    const run = reconRepo.createRun({
      merchantId,
      providerName: 'CASHFREE',
      periodStart: new Date(Date.now() - 30 * 86400000).toISOString(),
      periodEnd: new Date().toISOString(),
      totalOrdersChecked: orders.length,
      status: 'PROCESSING'
    });

    for (const order of orders) {
      if (!order.bank_reference) {
        discrepancies++;
        reconRepo.recordException({
          runId: run.id,
          merchantId,
          paymentOrderId: order.id,
          providerOrderId: order.provider_order_id,
          exceptionType: 'MISSING_UTR',
          expectedValue: 'Valid 12-digit UTR',
          actualValue: 'NULL'
        });
      } else {
        matched++;
      }
    }

    db.execute(
      `UPDATE reconciliation_runs SET total_matched = $1, total_discrepancies = $2, status = 'COMPLETED' WHERE id = $3`,
      [matched, discrepancies, run.id]
    );

    return HttpServer.json(res, 200, {
      runId: run.id,
      totalChecked: orders.length,
      matched,
      discrepancies,
      status: 'COMPLETED'
    });
  });

  // 10. POST /api/v1/reconciliation/exceptions/:id/resolve
  server.post('/api/v1/reconciliation/exceptions/:id/resolve', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    let body;
    try {
      body = await HttpServer.parseBody(req);
    } catch {
      body = {};
    }

    const resolved = reconRepo.resolveException(params.id, body.notes || 'Manually resolved by operator');
    return HttpServer.json(res, 200, { success: true, exception: resolved });
  });

  // --- DOWNLOADABLE REPORTS ---

  // 11. GET /api/v1/reports/:type (collections, payouts, settlements, audit)
  server.get('/api/v1/reports/:type', async (req, res, params) => {
    const merchantId = getMerchantId(req);
    if (!merchantId) return HttpServer.json(res, 401, { error: 'Unauthorized' });

    const type = params.type.toLowerCase();
    const parsedUrl = new URL(req.url, 'http://localhost');
    const format = parsedUrl.searchParams.get('format') || 'json';

    let data = [];
    if (type === 'collections') {
      data = poRepo.listByMerchant(merchantId, { limit: 500 });
    } else if (type === 'payouts') {
      data = db.query(`SELECT * FROM payouts WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 500`, [merchantId]);
    } else if (type === 'settlements') {
      data = settlementRepo.listByMerchant(merchantId, { limit: 500 });
    } else {
      data = db.query(`SELECT * FROM audit_logs WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 500`, [merchantId]);
    }

    if (format === 'csv') {
      if (data.length === 0) {
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename=${type}_report.csv` });
        return res.end('no_data\n');
      }
      const headers = Object.keys(data[0]);
      const csvLines = [headers.join(',')];
      for (const row of data) {
        const line = headers.map(h => {
          const val = row[h] === null || row[h] === undefined ? '' : String(row[h]);
          return `"${val.replace(/"/g, '""')}"`;
        }).join(',');
        csvLines.push(line);
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename=${type}_report_${Date.now()}.csv`
      });
      return res.end(csvLines.join('\n'));
    }

    return HttpServer.json(res, 200, { reportType: type, count: data.length, records: data });
  });
}
