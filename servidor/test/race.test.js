import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advance,createPlayer} from '../../client/src/shared/simulation.js';
import {trackFrame} from '../../client/src/shared/track.js';
import {snapshot,read,states} from '../../client/src/shared/protocol.js';
import {MAPS} from '../../client/src/shared/maps.js';
test('eight distinct closed maps have finite heading and increasing difficulty',()=>{
 const signatures=new Set();for(const m of MAPS){const points=[];for(let d=0;d<960;d+=12){const p=trackFrame(d,0,m.id);assert.ok(Number.isFinite(p.yaw));points.push(p.x.toFixed(2)+','+p.z.toFixed(2));}signatures.add(points.join(';'));const a=trackFrame(0,0,m.id),b=trackFrame(960,0,m.id);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1e-6);assert.equal(m.difficulty,m.id+1);}assert.equal(signatures.size,8);
});
test('countdown blocks movement, jump and race clock for exactly 90 ticks',()=>{
 const p={...createPlayer(1),countdown:90};for(let i=0;i<90;i++)advance(p,1,3);
 assert.equal(p.z,0);assert.equal(p.x,0);assert.equal(p.jumps,0);assert.equal(p.raceTicks,0);advance(p,0,0);assert.ok(p.z<0);assert.equal(p.raceTicks,1);
});
test('all five tricks occur on accepted jumps and stats survive binary snapshots',()=>{
 const types=new Set();for(let i=0;i<5;i++){const p={...createPlayer(1),raceTicks:i,mapId:7,ramps:9,place:2};advance(p,0,1);types.add(p.trick);const q=states(read(snapshot([p],1)))[0];for(const key of ['mapId','raceTicks','ramps','jumps','trick','place'])assert.equal(q[key],p[key]);}assert.equal(types.size,5);
});
test('finish freezes time and ramp count, harder maps enforce narrower width',()=>{
 const p={...createPlayer(1),z:-2879.9};advance(p,0,0);const ticks=p.raceTicks;for(let i=0;i<100;i++)advance(p,0,3);assert.equal(p.raceTicks,ticks);
 const hard={...createPlayer(2),mapId:7};for(let i=0;i<100;i++)advance(hard,1,0);assert.equal(hard.x,7.199999999999999);
});

test('waiting room never advances and ramp chooses a trick without counting a manual jump',()=>{
 const waiting={...createPlayer(1),countdown:65535};for(let i=0;i<200;i++)advance(waiting,1,3);assert.equal(waiting.countdown,65535);assert.equal(waiting.z,0);
 const variants=new Set();for(let i=0;i<5;i++){const p={...createPlayer(1),z:-31.9,raceTicks:i};advance(p,0,0);assert.equal(p.ramps,1);assert.equal(p.jumps,0);assert.ok(p.vy>0);variants.add(p.trick);}assert.equal(variants.size,5);
});
