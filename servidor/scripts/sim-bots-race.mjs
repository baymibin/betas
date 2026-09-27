// Simulación sin gráficos de una carrera completa con la física real del juego (advance +
// stepPowerWorld) para medir la IA: rampas, saltos, choques, cajas, poderes, vueltas y meta.
//   node scripts/sim-bots-race.mjs [semillas=5]
import {createPlayer, advance} from '../../client/src/shared/simulation.js';
import {createPowerWorld, stepPowerWorld} from '../../client/src/shared/powerups.js';
import {LAP_LENGTH, TOTAL_LAPS, raceProgress} from '../../client/src/shared/course.js';
import {botLooks, createBotPlayer, createBrain, botInput} from '../../client/src/shared/bot-ai.js';

export function simulateRace(seed, {bots = 7, human = 'straight', maxTicks = 30 * 400} = {}) {
  const world = createPowerWorld(seed);
  const humanP = {...createPlayer(0), nick: 'Humano', countdown: 90};
  const looks = botLooks(bots, seed, [{character: 0, board: 0, wing: 0}]);
  const racers = looks.map((look, i) => ({p: {...createBotPlayer(i + 1, look, i), countdown: 90}, brain: createBrain(look, seed * 31 + i), look}));
  const all = [humanP, ...racers.map(r => r.p)];
  const stats = new Map(all.map(p => [p.id, {divHits: 0, boxes: 0, used: 0, trapped: 0, laps: [], prevImpulse: 0, prevItem: 0, prevSlow: 0}]));
  let finishCount = 0, tick = 0;
  for (; tick < maxTicks && all.some(p => !p.place); tick++) {
    const uses = [];
    for (const p of all) {
      if (p.place) continue;
      let input = {axis: 0, buttons: 8};
      if (p.bot) input = botInput(racers.find(r => r.p === p).brain, p, world, all);
      const s = stats.get(p.id), beforeLap = raceProgress(p.z).lap;
      advance(p, input.axis, input.buttons);
      if (input.buttons & 4) uses.push(p.id);
      if (p.impulse < 0 && s.prevImpulse >= 0) s.divHits++;
      s.prevImpulse = p.impulse;
      const race = raceProgress(p.z);
      if (race.lap > beforeLap || (race.finished && s.laps.length < TOTAL_LAPS)) s.laps.push(tick);
      if (-p.z >= LAP_LENGTH * TOTAL_LAPS && !p.place) p.place = ++finishCount;
    }
    const held = new Map(all.map(p => [p.id, p.heldItem]));
    stepPowerWorld(world, all, uses);
    for (const p of all) {
      const s = stats.get(p.id);
      if (!held.get(p.id) && p.heldItem) s.boxes++;
      if (held.get(p.id) && !p.heldItem) s.used++;
      if (p.slowTicks >= 59 && s.prevSlow < 59) s.trapped++;
      s.prevSlow = p.slowTicks;
    }
  }
  return {tick, all, stats, racers, world};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = Number(process.argv[2] || 5);
  const agg = {};
  for (let seed = 1; seed <= seeds; seed++) {
    const {all, stats, racers} = simulateRace(seed);
    if (seed === 1) {
      console.log('Carrera semilla 1 (1 humano en línea recta + 7 bots):');
      for (const p of [...all].sort((a, b) => (a.place || 99) - (b.place || 99))) {
        const s = stats.get(p.id), r = racers.find(x => x.p === p);
        console.log(`  ${String(p.place || '-').padStart(2)}º ${p.nick.padEnd(12)} ${(r?.look.level || 'humano').padEnd(7)} skin ${p.character|0} tabla ${p.board|0} wings ${p.wing|0} | tiempo ${(p.raceTicks / 30).toFixed(1)}s | vueltas ${s.laps.length}/3 | rampas ${p.ramps} | saltos ${p.jumps} | choques separador ${s.divHits} | cajas ${s.boxes} | poderes usados ${s.used} | atrapado ${s.trapped}` + (r ? ` | turbos ${r.brain.stats.boosts} | esquivas ${r.brain.stats.dodges} | recuperaciones ${r.brain.recoveries}` : ''));
      }
    }
    for (const p of all) {
      const key = p.bot ? racers.find(x => x.p === p).look.level : 'humano recto';
      const s = stats.get(p.id), a = agg[key] ||= {n: 0, time: 0, ramps: 0, hits: 0, boxes: 0, used: 0, finished: 0, place: 0};
      a.n++; a.time += p.raceTicks / 30; a.ramps += p.ramps; a.hits += s.divHits; a.boxes += s.boxes; a.used += s.used; a.finished += s.laps.length === 3 ? 1 : 0; a.place += p.place || 9;
    }
  }
  console.log(`\nPromedio en ${seeds} carreras:`);
  for (const [k, a] of Object.entries(agg)) console.log(`  ${k.padEnd(13)} tiempo ${(a.time / a.n).toFixed(1)}s | puesto ${(a.place / a.n).toFixed(1)} | rampas ${(a.ramps / a.n).toFixed(1)}/60 | choques ${(a.hits / a.n).toFixed(1)} | cajas ${(a.boxes / a.n).toFixed(1)} | poderes ${(a.used / a.n).toFixed(1)} | terminan ${a.finished}/${a.n}`);
}
