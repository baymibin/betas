// Surf Salvaje — IA de bots.
// Los bots NO tienen física propia: esta IA solo decide las mismas entradas que un humano
// (eje lateral, saltar, turbo, acelerar y usar habilidad) y el juego las aplica con
// advance() y stepPowerWorld(), igual que al jugador. Se usa en el servidor (multijugador,
// autoritativo) y en el cliente solo en el modo solitario.
import {courseSection,SECTION,SURF_LIMIT,LAP_LENGTH,TOTAL_LAPS} from './course.js';
import {playerSpeed,createPlayer} from './simulation.js';
import {boardSkins,WING_COUNT,HAT_COUNT} from './board-cosmetics.js';

export const CHARACTER_COUNT = 5;
export const MAX_PARTICIPANTS = 8;
// Botones (mismos bits que el INPUT humano): 1 saltar · 2 turbo · 4 usar habilidad · 8 acelerar.
const JUMP = 1, BOOST = 2, USE = 4, THROTTLE = 8;

// Perfiles de dificultad: cambian decisiones, nunca la física.
export const BOT_LEVELS = {
  easy:   {think: 9, aimNoise: .9,  rampChance: .5,  boxChance: .45, jumpSkill: .72, lookAhead: 40, boostStart: .95, boostStop: .5,  itemDelay: [70, 160], mistake: .035, dodge: .6},
  normal: {think: 5, aimNoise: .45, rampChance: .78, boxChance: .72, jumpSkill: .9,  lookAhead: 54, boostStart: .7,  boostStop: .3,  itemDelay: [25, 80],  mistake: .012, dodge: .82},
  hard:   {think: 2, aimNoise: .18, rampChance: .95, boxChance: .9,  jumpSkill: .98, lookAhead: 66, boostStart: .45, boostStop: .1,  itemDelay: [8, 35],   mistake: .003, dodge: .97}
};
const LEVEL_MIX = ['hard', 'normal', 'easy', 'normal', 'hard', 'normal', 'easy'];
export const BOT_NAMES = ['Kai Olas', 'Maya Reef', 'Leo Tubo', 'Nalu Brisa', 'Tiki Rider', 'Coral Jade', 'Bruno Swell',
  'Luna Spray', 'Duke Marea', 'Iris Barril', 'Sol Pipeline', 'Noa Espuma', 'Rayo Kahuna', 'Mara Lagoon'];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Personalización aleatoria con variedad: solo IDs reales de los catálogos
// (5 skins de la tienda, boardSkins, WING_COUNT wings, HAT_COUNT hats).
// taken = equipamiento ya presente (humanos u otros bots) para no repetir combinaciones.
export function botLooks(count, seed, taken = [], usedNames = []) {
  const random = rng(seed), combos = [];
  for (let c = 0; c < CHARACTER_COUNT; c++) for (let b = 0; b < boardSkins.length; b++) for (let w = 0; w < WING_COUNT; w++) combos.push({character: c, board: b, wing: w});
  for (let i = combos.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [combos[i], combos[j]] = [combos[j], combos[i]]; }
  const seen = [...taken], names = BOT_NAMES.filter(n => !usedNames.includes(n)), out = [];
  for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
  for (let k = 0; k < count; k++) {
    let best = null, bestScore = -1;
    for (const c of combos) {
      if (seen.some(s => s.character === c.character && s.board === c.board && s.wing === c.wing)) continue;
      const score = (seen.some(s => s.character === c.character) ? 0 : 3) + (seen.some(s => s.wing === c.wing) ? 0 : 2) + (seen.some(s => s.board === c.board) ? 0 : 1);
      if (score > bestScore) { best = c; bestScore = score; if (score === 6) break; }
    }
    seen.push(best);
    out.push({...best, hat: Math.floor(random() * HAT_COUNT), nick: names[k % names.length] || 'Surf Bot ' + (k + 1), level: LEVEL_MIX[(out.length + (seed & 3)) % LEVEL_MIX.length]});
  }
  return out;
}

// Parrilla de salida: filas de dos detrás de la línea, a los lados del carril central
// (donde salen los humanos), nunca encima de otro participante ni fuera de los límites.
export function gridSlot(index) {
  const row = Math.floor(index / 2), side = index % 2 ? 1 : -1;
  return {x: side * (row % 2 ? 6.2 : 3.4), z: 3 + row * 3.2};
}

