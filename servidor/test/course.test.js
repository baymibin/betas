import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advance,createPlayer} from '../../client/src/shared/simulation.js';
import {SURF_LIMIT} from '../../client/src/shared/course.js';
import {snapshot,read,states} from '../../client/src/shared/protocol.js';
test('full course width remains bounded at the visible wooden rails',()=>{
 const p=createPlayer(1);for(let i=0;i<100;i++)advance(p,1,0);assert.equal(p.x,SURF_LIMIT);
 for(let i=0;i<200;i++)advance(p,-1,0);assert.equal(p.x,-SURF_LIMIT);
});
test('ramp launches and accelerates only when crossed within its width',()=>{
 const p={...createPlayer(1),z:-31.9};advance(p,0,0);assert.ok(p.vy>8);assert.ok(p.impulse>2);assert.ok(p.y>0);
 const miss={...createPlayer(2),z:-31.9,x:5};advance(miss,0,0);assert.equal(miss.impulse,0);assert.equal(miss.y,0);
 const before=p.z;advance(p,0,0);assert.ok(before-p.z>.7);
});
test('impulse snapshot reconciles identically across a ramp',()=>{
 const p={...createPlayer(1),z:-31.9};advance(p,0,0);
 const restored=states(read(snapshot([p],1)))[0];
 for(let i=0;i<25;i++){advance(p,.2,0);advance(restored,.2,0);}
 assert.ok(Math.abs(p.z-restored.z)<.0001);assert.ok(Math.abs(p.y-restored.y)<.0001);
});
test('wooden division slows a grounded surfer and can be jumped',()=>{
 const p={...createPlayer(1),z:-55.9};advance(p,0,0);assert.ok(p.impulse<0);
 const airborne={...createPlayer(2),z:-55.9,y:1.2};advance(airborne,0,0);assert.equal(airborne.impulse,0);
});

test('ramp supports board before launching from its lip',()=>{
 const p={...createPlayer(1),z:-28};let highest=0;
 for(let i=0;i<11;i++){advance(p,0,0);highest=Math.max(highest,p.y);}
 assert.ok(highest>.8);assert.ok(p.vy>0);
});
test('held turbo covers more distance and consumes energy',()=>{
 const fast={...createPlayer(1),x:9},normal={...createPlayer(2),x:9};
 for(let i=0;i<30;i++){advance(fast,0,2);advance(normal,0,0);}
 assert.ok(-fast.z>-normal.z*2);assert.ok(fast.energy<normal.energy);
});
test('race stops after exactly three laps',()=>{
 const p={...createPlayer(1),z:-2879.9};advance(p,0,2);assert.equal(p.z,-2880);
 advance(p,1,2);assert.equal(p.z,-2880);
});
