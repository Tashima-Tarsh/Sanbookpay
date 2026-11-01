import fs from 'node:fs';
import pg from 'pg';
const config=JSON.parse(fs.readFileSync('data/.secrets/render-postgres-connection.json','utf8'));
const url=new URL(config.externalConnectionString);
if(url.hostname!=='dpg-dbiop5142hec73b3bpq0-a.singapore-postgres.render.com'||url.pathname!=='/dynamo_pay')throw Error('Unexpected database');
url.searchParams.delete('sslmode');
const db=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:true}});await db.connect();
try{
 await db.query('BEGIN READ ONLY');const out={checkedAt:new Date().toISOString(),access:'read-only aggregate queries'};
 for(const t of ['merchants','pp_merchants','pp_api_keys','provider_connections','pp_receiver_devices','pp_receiver_policies','pp_receiver_events','android_devices','payment_sessions','webhook_deliveries']){
  const present=(await db.query('SELECT to_regclass($1) AS n',[t])).rows[0].n;
  if(present)out[t]=Number((await db.query('SELECT COUNT(*) AS n FROM '+t)).rows[0].n);
 }
 out.merchantStates=(await db.query('SELECT status,COUNT(*) AS count FROM pp_merchants GROUP BY status')).rows;
 out.activeNotificationPolicies=Number((await db.query('SELECT COUNT(*) AS n FROM pp_receiver_policies WHERE auto_success=1')).rows[0].n);
 out.activeDevices=Number((await db.query('SELECT COUNT(*) AS n FROM android_devices WHERE is_active=1')).rows[0].n);
 await db.query('ROLLBACK');fs.writeFileSync('output/testing/production-audit-database-2026-11-01.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
}finally{await db.end();}
