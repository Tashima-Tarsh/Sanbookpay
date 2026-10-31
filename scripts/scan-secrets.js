import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\brnd_[A-Za-z0-9]{20,}\b/,/\bgh[pousr]_[A-Za-z0-9]{30,}\b/,/\bgithub_pat_[A-Za-z0-9_]{40,}\b/,/\bya29\.[A-Za-z0-9_-]{30,}\b/];
const findings=[];
for(const file of files){
 if(/(?:^|\/)(?:\.secrets|backups)\//.test(file)||/\.(?:keystore|jks)$/.test(file)||/Dynamo-Pay-Private-Credentials\.pdf$/.test(file)){findings.push(file);continue;}
 if(/(?:^|\/)\.env(?:\.|$)/.test(file)&&!file.endsWith('.example')){findings.push(file);continue;}
 if(!/\.(?:js|ts|json|md|ya?ml|py|java|kt|kts|html|txt|sh|ps1|toml|ini)$/i.test(file)||!fs.existsSync(file))continue;
 const content=fs.readFileSync(file,'utf8');if(patterns.some(pattern=>pattern.test(content)))findings.push(file);
}
if(findings.length){console.error('Possible credentials found in tracked files (values withheld):\n'+[...new Set(findings)].join('\n'));process.exitCode=1;}
else console.log(`Secret pattern scan passed for ${files.length} tracked paths. This does not replace a complete Git-history audit.`);
