/* Surf Salvaje — Service Worker de caché persistente.
 *
 * Qué cachea (cache-first):
 *   - /assets/**            imágenes, texturas y audio. La clave incluye el hash de
 *                           contenido del manifiesto (embebido en index.html), así que un
 *                           archivo modificado recibe clave nueva y el viejo se purga.
 *   - Babylon.js del CDN     URLs con versión fija (babylonjs@x.y.z): inmutables.
 *   - fonts.gstatic.com      archivos de fuente inmutables; la hoja de Google Fonts se revalida.
 * Qué NO toca nunca: HTML, JS y CSS propios (van a red con ETag),
 * WebSockets (/lobby, /play: el SW no los intercepta), peticiones que no son GET
 * (crear/unirse a salas, capturas) ni ningún otro dato dinámico.
 */
const SW_VERSION = 'surf-sw-3';
const ASSET_CACHE = 'surf-assets-v1';
const LIB_CACHE = 'surf-libs-v1';
const META_CACHE = 'surf-meta-v1';
const KEEP = [ASSET_CACHE, LIB_CACHE, META_CACHE];
const MANIFEST_KEY = '/__surf/asset-manifest';

let manifest = null;          // {version, map: Map(path -> hash), libs:Set(url)}
const inflight = new Map();   // clave -> Promise<Response> (sin descargas duplicadas)

function index(m) {
  return {version: m.version, map: new Map(m.assets.map(a => [a.url, a.hash])), libs: new Set(m.libs.map(l => l.url))};
}

// El manifiesto lo envía la página (va embebido en index.html); aquí solo se guarda la copia.
async function loadManifest() {
  const saved = await (await caches.open(META_CACHE)).match(MANIFEST_KEY);
  if (saved) manifest = index(await saved.json());
  return manifest;
}

async function setManifest(json) {
  const next = index(json);
  const changed = !manifest || manifest.version !== next.version;
  manifest = next;
  const meta = await caches.open(META_CACHE);
  await meta.put(MANIFEST_KEY, new Response(JSON.stringify(json), {headers: {'Content-Type': 'application/json'}}));
  if (changed) await prune();
}

// Borra versiones obsoletas: archivos cuyo hash cambió o que ya no están en el manifiesto.
async function prune() {
  if (!manifest) return;
  const assets = await caches.open(ASSET_CACHE);
  for (const req of await assets.keys()) {
    const url = new URL(req.url);
    if (manifest.map.get(url.pathname) !== url.searchParams.get('v')) await assets.delete(req);
  }
  const libs = await caches.open(LIB_CACHE);
  for (const req of await libs.keys()) {
    const host = new URL(req.url).host;
    if (host === 'cdn.jsdelivr.net' && !manifest.libs.has(req.url)) await libs.delete(req);
  }
}

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('surf-') && !KEEP.includes(name)) await caches.delete(name);
    await loadManifest();
    await prune();
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'manifest' && data.manifest) event.waitUntil(setManifest(data.manifest));
  if (data.type === 'evict' && data.url) {
    // Recuperación de una copia corrupta: se elimina solo ese archivo.
    event.waitUntil((async () => {
      const path = new URL(data.url, self.location.origin).pathname;
      const cache = await caches.open(ASSET_CACHE);
      for (const req of await cache.keys()) if (new URL(req.url).pathname === path) await cache.delete(req);
    })());
  }
});

function rangeResponse(full, header, type) {
  const size = full.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(header || '');
  let start = 0, end = size - 1;
  if (m) {
    if (m[1] === '' && m[2] !== '') start = Math.max(0, size - Number(m[2]));
    else { start = Number(m[1] || 0); if (m[2] !== '') end = Math.min(Number(m[2]), size - 1); }
  }
  if (start >= size) return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${size}`}});
  return new Response(full.slice(start, end + 1), {status: 206, headers: {
    'Content-Type': type || 'application/octet-stream', 'Content-Range': `bytes ${start}-${end}/${size}`,
    'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes'}});
}

async function putSafely(cacheName, key, response) {
  try { await (await caches.open(cacheName)).put(key, response); }
  catch (e) { /* cuota llena u otro límite del navegador: se sigue sin guardar */ }
}

async function assetFirst(request, url) {
  if (!manifest) await loadManifest();
  const hash = manifest && manifest.map.get(url.pathname);
  if (!hash) return fetch(request);                    // no está en el manifiesto: red normal (ETag)
  const key = url.pathname + '?v=' + hash;
  const cache = await caches.open(ASSET_CACHE);
  const range = request.headers.get('range');
  if (url.searchParams.has('retry')) {                 // reintento del preloader: copia nueva desde la red
    const fresh = await fetch(url.pathname, {cache: 'reload', credentials: 'same-origin'});
    if (fresh.ok && fresh.status === 200) await putSafely(ASSET_CACHE, key, fresh.clone());
    return fresh;
  }
  const hit = await cache.match(key);
  if (hit) {
    if (!range) return hit;
    return rangeResponse(await hit.arrayBuffer(), range, hit.headers.get('Content-Type'));
  }
  // Una sola descarga por archivo, aunque lo pidan a la vez el preloader, Babylon,
  // el CSS o un <audio> con Range. Se pide la URL real (sin ?v) para que la caché
  // HTTP del navegador pueda responder 304 si el archivo ya llegó antes del SW.
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      const res = await fetch(url.pathname, {cache: 'no-cache', credentials: 'same-origin'});
      if (res.ok && res.status === 200) await putSafely(ASSET_CACHE, key, res.clone());
      return res;
    })().finally(() => inflight.delete(key)));
  }
  const res = (await inflight.get(key)).clone();
  if (!range || !res.ok) return res;
  return rangeResponse(await res.arrayBuffer(), range, res.headers.get('Content-Type'));
}

async function libFirst(request) {
  const cache = await caches.open(LIB_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  if (!inflight.has(request.url)) {
    inflight.set(request.url, (async () => {
      const res = await fetch(request);
      if (res.ok || res.type === 'opaque') await putSafely(LIB_CACHE, request.url, res.clone());
      return res;
    })().finally(() => inflight.delete(request.url)));
  }
  return (await inflight.get(request.url)).clone();
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(LIB_CACHE);
  const hit = await cache.match(request.url);
  const refresh = fetch(request).then(res => { if (res.ok) putSafely(LIB_CACHE, request.url, res.clone()); return res; });
  if (hit) { event.waitUntil(refresh.catch(() => {})); return hit; }
  return refresh;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/assets/')) event.respondWith(assetFirst(request, url));
    return;
  }
  if (url.host === 'cdn.jsdelivr.net' && /^\/npm\/babylonjs[a-z-]*@\d+\.\d+\.\d+\//.test(url.pathname)) return event.respondWith(libFirst(request));
  if (url.host === 'fonts.gstatic.com') return event.respondWith(libFirst(request));
  if (url.host === 'fonts.googleapis.com') return event.respondWith(staleWhileRevalidate(request, event));
});
