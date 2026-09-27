import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlayer, advance} from '../../client/src/shared/simulation.js';
import {createInputQueue, pushInput, nextInput, resetInputs, MAX_QUEUE} from '../src/input-queue.js';

const TICK = 1000 / 30;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Un cliente manda un input cada 33 ms; la red añade latencia y jitter (TCP: llegan en orden).
// En cada tick se compara el jugador del servidor con lo que el cliente predice para el seq
// confirmado (aplicar los inputs 1..ack una vez cada uno). Un desfase constante no se nota (el
// cliente se re-basa en cada SNAPSHOT); lo que el jugador ve como tirón es que ese desfase cambie.
function simulate(mode, jitter, seed = 7, ticks = 900) {
  const random = rng(seed), inputs = [];
  let axis = 0, arrival = 0;
  for (let i = 1; i <= ticks + 20; i++) {
    if (random() < .1) axis = Math.round((random() * 2 - 1) * 127) / 127;
    const buttons = 8 | (random() < .03 ? 1 : 0);
    arrival = Math.max(arrival, i * TICK + 40 + random() * jitter);
    inputs.push({seq: i, axis, buttons, arrival});
  }
  const reference = [createPlayer(1)];
  for (const c of inputs) { const p = {...reference.at(-1)}; advance(p, c.axis, c.buttons); reference.push(p); }

  const server = createPlayer(1), q = createInputQueue();
  let old = {axis: 0, buttons: 0, lastSeq: 0, updatedAt: -Infinity}, next = 0, corrections = 0, worst = 0, lastX = 0, lastZ = 0;
  for (let k = 1; k <= ticks; k++) {
    const now = k * TICK + 40;
    while (next < inputs.length && inputs[next].arrival <= now) {
      const c = inputs[next++];
      if (mode === 'queue') pushInput(q, c.seq, c.axis, c.buttons, c.arrival);
      else { old.lastSeq = c.seq; old.axis = c.axis; old.buttons = (old.buttons & 5) | c.buttons; old.updatedAt = c.arrival; }
    }
    let ack;
    if (mode === 'queue') { const input = nextInput(q, now); advance(server, input.axis, input.buttons); ack = q.ackSeq; }
    else { const fresh = now - old.updatedAt < 500; advance(server, fresh ? old.axis : 0, fresh ? old.buttons : 0); old.buttons &= 2 | 8; ack = old.lastSeq; }
    const expected = reference[ack], dx = server.x - expected.x, dz = server.z - expected.z;
    const jump = Math.hypot(dx - lastX, dz - lastZ); lastX = dx; lastZ = dz;
    if (jump > .01) corrections++;
    worst = Math.max(worst, jump);
  }
  return {corrections: corrections / ticks, worst};
}

test('queued inputs keep the server in step with client prediction under jitter', () => {
  for (const jitter of [0, 25, 60, 90]) {
    const before = simulate('latest', jitter), after = simulate('queue', jitter);
    // Con la cola, el servidor coincide con la predicción en casi todos los ticks mientras el jitter
    // no supere unos dos ticks; con 90 ms mejora, pero haría falta un búfer adaptativo.
    if (jitter <= 60) assert.ok(after.corrections < .05, `jitter ${jitter}: ${after.corrections}`);
    assert.ok(after.corrections <= before.corrections, `jitter ${jitter}: ${after.corrections} > ${before.corrections}`);
    // Con jitter mayor que un tick, quedarse con el último input corregía al jugador casi a diario.
    if (jitter >= 60) assert.ok(before.corrections > .2, `jitter ${jitter}: la lógica antigua ya era exacta (${before.corrections})`);
  }
});

test('input queue: one advance per tick, one-shot buttons are never lost or repeated', () => {
  const q = createInputQueue();
  // Ráfaga de 10 inputs (más que la cola): no se aplica más de uno por tick y el salto se conserva.
  for (let i = 1; i <= 10; i++) pushInput(q, i, 0, i === 2 ? 1 | 8 : 8, 0);
  assert.equal(q.queue.length, MAX_QUEUE);
  assert.equal(q.queue[0].buttons & 1, 1, 'el salto del input descartado pasa al siguiente');
  assert.deepEqual(nextInput(q, 1), {axis: 0, buttons: 9});
  assert.equal(q.ackSeq, 5);
  // Repetidos y antiguos se ignoran.
  assert.equal(pushInput(q, 10, 1, 0, 2), false);
  assert.equal(pushInput(q, 3, 1, 0, 2), false);
  // Cola vacía: repite eje y botones mantenidos, nunca saltar/usar, y anota el tick debido.
  while (q.queue.length) nextInput(q, 3);
  pushInput(q, 11, .5, 8 | 4 | 1, 4); nextInput(q, 4);
  assert.deepEqual(nextInput(q, 5), {axis: .5, buttons: 8});
  assert.equal(q.owed, 1);
  // Con uno o dos inputs de colchón la deuda no se salda (el desfase se queda constante).
  pushInput(q, 12, .2, 8, 6); pushInput(q, 13, .3, 8, 6);
  assert.deepEqual(nextInput(q, 6), {axis: .2, buttons: 8});
  assert.equal(q.ackSeq, 12); assert.equal(q.owed, 1);
  // Si se acumulan más que el colchón, el primero salda la deuda (confirmado sin avanzar).
  pushInput(q, 14, .4, 8, 7); pushInput(q, 15, .5, 8, 7); pushInput(q, 16, .6, 8, 7);
  assert.deepEqual(nextInput(q, 7), {axis: .4, buttons: 8});
  assert.equal(q.ackSeq, 14); assert.equal(q.owed, 0); assert.equal(q.queue.length, 2);
  // Un input con salto no se usa para saldar deuda.
  while (q.queue.length) nextInput(q, 8);
  q.owed = 1; for (let i = 17; i <= 20; i++) pushInput(q, i, 0, i === 17 ? 1 : 0, 8);
  assert.equal(nextInput(q, 8).buttons, 1); assert.equal(q.ackSeq, 17); assert.equal(q.owed, 1);
  while (q.queue.length) nextInput(q, 9);
  // Sin inputs durante 500 ms: se detiene el eje como antes y se olvida la deuda.
  assert.deepEqual(nextInput(q, 600), {axis: 0, buttons: 0}); assert.equal(q.owed, 0);
  pushInput(q, 21, 0, 8, 601); resetInputs(q); assert.equal(q.ackSeq, 21); assert.equal(q.queue.length, 0);
});
