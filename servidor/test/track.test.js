import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trackFrame} from '../../client/src/shared/track.js';
import {LAP_LENGTH} from '../../client/src/shared/course.js';
import {borderColor,characterColors} from '../../client/src/characters/stick-avatar.js';
test('track closes at each lap with matching position and heading',()=>{
 for(const d of [0,10,237,600]){
  const a=trackFrame(d),b=trackFrame(d+LAP_LENGTH);
  assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1e-8);assert.ok(Math.abs(a.yaw-b.yaw)<1e-8);
 }
});
test('all eight coastal circuits close and have no centerline intersections',()=>{
 const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
 for(let id=0;id<8;id++){
  const points=Array.from({length:161},(_,i)=>trackFrame(i*6,0,id));
  assert.ok(Math.hypot(points[0].x-points[160].x,points[0].z-points[160].z)<1e-7);
  for(let i=0;i<160;i++)for(let j=i+2;j<160;j++){if(i===0&&j===159)continue;const [a,b,c,d]=[points[i],points[i+1],points[j],points[j+1]];assert.ok(!(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0),`map ${id} crossing`);}
 }
});
test('lateral boundaries retain width around the entire circuit',()=>{
 for(let d=0;d<LAP_LENGTH;d+=7){const a=trackFrame(d,-10),b=trackFrame(d,10);assert.ok(Math.abs(Math.hypot(a.x-b.x,a.z-b.z)-20)<1e-8);}
});
test('character borders retain their own hue instead of black',()=>{
 for(const color of characterColors){const border=borderColor(color);assert.notEqual(border,'#102c37');assert.notEqual(border,'#000000');
 for(let i=1;i<7;i+=2)assert.ok(Math.abs(parseInt(border.slice(i,i+2),16)/parseInt(color.slice(i,i+2),16)-.72)<.01);}
});
