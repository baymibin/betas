// Prueba en vivo con 3 clientes: cada uno debe ver la skin, tabla y wings REALES de los demás
// en la sala de espera, tras un cambio de equipamiento, tras salir/volver a entrar y en carrera.
// Requiere el servidor corriendo:  PORT=3000 node src/index.js   y luego   node scripts/test-cosmetics-sync-live.mjs
import assert from 'node:assert/strict';
import {TYPE, packet, profilePacket, read, states, roomRequest, readRoom} from '../../client/src/shared/protocol.js';

const URL_ = `ws://127.0.0.1:${Number(process.env.PORT || 3000)}/play`;
const wait = ms => new Promise(r => setTimeout(r, ms));

function client(name, look, request) {
  const ws = new WebSocket(URL_); ws.binaryType = 'arraybuffer';
  const c = {name, look: {...look, nick: name}, ws, id: 0, room: null, players: [], error: null};
  c.ready = new Promise((resolve, reject) => {
    ws.onmessage = ({data}) => {
      const v = read(data), type = v.getUint8(1);
      if (type === TYPE.WELCOME) { c.id = v.getUint32(12, true); ws.send(profilePacket(c.look)); ws.send(request()); }
      if (type === TYPE.ROOM_STATE) { c.room = readRoom(v); resolve(c); }
      if (type === TYPE.ERROR) { c.error = v.getUint8(12); reject(Error(name + ' ERROR ' + c.error)); }
      if (type === TYPE.SNAPSHOT) c.players = states(v);
    };
    ws.onerror = reject;
  });
  c.change = look => { Object.assign(c.look, look); ws.send(profilePacket(c.look)); };
  c.close = () => new Promise(r => { ws.onclose = r; ws.close(); });
  return c;
}
const join = code => () => roomRequest(2, 0, code);

// Cada cliente debe ver a todos (incluido él mismo) con el equipamiento real.
async function expectAllSee(clients, label) {
  const deadline = Date.now() + 3000;
  for (;;) {
    try {
      for (const viewer of clients) for (const other of clients) {
        const seen = viewer.players.find(p => p.id === other.id);
        assert.ok(seen, `${viewer.name} no ve a ${other.name}`);
        for (const k of ['character', 'board', 'wing', 'hat', 'nick'])
          assert.equal(seen[k], other.look[k], `${label}: ${viewer.name} ve ${k} de ${other.name} = ${seen[k]}, esperado ${other.look[k]}`);
      }
      console.log('✓', label);
      return;
    } catch (e) { if (Date.now() > deadline) throw e; await wait(50); }
  }
}

const PC1 = {character: 0, board: 0, wing: 7, hat: 0};   // Classic · Ola Tropical · Dark Demon
const PC2 = {character: 1, board: 3, wing: 0, hat: 0};   // Mint · Anime · Angel
const PC3 = {character: 4, board: 5, wing: 8, hat: 0};   // Coral · Bloques · Mechanical Demon

const pc1 = await client('PC1', PC1, () => roomRequest(1, 0, '', 8)).ready;
const code = pc1.room.code;
const pc2 = await client('PC2', PC2, join(code)).ready;
let pc3 = await client('PC3', PC3, join(code)).ready;
await expectAllSee([pc1, pc2, pc3], 'Sala de espera: los 3 ven el equipamiento real de todos');

pc2.change({board: 1, wing: 5});   // Gótica · Bat Demon
await expectAllSee([pc1, pc2, pc3], 'PC2 cambia tabla y wings: los demás lo ven sin recrear la sala');

const oldId = pc3.id; await pc3.close();
await wait(200);
for (const c of [pc1, pc2]) assert.ok(!c.players.some(p => p.id === oldId), c.name + ' sigue viendo a PC3 desconectado');
console.log('✓ PC3 se desconecta: desaparece de la sala de PC1 y PC2');

pc3 = await client('PC3', PC3, join(code)).ready;
await expectAllSee([pc1, pc2, pc3], 'PC3 vuelve a entrar: recibe a los que ya estaban y ellos lo reciben a él');

pc1.ws.send(packet(TYPE.ROOM_START, 12).buffer);
await wait(300);
assert.ok(pc2.room.started && pc3.room.started, 'la carrera no empezó');
await expectAllSee([pc1, pc2, pc3], 'Carrera iniciada: el equipamiento se mantiene para todos');

await Promise.all([pc1.close(), pc2.close(), pc3.close()]);
console.log('✓ Sincronización de personalizaciones con 3 clientes: OK');
