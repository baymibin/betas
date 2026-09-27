// Solo para despliegues donde Nginx (u otro hosting estático) sirve el cliente sin pasar
// por el servidor Node: genera un index.html con el manifiesto de assets embebido.
// Con el servidor Node no hace falta: él embebe el manifiesto en vivo al servir index.html.
//   node scripts/build-asset-manifest.mjs [salida.html]   (por defecto artifacts/index.html)
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildManifest, embedManifest} from '../src/asset-manifest.js';
const root = fileURLToPath(new URL('../../client/', import.meta.url));
const out = resolve(process.argv[2] || fileURLToPath(new URL('../artifacts/index.html', import.meta.url)));
const manifest = await buildManifest(root);
mkdirSync(dirname(out), {recursive: true});
writeFileSync(out, embedManifest(readFileSync(root + 'index.html', 'utf8'), manifest));
const sum = g => manifest.assets.filter(a => a.priority === g).reduce((s, a) => s + a.bytes, 0);
console.log(`manifiesto v${manifest.version}: ${manifest.assets.length} assets -> ${out}`);
for (const p of ['critical', 'background', 'lazy']) console.log(`  ${p.padEnd(10)} ${(sum(p) / 1048576).toFixed(1)} MB`);
if (manifest.missing.length) console.warn('  referencias sin archivo:', manifest.missing.join(', '));
