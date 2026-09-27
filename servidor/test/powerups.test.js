import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlayer,advance} from '../../client/src/shared/simulation.js';
import {createPowerWorld,stepPowerWorld,hurt,makeBoxes,predictSelfPower} from '../../client/src/shared/powerups.js';
import {LAP_LENGTH} from '../../client/src/shared/course.js';
import {snapshot,states,read,powerWorldPacket,readPowerWorld,input} from '../../client/src/shared/protocol.js';
test('one box has only one owner and cannot be farmed',()=>{const w=createPowerWorld(1),a=createPlayer(1),b=createPlayer(2),box=w.boxes.find(b=>b.y===1.1);a.x=b.x=box.x;a.z=b.z=box.z+1;stepPowerWorld(w,[a,b]);a.z=b.z=box.z-1;stepPowerWorld(w,[a,b],[],()=>0);assert.equal(a.heldItem,1);assert.equal(b.heldItem,0);assert.ok(w.taken.has(box.id));a.heldItem=0;stepPowerWorld(w,[a,b]);assert.equal(a.heldItem,0);});
test('Tiki lasts 240 ticks and blocks attacks; hit protection prevents combos',()=>{const w=createPowerWorld(),p=createPlayer(1);p.heldItem=1;stepPowerWorld(w,[p],[1]);assert.equal(p.shieldTicks,240);assert.equal(hurt(p,45),false);for(let i=0;i<240;i++)advance(p,0,0);assert.equal(p.shieldTicks,0);assert.equal(hurt(p,45),true);assert.equal(hurt(p,60),false);});
test('turbo propels the player and is consumed once',()=>{const w=createPowerWorld(),p=createPlayer(1),q=createPlayer(2);p.heldItem=2;stepPowerWorld(w,[p,q],[1]);assert.equal(p.turboTicks,90);assert.equal(p.heldItem,0);advance(p,0,0);advance(q,0,0);assert.ok(p.z<q.z);stepPowerWorld(w,[p,q],[1]);assert.equal(p.turboTicks,89);});
test('coconut follows a target; whirlpool spares its owner and expires',()=>{const w=createPowerWorld(),a=createPlayer(1),b=createPlayer(2);a.z=-20;b.z=-28;a.heldItem=3;stepPowerWorld(w,[a,b],[1]);assert.equal(w.entities[0].target,2);for(let i=0;i<12;i++)stepPowerWorld(w,[a,b]);assert.ok(b.slowTicks>0);a.heldItem=4;stepPowerWorld(w,[a,b],[1]);const e=w.entities[0];a.z=e.z;stepPowerWorld(w,[a,b]);assert.equal(a.slowTicks,0);b.z=e.z;b.guardTicks=0;stepPowerWorld(w,[a,b]);assert.equal(b.slowTicks,60);assert.equal(w.entities.length,0);});
test('powers and world state use validated binary offsets',()=>{const p={...createPlayer(9),heldItem:4,shieldTicks:237,turboTicks:81,slowTicks:42,guardTicks:87};assert.deepEqual(states(read(snapshot([p],123)))[0].shieldTicks,237);assert.equal(read(input(3,0,4)).getUint8(13),4);const w=createPowerWorld();w.taken.add(5);w.entities.push({id:1,kind:3,owner:9,target:10,x:2,z:-5,y:1,ttl:90});const decoded=readPowerWorld(read(powerWorldPacket(w)));assert.ok(decoded.taken.has(5));assert.deepEqual(decoded.entities,w.entities);assert.throws(()=>readPowerWorld(read(powerWorldPacket(w).slice(0,-1))));});

test('random boxes are reproducible, dispersed, and airborne boxes are collectible only at height',()=>{
 const w=createPowerWorld(14);assert.deepEqual(w.boxes,makeBoxes(14));assert.notDeepEqual(w.boxes,makeBoxes(15));
 const box=w.boxes.find(b=>b.y>3),p=createPlayer(1);p.x=box.x;p.z=box.z+1;stepPowerWorld(w,[p]);p.z=box.z-1;stepPowerWorld(w,[p]);assert.equal(p.heldItem,0);
 p.z=box.z+1;p.y=box.y-.8;stepPowerWorld(w,[p]);p.z=box.z-1;stepPowerWorld(w,[p]);assert.ok(p.heldItem>0);
 assert.deepEqual(readPowerWorld(read(powerWorldPacket(w))).boxes,w.boxes);
});
test('tidal pulse respects shields and keeps rivals inside the course',()=>{
 const w=createPowerWorld(1),a=createPlayer(1),b=createPlayer(2),c=createPlayer(3);a.x=8;b.x=9;c.x=7;c.shieldTicks=20;a.heldItem=5;
 stepPowerWorld(w,[a,b,c],[1]);assert.equal(b.x,10);assert.equal(c.x,7);assert.equal(a.heldItem,0);
});
test('foam hits forward, clears with Tiki, and does not hit protected rivals',()=>{
 const w=createPowerWorld(1),a=createPlayer(1),b=createPlayer(2);b.z=-5;a.heldItem=6;stepPowerWorld(w,[a,b],[1]);for(let i=0;i<4;i++)stepPowerWorld(w,[a,b]);assert.equal(b.foamTicks,60);
 b.heldItem=1;stepPowerWorld(w,[a,b],[2]);assert.equal(b.foamTicks,0);
});
test('dolphin launches and grants a short boost on landing',()=>{
 const w=createPowerWorld(1),p=createPlayer(1);p.x=9;p.heldItem=7;stepPowerWorld(w,[p],[1]);assert.equal(p.vy,11);assert.equal(p.jumps,1);
 let peak=0;for(let i=0;i<55;i++){advance(p,0,0);peak=Math.max(peak,p.y);}assert.ok(peak>3);assert.equal(p.dolphinTicks,0);assert.ok(p.turboTicks>0);
});
test('slipstream requires alignment behind the selected rival and is synchronized',()=>{
 const w=createPowerWorld(1),a=createPlayer(1),b=createPlayer(2);b.z=-20;a.heldItem=8;stepPowerWorld(w,[a,b],[1]);assert.equal(a.slipActive,1);assert.equal(a.slipTarget,2);
 b.x=8;stepPowerWorld(w,[a,b]);assert.equal(a.slipActive,0);
 a.foamTicks=33;a.dolphinTicks=44;const decoded=states(read(snapshot([a],1)))[0];for(const key of ['slipTicks','slipTarget','slipActive','foamTicks','dolphinTicks'])assert.equal(decoded[key],a[key]);
});

