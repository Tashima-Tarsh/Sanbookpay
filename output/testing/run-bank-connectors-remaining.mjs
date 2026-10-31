import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('scripts/test-all.js','utf8');
const files=[...source.matchAll(/'([^']+\.test\.js)'/g)].map(m=>m[1]);
const failed='apps/payment-api/src/__tests__/whatsapp-berry-auth.test.js';
const selected=[...new Set([...files.slice(files.indexOf(failed)+1),'apps/payment-api/src/__tests__/payment-api.test.js','apps/payment-api/src/__tests__/counter-payments.test.js','apps/checkout-portal/src/__tests__/checkout-interactions.test.js'])];
const env={...process.env,NODE_ENV:'test',YOUPI_MODE:'localhost',ENCRYPTION_MASTER_KEY:crypto.randomBytes(32).toString('hex'),JWT_SECRET:crypto.randomBytes(32).toString('hex'),INITIAL_ADMIN_EMAIL:'admin@example.test',INITIAL_ADMIN_PASSWORD:crypto.randomBytes(24).toString('hex'),BASE_CHECKOUT_URL:'http://localhost:7000',BASE_PAYMENT_API_URL:'http://localhost:6100',SQLITE_DB_PATH:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'bank-connectors-tests-')),'test.sqlite')};
const report=JSON.parse(fs.readFileSync('output/testing/bank-connectors-regression-results.json','utf8'));
for(const file of selected){
 const started=Date.now(),result=spawnSync(process.execPath,['--test','--test-reporter=tap',file],{env,encoding:'utf8'});
 const passed=result.status===0&&!/^\s*not ok\b/m.test(result.stdout||'');
 const row={file,passed,durationSeconds:(Date.now()-started)/1000,tests:Number(result.stdout?.match(/^# tests (\d+)/m)?.[1]||0),testFailures:Number(result.stdout?.match(/^# fail (\d+)/m)?.[1]||0)};
 const index=report.suites.findIndex(s=>s.file===file);if(index>=0)report.suites[index]=row;else report.suites.push(row);
 console.log((passed?'PASS ':'FAIL ')+file);if(!passed)console.log(result.stdout,result.stderr);
 report.completed=report.suites.length;report.passedSuites=report.suites.filter(s=>s.passed).length;report.totalTests=report.suites.reduce((n,s)=>n+s.tests,0);report.testedAt=new Date().toISOString();
 fs.writeFileSync('output/testing/bank-connectors-regression-results.json',JSON.stringify(report,null,2));
}
console.log(JSON.stringify({completed:report.completed,passedSuites:report.passedSuites,totalTests:report.totalTests,failed:report.suites.filter(s=>!s.passed).map(s=>s.file)}));
if(report.suites.some(s=>!s.passed&&s.file!==failed))process.exitCode=1;
