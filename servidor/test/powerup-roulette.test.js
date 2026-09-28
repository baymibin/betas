// Ruleta de la caja de poder (estilo Mario Kart): la primera E solo para la ruleta y la segunda
// usa el poder. Misma regla en el servidor, la práctica y la predicción del cliente.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlayer, advance} from '../../client/src/shared/simulation.js';
import {createPowerWorld, stepPowerWorld, predictSelfPower, itemRolling, ITEM_ROLL_TICKS} from '../../client/src/shared/powerups.js';
import {snapshot, states, read} from '../../client/src/shared/protocol.js';

function racer(id, z) { return Object.assign(createPlayer(id), {countdown: 0, z}); }
function grabBox() {
  const world = createPowerWorld(7), p = racer(1, 0), rival = racer(2, -500);
  const box = world.boxes.find(b => b.y < 2);
  Object.assign(p, {x: box.x, y: 0, raceTicks: 100});
  world.previous.set(p.id, box.z + 1);
  p.z = box.z - .2;
  stepPowerWorld(world, [p, rival], [], () => 0);
  return {world, p, rival};
}

test('picking a box starts the roulette instead of giving a ready item', () => {
  const {p} = grabBox();
  assert.ok(p.heldItem > 0);
  assert.equal(p.itemRollEnd, 100 + ITEM_ROLL_TICKS);
  assert.equal(itemRolling(p), true);
});

test('E during the roulette only stops it; the next E uses the item', () => {
  const {world, p, rival} = grabBox();
  const kind = p.heldItem;
  stepPowerWorld(world, [p, rival], [p.id]);
  assert.equal(p.heldItem, kind, 'primera E: se ve el poder, no se usa');
  assert.equal(itemRolling(p), false);
  stepPowerWorld(world, [p, rival], [p.id]);
  assert.ok(p.heldItem === 0 || [3, 7, 8].includes(kind), 'segunda E: se usa (salvo poderes que necesitan objetivo)');
});

test('the roulette stops by itself when the race clock reaches its end', () => {
  const {p} = grabBox();
  for (let i = 0; i < ITEM_ROLL_TICKS; i++) advance(p, 0, 0);
  assert.equal(itemRolling(p), false);
});

// La clave del arreglo: el servidor (advance + stepPowerWorld) y la predicción del cliente
// (advance + predictSelfPower) toman la misma decisión para cada pulsación de E, también
// justo antes, en y después del final de la ruleta (antes uno paraba y el otro usaba).
test('server and client prediction agree on every E press around the end of the roulette', () => {
  for (const kind of [2, 7]) for (let pressAt = ITEM_ROLL_TICKS - 3; pressAt <= ITEM_ROLL_TICKS + 3; pressAt++) {
    const start = {...racer(1, -50), heldItem: kind, raceTicks: 200, itemRollEnd: 200 + ITEM_ROLL_TICKS};
    const server = {...start}, client = {...start}, other = racer(2, -900), world = createPowerWorld(3);
    for (let tick = 1; tick <= ITEM_ROLL_TICKS + 6; tick++) {
      const buttons = tick === pressAt || tick === pressAt + 2 ? 4 : 0;
      advance(server, 0, buttons); stepPowerWorld(world, [server, other], buttons & 4 ? [server.id] : []);
      advance(client, 0, buttons); if (buttons & 4) predictSelfPower(client);
    }
    for (const key of ['heldItem', 'itemRollEnd', 'turboTicks', 'vy', 'y', 'dolphinTicks'])
      assert.equal(client[key], server[key], `poder ${kind}, E en el tick ${pressAt}: ${key}`);
  }
});

test('the roulette travels in the snapshot relative to the race clock', () => {
  const p = Object.assign(racer(1, 0), {heldItem: 4, raceTicks: 500, itemRollEnd: 542, nick: 'Kai'});
  const [back] = states(read(snapshot([p], 1)));
  assert.deepEqual([back.heldItem, back.itemRollEnd, itemRolling(back)], [4, 542, true]);
  const done = states(read(snapshot([{...p, itemRollEnd: 10}], 1)))[0];
  assert.equal(itemRolling(done), false);
});
