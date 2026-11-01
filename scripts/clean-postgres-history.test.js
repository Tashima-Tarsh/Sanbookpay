import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {cleanPostgresHistory} from './clean-postgres-history.js';

test('PostgreSQL history cleanup verifies its backup and preserves protected rows',{skip:!process.env.HISTORY_POSTGRES_TEST_URL},async()=>{
 const url=new URL(process.env.HISTORY_POSTGRES_TEST_URL);url.searchParams.delete('sslmode');
 const client=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:30000});
 const schema='sanbook_cleanup_test_'+crypto.randomBytes(8).toString('hex');
 assert.match(schema,/^sanbook_cleanup_test_[a-f0-9]{16}$/);
 await client.connect();
 try{
  await client.query('CREATE SCHEMA '+schema);
  await client.query(`CREATE TABLE ${schema}.merchants(id TEXT PRIMARY KEY,branding TEXT);CREATE TABLE ${schema}.pp_api_keys(id TEXT PRIMARY KEY,secret_hash TEXT);CREATE TABLE ${schema}.payment_sessions(id TEXT PRIMARY KEY,merchant_id TEXT REFERENCES ${schema}.merchants(id));CREATE TABLE ${schema}.payment_orders(id TEXT PRIMARY KEY,session_id TEXT REFERENCES ${schema}.payment_sessions(id));CREATE TABLE ${schema}.gaming_wallets(id TEXT PRIMARY KEY,balance_paise BIGINT);`);
  await client.query(`INSERT INTO ${schema}.merchants VALUES('merchant','{"upiChannel":{"minAmountPaise":20000,"maxAmountPaise":2000000}}');INSERT INTO ${schema}.pp_api_keys VALUES('key','preserve-hash');INSERT INTO ${schema}.payment_sessions VALUES('session','merchant');INSERT INTO ${schema}.payment_orders VALUES('order','session');INSERT INTO ${schema}.gaming_wallets VALUES('wallet',20100);`);
  const backupPath=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'sanbook-pg-cleanup-test-')),'backup.json');
  const result=await cleanPostgresHistory(client,{schema,backupPath});
  assert.equal(result.backupRoundTripVerified,true);assert.equal(result.protectedDataVerified,true);
  assert.equal((await client.query('SELECT COUNT(*) AS n FROM '+schema+'.payment_sessions')).rows[0].n,'0');
  assert.equal((await client.query('SELECT secret_hash FROM '+schema+'.pp_api_keys')).rows[0].secret_hash,'preserve-hash');
  assert.equal((await client.query('SELECT balance_paise FROM '+schema+'.gaming_wallets')).rows[0].balance_paise,'0');
  assert.equal(JSON.parse((await client.query('SELECT branding FROM '+schema+'.merchants')).rows[0].branding).upiChannel.minAmountPaise,0);
 }finally{await client.query('ROLLBACK');await client.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await client.end();}
});
