import assert from 'node:assert/strict';
import {read,TYPE,states,profilePacket,roomRequest,readRoom,input,packet,readPowerWorld} from '../../client/src/shared/protocol.js';
const clients=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<650;i++){if(fn())return;await sleep(30);}throw Error('Power test timed out');}
async function connect(mode,code=''){const c={ws:new WebSocket('ws://localhost:3000/play')};clients.push(c.ws);c.ws.binaryType='arraybuffer';c.ws.onmessage=({data})=>{const v=read(data),type=v.getUint8(1);if(type===TYPE.WELCOME){c.id=v.getUint32(12,true);c.ws.send(profilePacket({nick:'PowerTest',character:0,board:0}));c.ws.send(roomRequest(mode,0,code));}if(type===TYPE.ROOM_STATE)c.room=readRoom(v);if(type===TYPE.SNAPSHOT){c.players=states(v);c.p=c.players.find(p=>p.id===c.id);}if(type===TYPE.POWER_WORLD)c.world=readPowerWorld(v);};await until(()=>c.p);return c;}
let steering;
try{const a=await connect(1),b=await connect(2,a.room.code);await until(()=>a.world?.boxes&&b.world?.boxes);
 assert.deepEqual(a.world.boxes,b.world.boxes);const box=a.world.boxes.find(b=>b.y===1.1);let seq=0;
 steering=setInterval(()=>{for(const c of [a,b])c.ws.send(input(++seq,Math.max(-1,Math.min(1,(box.x-c.p.x)*3)),0));},33);
 a.ws.send(packet(TYPE.ROOM_START,12).buffer);await until(()=>a.world?.taken.has(box.id)&&b.world?.taken.has(box.id));
 assert.equal(a.players.filter(p=>p.heldItem).length,1);const owner=a.p.heldItem?a:b,other=owner===a?b:a,kind=owner.p.heldItem;
 clearInterval(steering);owner.ws.send(input(++seq,0,4));await sleep(150);
 if(kind===1)assert.ok(owner.p.shieldTicks>220);if(kind===2)assert.ok(owner.p.turboTicks>70);if([4,5,6].includes(kind))assert.ok(owner.world.entities.some(e=>e.owner===owner.id&&e.kind===kind));if(kind===7)assert.ok(owner.p.dolphinTicks>0);
 assert.equal(owner.ws.readyState,1);assert.equal(other.ws.readyState,1);assert.equal(owner.p.heldItem,0);
 console.log('PASS: shared random layout, exclusive pickup and synchronized activation; item '+kind);

}finally{clearInterval(steering);for(const ws of clients)ws.close();}
