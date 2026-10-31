import {Worker,MessageChannel,receiveMessageOnPort} from 'node:worker_threads';

/** Preserve the repository's synchronous transaction boundary on a dedicated PG I/O thread. */
export class PostgresDatabase {
 constructor(connectionString){
  const {port1,port2}=new MessageChannel();this.port=port1;this.control=new Int32Array(new SharedArrayBuffer(4));
  this.worker=new Worker(new URL('./postgres-worker.js',import.meta.url),{workerData:{connectionString,port:port2,control:this.control.buffer},transferList:[port2]});
  this.worker.on('error',()=>{this.failed=true;});this.worker.unref();this.port.unref();
  this.dialect='postgres';
  this.exec(`CREATE OR REPLACE FUNCTION datetime(value text) RETURNS text LANGUAGE SQL AS $$ SELECT to_char((CASE WHEN value='now' THEN now() ELSE value::timestamptz END) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') $$;
CREATE OR REPLACE FUNCTION datetime(value text, modifier text) RETURNS text LANGUAGE SQL AS $$ SELECT to_char(((CASE WHEN value='now' THEN now() ELSE value::timestamptz END)+modifier::interval) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') $$;
CREATE OR REPLACE FUNCTION json_extract(value text, json_path text) RETURNS text LANGUAGE SQL IMMUTABLE AS $$ SELECT value::jsonb #>> string_to_array(substr(json_path,3),'.') $$;`);
 }
 request(sql,params=[],action='query'){
  if(this.failed)throw Error('Postgres connection is unavailable; restart required');
  Atomics.store(this.control,0,0);this.port.postMessage({sql,params,action});
  if(Atomics.wait(this.control,0,0,30000)==='timed-out'){this.failed=true;this.worker.terminate();throw Error('Postgres operation timed out; restart required');}
  const response=receiveMessageOnPort(this.port)?.message;
  if(!response){this.failed=true;throw Error('Postgres response unavailable');}
  if(response.error){const error=Error(response.error.code==='23505'?'UNIQUE constraint failed: '+response.error.message:response.error.message);error.code=response.error.code;throw error;}
  return response.value;
 }
 normalizeSql(sql){
  let index=0;
  let value=sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|\?/g,token=>token==='?'?'$'+(++index):token);
  if(/\bINSERT\s+OR\s+IGNORE\b/i.test(value))value=value.replace(/\bINSERT\s+OR\s+IGNORE\b/i,'INSERT').replace(/;?\s*$/,' ON CONFLICT DO NOTHING');
  return value.replace(/BEGIN IMMEDIATE/gi,'BEGIN');
 }
 prepareSchema(sql){
  const statements=sql.replace(/--[^\n]*/g,'').split(';').map(value=>value.trim()).filter(Boolean);
  const tables=statements.filter(value=>/^CREATE TABLE/i.test(value));const other=statements.filter(value=>!/^CREATE TABLE/i.test(value));
  const tableName=value=>/^CREATE TABLE(?: IF NOT EXISTS)?\s+"?(\w+)"?/i.exec(value)[1];
  const names=new Set(tables.map(tableName));const created=new Set(),ordered=[];
  while(tables.length){
   const index=tables.findIndex(value=>{const own=tableName(value);return [...value.matchAll(/REFERENCES\s+"?(\w+)"?/gi)].every(match=>match[1]===own||!names.has(match[1])||created.has(match[1]));});
   if(index<0)throw Error('Circular schema dependencies require an explicit migration');
   const statement=tables.splice(index,1)[0];created.add(tableName(statement));ordered.push(statement);
  }
  return ([...ordered,...other].join(';\n')+';').replace(/\bINTEGER\b/g,'BIGINT');
 }
 query(sql,params=[]){
  const pragma=/^\s*PRAGMA table_info\((\w+)\)/i.exec(sql);
  if(pragma)return this.request(`SELECT ordinal_position-1 AS cid,column_name AS name,data_type AS type,CASE WHEN is_nullable='NO' THEN 1 ELSE 0 END AS "notnull",column_default AS dflt_value FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position`,[pragma[1]]).rows;
  if(/sqlite_master/i.test(sql))return this.request("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='merchants'").rows;
  return this.request(this.normalizeSql(sql),params).rows;
 }
 queryOne(sql,params=[]){return this.query(sql,params)[0]??null;}
 execute(sql,params=[]){const result=this.request(this.normalizeSql(sql),params);return {changes:result.rowCount,lastInsertRowid:0};}
 run(sql,params=[]){return this.execute(sql,params);}
 exec(sql){if(/^\s*PRAGMA\b/i.test(sql))return;return this.request(this.normalizeSql(sql));}
 transaction(callback){this.exec('BEGIN ISOLATION LEVEL SERIALIZABLE');try{const result=callback();this.exec('COMMIT');return result;}catch(error){try{this.exec('ROLLBACK');}catch{}throw error;}}
 close(){try{this.request('',[],'close');}finally{this.port.close();this.worker.terminate();}}
}
