// Pruebas en vivo de bots contra el servidor real (PORT, por defecto 3000).
//   node scripts/test-bots-live.mjs          · FULL=1 también corre la carrera completa (~2 min)
import assert from 'node:assert/strict';
import {TYPE, packet, profilePacket, read, states, roomRequest, readRoom, roomBots} from '../../client/src/shared/protocol.js';
import {LAP_LENGTH, TOTAL_LAPS} from '../../client/src/shared/course.js';

const URL_ = `ws://127.0.0.1:${Number(process.env.PORT || 3000)}/play`;
const wait = ms => new Promise(r => setTimeout(r, ms));
function client(name, look, request) {
  const ws = new WebSocket(URL_); ws.binaryType = 'arraybuffer';
  const c = {name, ws, id: 0, room: null, players: []};
  c.ready = new Promise((resolve, reject) => {
    ws.onmessage = ({data}) => { const v = read(data), t = v.getUint8(1);
      if (t === TYPE.WELCOME) { c.id = v.getUint32(12, true); ws.send(profilePacket({...look, nick: name})); ws.send(request()); }
      if (t === TYPE.ROOM_STATE) { c.room = readRoom(v); resolve(c); }
      if (t === TYPE.ERROR) reject(Error(name + ' error ' + v.getUint8(12)));
      if (t === TYPE.SNAPSHOT) c.players = states(v); };
    ws.onerror = reject;
  });
  c.bots = () => c.players.filter(p => p.bot);
  c.close = () => new Promise(r => { ws.onclose = r; ws.close(); });
  return c;
}
async function until(fn, label, ms = 4000) { const end = Date.now() + ms; for (;;) { try { const r = fn(); if (r !== false) return r; } catch (e) { if (Date.now() > end) throw e; } if (Date.now() > end) throw Error('timeout: ' + label); await wait(40); } }
const key = p => [p.id, p.nick, p.character, p.board, p.wing, p.hat].join('|');

// B: sala sin bots
const solo = await client('SinBots', {character: 0, board: 0, wing: 0}, () => roomRequest(1, 0, '', 8, 0)).ready;
await until(() => solo.players.length === 1, 'snapshot');
assert.equal(solo.bots().length, 0); console.log('✓ B  Sala sin bots: 0 bots'); await solo.close();

// C + D: sala con 3 bots y dos humanos que se unen
const host = await client('Anfitrion', {character: 0, board: 0, wing: 7}, () => roomRequest(1, 0, '', 8, 3)).ready;
await until(() => host.bots().length === 3, '3 bots');
const g1 = await client('Invitado1', {character: 1, board: 3, wing: 0}, () => roomRequest(2, 0, host.room.code)).ready;
const g2 = await client('Invitado2', {character: 4, board: 5, wing: 8}, () => roomRequest(2, 0, host.room.code)).ready;
await until(() => [host, g1, g2].every(c => c.players.length === 6), '6 participantes');
const ref = host.bots().map(key).sort().join('\n');
for (const c of [g1, g2]) assert.equal(c.bots().map(key).sort().join('\n'), ref, c.name + ' ve bots distintos');
console.log('✓ C  3 humanos ven los mismos 3 bots:\n   ' + host.bots().map(b => `${b.nick} (id ${b.id}) skin ${b.character} tabla ${b.board} wings ${b.wing}`).join('\n   '));
const combos = host.players.map(p => `${p.character}-${p.board}-${p.wing}`);
assert.equal(new Set(combos).size, combos.length, 'hay dos participantes idénticos');
assert.ok(new Set(host.bots().map(b => b.character)).size === 3, 'bots con el mismo color');
console.log('✓ D  Cada bot tiene su propio color, tabla y wings (sin combinaciones repetidas)');

// E: capacidad y prioridad humana; solo el anfitrión cambia bots
g1.ws.send(roomBots(0)); await wait(300);
assert.equal(host.bots().length, 3, 'un invitado pudo cambiar los bots');
host.ws.send(roomBots(7)); await until(() => host.players.length === 8 && host.bots().length === 5, 'tope 8');
console.log('✓ E  El anfitrión pide 7 bots con 3 humanos → el servidor deja 5 (total 8); un invitado no puede cambiarlos');
const g3 = await client('Invitado3', {character: 2, board: 1, wing: 4}, () => roomRequest(2, 0, host.room.code)).ready;
await until(() => host.players.length === 8 && host.bots().length === 4, 'bot libera plaza');
console.log('✓ E  Entra un 4º humano con la sala llena: un bot libera su plaza (4 humanos + 4 bots = 8)');
await g3.close();
await until(() => host.bots().length === 5, 'bot vuelve');
console.log('✓ E  Sale ese humano antes de la carrera: vuelve el bot (3 + 5 = 8)');
host.ws.send(roomBots(3)); await until(() => host.bots().length === 3 && g2.bots().length === 3, 'baja a 3');
console.log('✓ E  El anfitrión baja a 3 bots y todos lo reciben');

// Carrera: los bots arrancan con la cuenta atrás y avanzan con la física real
host.ws.send(packet(TYPE.ROOM_START, 12).buffer);
await until(() => host.bots().every(b => b.countdown === 0), 'salida', 6000);
await wait(3000);
const moved = host.bots().map(b => -b.z);
assert.ok(moved.every(d => d > 30), 'los bots no avanzan: ' + moved);
console.log('✓    Carrera iniciada: los bots avanzan (' + moved.map(d => d.toFixed(0) + ' m').join(', ') + ')');
const sameView = () => { const a = host.bots().map(b => b.id + ':' + Math.round(b.z)).join(), b = g1.bots().map(b => b.id + ':' + Math.round(b.z)).join(); return a === b; };
await until(sameView, 'misma posición en dos clientes', 2000);
console.log('✓    Dos clientes reciben las mismas posiciones de los bots (mismo tick)');
if (process.env.FULL) {
  await until(() => host.bots().every(b => b.place > 0), 'bots en meta', 180000);
  for (const b of host.bots().sort((a, b) => a.place - b.place)) console.log(`   meta: ${b.place}º ${b.nick} en ${(b.raceTicks / 30).toFixed(1)} s · ${Math.floor(-b.z / LAP_LENGTH)} vueltas · rampas ${b.ramps} · saltos ${b.jumps}`);
  assert.ok(host.bots().every(b => -b.z >= LAP_LENGTH * TOTAL_LAPS));
  console.log('✓ G  Los 3 bots completan las 3 vueltas y reciben su puesto en el servidor');
}
await Promise.all([host, g1, g2].map(c => c.close()));
console.log('Bots multijugador: OK');
