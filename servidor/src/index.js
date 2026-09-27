import {createPowerWorld,stepPowerWorld} from '../../client/src/shared/powerups.js';
import {randomInt, createHash, randomUUID} from 'node:crypto';
import uWS from 'uWebSockets.js';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, relative, isAbsolute, extname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {TYPE, PROTOCOL_VERSION, powerWorldPacket, packet, read, snapshot, readProfile, roomState, roomList} from '../../client/src/shared/protocol.js';
import {DT, createPlayer, advance} from '../../client/src/shared/simulation.js';
import {isMapEnabled} from '../../client/src/shared/maps.js';
import {botLooks, createBotPlayer, createBrain, botInput, MAX_PARTICIPANTS} from '../../client/src/shared/bot-ai.js';
import {currentManifest, fileHash, embedManifest} from './asset-manifest.js';
import {createInputQueue, pushInput, nextInput, resetInputs} from './input-queue.js';
import {statSync, existsSync} from 'node:fs';
import {openDatabase, syncCatalog, loadEconomyConfig, describeDatabase} from './db.js';
import {createEconomy} from './economy.js';
import {authConfig, createAuth, SESSION_COOKIE} from './auth.js';
import {mountApi, parseCookies} from './api.js';

const clientRoot = fileURLToPath(new URL('../../client/', import.meta.url));
// Variables de entorno locales (servidor/.env, nunca en git). Ver .env.example.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
// ---------- Cuentas y economía ----------
// DATABASE_URL elige el motor: mysql://... (MySQL/MariaDB, p. ej. aaPanel) o SQLite por defecto.
const economyConfig = loadEconomyConfig();
let db;
try { db = await openDatabase(); }
catch (error) { console.error('[db] No se pudo abrir la base de datos (' + describeDatabase() + '):', error.message); process.exit(1); }
await syncCatalog(db, economyConfig);
const economy = createEconomy(db, economyConfig);
await economy.loadCache();
const authSettings = authConfig();
const auth = createAuth(db, economy, authSettings);
const socketsByUser = new Map();   // surf_user_id -> conexiones /play abiertas
// Equipamiento visible en carrera: con sesión manda la cuenta (lo equipado y poseído); como
// invitado solo se aceptan artículos gratuitos. El nick de una cuenta es el de su perfil.
// Con cuenta se consulta la base de datos sin frenar el bucle de juego; solo se aplica la
// respuesta más reciente y nunca a una conexión ya cerrada.
function applyProfile(d, requested) {
  if (d.userId) {
    const version = d.profileVersion = (d.profileVersion || 0) + 1;
    Promise.all([economy.getUser(d.userId), economy.equipped(d.userId)]).then(([user, eq]) => {
      if (d.closed || version !== d.profileVersion || !user) return;
      Object.assign(d.player, {character: eq.character, board: eq.board, wing: eq.wing, hat: eq.hat, nick: user.nickname});
    }, error => console.error('[economy] perfil', error.message));
    return;
  }
  const look = {...requested};
  for (const slot of ['character', 'board', 'wing', 'hat']) if (!economy.isFree(slot, look[slot] | 0)) look[slot] = 0;
  Object.assign(d.player, look);
}
function refreshEquipment(userId) { for (const ws of socketsByUser.get(userId) || []) applyProfile(ws.getUserData(), {}); }
function startRace(room) { room.started = true; room.raceId = randomUUID(); room.humansAtStart = room.size; }
// Recompensa de llegada, calculada aquí con el puesto real (nunca con datos del cliente).
function rewardFinish(d, room) {
  if (!d.userId || !room.raceId) return;
  economy.rewardRace(d.userId, room.raceId, d.player.place, room.humansAtStart || room.size)
    .catch(error => console.error('[economy] recompensa de carrera', error.message));
}
const screenshotsRoot = fileURLToPath(new URL('../artifacts/screenshots/', import.meta.url));
mkdirSync(screenshotsRoot, {recursive:true});
const rooms = new Set(); let nextId = 1, tick = 0;
const lobbyPeers=new Set();
function publishLobby(){const data=roomList([...rooms].map(r=>({code:r.code,mapId:r.mapId,count:r.size,bots:r.bots.length,capacity:r.capacity,started:r.started,host:[...r].find(w=>w.getUserData().player.id===r.hostId)?.getUserData().player.nick||'Surfer'})));for(const peer of lobbyPeers)if(peer.getBufferedAmount()===0)peer.send(data,true);return data;}
function broadcastRoom(room){publishLobby();const buffer=roomState(room);for(const ws of room)ws.send(buffer,true);}
// ---------- Bots (autoritativos: solo el servidor los simula y decide su equipamiento) ----------
// Plazas de bots = mín(lo pedido por el anfitrión, capacidad − humanos). Los humanos tienen
// prioridad: si entra uno y no cabe, sale un bot; si un humano se va antes de la carrera, vuelve.
const humansOf=room=>[...room].map(w=>w.getUserData().player);
function syncBots(room){
 if(room.started)return;
 const humans=humansOf(room),want=Math.max(0,Math.min(room.botTarget,room.capacity-humans.length,MAX_PARTICIPANTS-humans.length));
 while(room.bots.length>want)room.bots.pop();
 if(room.bots.length<want){
  const present=[...humans,...room.bots.map(b=>b.player)];
  const looks=botLooks(want-room.bots.length,randomInt(1,2**31),present.map(p=>({character:p.character|0,board:p.board|0,wing:p.wing|0})),present.map(p=>p.nick));
  for(const look of looks){const id=nextId++;room.bots.push({player:createBotPlayer(id,look,room.bots.length,room.mapId),brain:createBrain(look,randomInt(1,2**31),room.mapId)});}
 }
}
function roomPlayers(room){return humansOf(room).concat(room.bots.map(b=>b.player));}
function assignRoom(ws,v){
 const d=ws.getUserData();if(d.room||(v.byteLength!==21&&v.byteLength!==22))throw Error('Invalid room request');
 const mode=v.getUint8(12),mapId=v.getUint8(13),capacity=v.getUint8(20);if(capacity<2||capacity>8)throw Error('Invalid capacity');if(mapId>7||mode>2)throw Error('Invalid map');
 // Circuitos bloqueados temporalmente (maps.js): no se crean salas nuevas en ellos.
 if(mode!==2&&!isMapEnabled(mapId)){const e=packet(TYPE.ERROR,13);e.setUint8(12,2);ws.send(e.buffer,true);return;}
 let room;
 if(mode===2){const code=String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+14,6));room=[...rooms].find(r=>r.code===code);if(!room||room.started||room.size>=room.capacity||!isMapEnabled(room.mapId)){const e=packet(TYPE.ERROR,13);e.setUint8(12,1);ws.send(e.buffer,true);return;}}
 else {
  room=new Set();do{room.code=String(randomInt(100000,1000000));}while([...rooms].some(r=>r.code===room.code));
  room.powerWorld=createPowerWorld();room.capacity=capacity;room.mapId=mapId;room.hostId=d.player.id;room.finishCount=0;room.bots=[];if(mode===0)startRace(room);
  room.botTarget=mode===1&&v.byteLength===22?Math.min(v.getUint8(21),capacity-1):0;rooms.add(room);
 }
 d.room=room;room.add(ws);d.player.mapId=room.mapId;d.player.countdown=room.started?90:65535;syncBots(room);broadcastRoom(room);
}
const app = uWS.App().ws('/lobby',{maxPayloadLength:16,idleTimeout:120,open(ws){lobbyPeers.add(ws);publishLobby();},close(ws){lobbyPeers.delete(ws);},message(ws){ws.send(publishLobby(),true);}}).ws('/play', {
  maxPayloadLength: 64, maxBackpressure: 16384, closeOnBackpressureLimit: true, idleTimeout: 30,
  // La sesión viaja en la cookie HttpOnly del handshake: el WebSocket nunca recibe tokens.
  upgrade(res, req, context) {
    // uWS invalida req tras la primera espera: se copian las cabeceras antes de consultar la sesión.
    const key = req.getHeader('sec-websocket-key'), protocol = req.getHeader('sec-websocket-protocol'), extensions = req.getHeader('sec-websocket-extensions');
    const token = parseCookies(req.getHeader('cookie'))[SESSION_COOKIE];
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    auth.session(token).catch(() => null).then(session => {
      if (!aborted) res.cork(() => res.upgrade({userId: session?.userId || null}, key, protocol, extensions, context));
    });
  },
  open(ws) {
    const data = ws.getUserData(); if(data.userId){if(!socketsByUser.has(data.userId))socketsByUser.set(data.userId,new Set());socketsByUser.get(data.userId).add(ws);} data.player = createPlayer(nextId++); applyProfile(data,{}); data.inputs = createInputQueue();
    data.room=null;
    const v = packet(TYPE.WELCOME, 17); v.setUint32(12, data.player.id, true); v.setUint8(16, PROTOCOL_VERSION); ws.send(v.buffer, true);
  },
  message(ws, buffer, binary) {
    try {
      const v = read(buffer), d = ws.getUserData(), seq = v.getUint32(4,true);
      if(binary&&v.getUint8(1)===TYPE.ROOM_REQUEST){assignRoom(ws,v);return;}
      if(binary&&v.getUint8(1)===TYPE.ROOM_START){if(v.byteLength!==12||!d.room||d.room.hostId!==d.player.id||d.room.started)return;startRace(d.room);for(const peer of d.room){const state=peer.getUserData();state.player.countdown=90;resetInputs(state.inputs);}for(const bot of d.room.bots)bot.player.countdown=90;broadcastRoom(d.room);return;}
      // Cantidad de bots: solo el anfitrión y solo antes de empezar; el servidor la ajusta a la capacidad.
      if(binary&&v.getUint8(1)===TYPE.ROOM_BOTS){if(v.byteLength!==13||!d.room||d.room.hostId!==d.player.id||d.room.started)return;d.room.botTarget=Math.min(v.getUint8(12),MAX_PARTICIPANTS-1);syncBots(d.room);broadcastRoom(d.room);return;}
      // Perfil visual (skin, tabla, wings, hat, nick): al entrar y cada vez que el jugador
      // cambia su equipamiento. Viaja a todos en cada SNAPSHOT, así que los que ya estaban
      // y los que entran tarde reciben el estado real de todos (en ambas direcciones).
      if(binary && v.getUint8(1)===TYPE.PROFILE) { applyProfile(d,readProfile(v));return; }
      if (!binary || v.getUint8(1) !== TYPE.INPUT || v.byteLength !== 14 || v.getInt8(12) === -128 || v.getUint8(13) > 15) throw Error('Invalid input');
      // Store scalars: uWS owns the incoming ArrayBuffer and invalidates it after this callback.
      pushInput(d.inputs,seq,v.getInt8(12)/127,v.getUint8(13)&15,performance.now());
    } catch { ws.end(1008, 'Invalid input'); }
  },
  close(ws) {const d=ws.getUserData(),room=d.room;d.closed=true;if(d.userId){const set=socketsByUser.get(d.userId);set?.delete(ws);if(!set?.size)socketsByUser.delete(d.userId);}if(!room)return;room.delete(ws);if(!room.size){room.bots.length=0;rooms.delete(room);publishLobby();}else{if(room.hostId===d.player.id)room.hostId=[...room][0].getUserData().player.id;syncBots(room);broadcastRoom(room);}}
}).post('/save-screenshot', (res, req) => {
  let buffer = Buffer.alloc(0);
  console.log('[server] receiving screenshot data...');
  res.onData((chunk, isLast) => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (isLast) {
      try {
        const str = buffer.toString('utf8');
        const base64Data = str.replace(/^data:image\/png;base64,/, '');
        writeFileSync(resolve(screenshotsRoot, 'bahia_coral_gameplay.png'), base64Data, 'base64');
        console.log('[server] screenshot saved successfully to disk!');
      } catch (e) {
        console.error('[server] screenshot error', e);
      }
      res.end('ok');
    }
  });
}).get('/*', (res, req) => {
  try {
    const pathname = decodeURIComponent(req.getUrl());
    const version = new URLSearchParams(req.getQuery() || '').get('v');
    const ifNoneMatch = req.getHeader('if-none-match');
    const publicPath = pathname === '/' ? 'index.html' : pathname.slice(1);
    // El manifiesto de assets no se expone como archivo: va embebido en el HTML.
    if (publicPath === 'asset-manifest.json') return res.writeStatus('404 Not Found').end();
    if (publicPath === 'index.html') return servePage(res, ifNoneMatch);
    const file = resolve(clientRoot, publicPath);
    const local = relative(clientRoot, file);
    const type = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.mp3':'audio/mpeg','.woff2':'font/woff2','.json':'application/json; charset=utf-8','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'}[extname(file)];
    if (!type || local.startsWith('..') || isAbsolute(local)) return res.writeStatus('404 Not Found').end();
    // Caché HTTP: ETag por contenido. Los assets pedidos con ?v=<hash actual> (los que
    // guarda el Service Worker) son inmutables; el resto se revalida (304 si no cambió).
    const {hash} = fileHash(file);
    const etag = `"${hash}"`;
    const immutable = local.startsWith('assets') && version === hash;
    const cacheControl = immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
    const notModified = !!ifNoneMatch && ifNoneMatch.split(/\s*,\s*/).some(t => t.replace(/^W\//, '') === etag);
    if (process.env.SURF_HTTP_LOG) console.log('[http]', notModified ? 304 : 200, pathname);
    if (notModified) {
      return res.writeStatus('304 Not Modified').writeHeader('ETag', etag).writeHeader('Cache-Control', cacheControl).end();
    }
    const asset = readFileSync(file);
    res.writeHeader('Cache-Control', cacheControl).writeHeader('ETag', etag).writeHeader('Content-Type', type);
    if (pathname === '/sw.js') res.writeHeader('Service-Worker-Allowed', '/');
    res.end(asset);
  } catch {
    res.writeStatus('404 Not Found').end();
  }
});
// index.html con el manifiesto de assets embebido (sin petición extra a /asset-manifest.json).
function servePage(res, ifNoneMatch) {
  let aborted = false; res.onAborted(() => { aborted = true; });
  currentManifest(clientRoot).then(manifest => {
    if (aborted) return;
    const html = embedManifest(readFileSync(resolve(clientRoot, 'index.html'), 'utf8'), manifest);
    const etag = `"${createHash('sha256').update(html).digest('hex').slice(0, 16)}"`;
    const notModified = !!ifNoneMatch && ifNoneMatch.split(/\s*,\s*/).some(t => t.replace(/^W\//, '') === etag);
    if (process.env.SURF_HTTP_LOG) console.log('[http]', notModified ? 304 : 200, '/index.html');
    res.cork(() => {
      if (notModified) return res.writeStatus('304 Not Modified').writeHeader('ETag', etag).writeHeader('Cache-Control', 'no-cache').end();
      res.writeHeader('Cache-Control', 'no-cache').writeHeader('ETag', etag).writeHeader('Content-Type', 'text/html; charset=utf-8').end(html);
    });
  }).catch(e => { console.error('[server] index.html', e); if (!aborted) res.cork(() => res.writeStatus('500 Internal Server Error').end()); });
}
let last = performance.now(), accumulator = 0;
setInterval(() => {
  const now = performance.now(); accumulator += Math.min((now-last)/1000, 0.2); last = now;
  let steps = 0;
  while (accumulator >= DT && steps++ < 5) {
    for (const room of rooms) {const uses=[];for (const ws of room) {
      const d=ws.getUserData();
      // Un input de la cola por tick (ver input-queue.js): el mismo que el cliente ya predijo.
      if(room.started){const input=nextInput(d.inputs,now);if(input.buttons&4)uses.push(d.player.id);advance(d.player,input.axis,input.buttons);}
      else resetInputs(d.inputs);
      d.player.seq=d.inputs.ackSeq;
      if(-d.player.z>=2880&&!d.player.place){d.player.place=++room.finishCount;rewardFinish(d,room);}
    }
    // Bots: la IA decide entradas como un jugador y se aplican con la misma física.
    const everyone=roomPlayers(room);
    for(const bot of room.bots){
      const input=botInput(bot.brain,bot.player,room.powerWorld,everyone);
      if(room.started)advance(bot.player,input.axis,input.buttons);
      if(input.buttons&4)uses.push(bot.player.id);
      if(-bot.player.z>=2880&&!bot.player.place)bot.player.place=++room.finishCount;
    }
    if(room.started)stepPowerWorld(room.powerWorld,everyone,uses);
    }
    tick++; accumulator -= DT;
  }
  if (steps > 5) accumulator = 0;
  if (tick !== lastSnapshot) {
    lastSnapshot = tick;
    for (const room of rooms) {
      const buffer = snapshot(roomPlayers(room),tick),powers=powerWorldPacket(room.powerWorld,tick);
      // Solo se omite el snapshot si el cliente acumula varios sin enviar; con ===0 bastaba un byte
      // pendiente para perder el tick entero y los rivales daban tirones.
      for (const ws of room) if (ws.getBufferedAmount() < SNAPSHOT_BACKLOG){ws.send(buffer,true);ws.send(powers,true);}
    }
  }
}, 4);
let lastSnapshot = 0;
const SNAPSHOT_BACKLOG = 4096;
mountApi(app, {auth, economy, config: authSettings, onEquipmentChanged: refreshEquipment});
app.listen(Number(process.env.PORT || 3000), token => {
  if (!token) { console.error('Unable to listen'); process.exit(1); }
  console.log('Surf Salvaje (protocolo v' + PROTOCOL_VERSION + '): http://localhost:' + (process.env.PORT || 3000));
  console.log('Base de datos: ' + describeDatabase());
  console.log('Cuentas: Google ' + (auth.enabled('google') ? 'activo' : 'sin configurar') + ' · Discord ' + (auth.enabled('discord') ? 'activo' : 'sin configurar') + ' · pagos reales deshabilitados');
});
