import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export function validHostedFile(name){return /^\.secrets\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(name)&&!name.startsWith('.secrets/render');}

/** Restore private configuration from the durable database before services load secrets. */
export async function restorePostgresFiles(dataDir,connectionString){
 const host=new URL(connectionString).hostname;
 const client=new pg.Client({connectionString,ssl:process.env.RENDER==='true'&&host.startsWith('dpg-')&&!host.includes('.')?false:{rejectUnauthorized:true},connectionTimeoutMillis:15000});
 try{
  await client.connect();const {rows}=await client.query('SELECT path,contents FROM hosted_files ORDER BY path');
  if(!rows.some(row=>row.path==='.secrets/console-login.json'))throw Error('Database migration is incomplete: console access is missing');
  for(const row of rows){
   if(!validHostedFile(row.path))throw Error('Invalid private configuration path');
   const target=path.join(dataDir,row.path);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,row.contents,{mode:0o600});
  }
 }finally{await client.end();}
}
