import crypto from 'node:crypto';

// Explicit history tables only. Unknown/configuration tables are preserved and checked.
export const HISTORY=new Set(`callback_delivery_attempts callback_outbox collection_events console_refund_requests console_split_transfers console_split_allocations diagnostic_logs failover_events idempotency_keys incident_reports ledger_entries ledger_transactions manual_payment_references operational_alerts payment_attempts payment_observations payment_orders payment_receipts payment_sessions payout_approvals payout_events payouts pp_api_requests pp_api_windows pp_request_claims pp_velocity pp_case_events pp_cases pp_credit_notes pp_finance_audit pp_invoice_usage pp_invoices pp_payment_attempts pp_provider_events pp_receiver_events pp_receiver_reference_claims pp_receiver_pairings pp_wallet_fulfillments pp_external_collections pp_banking_events provider_payment_claims provider_webhook_deliveries reconciliation_exceptions reconciliation_runs refunds reversals settlement_entries settlements split_settlement_entries support_tickets ticket_messages upi_mirror_observations wallet_transactions webhook_deliveries`.split(' '));
const quote=s=>'"'+s.replaceAll('"','""')+'"';

export function fingerprintRows(data,table){
 const rows=data.map(row=>{
  const copy={...row};
  if(table==='merchants'){
   const branding=JSON.parse(copy.branding||'{}');
   if(branding.upiChannel)branding.upiChannel.minAmountPaise=0;
   copy.branding=JSON.stringify(branding);
  }
  if(table==='pp_connection_policy')copy.min_paise=0;
  if(['ledger_accounts','gaming_wallets'].includes(table))copy.balance_paise=0;
  if(table==='payment_receiving_accounts'){copy.is_slot_busy=0;copy.current_active_session_id=null;}
  return JSON.stringify(copy);
 }).sort();
 return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
const fingerprint=(db,table)=>fingerprintRows(db.query('SELECT * FROM '+quote(table)),table);

export function cleanTransactionHistory(db) {
 if(db.dialect==='postgres')throw Error('Use the reviewed PostgreSQL maintenance procedure with a database backup');
 return db.transaction(()=>{
  const tables=db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(r=>r.name);
  const preserved=tables.filter(t=>!HISTORY.has(t));
  const before=Object.fromEntries(preserved.map(t=>[t,fingerprint(db,t)]));
  const remaining=new Set(tables.filter(t=>HISTORY.has(t))),deleted={};
  const parents=Object.fromEntries(tables.map(t=>[t,db.query('PRAGMA foreign_key_list('+quote(t)+')').map(f=>f.table)]));
  // Delete children before parents; never disable foreign keys or use cascading truncation.
  while(remaining.size){
   const leaf=[...remaining].find(t=>![...remaining].some(child=>child!==t&&parents[child].includes(t)));
   if(!leaf)throw Error('History dependency cycle requires explicit review');
   deleted[leaf]=Number(db.queryOne('SELECT COUNT(*) AS n FROM '+quote(leaf)).n);
   if(deleted[leaf])db.execute('DELETE FROM '+quote(leaf));remaining.delete(leaf);
  }
  if(tables.includes('merchants'))for(const row of db.query('SELECT id,branding FROM merchants')){
   const branding=JSON.parse(row.branding||'{}');
   if(branding.upiChannel){branding.upiChannel.minAmountPaise=0;db.execute('UPDATE merchants SET branding=? WHERE id=?',[JSON.stringify(branding),row.id]);}
  }
  if(tables.includes('pp_connection_policy'))db.execute('UPDATE pp_connection_policy SET min_paise=0');
  for(const table of ['ledger_accounts','gaming_wallets'])if(tables.includes(table))db.execute('UPDATE '+quote(table)+' SET balance_paise=0');
  if(tables.includes('payment_receiving_accounts'))db.execute('UPDATE payment_receiving_accounts SET is_slot_busy=0,current_active_session_id=NULL');
  for(const table of Object.keys(deleted))if(Number(db.queryOne('SELECT COUNT(*) AS n FROM '+quote(table)).n)!==0)throw Error('History table was repopulated during cleanup: '+table);
  for(const table of preserved)if(fingerprint(db,table)!==before[table])throw Error('Cleanup changed protected configuration or identity table: '+table);
  if(db.query('PRAGMA foreign_key_check').length)throw Error('Cleanup failed foreign-key integrity verification');
  return {deleted,preservedTables:preserved,minimumPaise:0,protectedDataVerified:true};
 });
}
