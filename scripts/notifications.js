import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Database, runMigrations } from '@youpi/db';
import { NotificationDeliveryService, notificationConfig } from '../apps/payment-api/src/services/notification-delivery.service.js';

const envPath=fileURLToPath(new URL('../.env',import.meta.url));
const {values}=parseArgs({options:{setup:{type:'boolean'},test:{type:'boolean'},email:{type:'string'},phone:{type:'string'}}});
if(fs.existsSync(envPath))process.loadEnvFile(envPath);
if(values.setup){
  let contents=fs.existsSync(envPath)?fs.readFileSync(envPath,'utf8'):'';
  const defaults={NTFY_BASE_URL:'https://ntfy.sh',NTFY_TOPIC:'sanbookpay-'+crypto.randomBytes(24).toString('hex'),NTFY_TOKEN:'',GMAIL_SEND_CLIENT_ID:'',GMAIL_SEND_CLIENT_SECRET:'',GMAIL_SEND_FROM:'',SMS_GATEWAY_URL:'',SMS_GATEWAY_USERNAME:'',SMS_GATEWAY_PASSWORD:''};
  const additions=Object.entries(defaults).filter(([name])=>!new RegExp(`^${name}=`,'m').test(contents)).map(([name,value])=>`${name}=${value}`);
  if(additions.length){fs.appendFileSync(envPath,'\n# Outgoing local notifications\n'+additions.join('\n')+'\n',{mode:0o600});process.loadEnvFile(envPath);}
}
const c=notificationConfig();
console.log(JSON.stringify({push:c.topic?'CONFIGURED':'MISSING_TOPIC',email:c.clientId&&c.clientSecret&&c.refreshToken&&c.from?'CONFIGURED':'NEEDS_SENDER_CLIENT_AND_CONSENT',sms:c.smsUrl&&c.smsUser&&c.smsPassword?'CONFIGURED':'NEEDS_PHONE_LOCAL_URL_AND_CREDENTIALS',encryption:/^[a-fA-F0-9]{64}$/.test(c.key||'')?'CONFIGURED':'MISSING_MASTER_KEY'},null,2));
if(values.test){
  // Isolated test jobs never touch real payment records or the live delivery queue.
  const db=new Database({inMemory:true});
  runMigrations(db);
  const service=new NotificationDeliveryService(db);
  try{
    const statuses=service.enqueue({sessionId:'owner-test-'+crypto.randomUUID(),emailSubject:'Sanbook Pay notification test',emailHtml:'<p>This is an owner-requested notification test. No payment occurred.</p>',smsMessage:'Sanbook Pay notification test. No payment occurred.'},{email:values.email,phone:values.phone});
    console.log('Test channels:',JSON.stringify(statuses));await service.processPending();
    const results=db.query('SELECT channel,status,last_error FROM notification_deliveries');console.log(JSON.stringify(results,null,2));
    const requested=[...(c.topic?['push']:[]),...(values.email!==undefined?['email']:[]),...(values.phone!==undefined?['sms']:[])];
    if(!requested.length||requested.some(channel=>!results.some(row=>row.channel===channel&&row.status==='SUBMITTED')))process.exitCode=1;
  } finally {service.stop();db.close();}
}