test('airborne boxes can be reached by real ramp physics on every map and speed mode',()=>{
 for(let mapId=0;mapId<8;mapId++)for(const turbo of [0,1,2]){
  const w=createPowerWorld(10+mapId),box=w.boxes.find(b=>b.y>3),p=createPlayer(1);w.boxes=[box];p.mapId=mapId;p.x=box.x;p.z=box.z+15;if(turbo===2)p.turboTicks=90;
  for(let tick=0;tick<60&&!p.heldItem;tick++){advance(p,0,turbo===1?2:0);stepPowerWorld(w,[p],[],()=>0);}
  assert.equal(p.heldItem,1,`map ${mapId}, boost ${turbo}`);
 }
});
test('el remolino persiste entre vueltas hasta que alguien lo atraviesa',()=>{
 const w=createPowerWorld(3),owner={...createPlayer(1),heldItem:4,z:-100,x:0},rival={...createPlayer(2),z:-300,x:6};
 stepPowerWorld(w,[owner,rival],[1]);
 const whirl=w.entities.find(e=>e.kind===4);assert.ok(whirl,'se crea el remolino');
 // Pasan varias vueltas de tiempo (antes caducaba a los 300 ticks = 10 s).
 for(let i=0;i<3000;i++)stepPowerWorld(w,[owner,rival]);
 assert.ok(w.entities.some(e=>e.id===whirl.id),'sigue en el agua tras 100 s');
 // El dueño completa una vuelta y vuelve a pasar por el mismo punto: no lo consume.
 owner.z=whirl.z-LAP_LENGTH;owner.x=whirl.x;stepPowerWorld(w,[owner,rival]);
 assert.ok(w.entities.some(e=>e.id===whirl.id),'cambiar de vuelta no lo elimina');
 // Otro jugador lo atraviesa en la vuelta 2: se activa una sola vez y desaparece.
 rival.z=whirl.z-LAP_LENGTH;rival.x=whirl.x;rival.y=0;stepPowerWorld(w,[owner,rival]);
 assert.ok(rival.slowTicks>0,'aplica su efecto al rival');
 assert.ok(!w.entities.some(e=>e.id===whirl.id),'se consume al activarse');
 // Una carrera nueva empieza sin remolinos consumidos ni heredados.
 assert.equal(createPowerWorld(3).entities.length,0);
});
test('el remolino viaja por red con su estado persistente',()=>{
 const w=createPowerWorld(5);w.entities.push({id:7,kind:4,owner:1,target:0,x:1.5,z:-420,y:.1,ttl:65000});
 const back=readPowerWorld(read(powerWorldPacket(w)));assert.equal(back.entities[0].kind,4);assert.equal(back.entities[0].ttl,65000);
});

test('client prediction of own Tiki, rocket and dolphin matches the server exactly',()=>{
 for(const [kind,y] of [[1,0],[2,0],[7,0],[7,2],[3,0],[5,0]]){
  const base={...createPlayer(4),heldItem:kind,y,slowTicks:20,impulse:-.5},server={...base},client={...base},other={...createPlayer(5),z:-40};
  advance(server,0,4);stepPowerWorld(createPowerWorld(1),[server,other],[4]);
  advance(client,0,4);predictSelfPower(client);
  // Los poderes que dependen de rivales (3, 5...) no se predicen: el cliente conserva el objeto.
  if([1,2,7].includes(kind))assert.deepEqual(client,server,'kind '+kind+' y '+y);
  else {assert.equal(client.heldItem,kind);}
 }
 const waiting={...createPlayer(6),heldItem:2,countdown:5};predictSelfPower(waiting);assert.equal(waiting.heldItem,2);assert.equal(waiting.turboTicks,0);
});
