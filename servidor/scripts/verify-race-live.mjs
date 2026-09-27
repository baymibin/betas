import assert from 'node:assert/strict';
import {read,states,TYPE,input,profilePacket,roomRequest,readRoom,packet} from '../../client/src/shared/protocol.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(name,options){
 const client={frames:new Map(),ws:new WebSocket('ws://localhost:3000/play')};client.ws.binaryType='arraybuffer';
 client.ws.onmessage=({data})=>{const v=read(data),type=v.getUint8(1);if(type===TYPE.WELCOME){client.id=v.getUint32(12,true);client.ws.send(profilePacket({nick:name,character:0,board:0}));client.ws.send(roomRequest(options.mode,options.mapId||0,options.code||''));}if(type===TYPE.ROOM_STATE)client.room=readRoom(v);if(type===TYPE.SNAPSHOT){client.player=states(v).find(p=>p.id===client.id);client.frames.set(v.getUint32(8,true),client.player);if(client.frames.size>20)client.frames.delete(client.frames.keys().next().value);}if(type===TYPE.ERROR)client.error=true;};
 for(let i=0;i<50&&!client.player&&!client.error;i++)await sleep(50);return client;
}
const clients=[];try{
 const host=await connect('Host',{mode:1,mapId:5});clients.push(host);assert.equal(host.room.mapId,5);assert.equal(host.player.countdown,65535);
 const guest=await connect('Guest',{mode:2,code:host.room.code});clients.push(guest);assert.equal(guest.room.code,host.room.code);assert.equal(guest.player.mapId,5);
 guest.ws.send(packet(TYPE.ROOM_START,12).buffer);await sleep(250);assert.equal(host.room.started,false);assert.equal(host.player.z,0);
 host.ws.send(packet(TYPE.ROOM_START,12).buffer);await sleep(250);assert.equal(host.room.started,true);assert.equal(guest.room.started,true);const commonTick=[...host.frames.keys()].reverse().find(t=>guest.frames.has(t));assert.notEqual(commonTick,undefined);assert.equal(host.frames.get(commonTick).countdown,guest.frames.get(commonTick).countdown);
 const late=await connect('Late',{mode:2,code:host.room.code});clients.push(late);assert.equal(late.error,true);
 for(let i=1;i<=100;i++)guest.ws.send(input(i,0,0));await sleep(10500);assert.equal(guest.ws.readyState,1);assert.ok(guest.player.z<0);
 const next=await connect('Next',{mode:1,mapId:2});clients.push(next);const follower=await connect('Follower',{mode:2,code:next.room.code});clients.push(follower);next.ws.close();await sleep(250);assert.equal(follower.room.hostId,follower.id);
 console.log('PASS: host-selected map, shared room, waiting freeze, host-only start, shared countdown, late join rejected, burst/pause survive, host transfers.');
}finally{for(const c of clients)c.ws.close();}
