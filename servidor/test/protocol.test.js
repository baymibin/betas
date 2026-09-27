import {test} from 'node:test';
import assert from 'node:assert/strict';
import {input,read,snapshot,states,profilePacket,readProfile} from '../../client/src/shared/protocol.js';
import {createPlayer,advance} from '../../client/src/shared/simulation.js';
test('input uses little endian and rejects truncated frames',()=>{
 const b=input(0x12345678,-1,3); assert.deepEqual([...new Uint8Array(b).slice(4,8)],[0x78,0x56,0x34,0x12]);
 assert.equal(read(b).getInt8(12),-127); assert.throws(()=>read(b.slice(0,13)));
});
test('free cosmetics and UTF-8 nick survive wire format; invalid cosmetics rejected',()=>{
 const profile={nick:'Tuga 🌊',character:4,board:5,wing:7,hat:0};
 assert.deepEqual(readProfile(read(profilePacket(profile))),profile);
 const p={...createPlayer(3),...profile};const decoded=states(read(snapshot([p],1)))[0];
 assert.equal(decoded.nick,profile.nick);assert.equal(decoded.character,4);assert.equal(decoded.board,5);assert.equal(decoded.wing,7);assert.equal(decoded.hat,0);
 const invalid=read(profilePacket(profile));invalid.setUint8(12,5);assert.throws(()=>readProfile(invalid));
 const invalidBoard=read(profilePacket(profile));invalidBoard.setUint8(13,6);assert.throws(()=>readProfile(invalidBoard));
 const invalidWing=read(profilePacket(profile));invalidWing.setUint8(47,9);assert.throws(()=>readProfile(invalidWing));
 const legacy=profilePacket(profile).slice(0,47);new DataView(legacy).setUint16(2,47,true);
 assert.deepEqual(readProfile(read(legacy)),{...profile,wing:0,hat:0});
});
test('authoritative state round trips and replay converges',()=>{
 const server=createPlayer(7), client=createPlayer(7), commands=Array.from({length:90},(_,i)=>({axis:i<40?1:-1,buttons:i===10?1:0}));
 for(const c of commands.slice(0,50)) advance(server,c.axis,c.buttons);
 const restored=states(read(snapshot([server],50)))[0];
 for(const c of commands.slice(50)) advance(restored,c.axis,c.buttons);
 for(const c of commands) advance(client,c.axis,c.buttons);
 assert.ok(Math.abs(restored.z-client.z)<0.00001); assert.ok(Math.abs(restored.x-client.x)<0.00001);
});
