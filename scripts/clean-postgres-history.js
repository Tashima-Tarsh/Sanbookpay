import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {HISTORY,fingerprintRows} from './clean-transaction-history.js';

const quote=s=>'"'+s.replaceAll('"','""')+'"';

// Caller verifies the exact database connection. No migrations, CASCADE or credential changes.
export async function cleanPostgresHistory(client,{schema='public',backupPath}){
 if(!path.isAbsolute(backupPath)||fs.existsSync(backupPath))throw Error('A new absolute private backup path is required');
 const table=t=>quote(schema)+'.'+quote(t),q=(sql,args=[])=>client.query(sql,args);
 await q('BEGIN ISOLATION LEVEL SERIALIZABLE');
 try{
  await q("SET LOCAL lock_timeout='10s'");
  const tables=(await q("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name",[schema])).rows.map(r=>r.table_name);
  if(!tables.includes('merchants'))throw Error('Expected application merchant table is missing');
  await q('LOCK TABLE '+tables.map(table).join(',')+' IN ACCESS EXCLUSIVE MODE');
  const snapshot={version:1,schema,createdAt:new Date().toISOString(),database:(await q('SELECT current_database() AS name')).rows[0].name,tables:{}};
  for(const name of tables)snapshot.tables[name]=(await q('SELECT row_to_json(t)::text AS row FROM '+table(name)+' t')).rows.map(r=>r.row);
  fs.mkdirSync(path.dirname(backupPath),{recursive:true,mode:0o700});
  const bytes=JSON.stringify(snapshot),fd=fs.openSync(backupPath,'wx',0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const restored=JSON.parse(fs.readFileSync(backupPath,'utf8'));
  // Validate every saved row can be reconstructed with the unchanged PostgreSQL row type.
  for(const name of tables){
   const restoredRows=(await q('SELECT row_to_json(t)::text AS row FROM json_populate_recordset(NULL::'+table(name)+',$1::json) t',['['+restored.tables[name].join(',')+']'])).rows.map(r=>r.row).sort();
   if(JSON.stringify(restoredRows)!==JSON.stringify([...snapshot.tables[name]].sort()))throw Error('Backup row round-trip verification failed: '+name);
  }
  const protectedTables=tables.filter(t=>!HISTORY.has(t));
  const before=Object.fromEntries(protectedTables.map(t=>[t,fingerprintRows(snapshot.tables[t].map(JSON.parse),t)]));
  const edges=(await q(`SELECT child.relname AS child,parent.relname AS parent FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_namespace n ON n.oid=child.relnamespace JOIN pg_class parent ON parent.oid=c.confrelid WHERE c.contype='f' AND n.nspname=$1`,[schema])).rows;
  const remaining=new Set(tables.filter(t=>HISTORY.has(t))),deleted={};
  while(remaining.size){
   const leaf=[...remaining].find(t=>!edges.some(e=>e.parent===t&&e.child!==t&&remaining.has(e.child)));
   if(!leaf)throw Error('History dependency cycle requires explicit review');
   deleted[leaf]=snapshot.tables[leaf].length;if(deleted[leaf])await q('DELETE FROM '+table(leaf));remaining.delete(leaf);
  }
  for(const raw of snapshot.tables.merchants){const row=JSON.parse(raw),branding=JSON.parse(row.branding||'{}');if(branding.upiChannel){branding.upiChannel.minAmountPaise=0;await q('UPDATE '+table('merchants')+' SET branding=$1 WHERE id=$2',[JSON.stringify(branding),row.id]);}}
  if(tables.includes('pp_connection_policy'))await q('UPDATE '+table('pp_connection_policy')+' SET min_paise=0');
  for(const t of ['ledger_accounts','gaming_wallets'])if(tables.includes(t))await q('UPDATE '+table(t)+' SET balance_paise=0');
  if(tables.includes('payment_receiving_accounts'))await q('UPDATE '+table('payment_receiving_accounts')+' SET is_slot_busy=0,current_active_session_id=NULL');
  for(const t of Object.keys(deleted))if(Number((await q('SELECT COUNT(*) AS n FROM '+table(t))).rows[0].n)!==0)throw Error('History was repopulated: '+t);
  for(const t of protectedTables){const rows=(await q('SELECT row_to_json(t)::text AS row FROM '+table(t)+' t')).rows.map(r=>JSON.parse(r.row));if(fingerprintRows(rows,t)!==before[t])throw Error('Protected table changed: '+t);}
  await q('COMMIT');
  return {deleted,preservedTables:protectedTables,protectedDataVerified:true,backupRoundTripVerified:true,backupSha256:crypto.createHash('sha256').update(bytes).digest('hex'),minimumPaise:0};
 }catch(error){await q('ROLLBACK');throw error;}
}
