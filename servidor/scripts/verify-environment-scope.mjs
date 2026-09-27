import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const backup=resolve(root,'servidor/backups/environment-refinement-20260924-125951');
const manifest=JSON.parse((await readFile(resolve(backup,'manifest.json'),'utf8')).replace(/^\uFEFF/,''));
const allowed=new Set(['client/src/world/map-theme.js','client/src/world/volcanic-coast.js','client/src/world/beach-huts.js','client/src/world/tropical-shaders.js']);
let preserved=0;
for(const entry of manifest){
 const path=relative(backup,entry.Path).replaceAll('\\','/');
 if(allowed.has(path))continue;
 const hash=createHash('sha256').update(await readFile(resolve(root,path))).digest('hex').toUpperCase();
 assert.equal(hash,entry.Hash,'Protected file modified: '+path);preserved++;
}
const before=await readFile(resolve(backup,'client/src/core/game.js'),'utf8');
const after=await readFile(resolve(root,'client/src/core/game.js'),'utf8');
assert.equal(after,before,'Game runtime changed since the environment backup');
console.log(`PASS: ${preserved} protected files identical. Camera, avatar, board, HUD, input, simulation and ramp/circuit code unchanged.`);
