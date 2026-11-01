import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { encrypt, decrypt } from '@youpi/common';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
export const gmailTokenPath=path.join(root,'data/.secrets/gmail-send.json');
const emailPattern=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
export const validEmail=value=>typeof value==='string'&&value.length<=254&&emailPattern.test(value);

export function notificationConfig(env=process.env) {
  let tokens={};
  if(!env.GMAIL_SEND_REFRESH_TOKEN&&env===process.env) {
    try{tokens=JSON.parse(fs.readFileSync(gmailTokenPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Unable to read private Gmail sending credentials');}
  }
  return {
    key:env.ENCRYPTION_MASTER_KEY,
    topic:env.NTFY_TOPIC||'',ntfyUrl:env.NTFY_BASE_URL||'https://ntfy.sh',ntfyToken:env.NTFY_TOKEN||'',
    smsUrl:env.SMS_GATEWAY_URL||'',smsUser:env.SMS_GATEWAY_USERNAME||'',smsPassword:env.SMS_GATEWAY_PASSWORD||'',
    clientId:env.GMAIL_SEND_CLIENT_ID||'',clientSecret:env.GMAIL_SEND_CLIENT_SECRET||'',
    refreshToken:env.GMAIL_SEND_REFRESH_TOKEN||tokens.refresh_token||'',from:env.GMAIL_SEND_FROM||''
  };
}

function endpoint(value, localOnly=false) {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Invalid notification server URL');
  const local=/^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname);
  if((localOnly&&!local)||(url.protocol==='http:'&&!local))throw new Error('Use a local network address for the phone gateway and HTTPS for public servers');
  return url.href.replace(/\/$/,'');
}

export class NotificationDeliveryService {
  constructor(db,options={}) {
    this.db=db;this.config=notificationConfig(options.env);this.fetch=options.fetch||globalThis.fetch;
    this.now=options.now||Date.now;this.gmailSend=options.gmailSend;this.running=false;this.stopped=false;
    db.execute(`CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY,payment_id TEXT NOT NULL,channel TEXT NOT NULL,payload TEXT,
      status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at BIGINT NOT NULL,
      lease_until BIGINT NOT NULL DEFAULT 0,claim_token TEXT,submitted_at TEXT,last_error TEXT,
      UNIQUE(payment_id,channel))`);
    db.execute('CREATE INDEX IF NOT EXISTS notification_deliveries_pending ON notification_deliveries(status,next_attempt_at)');
  }

  enqueue(receipt,{email,phone}={}) {
    // CustomerRepository stores Indian mobiles without +91 and may synthesize a login-only email.
    if(typeof phone==='string'&&/^[6-9]\d{9}$/.test(phone))phone='+91'+phone;
    if(typeof email==='string'&&/@customer\.youpi\.local$/i.test(email))email=undefined;
    const c=this.config,states={};
    const channels=[['push',Boolean(c.topic),true,{message:'Sanbook Pay: a new receipt is available. Sign in to view details.'}],
      ['email',Boolean(c.clientId&&c.clientSecret&&c.refreshToken&&validEmail(c.from)),validEmail(email),{to:email,subject:receipt.emailSubject,html:receipt.emailHtml}],
      ['sms',Boolean(c.smsUrl&&c.smsUser&&c.smsPassword),typeof phone==='string'&&/^\+[1-9]\d{7,14}$/.test(phone),{to:phone,message:receipt.smsMessage}]];
    for(const [channel,configured,valid,payload] of channels) {
      const field=channel==='push'?'pushStatus':`${channel}Status`;
      if(!configured){states[field]='NOT_CONFIGURED';continue;}
      if(!valid){states[field]=(channel==='email'?email:phone)?'INVALID_RECIPIENT':'NO_RECIPIENT';continue;}
      if(!/^[a-fA-F0-9]{64}$/.test(c.key||''))throw new Error('Notification delivery requires ENCRYPTION_MASTER_KEY');
      this.db.execute(`INSERT OR IGNORE INTO notification_deliveries(id,payment_id,channel,payload,status,next_attempt_at) VALUES(?,?,?,?,?,?)`,
        [crypto.randomUUID(),receipt.sessionId,channel,encrypt(JSON.stringify(payload),c.key),'PENDING',this.now()]);
      states[field]=this.db.queryOne('SELECT status FROM notification_deliveries WHERE payment_id=? AND channel=?',[receipt.sessionId,channel]).status;
    }
    return states;
  }

  async submit(job,payload) {
    const c=this.config;
    if(job.channel==='email') {
      if(!validEmail(payload.to)||!validEmail(c.from)||/[\r\n]/.test(payload.subject))throw Object.assign(new Error('Invalid email headers'),{permanent:true});
      const raw=Buffer.from([`From: ${c.from}`,`To: ${payload.to}`,`Subject: =?UTF-8?B?${Buffer.from(payload.subject).toString('base64')}?=`,
        `Message-ID: <${job.id}@sanbookpay.local>`,'MIME-Version: 1.0','Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(payload.html).toString('base64').match(/.{1,76}/g)?.join('\r\n')||''].join('\r\n')).toString('base64url');
      if(this.gmailSend)return this.gmailSend(raw);
      const auth=new google.auth.OAuth2(c.clientId,c.clientSecret);auth.setCredentials({refresh_token:c.refreshToken});
      await google.gmail({version:'v1',auth}).users.messages.send({userId:'me',requestBody:{raw}},{timeout:15000,retry:false});
      return;
    }
    let url,headers,body;
    if(job.channel==='push') {
      if(!/^[A-Za-z0-9_-]{1,128}$/.test(c.topic))throw Object.assign(new Error('Invalid ntfy topic'),{permanent:true});
      url=`${endpoint(c.ntfyUrl)}/${encodeURIComponent(c.topic)}`;
      headers={'Content-Type':'text/plain; charset=utf-8',...(c.ntfyToken?{Authorization:`Bearer ${c.ntfyToken}`}:{})};body=payload.message;
    } else {
      url=`${endpoint(c.smsUrl,true)}/message`;
      headers={'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(`${c.smsUser}:${c.smsPassword}`).toString('base64')};
      body=JSON.stringify({id:job.id,textMessage:{text:payload.message},phoneNumbers:[payload.to]});
    }
    const response=await this.fetch(url,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(15000)});
    await response.body?.cancel();
    if(!response.ok)throw Object.assign(new Error('Notification HTTP failure'),{status:response.status,permanent:response.status>=400&&response.status<500&&![408,429].includes(response.status)});
  }

  async processPending() {
    if(this.running||this.stopped)return;
    this.running=true;
    try {
      const now=this.now();
      const jobs=this.db.query(`SELECT * FROM notification_deliveries WHERE (status='PENDING' AND next_attempt_at<=?) OR (status='SENDING' AND lease_until<=?) ORDER BY next_attempt_at LIMIT 20`,[now,now]);
      for(const job of jobs) {
        if(this.stopped)break;
        const token=crypto.randomUUID(),claimed=this.db.execute(`UPDATE notification_deliveries SET status='SENDING',lease_until=?,claim_token=? WHERE id=? AND ((status='PENDING' AND next_attempt_at<=?) OR (status='SENDING' AND lease_until<=?))`,[this.now()+120000,token,job.id,this.now(),this.now()]);
        if(!Number(claimed.changes))continue;
        let status='SUBMITTED',error=null,submittedAt=new Date(this.now()).toISOString();
        try{await this.submit(job,JSON.parse(decrypt(job.payload,this.config.key)));}
        catch(failure){
          const code=Number(failure.status||failure.response?.status||0);
          status=failure.permanent||(code>=400&&code<500&&![408,429].includes(code))||job.attempts>=4?'FAILED':'PENDING';
          error=code?`HTTP_${code}`:'SUBMISSION_FAILED';submittedAt=null;
        }
        // Shutdown may close the database before an outstanding HTTP request returns.
        if(this.stopped)break;
        this.db.transaction(()=>{
          const result=this.db.execute(`UPDATE notification_deliveries SET status=?,attempts=attempts+1,next_attempt_at=?,lease_until=0,claim_token=NULL,submitted_at=?,last_error=?,payload=? WHERE id=? AND claim_token=?`,
            [status,this.now()+Math.min(3600000,30000*2**job.attempts),submittedAt,error,status==='SUBMITTED'||status==='FAILED'?null:job.payload,job.id,token]);
          if(!Number(result.changes))return;
          const stored=this.db.queryOne('SELECT receipt FROM payment_receipts WHERE payment_id=?',[job.payment_id]);
          if(stored){const receipt=JSON.parse(stored.receipt);receipt[job.channel==='push'?'pushStatus':`${job.channel}Status`]=status;if(submittedAt)receipt.dispatchedAt=submittedAt;this.db.execute('UPDATE payment_receipts SET receipt=? WHERE payment_id=?',[JSON.stringify(receipt),job.payment_id]);}
        });
      }
    }finally{this.running=false;}
  }

  start(){if(this.timer)return;this.stopped=false;this.timer=setInterval(()=>this.processPending().catch(()=>console.error('[Notifications] Worker failed; queued work retained')),5000);this.timer.unref?.();}
  stop(){this.stopped=true;clearInterval(this.timer);this.timer=null;}
}