export function createBotPlayer(id, look, index, mapId = 0) {
  const slot = gridSlot(index);
  return {...createPlayer(id), ...look, bot: 1, mapId, x: slot.x, z: slot.z, countdown: 65535};
}

export function createBrain(look, seed, mapId = 0) {
  const random = rng(seed ^ 0x9E3779B9);
  const level = BOT_LEVELS[look.level] || BOT_LEVELS.normal;
  return {random, level, mapId, lane: (random() * 2 - 1) * 4.2, target: 0, noise: 0, nextThink: 0, tick: 0,
    rampPlan: new Map(), boxPlan: new Map(), jumpAt: null, boosting: false, itemSince: -1, itemWait: 0,
    distractedUntil: 0, best: -Infinity, bestTick: 0, recoveries: 0, lastGood: null, stats: {jumps: 0, dodges: 0, boosts: 0, items: 0, rampsAimed: 0}};
}

const lapDz = (az, bz) => { let dz = (((-az) % LAP_LENGTH + LAP_LENGTH) % LAP_LENGTH) - (((-bz) % LAP_LENGTH + LAP_LENGTH) % LAP_LENGTH); if (dz > LAP_LENGTH / 2) dz -= LAP_LENGTH; if (dz < -LAP_LENGTH / 2) dz += LAP_LENGTH; return dz; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Decide las entradas de un tick. p = estado del bot (mismo formato que un jugador),
// world = mundo de poderes, players = todos los participantes (humanos y bots).
export function botInput(brain, p, world, players) {
  if (p.countdown || p.place || -p.z >= LAP_LENGTH * TOTAL_LAPS) { brain.jumpAt = null; return {axis: 0, buttons: 0}; }
  brain.tick++;   // solo cuenta ticks de carrera (la cuenta atrás no es "falta de progreso")
  const L = brain.level, rand = brain.random, limit = SURF_LIMIT - (p.mapId || 0) * .4 - .55;
  const d0 = -p.z, v = Math.max(8, playerSpeed(p, brain.boosting, true));
  recover(brain, p);

  // ---- Navegación: se replanifica cada L.think ticks (tiempo de reacción del perfil).
  if (brain.tick >= brain.nextThink) {
    brain.nextThink = brain.tick + L.think;
    think(brain, p, world, players, d0, v, limit);
  }
  let target = clamp(brain.target + brain.noise, -limit, limit);

  // Esquiva reactiva de último momento (proyectiles de espuma que vienen por detrás).
  for (const e of world?.entities || []) {
    if (e.kind === 6 && e.owner !== p.id && e.z > p.z && e.z - p.z < 18 && Math.abs(e.x - p.x) < 2) {
      if (rand() < L.dodge) { target = clamp(p.x + (p.x >= e.x ? 3 : -3), -limit, limit); brain.stats.dodges++; }
    }
  }

  // ---- Dirección: mismo eje -1..1 que el teclado/ratón humano.
  const diff = target - p.x;
  const axis = Math.abs(diff) < .06 ? 0 : clamp(diff * 1.9, -1, 1);

  let buttons = THROTTLE;
  // ---- Salto planificado (por encima de separadores o del remolino).
  if (brain.jumpAt !== null && p.y === 0 && d0 >= brain.jumpAt) { buttons |= JUMP; brain.jumpAt = null; brain.stats.jumps++; }
  if (p.y > 0 && brain.jumpAt !== null && d0 > brain.jumpAt + 12) brain.jumpAt = null;

  // ---- Turbo con histéresis: solo cuando rinde (sin impulso de rampa ni cohete activo).
  const lastLap = d0 > LAP_LENGTH * (TOTAL_LAPS - 1);
  const start = lastLap ? L.boostStart * .75 : L.boostStart;
  if (p.impulse > 0 || p.turboTicks > 0 || p.slowTicks > 0) brain.boosting = false;
  else if (!brain.boosting && p.energy >= start) { brain.boosting = true; brain.stats.boosts++; }
  else if (brain.boosting && p.energy <= L.boostStop) brain.boosting = false;
  if (brain.boosting) buttons |= BOOST;

  // ---- Habilidades: se usan según su regla real (ver stepPowerWorld).
  if (p.heldItem) {
    if (brain.itemSince < 0) { brain.itemSince = brain.tick; brain.itemWait = L.itemDelay[0] + Math.floor(rand() * (L.itemDelay[1] - L.itemDelay[0])); }
    if (shouldUse(brain, p, world, players, d0)) { buttons |= USE; brain.stats.items++; }
  } else brain.itemSince = -1;
  return {axis, buttons};
}

function think(brain, p, world, players, d0, v, limit) {
  const L = brain.level, rand = brain.random;
  if (brain.tick < brain.distractedUntil) return;
  if (rand() < L.mistake) {            // error ocasional controlado: pierde la línea un momento
    brain.distractedUntil = brain.tick + 18 + Math.floor(rand() * 24);
    brain.target = clamp(p.x + (rand() * 2 - 1) * 5, -limit, limit); brain.noise = 0; brain.jumpAt = null;
    return;
  }
  let target = brain.lane, precise = false;
  const reach = t => 7 * t * .92 + 1.1;   // desplazamiento lateral posible en t segundos

  // 1) Rampa siguiente: decidir una vez por rampa si se toma; tomarla solo si llega.
  const i = Math.max(0, Math.ceil((d0 + .5 - 32) / SECTION)), ramp = courseSection(i), rampDist = -ramp.z - d0;
  if (rampDist > 0 && rampDist < L.lookAhead + 20) {
    if (!brain.rampPlan.has(i)) { brain.rampPlan.set(i, rand() < L.rampChance); if (brain.rampPlan.size > 8) brain.rampPlan.delete(brain.rampPlan.keys().next().value); }
    if (brain.rampPlan.get(i) && Math.abs(ramp.x - p.x) <= reach(rampDist / v) && p.y < 1.3) { target = ramp.x; precise = true; brain.stats.rampsAimed++; }
  }
  // 2) Caja sorpresa en el agua (solo si no lleva habilidad; mismas reglas de recogida).
  if (!precise && !p.heldItem && world?.boxes) {
    for (const box of world.boxes) {
      if (box.y > 2 || world.taken?.has(box.id)) continue;
      const dist = -box.z - d0;
      if (dist < 2 || dist > L.lookAhead) continue;
      if (!brain.boxPlan.has(box.id)) brain.boxPlan.set(box.id, rand() < L.boxChance);
      if (brain.boxPlan.get(box.id) && Math.abs(box.x - p.x) <= reach(dist / v)) { target = box.x; precise = true; break; }
    }
  }
  // 3) Estela del líder: seguir al rival marcado.
  if (!precise && p.slipTicks > 0) { const lead = players.find(q => q.id === p.slipTarget); if (lead) target = lead.x; }

  // 4) Peligros: separador del carril (frena si no se salta), remolino y trampa roja.
  const predictX = dist => { const t = Math.max(0, dist) / v; return p.x + clamp(target - p.x, -7 * t, 7 * t); };
  brain.jumpAt = null;
  const j = Math.max(0, Math.ceil((d0 + .5 - 56) / SECTION)), div = courseSection(j), divX = -div.x * .6, divDist = -(div.z - 24) - d0;
  const rampCarries = precise && target === ramp.x && rampDist > 0 && rampDist < divDist;   // el vuelo de la rampa ya pasa por encima
  if (divDist > 0 && divDist < 34 && !(p.shieldTicks > 0) && !rampCarries) {
    const crossX = predictX(divDist), airborne = p.y > 0 && divDist / v < .5;
    if (Math.abs(crossX - divX) < 1.9 && !airborne) {
      if (rand() < L.jumpSkill) planJump(brain, d0 + divDist, v, rand, L);          // saltarlo en el momento justo
      else if (!precise) { target = clamp(divX + (p.x >= divX ? 2.8 : -2.8), -limit, limit); brain.stats.dodges++; }
    }
  }
  for (const e of world?.entities || []) {
    if ((e.kind !== 4 && e.kind !== 5) || (e.kind === 4 && e.owner === p.id)) continue;
    const dist = -lapDz(p.z, e.z);            // distancia hacia delante en el mismo punto de la vuelta
    if (dist < 1 || dist > 36) continue;
    const crossX = predictX(dist);
    if (Math.abs(crossX - e.x) > 2.4) continue;
    if (rand() > L.dodge) continue;
    brain.stats.dodges++;
    if (e.kind === 4 && dist < v * .6 && p.y === 0 && !precise) planJump(brain, d0 + dist, v, rand, L);   // el remolino solo atrapa en el agua
    else target = clamp(e.x + (p.x >= e.x ? 3.2 : -3.2), -limit, limit);                               // la trampa roja atrapa también en el aire
  }
  // 5) Separación entre surfistas para no ir superpuestos.
  for (const q of players) {
    if (q.id === p.id || Math.abs(q.z - p.z) > 3 || Math.abs(q.x - target) > 1.1 || precise) continue;
    target += (p.id > q.id ? 1.4 : -1.4);
  }
  brain.target = clamp(target, -limit, limit);
  brain.noise = (rand() * 2 - 1) * L.aimNoise * (precise ? .35 : 1);
  // El carril libre cambia de vez en cuando para que cada bot tenga su propia línea.
  if (rand() < .02) brain.lane = clamp((rand() * 2 - 1) * 5, -limit, limit);
}

// Salto: y(t) = 6t − 7t² supera 0.85 entre t≈0.18 s y t≈0.68 s. Se apunta al centro
// de esa ventana (≈0.42 s antes del obstáculo); el perfil añade error de sincronización.
function planJump(brain, obstacleDist, v, rand, L) {
  const lead = v * (.42 + (rand() * 2 - 1) * .2 * (1 - L.jumpSkill + .05));
  brain.jumpAt = obstacleDist - lead;
}

function shouldUse(brain, p, world, players, d0) {
  const waited = brain.tick - brain.itemSince >= brain.itemWait, long = brain.tick - brain.itemSince >= brain.itemWait * 3 + 90;
  const rivals = players.filter(q => q.id !== p.id && !q.place && !q.countdown);
  const ahead = rivals.filter(q => q.z < p.z).sort((a, b) => b.z - a.z)[0];
  const behindClose = rivals.some(q => q.z > p.z && q.z - p.z < 40 && Math.abs(q.x - p.x) < 3.5);
  const hazardAhead = (world?.entities || []).some(e => (e.kind === 4 || e.kind === 5) && e.owner !== p.id && -lapDz(p.z, e.z) > 0 && -lapDz(p.z, e.z) < 14 && Math.abs(e.x - p.x) < 2);
  switch (p.heldItem) {
    case 1: return (world?.entities || []).some(e => e.kind === 3 && e.target === p.id) || hazardAhead || (waited && long);  // Tiki: escudo cuando hay amenaza
    case 2: return waited && p.slowTicks === 0;                                                   // Ola cohete: turbo directo
    case 3: return waited && !!ahead;                                                              // Coco buscador: necesita un rival delante
    case 4: return waited && (behindClose || long);                                                // Remolino: se deja detrás, mejor con rivales cerca
    case 5: return waited && (rivals.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 9) || long);     // Pulso: empuja a los cercanos
    case 6: return waited && ahead && ahead.z - p.z > -45 && Math.abs(ahead.x - p.x) < 1.3;        // Espuma: sale recta hacia delante
    case 7: return p.y < 1.3 && ((brain.jumpAt !== null && d0 >= brain.jumpAt - 4) || (waited && long));  // Delfín: salto grande sobre un obstáculo
    case 8: return waited && !!ahead && p.z - ahead.z < 45;                                        // Estela del líder
  }
  return false;
}

// Recuperación excepcional: estado inválido (NaN) o sin progreso real durante 3 s.
function recover(brain, p) {
  const d0 = -p.z;
  if (![p.x, p.z, p.y, p.vy].every(Number.isFinite)) {
    if (brain.lastGood) Object.assign(p, brain.lastGood); else Object.assign(p, {x: 0, y: 0, vy: 0});
    brain.recoveries++; return;
  }
  if (brain.tick % 15 === 0) brain.lastGood = {x: p.x, z: p.z, y: p.y, vy: p.vy};
  if (d0 > brain.best + .5) { brain.best = d0; brain.bestTick = brain.tick; }
  else if (brain.tick - brain.bestTick > 90) {
    brain.recoveries++; brain.bestTick = brain.tick;
    brain.target = 0; brain.noise = 0; brain.jumpAt = null; brain.boosting = false; brain.distractedUntil = 0;
  }
}
