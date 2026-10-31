import {workerData} from 'node:worker_threads';
import pg from 'pg';

pg.types.setTypeParser(20,value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw Error('Database integer exceeds safe precision');return n;});
const {port,control,connectionString}=workerData;
const signal=new Int32Array(control);
const host=new URL(connectionString).hostname;
const internal=process.env.RENDER==='true'&&host.startsWith('dpg-')&&!host.includes('.');
const client=new pg.Client({connectionString,ssl:internal||['localhost','127.0.0.1'].includes(host)?false:{rejectUnauthorized:true},application_name:'dynamo-pay',connectionTimeoutMillis:15000,statement_timeout:20000});
const connected=client.connect();connected.catch(()=>{});client.on('error',()=>{});
port.on('message',async request=>{
 let response;
 try{
  await connected;
  if(request.action==='close'){await client.end();response={value:true};}
  else{const result=await client.query(request.sql,request.params||[]);response={value:Array.isArray(result)?{rows:[],rowCount:0}:{rows:result.rows,rowCount:result.rowCount}};}
 }catch(error){response={error:{message:error.message,code:error.code}};}
 port.postMessage(response);Atomics.store(signal,0,1);Atomics.notify(signal,0);
});
