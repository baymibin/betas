import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roomRequest,roomState,readRoom,roomList,readRoomList,read,roomBots,TYPE} from '../../client/src/shared/protocol.js';
import {raceOrder} from '../../client/src/ui/ranking.js';
test('capacity and room status survive binary transport',()=>{
 const v=read(roomRequest(1,3,'',4));assert.equal(v.byteLength,21);assert.equal(v.getUint8(20),4);
 const r={hostId:10,code:'123456',mapId:3,started:true,capacity:4,botTarget:2};assert.deepEqual(readRoom(read(roomState(r))),r);
 const listing={code:r.code,mapId:3,count:4,bots:3,capacity:4,started:true,host:'Surfer'};assert.deepEqual(readRoomList(read(roomList([listing]))),[listing]);
 const withBots=read(roomRequest(1,0,'',8,5));assert.equal(withBots.byteLength,22);assert.equal(withBots.getUint8(21),5);
 const b=read(roomBots(4));assert.equal(b.getUint8(1),TYPE.ROOM_BOTS);assert.equal(b.byteLength,13);assert.equal(b.getUint8(12),4);
});
test('ranking follows distance then authoritative finish position without mutating snapshots',()=>{
 const players=[{id:1,z:-50},{id:2,z:-100},{id:3,z:-80}];assert.deepEqual(raceOrder(players).map(p=>p.id),[2,3,1]);assert.equal(players[0].id,1);
 players[0].place=1;assert.deepEqual(raceOrder(players).map(p=>p.id),[1,2,3]);
});
