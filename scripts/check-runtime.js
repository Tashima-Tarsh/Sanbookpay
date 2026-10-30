import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Services import JavaScript directly; the historical TypeScript projects are not the runtime build.
function sources(dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(dir,entry.name);
    if(entry.isDirectory())return ['node_modules','dist','__tests__'].includes(entry.name)?[]:sources(file);
    return entry.name.endsWith('.js')&&!entry.name.endsWith('.test.js')?[file]:[];
  });
}
const files=['apps','packages','scripts'].flatMap(sources);
for(const file of files){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0){console.error(result.stderr||result.error||`Syntax validation failed: ${file}`);process.exit(1);}
}
console.log(`Validated ${files.length} JavaScript runtime files. No transpilation is required.`);
