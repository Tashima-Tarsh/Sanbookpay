import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {PostgresDatabase} from '../packages/db/src/postgres-database.js';
import {validHostedFile} from './postgres-bootstrap.js';

if(!process.env.MIGRATION_DATABASE_URL)throw Error('Set MIGRATION_DATABASE_URL privately before migration');
const root=process.cwd(),snapshot=path.join(root,'data/backups',`before-render-${Date.now()}.sqlite`);
fs.mkdirSync(path.dirname(snapshot),{recursive:true,mode:0o700});
const live=new DatabaseSync(path.join(root,'data/youpi_pg.sqlite'),{readOnly:true});await backup(live,snapshot);live.close();
const source=new DatabaseSync(snapshot,{readOnly:true}),target=new PostgresDatabase(process.env.MIGRATION_DATABASE_URL);
const quote=name=>{if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))throw Error('Invalid database identifier');return '"'+name+'"';};
try{
 if(source.prepare('PRAGMA foreign_key_check').all().length)throw Error('Source foreign-key integrity check failed');
 if(target.queryOne("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('merchants','hosted_files')").n)throw Error('Target already contains application data; refusing to overwrite it');
 const definitions=source.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL").all();
 const ordered=target.prepareSchema(definitions.map(row=>row.sql+';').join('\n'));
 const names=[...ordered.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+"?(\w+)"?/gi)].map(match=>match[1]);
 const report=[];
 target.transaction(()=>{
  target.exec(ordered);
  for(const table of names){
   const columns=source.prepare(`PRAGMA table_info(${quote(table)})`).all().map(row=>row.name);
   const rows=source.prepare(`SELECT * FROM ${quote(table)}`).all();
   for(let offset=0;offset<rows.length;offset+=50){
    const batch=rows.slice(offset,offset+50),values=batch.flatMap(row=>columns.map(column=>row[column]));
    const tuples=batch.map((row,i)=>'('+columns.map((column,j)=>'$'+(i*columns.length+j+1)).join(',')+')');
    target.execute(`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES ${tuples.join(',')}`,values);
   }
   const actual=target.queryOne(`SELECT count(*) AS n FROM ${quote(table)}`).n;if(actual!==rows.length)throw Error(`Migration count mismatch: ${table}`);
   report.push({table,rows:actual});
  }
  target.exec('CREATE TABLE hosted_files(path TEXT PRIMARY KEY,contents BYTEA NOT NULL)');
  for(const name of fs.readdirSync(path.join(root,'data/.secrets'))){
   const relative='.secrets/'+name,full=path.join(root,'data',relative);
   if(validHostedFile(relative)&&fs.statSync(full).isFile()&&name!=='quick_tunnel_url')target.execute('INSERT INTO hosted_files(path,contents) VALUES($1,$2)',[relative,fs.readFileSync(full)]);
  }
  if(!target.queryOne("SELECT path FROM hosted_files WHERE path='.secrets/console-login.json'"))throw Error('Console login configuration is missing');
 });
 fs.writeFileSync('data/.secrets/render-migration-report.json',JSON.stringify({migratedAt:new Date().toISOString(),tables:report},null,2));
 console.log(`Migration verified: ${report.length} tables, ${report.reduce((sum,row)=>sum+row.rows,0)} rows. Original SQLite backup preserved locally.`);
}finally{source.close();target.close();}
