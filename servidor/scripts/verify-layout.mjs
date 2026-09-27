import assert from 'node:assert/strict';
import {readdir,readFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative,extname,dirname} from 'node:path';
const project=fileURLToPath(new URL('../../',import.meta.url));
const client=resolve(project,'client');
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name);out.push(...(e.isDirectory()?await files(p):[p]));}return out;}
assert.deepEqual((await readdir(project)).sort(),['client','servidor']);
const sources=[...await files(resolve(client,'src')),...await files(resolve(project,'servidor/src')),...await files(resolve(project,'servidor/test')),...await files(resolve(project,'servidor/scripts'))];
let imports=0;
for(const file of sources.filter(p=>/\.(js|mjs|cjs)$/.test(p))){
 const text=await readFile(file,'utf8');
 for(const match of text.matchAll(/(?:from\s*|import\s*|require\(\s*)['"](\.[^'"]+)['"]/g)){
  await access(resolve(dirname(file),match[1]));imports++;
 }
}
const publicFiles=(await files(client)).filter(p=>['.html','.js','.css','.png','.jpg','.jpeg','.webp','.mp3'].includes(extname(p)));
for(const file of publicFiles){
 const url='/'+relative(client,file).replaceAll('\\','/');
 const response=await fetch('http://localhost:3000'+url);
 assert.equal(response.status,200,url);
 const data=Buffer.from(await response.arrayBuffer());
 assert.ok(data.equals(await readFile(file)),url+' content');
}
for(const url of ['/servidor/package.json','/node_modules/uWebSockets.js/package.json','/package.json','/%2e%2e%5cservidor%5csrc%5cindex.js']){
 assert.equal((await fetch('http://localhost:3000'+url)).status,404,url);
}
console.log(`PASS: ${imports} imports, ${publicFiles.length} public files; only client and servidor at root; internal files excluded.`);
