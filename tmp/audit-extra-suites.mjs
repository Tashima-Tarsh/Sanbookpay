import fs from 'node:fs';
const c=JSON.parse(fs.readFileSync('data/.secrets/render-postgres-connection.json','utf8'));
const u=new URL(c.externalConnectionString);
if(u.hostname!=='dpg-dbiop5142hec73b3bpq0-a.singapore-postgres.render.com'||u.pathname!=='/dynamo_pay')throw Error('Unexpected database');
process.env.HISTORY_POSTGRES_TEST_URL=u.toString();
await import('../packages/db/src/__tests__/sqlite_verify.test.js');
await import('../scripts/clean-postgres-history.test.js');
