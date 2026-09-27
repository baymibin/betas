import assert from 'node:assert/strict';
import {read,TYPE,profilePacket,roomRequest,readRoom,readRoomList,packet} from '../../client/src/shared/protocol.js';
const clients=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await sleep(30);}throw Error('Timed out');}
async function join(mode,code='',capacity=2){const c={ws:new WebSocket('ws://localhost:3000/play')};clients.push(c.ws);c.ws.binaryType='arraybuffer';c.ws.onmessage=({data})=>{const v=read(data),type=v.getUint8(1);if(type===TYPE.WELCOME){c.ws.send(profilePacket({nick:'CapacityTest',character:0,board:0}));c.ws.send(roomRequest(mode,1,code,capacity));}if(type===TYPE.ROOM_STATE)c.room=readRoom(v);if(type===TYPE.ERROR)c.error=true;};await until(()=>c.room||c.error);return c;}
let list=[];
try{
 const lobby=new WebSocket('ws://localhost:3000/lobby');clients.push(lobby);lobby.binaryType='arraybuffer';lobby.onmessage=({data})=>{list=readRoomList(read(data));};
 const host=await join(1);await until(()=>list.some(r=>r.code===host.room.code&&r.count===1&&r.capacity===2));
 await join(2,host.room.code);await until(()=>list.some(r=>r.code===host.room.code&&r.count===2));
 const excess=await join(2,host.room.code);assert.equal(excess.error,true);
 host.ws.send(packet(TYPE.ROOM_START,12).buffer);await until(()=>list.some(r=>r.code===host.room.code&&r.started));
 console.log('PASS: lobby publishes capacity, occupancy and race status; server rejects a third player in a two-player room.');
}finally{for(const ws of clients)ws.close();}
