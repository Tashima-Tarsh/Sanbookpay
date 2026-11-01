import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { gmailTokenPath } from '../apps/payment-api/src/services/notification-delivery.service.js';

export async function startGmailAuthorization({clientId,clientSecret,port=4242,tokenPath=gmailTokenPath,createClient=(...args)=>new google.auth.OAuth2(...args)}) {
  if(!clientId||!clientSecret)throw new Error('Set GMAIL_SEND_CLIENT_ID and GMAIL_SEND_CLIENT_SECRET in the root .env first');
  const state=crypto.randomBytes(32).toString('hex');let client,busy=false,resolveDone,rejectDone;
  const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
  // Attach immediately so a timeout without a consumer cannot cause an unhandled rejection.
  done.catch(()=>{});
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method!=='GET'||url.pathname!=='/'||url.searchParams.get('state')!==state){res.writeHead(400);res.end('Invalid OAuth callback state. Return to the original consent link.');return;}
    if(url.searchParams.has('error')){res.writeHead(400);res.end('Authorization was declined.');finish(new Error('Authorization declined'));return;}
    if(busy||!url.searchParams.get('code')){res.writeHead(400);res.end('Missing or already consumed authorization code.');return;}
    busy=true;
    try {
      const {tokens}=await client.getToken(url.searchParams.get('code'));
      if(!tokens.refresh_token)throw new Error('No refresh token');
      const granted=tokens.scope?.split(' ')||[];
      if(granted.length&&(!granted.includes('https://www.googleapis.com/auth/gmail.send')||granted.some(scope=>scope!=='https://www.googleapis.com/auth/gmail.send')))throw new Error('Unexpected OAuth scopes');
      fs.mkdirSync(path.dirname(tokenPath),{recursive:true,mode:0o700});
      const temp=tokenPath+'.'+crypto.randomUUID()+'.tmp';
      fs.writeFileSync(temp,JSON.stringify({refresh_token:tokens.refresh_token})+'\n',{mode:0o600,flag:'wx'});
      fs.renameSync(temp,tokenPath);fs.chmodSync(tokenPath,0o600);
      res.writeHead(200);res.end('Gmail sending authorized. Credentials saved privately. You can close this tab.');finish();
    } catch {res.writeHead(502);res.end('Gmail token exchange or private credential storage failed. Run gmail-auth again.');finish(new Error('Token exchange failed; no authorization success claimed'));}
  });
  let timeout;
  function finish(error){clearTimeout(timeout);server.close();if(error)rejectDone(error);else resolveDone();}
  server.on('error',error=>finish(error));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const redirectUri=`http://127.0.0.1:${server.address().port}/`;
  client=createClient(clientId,clientSecret,redirectUri);
  const authUrl=client.generateAuthUrl({access_type:'offline',scope:['https://www.googleapis.com/auth/gmail.send'],prompt:'consent',include_granted_scopes:false,state});
  timeout=setTimeout(()=>finish(new Error('Authorization timed out after 10 minutes')),600000);timeout.unref();
  return {server,authUrl,redirectUri,done};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const envPath=fileURLToPath(new URL('../.env',import.meta.url));if(fs.existsSync(envPath))process.loadEnvFile(envPath);
    const flow=await startGmailAuthorization({clientId:process.env.GMAIL_SEND_CLIENT_ID,clientSecret:process.env.GMAIL_SEND_CLIENT_SECRET});
    console.log('Open this consent URL on this computer:\n'+flow.authUrl);
    console.log('Waiting on '+flow.redirectUri+' (10 minutes). No refresh token will be printed.');
    await flow.done;console.log('Gmail sending is connected. Restart the API to load the saved credential.');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
