import test from 'node:test';
import assert from 'node:assert/strict';
import {Database,runMigrations,MerchantRepository,PaymentSessionRepository,PaymentOrderRepository,LedgerRepository,WalletRepository} from '@youpi/db';
import {cleanTransactionHistory} from './clean-transaction-history.js';

test('history cleanup empties payments and balances while preserving accounts and keys',()=>{
 const db=new Database({inMemory:true});runMigrations(db);
 try{
  const merchants=new MerchantRepository(db),merchant=merchants.getDefault();
  merchants.update(merchant.id,{branding:{upiChannel:{enabled:true,minAmountPaise:20000,maxAmountPaise:2000000,allowedVpas:['merchant@bank']}}});
  const session=new PaymentSessionRepository(db).create({merchantId:merchant.id,orderId:'old-order',amountPaise:20100,status:'ACTIVE'});
  const order=new PaymentOrderRepository(db).create({merchantId:merchant.id,merchantOrderId:'old-provider',amountPaise:20100});
  new LedgerRepository(db).recordDoubleEntry(merchant.id,'COLLECTION',order.id,'Test posting','PROVIDER_CLEARING','MERCHANT_RECEIVABLES',20100);
  new WalletRepository(db).createWallet({merchantId:merchant.id,playerReference:'preserve-player',balancePaise:20100});
  db.execute("CREATE TABLE pp_api_keys(id TEXT PRIMARY KEY,secret_hash TEXT)");db.execute("INSERT INTO pp_api_keys VALUES('key','keep-hash')");
  const result=cleanTransactionHistory(db);
  for(const table of ['payment_sessions','payment_orders','ledger_entries','ledger_transactions'])assert.equal(Number(db.queryOne(`SELECT COUNT(*) AS n FROM ${table}`).n),0,table);
  assert.equal(db.queryOne('SELECT secret_hash FROM pp_api_keys').secret_hash,'keep-hash');
  assert.equal(Number(db.queryOne('SELECT balance_paise FROM gaming_wallets').balance_paise),0);
  assert.equal(Number(db.queryOne('SELECT SUM(balance_paise) AS n FROM ledger_accounts').n),0);
  const channel=merchants.findById(merchant.id).branding.upiChannel;assert.equal(channel.minAmountPaise,0);assert.equal(channel.maxAmountPaise,2000000);assert.deepEqual(channel.allowedVpas,['merchant@bank']);
  assert.equal(merchants.findById(merchant.id).webhookSecret,merchant.webhookSecret);assert.ok(result.deleted.payment_sessions>=1);
  assert.equal(db.query('PRAGMA foreign_key_check').length,0);
 }finally{db.close();}
});

test('cleanup rolls back if an unrecognized dependent table would lose protected data',()=>{
 const db=new Database({inMemory:true});runMigrations(db);
 try{
  const mid=new MerchantRepository(db).getDefault().id;
  const session=new PaymentSessionRepository(db).create({merchantId:mid,orderId:'preserve-unrecognized',amountPaise:100});
  db.execute('CREATE TABLE protected_notes(id TEXT PRIMARY KEY,payment_id TEXT REFERENCES payment_sessions(id) ON DELETE CASCADE)');
  db.execute('INSERT INTO protected_notes VALUES(?,?)',['keep',session.id]);
  assert.throws(()=>cleanTransactionHistory(db),/protected configuration or identity/);
  assert.equal(Number(db.queryOne('SELECT COUNT(*) AS n FROM payment_sessions').n),1);
  assert.equal(Number(db.queryOne('SELECT COUNT(*) AS n FROM protected_notes').n),1);
 }finally{db.close();}
});
