import {test} from 'node:test';
import assert from 'node:assert/strict';
import {botLooks, gridSlot, createBotPlayer, createBrain, botInput, CHARACTER_COUNT} from '../../client/src/shared/bot-ai.js';
import {boardSkins, WING_COUNT} from '../../client/src/shared/board-cosmetics.js';
import {snapshot, states, read} from '../../client/src/shared/protocol.js';
import {simulateRace} from '../scripts/sim-bots-race.mjs';

test('bots: personalización real, variada y distinta a la de los humanos', () => {
  const human = {character: 0, board: 0, wing: 7};
  const looks = botLooks(7, 42, [human], ['Kazaf']);
  assert.equal(looks.length, 7);
  for (const l of looks) {
    assert.ok(l.character >= 0 && l.character < CHARACTER_COUNT && l.board >= 0 && l.board < boardSkins.length && l.wing >= 0 && l.wing < WING_COUNT);
    assert.ok(!(l.character === 0 && l.board === 0 && l.wing === 7));
  }
  assert.equal(new Set(looks.map(l => `${l.character}-${l.board}-${l.wing}`)).size, 7);
  assert.equal(new Set(looks.map(l => l.wing)).size, 7, 'wings repetidas');
  assert.equal(new Set(looks.map(l => l.nick)).size, 7);
  assert.ok(new Set(looks.map(l => l.level)).size >= 3, 'faltan perfiles de dificultad');
});
test('bots: parrilla de salida sin superposición ni fuera del circuito', () => {
  const slots = Array.from({length: 7}, (_, i) => gridSlot(i));
  assert.equal(new Set(slots.map(s => s.x + ',' + s.z)).size, 7);
  for (const s of slots) { assert.ok(Math.abs(s.x) <= 9.4 && s.z > 0); assert.ok(Math.hypot(s.x, s.z) > 3); }
});
test('bots: la IA solo produce entradas humanas válidas', () => {
  const [look] = botLooks(1, 3), p = {...createBotPlayer(1, look, 0), countdown: 0}, brain = createBrain(look, 3);
  for (let i = 0; i < 300; i++) { const {axis, buttons} = botInput(brain, p, {boxes: [], taken: new Set(), entities: []}, [p]); assert.ok(axis >= -1 && axis <= 1 && buttons >= 0 && buttons <= 15); }
});
test('bots: viajan por red con su marca de bot y su equipamiento', () => {
  const [look] = botLooks(1, 9), p = createBotPlayer(12, look, 0);
  const d = states(read(snapshot([p], 1)))[0];
  assert.deepEqual([d.bot, d.character, d.board, d.wing, d.nick], [1, look.character, look.board, look.wing, look.nick]);
});
test('bots: carrera completa con la física real (3 vueltas, rampas, saltos, poderes)', () => {
  for (const seed of [1, 2, 3]) {
    const {all, stats} = simulateRace(seed);
    for (const p of all.filter(p => p.bot)) {
      const s = stats.get(p.id);
      assert.ok(p.place > 0, 'un bot no llegó a meta');
      assert.equal(s.laps.length, 3);
      assert.ok(p.ramps >= 10, 'no usa rampas');
      assert.ok(p.jumps >= 3, 'no salta');
    }
    assert.ok(all.filter(p => p.bot).some(p => stats.get(p.id).used > 0), 'nadie usó poderes');
  }
});
