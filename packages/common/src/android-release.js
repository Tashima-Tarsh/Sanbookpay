import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export function androidSourceHash(root) {
  const source=path.join(root,'apps/android-observer-app/app/src/main');
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
  const hash=crypto.createHash('sha256');
  for(const file of walk(source)){hash.update(path.relative(source,file).replaceAll('\\','/'));hash.update(fs.readFileSync(file));}
  return hash.digest('hex');
}
export function isCurrentAndroidRelease(apk,root) {
  try{const release=JSON.parse(fs.readFileSync(apk+'.release.json','utf8'));return release.sourceHash===androidSourceHash(root)&&release.apkHash===crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');}catch{return false;}
}
