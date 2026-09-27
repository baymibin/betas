// Prueba en vivo de reconciliación con 8 humanos (sin bots) contra el servidor real.
//   node scripts/verify-inputs-live.mjs            · PORT (3000), JITTER ms (40), SECONDS (12)
// Cada cliente manda un input cada 33 ms con jitter de red simulado, predice como el juego
// (advance + reenviar pendientes al llegar un SNAPSHOT) y mide cuánto le corrige el servidor.
import {TYPE, read, states, input, profilePacket, roomRequest, readRoom, packet} from '../../client/src/shared/protocol.js';
import {advance} from '../../client/src/shared/simulation.js';

const PORT = Number(process.env.PORT || 3000), JITTER = Number(process.env.JITTER ?? 40), SECONDS = Number(process.env.SECONDS || 12);
const URL_ = `ws://127.0.0.1:${PORT}/play`;
const wait = ms => new Promise(r => setTimeout(r, ms));

function client(name, request) {
  const ws = new WebSocket(URL_); ws.binaryType = 'arraybuffer';
  const c = {name, ws, id: 0, room: null, player: null, pending: [], seq: 0, jumps: [], sendAt: 0, axis: 0};
  c.ready = new Promise((resolve, reject) => {
    ws.onmessage = ({data}) => {
      const v = read(data), t = v.getUint8(1);
      if (t === TYPE.WELCOME) { c.id = v.getUint32(12, true); ws.send(profilePacket({character: 0, board: 0, wing: 0, hat: 0, nick: name})); ws.send(request()); }
      if (t === TYPE.ROOM_STATE) { c.room = readRoom(v); resolve(c); }
      if (t !== TYPE.SNAPSHOT) return;
      const own = states(v).find(p => p.id === c.id); if (!own) return;
      const before = c.player;
      c.pending = c.pending.filter(p => p.seq > own.seq);
      c.player = {...own}; for (const p of c.pending) advance(c.player, p.axis, p.buttons);
      if (before && c.racing && !own.countdown) c.jumps.push(Math.hypot(c.player.x - before.x, c.player.z - before.z));
    };
    ws.onerror = reject;
  });
  // Un input cada 33 ms (como el juego); la red lo retrasa entre 0 y JITTER ms, en orden (TCP).
  c.tick = () => {
    if (!c.player || !c.room?.started) return;
    if (Math.random() < .08) c.axis = Math.round((Math.random() * 2 - 1) * 127) / 127;
    const cmd = {seq: ++c.seq, axis: c.axis, buttons: 8 | (Math.random() < .02 ? 1 : 0)};
    c.pending.push(cmd); advance(c.player, cmd.axis, cmd.buttons);
    const now = performance.now(); c.sendAt = Math.max(c.sendAt, now + Math.random() * JITTER);
    const buffer = input(cmd.seq, cmd.axis, cmd.buttons);
    setTimeout(() => { if (ws.readyState === 1) ws.send(buffer); }, c.sendAt - now);
  };
  return c;
}

const host = await client('Host', () => roomRequest(1, 0, '', 8, 0)).ready;
const guests = [];
for (let i = 1; i < 8; i++) guests.push(await client('Jugador' + i, () => roomRequest(2, 0, host.room.code)).ready);
const everyone = [host, ...guests];
host.ws.send(packet(TYPE.ROOM_START, 12).buffer);
await wait(300);
const timer = setInterval(() => everyone.forEach(c => c.tick()), 1000 / 30);
await wait(3300);                        // cuenta atrás de 3 s
everyone.forEach(c => { c.racing = true; });
await wait(SECONDS * 1000);
clearInterval(timer);

const jumps = everyone.flatMap(c => c.jumps), visible = jumps.filter(j => j > .05);
const sorted = [...jumps].sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * .95)] || 0;
console.log(`8 humanos · jitter ${JITTER} ms · ${SECONDS} s · ${jumps.length} snapshots`);
console.log(`correcciones visibles (>0.05): ${(visible.length / Math.max(1, jumps.length) * 100).toFixed(1)} %`);
console.log(`corrección media ${(jumps.reduce((a, b) => a + b, 0) / Math.max(1, jumps.length)).toFixed(3)} · p95 ${p95.toFixed(3)} · máx ${Math.max(0, ...jumps).toFixed(3)}`);
await Promise.all(everyone.map(c => new Promise(r => { c.ws.onclose = r; c.ws.close(); })));
