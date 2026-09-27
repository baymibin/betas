import assert from 'node:assert/strict';
import {createPowerWorld, stepPowerWorld} from '../../client/src/shared/powerups.js';
import {LAP_LENGTH} from '../../client/src/shared/course.js';

console.log('--- Testing Bug 1: Box collection reliability and holding block ---');
{
  const world = createPowerWorld(42);
  const targetBox = world.boxes[0];
  
  // Surfer A holding nothing
  const playerA = {
    id: 1,
    countdown: 0,
    place: 0,
    z: targetBox.z + 5,
    x: targetBox.x,
    y: targetBox.y - 0.8,
    heldItem: 0
  };

  // Step towards box
  world.previous.set(playerA.id, playerA.z);
  playerA.z = targetBox.z - 1; // crossed the box
  
  stepPowerWorld(world, [playerA]);
  
  assert.ok(world.taken.has(targetBox.id), 'Box 0 should be collected when player has no heldItem');
  assert.ok(playerA.heldItem > 0, `Player A picked up powerup ${playerA.heldItem}`);
  console.log(`✓ Surfer without heldItem collected Box 0 and received powerup #${playerA.heldItem}`);

  // Now Surfer A has a heldItem. Try to cross Box 1 while holding item
  const box1 = world.boxes[1];
  const initialHeld = playerA.heldItem;
  playerA.x = box1.x;
  playerA.y = box1.y - 0.8;
  world.previous.set(playerA.id, box1.z + 5);
  playerA.z = box1.z - 1; // crossed box 1

  stepPowerWorld(world, [playerA]);

  assert.ok(!world.taken.has(box1.id), 'Box 1 MUST NOT be collected while player holds an item');
  assert.equal(playerA.heldItem, initialHeld, 'Player held item should remain unchanged');
  console.log('✓ Surfer with heldItem passed through Box 1 WITHOUT collecting or breaking it!');
}

console.log('\n--- Testing Bug 2: Red Trap Box persistent lifetime and complete lap collision ---');
{
  const world = createPowerWorld(100);
  
  // Surfer A has kind=5 (Pulso de marea) on Lap 1
  const playerA = {
    id: 1,
    countdown: 0,
    place: 0,
    x: 0,
    z: -100, // Lap 1 position
    y: 0.1,
    heldItem: 5,
    shieldTicks: 0,
    guardTicks: 0,
    slowTicks: 0
  };

  // Player A drops red trap box
  stepPowerWorld(world, [playerA], [playerA.id]);
  assert.equal(playerA.heldItem, 0, 'Player A consumed powerup 5');
  
  const trap = world.entities.find(e => e.kind === 5 && e.owner === playerA.id);
  assert.ok(trap, 'Red trap box entity should be spawned in world');
  assert.equal(trap.ttl, 65000, 'Red trap box has persistent TTL of 65000 ticks');
  console.log(`✓ Red trap box spawned at x=${trap.x}, z=${trap.z}, ttl=${trap.ttl}`);

  // Simulate racing for 1200 ticks (~40 seconds, more than 1 full lap!)
  // The trap MUST NOT disappear!
  for (let i = 0; i < 1200; i++) {
    stepPowerWorld(world, [playerA]);
  }

  assert.ok(world.entities.some(e => e.id === trap.id), 'Red trap box must remain on track after 1200 ticks');
  assert.equal(trap.ttl, 65000, 'Red trap box TTL does not decay over time');
  console.log('✓ Red trap box remained active and persistent on track through 1200 ticks (>40 seconds)!');

  // Now Surfer A completes a full lap and reaches the exact same track location on Lap 2!
  // On Lap 2, player's z is: initial_z - LAP_LENGTH (-100 - 960 = -1060)
  playerA.x = trap.x;
  playerA.z = trap.z - LAP_LENGTH; // -1060 (Lap 2!)
  playerA.guardTicks = 0;
  playerA.slowTicks = 0;

  stepPowerWorld(world, [playerA]);

  assert.equal(playerA.slowTicks, 60, 'Player should collide with trap box and be slowed after a complete lap!');
  assert.ok(!world.entities.some(e => e.id === trap.id), 'Red trap box was consumed upon collision on Lap 2');
  console.log('✓ Surfer on Lap 2 successfully collided with the Lap 1 red trap box, slowed down for 60 ticks, and trap was consumed!');
}

console.log('\nALL VERIFICATION TESTS PASSED SUCCESSFULLY! 🎯');
