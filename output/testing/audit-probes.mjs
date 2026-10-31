import fs from 'node:fs';
import crypto from 'node:crypto';
import {Database,runMigrations,MerchantRepository,PaymentSessionRepository} from '../../packages/db/src/index.js';
import {WalletRepository} from '../../packages/db/src/repositories/wallet.repository.js';
import {initializePlatform} from '../../apps/payment-api/src/platform/schema.js';
import {registerCallbackWalletRoutes} from '../../apps/payment-api/src/routes/callback-wallet.routes.js';
import {authGuard} from '../../apps/payment-api/src/auth-guard.js';
import {SuperAdminRepository} from '../../packages/db/src/repositories/super-admin.repository.js';
import {HttpServer} from '../../apps/payment-api/src/server.js';
import {registerSuperAdminRoutes,superAdminGuard} from '../../apps/payment-api/src/routes/super-admin.routes.js';
import {registerPaymentLinkRoutes} from '../../apps/payment-api/src/routes/payment-link.routes.js';
process.env.NODE_ENV='test';
process.env.ENCRYPTION_MASTER_KEY=crypto.randomBytes(32).toString('hex');
const db=new Database({inMemory:true});
const warn=console.warn;console.warn=()=>{};
runMigrations(db);initializePlatform(db);console.warn=warn;
const admins=new SuperAdminRepository(db),merchants=new MerchantRepository(db);
const server=new HttpServer();
server.use(authGuard);
global.__sanbook_ctx={superAdminRepo:admins};
server.use(superAdminGuard);
registerSuperAdminRoutes(server,{db,superAdminRepo:admins,merchantRepo:merchants,auditRepo:{log(){}},mfaRepo:{}});
const sessionRepo=new PaymentSessionRepository(db),walletRepo=new WalletRepository(db);
const testMerchant=merchants.create({businessName:'Audit only',slug:'audit-only',contactEmail:'audit@example.test',contactPhone:'9000000000'});
const testSession=sessionRepo.create({merchantId:testMerchant.id,orderId:'audit-only-order',amountPaise:1200,status:'INITIATED'});
registerCallbackWalletRoutes(server,{db,sessionRepo,walletRepo});
const seen=[];
registerPaymentLinkRoutes(server,{
 db:{queryOne(){return {merchant_id:'audit-merchant',scopes:'["payments.read"]',environment:'SANDBOX',expires_at:'2000-01-01T00:00:00Z'};},transaction(fn){return fn();}},
 merchantRepo:{findById(){return {id:'audit-merchant',branding:{status:'ACTIVE'}};}},
 routingEngine:{selectRoute(){return {route:{id:'audit-route'},receivingAccount:{id:'audit-account',upiId:'audit@example',payeeName:'Audit'}};}},
 sessionRepo:{create(data){seen.push(data);return data;}},auditRepo:{log(){}}
});
const http=server.createServer();await new Promise(r=>http.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${http.address().port}`;
const call=async(path,body,token)=>fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
const results=[];
try{
 const unsigned=await call('/api/v1/callbacks/providers/audit',{orderId:'audit-only-order',status:'SUCCESS'});
 results.push({probe:'unsigned provider callback without amount or payment reference',status:unsigned.status,storedStatus:sessionRepo.findById(testSession.id).status,ledgerEntries:Number(db.queryOne('SELECT COUNT(*) AS n FROM ledger_entries').n)});await unsigned.text();
 const credit=await call('/api/v1/callbacks/wallets/credit',{merchantId:testMerchant.id,playerReference:'audit-player',amountPaise:5000,idempotencyKey:'audit-credit-1'});
 results.push({probe:'unauthenticated wallet credit without payment ID',status:credit.status,balance:walletRepo.findWalletByPlayer(testMerchant.id,'audit-player')?.balancePaise});await credit.text();
 const login=await call('/api/v1/super-admin/login',{email:'superadmin@sanbookpay.com',password:'SanbookPayAdmin_ChangeMe!'});
 const session=await login.json();results.push({probe:'fixed default password on clean database',status:login.status,sessionIssued:Boolean(session.token)});
 const enroll=await call('/api/v1/super-admin/mfa/enroll',{},session.token);results.push({probe:'MFA enrollment',status:enroll.status});await enroll.text();
 db.execute("UPDATE super_admin_users SET status='SUSPENDED' WHERE id=?",[session.admin.id]);
 const disabled=await call('/api/v1/super-admin/merchants',null,session.token);results.push({probe:'existing token after administrator suspended',status:disabled.status});await disabled.text();
 for(const amount of ['12junk',12]){
  const response=await call('/api/v1/payment-links/amount-only',{amount},'dp_test_audit');const body=await response.json();
  results.push({probe:'expired sandbox read-only key amount '+amount,status:response.status,amountPaise:body.amountPaise,paymentStatus:body.status,payableIntentReturned:Boolean(body.upiIntent)});
 }
}finally{await new Promise(r=>http.close(r));db.close();delete global.__sanbook_ctx;}
fs.writeFileSync(new URL('./audit-probes-results.json',import.meta.url),JSON.stringify({testedAt:new Date().toISOString(),scope:'isolated in-memory auth routes; dependency stubs for payment-link policy checks',results},null,2));
console.log(JSON.stringify(results,null,2));
