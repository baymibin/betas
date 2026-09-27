// Manifiesto centralizado de assets de Surf Salvaje.
// Escanea el código real del cliente (index.html, src/**/*.js, styles/*.css),
// resuelve las rutas dinámicas conocidas y describe cada archivo usado con
// id, url, tipo, bytes, hash de contenido, grupo y prioridad.
// Lo usan el servidor (GET /asset-manifest.json) y scripts/build-asset-manifest.mjs.
import {readFileSync, readdirSync, statSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, extname, relative} from 'node:path';
import {pathToFileURL} from 'node:url';

// Librerías externas versionadas (antes eran <script> bloqueantes en index.html).
// `bytes` es el tamaño sin comprimir de babylonjs@9.26.1: solo se usa como peso del progreso.
export const LIBS = [
  {id: 'lib:babylon', url: 'https://cdn.jsdelivr.net/npm/babylonjs@9.26.1/babylon.js', bytes: 8342583},
  {id: 'lib:babylon-materials', url: 'https://cdn.jsdelivr.net/npm/babylonjs-materials@9.26.1/babylonjs.materials.min.js', bytes: 383867}
];
export const FONTS = {family: 'Baloo 2', weights: [500, 600, 700, 800]};

const TYPES = {'.png': 'image', '.webp': 'image', '.jpg': 'image', '.jpeg': 'image', '.svg': 'image', '.mp3': 'audio', '.woff2': 'font', '.glb': 'model', '.gltf': 'model'};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), s = statSync(p);
    if (s.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// Solo archivos alcanzables desde index.html (imports, módulos inyectados y hojas
// de estilo), para no precargar assets de módulos que ya nadie usa.
function sourceFiles(root) {
  const seen = new Set(), queue = [join(root, 'index.html')];
  const add = p => { const f = join(root, p.replace(/^\.?\//, '')); if (existsSync(f) && !seen.has(f)) queue.push(f); };
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/["'](\/?(?:src|styles)\/[A-Za-z0-9_./-]+\.(?:js|css))["']/g)) add(m[1]);
    if (file.endsWith('.js')) {
      for (const m of text.matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) add(relative(root, join(file, '..', m[1])));
    }
  }
  return [...seen];
}

// Rutas construidas en tiempo de ejecución que el escaneo literal no ve completas.
function dynamicRefs(root) {
  const refs = [];
  const shop = readFileSync(join(root, 'src/ui/shop.js'), 'utf8');
  const wings = /wingFiles\s*=\s*\[([^\]]*)\]/.exec(shop);
  if (wings) for (const m of wings[1].matchAll(/'([^']+)'/g)) refs.push('/assets/images/wings/' + m[1]);
  for (let i = 1; i <= 8; i++) refs.push(`/assets/images/powerups/power-${i}.webp`);
  return refs;
}

// Circuito -> miniatura / banner, leído de MAP_ITEMS en rooms.js.
function mapAssets(root) {
  const rooms = readFileSync(join(root, 'src/ui/rooms.js'), 'utf8');
  const out = new Map();
  for (const m of rooms.matchAll(/id:\s*(\d+),[\s\S]*?thumb:\s*'([^']+)',\s*banner:\s*'([^']+)'/g)) {
    out.set(m[2], Number(m[1])); out.set(m[3], Number(m[1]));
  }
  return out;
}

function cosmetics(root) {
  const boards = [...readFileSync(join(root, 'src/shared/board-cosmetics.js'), 'utf8').matchAll(/file:'([^']+)'/g)].map(m => m[1]);
  const shop = readFileSync(join(root, 'src/ui/shop.js'), 'utf8');
  const wings = [.../wingFiles\s*=\s*\[([^\]]*)\]/.exec(shop)[1].matchAll(/'([^']+)'/g)].map(m => '/assets/images/wings/' + m[1]);
  return {boards, wings, profileKey: /const key='([^']+)'/.exec(shop)?.[1] || 'surf.profile.v1'};
}

export async function classify(root) {
  const {isMapEnabled} = await import(pathToFileURL(join(root, 'src/shared/maps.js')).href);
  const mapOf = mapAssets(root);
  return url => {
    if (mapOf.has(url)) {
      const enabled = isMapEnabled(mapOf.get(url));
      if (url.includes('thumbnail_')) return enabled ? ['multiplayer', 'background'] : ['locked', 'background'];
      return enabled ? ['multiplayer', 'background'] : ['locked', 'lazy'];
    }
    if (url.startsWith('/assets/audio/music/') || url.startsWith('/assets/audio/ambience/')) return ['coral', 'background'];
    if (url.startsWith('/assets/images/menu/custom_ui/') || url === '/assets/images/maps/background_thumb.png') return ['multiplayer', 'background'];
    if (url.startsWith('/assets/images/menu/') || url === '/assets/images/shop/shop-bg-tropical.webp' || url.startsWith('/assets/images/sprites/')) return ['core', 'critical'];
    if (url.startsWith('/assets/images/boards/') || url.startsWith('/assets/images/wings/') || url.startsWith('/assets/images/shop/')) return ['custom', 'background'];
    if (url.startsWith('/assets/images/environment/') || url.startsWith('/assets/images/powerups/') || url.startsWith('/assets/audio/effects/')) return ['coral', 'critical'];
    return ['core', 'background'];
  };
}

const hashCache = new Map(); // path -> {mtimeMs,size,hash}
export function fileHash(file) {
  const s = statSync(file), c = hashCache.get(file);
  if (c && c.mtimeMs === s.mtimeMs && c.size === s.size) return c;
  const entry = {mtimeMs: s.mtimeMs, size: s.size, hash: createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16)};
  hashCache.set(file, entry);
  return entry;
}

