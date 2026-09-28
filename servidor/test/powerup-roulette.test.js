// Ruleta de la caja de poder (estilo Mario Kart): la primera E solo para la ruleta y la segunda
// usa el poder. Misma regla en el servidor, la práctica y la predicción del cliente.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlayer} from '../../client/src/shared/simulation.js';
import {createPowerWorld, stepPowerWorld, predictSelfPower, ITEM_ROLL_TICKS} from '../../client/src/shared/powerups.js';
import {snapshot, states, read} from '../../client/src/shared/protocol.js';

function racer(id, z) { return Object.assign(createPlayer(id), {countdown: 0, z}); }
function grabBox() {
  const world = createPowerWorld(7), p = racer(1, 0), rival = racer(2, -500);
  const box = world.boxes.find(b => b.y < 2);
  Object.assign(p, {x: box.x, z: box.z + .5, y: 0});
  world.previous.set(p.id, box.z + 1);
  p.z = box.z - .2;
  stepPowerWorld(world, [p, rival], [], () => 0);
  return {world, p, rival};
}

test('picking a box starts the roulette instead of giving a ready item', () => {
  const {p} = grabBox();
  assert.ok(p.heldItem > 0);
  assert.equal(p.itemRoll, ITEM_ROLL_TICKS);
});

test('E during the roulette only stops it; the next E uses the item', () => {
  const {world, p, rival} = grabBox();
  const kind = p.heldItem;
  stepPowerWorld(world, [p, rival], [p.id]);
  assert.deepEqual([p.heldItem, p.itemRoll], [kind, 0], 'primera E: se ve el poder, no se usa');
  stepPowerWorld(world, [p, rival], [p.id]);
  assert.ok(p.heldItem === 0 || [3, 7, 8].includes(kind), 'segunda E: se usa (salvo poderes que necesitan objetivo)');
});

test('the roulette stops by itself and the client predicts the same stop', () => {
  const {world, p, rival} = grabBox();
  for (let i = 0; i < ITEM_ROLL_TICKS; i++) stepPowerWorld(world, [p, rival], []);
  assert.equal(p.itemRoll, 0);
  const copy = {...p, itemRoll: 30, heldItem: 2};
  predictSelfPower(copy);
  assert.deepEqual([copy.itemRoll, copy.heldItem], [0, 2], 'la predicción también solo para la ruleta');
});

test('the roulette state travels in the snapshot', () => {
  const p = Object.assign(racer(1, 0), {heldItem: 4, itemRoll: 42, nick: 'Kai'});
  const [back] = states(read(snapshot([p], 1)));
  assert.deepEqual([back.heldItem, back.itemRoll], [4, 42]);
});
