import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import {BlockList,isIP} from 'node:net';
import {validateOutboundWebhookUrl} from './secrets.js';

const blocked=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(ip,bits,'ipv4');
for(const [ip,bits] of [['::',96],['100::',64],['2001:db8::',32],['fc00::',7],['fe80::',10],['ff00::',8]])blocked.addSubnet(ip,bits,'ipv6');
blocked.addAddress('::1','ipv6');
export function publicIp(address){const family=isIP(address);return Boolean(family)&&!blocked.check(address,family===6?'ipv6':'ipv4');}

// DNS is checked inside the connection lookup, so validation and connection cannot resolve differently.
export function fetchPublic(urlValue,options={}){
 const checked=validateOutboundWebhookUrl(String(urlValue));if(!checked.valid)return Promise.reject(Error(checked.error));
 const url=checked.url,allowPrivate=process.env.YOUPI_ALLOW_PRIVATE_WEBHOOKS==='true',host=url.hostname.replace(/^\[|\]$/g,'');
 if(isIP(host)&&!allowPrivate&&!publicIp(host))return Promise.reject(Error('Private/reserved destination refused'));
 return new Promise((resolve,reject)=>{
  const request=(url.protocol==='https:'?https:http).request(url,{method:options.method||'GET',headers:options.headers,signal:options.signal,agent:false,
   lookup(hostname,settings,callback){dns.lookup(hostname,{all:true,verbatim:true},(error,addresses)=>{
    if(error)return callback(error);
    if(!addresses.length||(!allowPrivate&&addresses.some(item=>!publicIp(item.address))))return callback(Error('DNS resolved to a private/reserved destination'));
    if(settings.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);
   });}
  },response=>{
   const chunks=[];let length=0;
   response.on('data',chunk=>{length+=chunk.length;if(length>(options.maxResponseBytes||1024*1024)){request.destroy(Error('Upstream response too large'));return;}chunks.push(chunk);});
   response.on('error',reject);response.on('aborted',()=>reject(Error('Upstream response interrupted')));
   response.on('end',()=>{const body=Buffer.concat(chunks).toString('utf8'),status=response.statusCode;resolve({status,ok:status>=200&&status<300,headers:response.headers,text:async()=>body,json:async()=>JSON.parse(body)});});
  });
  request.on('error',reject);request.setTimeout(options.timeoutMs||10000,()=>request.destroy(Error('Upstream request timed out')));
  if(options.body!==undefined)request.write(options.body);request.end();
 });
}
