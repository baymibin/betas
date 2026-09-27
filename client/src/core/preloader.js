/* Surf Salvaje — preloader real.
 * Script clásico (no módulo): se ejecuta antes que Babylon y que el juego.
 *  1. Registra el Service Worker (caché persistente de assets estáticos).
 *  2. Lee el manifiesto embebido en index.html (hash + tamaño + grupo + prioridad de cada archivo).
 *  3. Descarga y valida lo crítico: fuentes, Babylon.js (con progreso por bytes),
 *     imágenes (descarga + decode), efectos de sonido (descarga + decodeAudioData).
 *  4. Inyecta el juego y espera a que la escena de Bahía Coral esté lista
 *     (texturas Babylon realmente cargadas + scene.whenReadyAsync()).
 *  5. Solo entonces oculta la pantalla de carga. Después precarga en segundo plano
 *     lo no crítico (tienda, multijugador, miniaturas de circuitos bloqueados).
 * El porcentaje sale de bytes/tareas terminadas: no hay temporizadores de relleno.
 */
(function () {
  'use strict';
  var GAME_ENTRY = '/src/core/game.js';
  var TIMEOUT_MS = 30000, LIB_TIMEOUT_MS = 90000, AUTO_RETRIES = 2;
  var DOWNLOAD_SHARE = 0.85;            // 85 % descargas/decodificación, 15 % preparación de escena
  var FONT_WEIGHT_BYTES = 45000;        // peso de progreso de cada variante tipográfica

  var el = {
    root: document.getElementById('loading'),
    bar: document.getElementById('loading-bar-fill'),
    track: document.querySelector('#loading .loading-track'),
    pct: document.getElementById('loading-percent'),
    status: document.getElementById('loading-status'),
    error: document.getElementById('loading-error'),
    errorList: document.getElementById('loading-error-list'),
    retry: document.getElementById('loading-retry')
  };
  var log = function () { var a = ['[preload]'].concat([].slice.call(arguments)); console.info.apply(console, a); };

  // ---------------------------------------------------------------- progreso
  var totalWeight = 1, doneWeight = 0, streaming = {}, sceneFraction = 0, target = 0, shown = 0;
  function downloadFraction() {
    var s = doneWeight; for (var k in streaming) s += streaming[k];
    return Math.min(1, s / totalWeight);
  }
  function recompute() { target = Math.min(1, DOWNLOAD_SHARE * downloadFraction() + (1 - DOWNLOAD_SHARE) * sceneFraction); }
  function paint() {
    // Suavizado visual: nunca supera el progreso real (target).
    shown += (target - shown) * 0.18;
    if (target - shown < 0.002) shown = target;
    if (el.bar) el.bar.style.transform = 'scaleX(' + shown.toFixed(4) + ')';
    if (el.pct) el.pct.textContent = Math.floor(shown * 100) + '%';
    if (el.track) el.track.setAttribute('aria-valuenow', String(Math.floor(shown * 100)));
    if (!finished) requestAnimationFrame(paint);
  }
  function setStatus(text) { if (el.status) el.status.textContent = text; }
  // Estado = la tarea pendiente más importante (no la última que empezó).
  var STAGES = ['Cargando fuentes...', 'Cargando el motor 3D...', 'Cargando texturas...', 'Cargando escenarios...', 'Preparando efectos de sonido...', 'Preparando personajes y tablas...'];
  var active = {};
  function begin(label) { active[label] = (active[label] || 0) + 1; showActive(); }
  function end(label) { active[label]--; showActive(); }
  function showActive() {
    if (returning) return;
    for (var i = 0; i < STAGES.length; i++) if (active[STAGES[i]] > 0) return setStatus(STAGES[i]);
  }

  // ------------------------------------------------------------- utilidades
  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('Tiempo agotado: ' + label)); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function evict(url) {
    var sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (sw) sw.postMessage({type: 'evict', url: url});
  }
  async function withRetries(task, label, url) {
    var lastError;
    for (var attempt = 0; attempt <= AUTO_RETRIES; attempt++) {
      try { return await task(attempt); }
      catch (e) {
        lastError = e;
        console.warn('[preload] fallo', label, 'intento', attempt + 1, e && e.message);
        if (url) evict(url);          // posible copia corrupta en caché: se descarta solo ese archivo
        if (attempt < AUTO_RETRIES) await wait(500 * Math.pow(2, attempt));
      }
    }
    throw lastError;
  }

  // Cola con concurrencia limitada y deduplicación por URL.
  var inflight = {};
  function once(url, fn) { if (!inflight[url]) inflight[url] = fn().finally(function () { delete inflight[url]; }); return inflight[url]; }
  async function pool(items, limit, worker) {
    var i = 0, results = [];
    async function next() { while (i < items.length) { var idx = i++; results[idx] = await worker(items[idx]); } }
    var runners = []; for (var k = 0; k < Math.min(limit, items.length); k++) runners.push(next());
    await Promise.all(runners);
    return results;
  }

  // --------------------------------------------------------------- loaders
  function loadImage(asset) {
    return once(asset.url, function () {
      return withRetries(function (attempt) {
        var img = new Image();
        img.decoding = 'async';
        // Tras un fallo, se fuerza una petición nueva que evita la copia en caché.
        img.src = attempt ? asset.url + (asset.url.indexOf('?') < 0 ? '?' : '&') + 'retry=' + Date.now() : asset.url;
        return withTimeout(img.decode(), TIMEOUT_MS, asset.url).then(function () {
          if (!img.naturalWidth) throw new Error('Imagen vacía: ' + asset.url);
          return img;
        });
      }, asset.id, asset.url);
    });
  }
  function loadAudio(asset) {
    return once(asset.url, function () {
      return withRetries(async function () {
        var res = await withTimeout(fetch(asset.url), TIMEOUT_MS, asset.url);
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + asset.url);
        var buf = await res.arrayBuffer();
        // Decodificar valida el archivo sin pedir permiso de reproducción (no depende del autoplay).
        var Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (Offline) await new Offline(1, 1, 44100).decodeAudioData(buf.slice(0));
        return buf;
      }, asset.id, asset.url);
    });
  }
  function loadFile(asset) {
    return once(asset.url, function () {
      return withRetries(async function () {
        var res = await withTimeout(fetch(asset.url), TIMEOUT_MS, asset.url);
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + asset.url);
        return res.blob();
      }, asset.id, asset.url);
    });
  }
  function loaderFor(asset) { return asset.type === 'image' ? loadImage : asset.type === 'audio' ? loadAudio : loadFile; }

  // Librerías: descarga con progreso real por bytes y ejecución desde memoria (sin segunda descarga).
  function loadLibrary(lib) {
    return withRetries(async function () {
      streaming[lib.id] = 0;
      var res = await withTimeout(fetch(lib.url, {mode: 'cors'}), LIB_TIMEOUT_MS, lib.url);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + lib.url);
      var reader = res.body && res.body.getReader && res.body.getReader();
      var chunks = [], received = 0;
      if (reader) {
        for (;;) {
          var step = await withTimeout(reader.read(), LIB_TIMEOUT_MS, lib.url);
          if (step.done) break;
          chunks.push(step.value); received += step.value.length;
          streaming[lib.id] = Math.min(received, lib.bytes * 0.98); recompute();
        }
      } else { chunks.push(new Uint8Array(await res.arrayBuffer())); }
      var url = URL.createObjectURL(new Blob(chunks, {type: 'text/javascript'}));
      await new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = url; s.onload = resolve; s.onerror = function () { reject(new Error('No se pudo ejecutar ' + lib.url)); };
        document.head.appendChild(s);
      });
      URL.revokeObjectURL(url);
      delete streaming[lib.id];
    }, lib.id, lib.url);
  }

  async function loadFonts(fonts) {
    if (!document.fonts || !document.fonts.load) return;
    await Promise.all(fonts.weights.map(function (w) {
      return withRetries(function () {
        return withTimeout(document.fonts.load(w + ' 32px "' + fonts.family + '"', 'Surf Salvaje ÁÉÍÓÚÑáéíóúñ 0123456789'), TIMEOUT_MS, fonts.family + ' ' + w)
          .then(function (faces) { if (!faces.length) throw new Error('Fuente no disponible: ' + fonts.family + ' ' + w); });
      }, 'font:' + w).then(function () { doneWeight += FONT_WEIGHT_BYTES; recompute(); });
    }));
    await document.fonts.ready;
  }

  // --------------------------------------------------------- Service Worker
  async function setupServiceWorker(manifest) {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return {controlled: false};
    try {
      var reg = await navigator.serviceWorker.register('/sw.js', {scope: '/'});
      await withTimeout(navigator.serviceWorker.ready, 4000, 'service worker');
      if (!navigator.serviceWorker.controller) {
        // Primera visita: esperar a que el SW tome el control para que la precarga ya quede cacheada.
        await withTimeout(new Promise(function (r) { navigator.serviceWorker.addEventListener('controllerchange', r, {once: true}); }), 3000, 'control del SW').catch(function () {});
      }
      var sw = navigator.serviceWorker.controller || reg.active;
      if (sw) sw.postMessage({type: 'manifest', manifest: manifest});
      return {controlled: !!navigator.serviceWorker.controller};
    } catch (e) {
      console.warn('[preload] Service Worker no disponible; se usa solo la caché HTTP.', e);
      return {controlled: false};
    }
  }
  async function cachedCount(assets) {
    if (!window.caches) return 0;
    try {
      var cache = await caches.open('surf-assets-v1'), hits = 0;
      await Promise.all(assets.map(function (a) { return cache.match(a.url + '?v=' + a.hash).then(function (r) { if (r) hits++; }); }));
      return hits;
    } catch (e) { return 0; }
  }

  // -------------------------------------------------------------- escena
  var sceneWaiter = null, finished = false, sceneExtra = null;
  var sceneReady = new Promise(function (resolve) { sceneWaiter = resolve; });

  async function prepareScene(scene) {
    setStatus(returning ? 'Preparando Bahía Coral...' : 'Preparando el océano...');
    var started = performance.now();
    // Texturas declaradas por la escena: progreso = texturas listas / texturas totales.
    for (;;) {
      var list = scene.textures.filter(function (t) { return t && !t.isRenderTarget && t.getClassName && t.getClassName() !== 'RenderTargetTexture'; });
      var ready = 0, failed = [];
      list.forEach(function (t) { if (t.loadingError) failed.push(t.name || t.url); else if (t.isReady()) ready++; });
      sceneFraction = list.length ? ready / list.length : 1; recompute();
      if (failed.length) throw Object.assign(new Error('Texturas con error'), {items: failed});
      if (ready === list.length) break;
      if (performance.now() - started > 45000) throw Object.assign(new Error('La escena no terminó de cargar'), {items: list.filter(function (t) { return !t.isReady(); }).map(function (t) { return t.name || t.url; })});
      await wait(50);
    }
    await withTimeout(scene.whenReadyAsync(), 45000, 'scene.whenReadyAsync');
    // Compilación de materiales que el juego hace antes de mostrarse (powerView.warmup).
    if (sceneExtra) await withTimeout(sceneExtra, 45000, 'compilación de materiales');
    sceneFraction = 1; recompute();
  }

  // --------------------------------------------------------------- errores
  var failures = [];
  function showError(items) {
    finished = false;
    el.root.classList.add('has-error');
    if (el.errorList) el.errorList.textContent = items.slice(0, 4).join(' · ') + (items.length > 4 ? ' …' : '');
    setStatus('');
  }
  if (el.retry) el.retry.addEventListener('click', function () {
    el.root.classList.remove('has-error');
    run();
  });

  // Imágenes del HTML marcadas con data-src: se piden cuando el SW ya controla la página.
  function releaseDeferredImages() {
    var imgs = document.querySelectorAll('img[data-src]');
    for (var i = 0; i < imgs.length; i++) { imgs[i].src = imgs[i].getAttribute('data-src'); imgs[i].removeAttribute('data-src'); }
    document.documentElement.classList.remove('surf-preloading');
    el.root.classList.add('bg-ready');   // fondo tropical, ya servido por el SW
  }

  // ------------------------------------------------------------------ flujo
  var manifest = null, returning = false, stageDone = {};
  function profileEquipment(m) {
    var p = {};
    try { p = JSON.parse(localStorage.getItem(m.cosmetics.profileKey) || '{}'); } catch (e) {}
    var boards = m.cosmetics.boards || [], wings = m.cosmetics.wings || [];
    return [boards[p.board | 0] || boards[0], wings[p.wing | 0] || wings[0]].filter(Boolean);
  }

  // Manifiesto mínimo: si index.html no trae el manifiesto (servidor viejo sin
  // reiniciar, HTML servido sin procesar), el juego arranca igual:
  // motor + fuentes + escena, sin precarga ni caché persistente de /assets.
  var FALLBACK_MANIFEST = {
    version: 'fallback',
    libs: [
      {id: 'lib:babylon', url: 'https://cdn.jsdelivr.net/npm/babylonjs@9.26.1/babylon.js', bytes: 8342583},
      {id: 'lib:babylon-materials', url: 'https://cdn.jsdelivr.net/npm/babylonjs-materials@9.26.1/babylonjs.materials.min.js', bytes: 383867}
    ],
    fonts: {family: 'Baloo 2', weights: [500, 600, 700, 800]},
    cosmetics: {boards: [], wings: [], profileKey: 'surf.profile.v1'},
    assets: []
  };
  // El servidor embebe el manifiesto en index.html (<script id="surf-manifest">):
  // no hay petición extra. Si falta (servidor viejo o HTML sin procesar), se usa el mínimo.
  function readManifest() {
    try {
      var tag = document.getElementById('surf-manifest');
      var json = tag && JSON.parse(tag.textContent);
      if (json && Array.isArray(json.assets) && Array.isArray(json.libs) && json.fonts) return json;
    } catch (e) { /* JSON dañado: se usa el mínimo */ }
    console.warn('[preload] index.html sin manifiesto embebido; se continúa sin precarga de recursos. Reinicia el servidor Node.');
    return FALLBACK_MANIFEST;
  }

  var t0 = performance.now();
  async function run() {
    failures = []; active = {};
    try {
      if (!manifest) {
        setStatus('Buscando la próxima ola...');
        manifest = readManifest();
        window.SurfAssetManifest = manifest;
      }
      if (!stageDone.sw) { if (manifest !== FALLBACK_MANIFEST) await setupServiceWorker(manifest); stageDone.sw = true; }
      releaseDeferredImages();

      var equipped = profileEquipment(manifest);
      var critical = manifest.assets.filter(function (a) { return a.priority === 'critical' || equipped.indexOf(a.url) >= 0; });
      var hits = await cachedCount(critical);
      returning = hits >= critical.length * 0.9 && critical.length > 0;
      log('manifest v' + manifest.version, critical.length + ' críticos', hits + ' ya en caché');

      totalWeight = critical.reduce(function (s, a) { return s + a.bytes; }, 0) +
        manifest.libs.reduce(function (s, l) { return s + l.bytes; }, 0) + manifest.fonts.weights.length * FONT_WEIGHT_BYTES;
      doneWeight = 0; streaming = {}; recompute();

      setStatus(returning ? 'Recuperando recursos...' : 'Cargando fuentes...');
      if (!stageDone.fonts) begin(STAGES[0]);
      var fontsTask = stageDone.fonts ? Promise.resolve() : loadFonts(manifest.fonts).then(function () { stageDone.fonts = true; end(STAGES[0]); })
        .catch(function (e) { failures.push('Tipografía ' + manifest.fonts.family); throw e; });
      if (stageDone.fonts) doneWeight += manifest.fonts.weights.length * FONT_WEIGHT_BYTES;

      // Motor 3D en serie (materials depende de babylon) y en paralelo con los assets.
      var libsTask = (async function () {
        for (var i = 0; i < manifest.libs.length; i++) {
          var lib = manifest.libs[i];
          if (stageDone[lib.id]) { doneWeight += lib.bytes; continue; }
          begin(STAGES[1]);
          try { await loadLibrary(lib); } catch (e) { failures.push(lib.url); throw e; } finally { end(STAGES[1]); }
          stageDone[lib.id] = true; doneWeight += lib.bytes; recompute();
        }
      })();

      var order = {core: 0, coral: 1, custom: 2, multiplayer: 3, locked: 4};
      critical.sort(function (a, b) { return order[a.group] - order[b.group]; });
      // Primera visita: lo que el HTML/CSS ya pidió antes de que el SW controlara la página
      // termina primero en la caché HTTP; así el SW solo lo revalida (304) y no hay doble descarga.
      var pageLoaded = document.readyState === 'complete' ? Promise.resolve() : new Promise(function (r) { window.addEventListener('load', r, {once: true}); });
      var assetsTask = pageLoaded.then(function () { return pool(critical, 6, async function (asset) {
        var label = asset.group === 'custom' ? STAGES[5] : asset.type === 'audio' ? STAGES[4] : asset.group === 'core' ? STAGES[2] : STAGES[3];
        begin(label);
        try { await loaderFor(asset)(asset); doneWeight += asset.bytes; recompute(); }
        catch (e) { failures.push(asset.id); console.error('[preload] recurso crítico falló:', asset.url, e); }
        finally { end(label); }
      }); });

      var settled = await Promise.allSettled([fontsTask, libsTask, assetsTask]);
      if (failures.length || settled.some(function (r) { return r.status === 'rejected'; })) {
        settled.forEach(function (r) { if (r.status === 'rejected') console.error('[preload]', r.reason); });
        return showError(failures.length ? failures : ['recurso crítico']);
      }

      log('recursos críticos listos en ' + Math.round(performance.now() - t0) + ' ms' + (returning ? ' (desde caché)' : ''));
      if (!stageDone.game) {
        stageDone.game = true;
        var s = document.createElement('script');
        s.type = 'module'; s.src = GAME_ENTRY;
        s.onerror = function () { showError([GAME_ENTRY]); };
        document.body.appendChild(s);
      }
      var scene = await sceneReady;
      await prepareScene(scene);
      log('escena lista en ' + Math.round(performance.now() - t0) + ' ms');
      finish();
    } catch (e) {
      console.error('[preload] carga interrumpida:', e);
      showError(e && e.items ? e.items : failures.length ? failures : [e && e.message || 'Error desconocido']);
    }
  }

  function finish() {
    target = 1; shown = 1; paint();
    setStatus('Todo listo para surfear.');
    finished = true;
    if (el.bar) el.bar.style.transform = 'scaleX(1)';
    if (el.pct) el.pct.textContent = '100%';
    el.root.classList.add('gone');
    el.root.setAttribute('aria-busy', 'false');
    setTimeout(function () { el.root.style.display = 'none'; }, 650);
    if (readyResolve) readyResolve();
    backgroundPrefetch();
  }

  // Precarga en segundo plano (no bloquea): tienda, multijugador y miniaturas de
  // los circuitos bloqueados. Lo marcado "lazy" (banners de circuitos bloqueados) no se toca.
  function backgroundPrefetch() {
    var items = manifest.assets.filter(function (a) { return a.priority === 'background'; });
    var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 200); };
    idle(function () {
      pool(items, 2, function (asset) {
        var loader = asset.type === 'audio' ? loadFile : loaderFor(asset);
        return loader(asset).catch(function (e) { console.warn('[preload] opcional no disponible:', asset.url, e && e.message); });
      }).then(function () { log('precarga en segundo plano completa (' + items.length + ' archivos)'); });
    });
  }

  var readyResolve = null;
  window.SurfPreloader = {
    // game.js la llama cuando la escena existe; el loading decide cuándo terminar.
    sceneCreated: function (scene, extra) { sceneExtra = extra || null; sceneWaiter(scene); },
    ready: new Promise(function (r) { readyResolve = r; }),
    fail: function (msg) { showError([msg]); }
  };

  requestAnimationFrame(paint);
  run();
})();