export async function buildManifest(root) {
  const found = new Set();
  for (const f of sourceFiles(root)) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/(?:\.)?\/?(assets\/[A-Za-z0-9_./-]+\.(?:png|webp|jpe?g|svg|mp3|woff2|glb|gltf))/g)) found.add('/' + m[1]);
  }
  for (const r of dynamicRefs(root)) found.add(r);
  const group = await classify(root);
  const assets = [], missing = [];
  for (const url of [...found].sort()) {
    const file = join(root, url.slice(1));
    if (!existsSync(file)) { missing.push(url); continue; }
    const {size, hash} = fileHash(file);
    const [g, priority] = group(url);
    assets.push({id: url.slice(8).replace(/\.[^.]+$/, ''), url, type: TYPES[extname(url)] || 'file', bytes: size, hash, group: g, priority});
  }
  const version = createHash('sha256').update(assets.map(a => a.url + a.hash).join('|') + LIBS.map(l => l.url).join('|')).digest('hex').slice(0, 12);
  return {version, generated: new Date().toISOString(), libs: LIBS, fonts: FONTS, cosmetics: cosmetics(root), assets, missing};
}

// Versión para el servidor: rescanea solo cuando cambia algún archivo fuente o asset.
let memo = null;
export async function currentManifest(root) {
  const files = sourceFiles(root);
  const stamp = files.map(f => statSync(f).mtimeMs).join(',');
  if (memo && memo.stamp === stamp) {
    let changed = false;
    for (const a of memo.manifest.assets) {
      const file = join(root, a.url.slice(1));
      if (!existsSync(file)) { changed = true; break; }
      const {hash, size} = fileHash(file);
      if (hash !== a.hash || size !== a.bytes) { changed = true; break; }
    }
    if (!changed) return memo.manifest;
  }
  memo = {stamp, manifest: await buildManifest(root)};
  return memo.manifest;
}

// index.html con el manifiesto embebido: el cliente no pide ningún /asset-manifest.json.
const PRELOADER_TAG = '<script src="/src/core/preloader.js"></script>';
export function embedManifest(html, m) {
  const json = JSON.stringify({version: m.version, libs: m.libs, fonts: m.fonts, cosmetics: m.cosmetics, assets: m.assets}).replace(/</g, '\\u003c');
  return html.replace(PRELOADER_TAG, `<script id="surf-manifest" type="application/json">${json}</script>\n${PRELOADER_TAG}`);
}
