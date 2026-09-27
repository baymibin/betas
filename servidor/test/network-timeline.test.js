import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RemoteTimeline,INTERP_DELAY} from '../../client/src/network/remote-timeline.js';
import {roomList,readRoomList,read} from '../../client/src/shared/protocol.js';
test('directory preserves Unicode names and binary offsets',()=>{
 const rooms=[{code:'123456',mapId:7,count:3,host:'José 🌊'},{code:'654321',mapId:2,count:7,host:'Guest'}];
 assert.deepEqual(readRoomList(read(roomList(rooms))),rooms.map(r=>({...r,bots:0,capacity:8,started:false})));
 assert.throws(()=>readRoomList(read(roomList(rooms).slice(0,-1))));
});
test('remote movement uses ticks despite jitter and rejects old snapshots',()=>{
 const t=new RemoteTimeline(),p=z=>[{id:1,x:0,z,y:0,countdown:0,place:0}];
 t.push(0,p(0),1000);t.push(3,p(-3),1130);t.push(6,p(-6),1200);
 assert.ok(Math.abs(t.sample(1150+INTERP_DELAY)[0].z+4.5)<.02);
 t.push(3,p(99),1250);assert.equal(t.frames.length,3);
 assert.ok(Math.abs(t.sample(2000)[0].z+7.5)<.01);
});
