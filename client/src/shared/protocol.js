import {makeBoxes} from './powerups.js';
import {boardSkins} from './board-cosmetics.js';
import {wingFiles,hats} from './catalog.js';
export const TYPE = { WELCOME: 1, INPUT: 2, SNAPSHOT: 3, PROFILE:4, ROOM_REQUEST:5, ROOM_STATE:6, ROOM_START:7, ERROR:8, ROOM_LIST:9, POWER_WORLD:10, ROOM_BOTS:11 };
export const HEADER = 12;
// Versión del protocolo: el servidor la envía en el byte 16 del WELCOME (17 bytes).
// Un WELCOME de 16 bytes = servidor anterior, que solo entiende el PROFILE de 47 bytes.
// v3: bots (flag en el SNAPSHOT, cantidad en ROOM_REQUEST/ROOM_STATE/ROOM_LIST y paquete ROOM_BOTS).
export const PROTOCOL_VERSION = 3;
export function powerWorldPacket(world,tick=0){
 const taken=[...world.taken],entities=world.entities,v=packet(TYPE.POWER_WORLD,20+taken.length+entities.length*32,0,tick);
 v.setUint32(16,world.seed,true);v.setUint16(12,taken.length,true);v.setUint16(14,entities.length,true);taken.forEach((id,i)=>v.setUint8(20+i,id));
 entities.forEach((e,i)=>{const o=20+taken.length+i*32;v.setUint32(o,e.id,true);v.setUint8(o+4,e.kind);v.setUint32(o+8,e.owner,true);v.setUint32(o+12,e.target,true);v.setFloat32(o+16,e.x,true);v.setFloat32(o+20,e.z,true);v.setFloat32(o+24,e.y,true);v.setUint16(o+28,e.ttl,true);});return v.buffer;
}
export function readPowerWorld(v){
 if(v.byteLength<20)throw Error('Invalid powers');const count=v.getUint16(12,true),n=v.getUint16(14,true);if(count>48||n>64||v.byteLength!==20+count+n*32)throw Error('Invalid powers');
 return {seed:v.getUint32(16,true),boxes:makeBoxes(v.getUint32(16,true)),taken:new Set(Array.from({length:count},(_,i)=>v.getUint8(20+i))),entities:Array.from({length:n},(_,i)=>{const o=20+count+i*32;return {id:v.getUint32(o,true),kind:v.getUint8(o+4),owner:v.getUint32(o+8,true),target:v.getUint32(o+12,true),x:v.getFloat32(o+16,true),z:v.getFloat32(o+20,true),y:v.getFloat32(o+24,true),ttl:v.getUint16(o+28,true)};})};
}
// ROOM_LIST: registro de 44 bytes · 0..5 código · 6 mapa · 7 humanos · 8..40 anfitrión · 41 capacidad · 42 en carrera · 43 bots.
export function roomList(rooms){
 const list=rooms.slice(0,100),v=packet(TYPE.ROOM_LIST,14+list.length*44);v.setUint16(12,list.length,true);
 list.forEach((r,i)=>{const o=14+i*44;for(let j=0;j<6;j++)v.setUint8(o+j,r.code.charCodeAt(j));v.setUint8(o+6,r.mapId);v.setUint8(o+7,r.count);writeName(v,o+8,r.host);v.setUint8(o+41,r.capacity||8);v.setUint8(o+42,r.started?1:0);v.setUint8(o+43,r.bots||0);});return v.buffer;
}
export function readRoomList(v){
 if(v.byteLength<14||v.getUint8(1)!==TYPE.ROOM_LIST)throw Error('Invalid room list');
 const n=v.getUint16(12,true),size=n?(v.byteLength-14)/n:44;if(n>100||(size!==43&&size!==44)||v.byteLength!==14+n*size)throw Error('Invalid room list');
 return Array.from({length:n},(_,i)=>{const o=14+i*size,mapId=v.getUint8(o+6),count=v.getUint8(o+7),bots=size===44?v.getUint8(o+43):0;if(mapId>7||count>8||bots>7)throw Error('Invalid room');return {code:String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+o,6)),mapId,count,bots,host:readName(v,o+8),capacity:v.getUint8(o+41),started:!!v.getUint8(o+42)};});
}
export function packet(type, bytes, seq = 0, tick = 0) {
  const buffer = new ArrayBuffer(bytes), v = new DataView(buffer);
  v.setUint8(0, 7); v.setUint8(1, type); v.setUint16(2, bytes, true);
  v.setUint32(4, seq, true); v.setUint32(8, tick, true);
  return v;
}
export function read(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER) throw Error('Invalid packet');
  const v = new DataView(buffer);
  if (v.getUint8(0) !== 7 || v.getUint16(2, true) !== buffer.byteLength) throw Error('Protocol mismatch');
  return v;
}
export function input(seq, axis, buttons) {
  const v = packet(TYPE.INPUT, 14, seq);
  v.setInt8(12, Math.round(Math.max(-1, Math.min(1, axis)) * 127));
  v.setUint8(13, buttons & 15); return v.buffer;
}
export function snapshot(players, tick) {
  const v = packet(TYPE.SNAPSHOT, 14 + players.length * 108, 0, tick);
  v.setUint16(12, players.length, true);
  players.forEach((p, i) => {
    const o = 14 + i * 108;
    v.setUint32(o, p.id, true); v.setUint32(o + 4, p.seq, true);
    ['x','z','y','vy','energy'].forEach((k, j) => v.setFloat32(o + 8 + j * 4, p[k], true));
    v.setUint8(o+28,p.character||0);v.setUint8(o+29,p.board||0);
    writeName(v,o+30,p.nick||'Surfer');
    v.setFloat32(o+64,p.impulse||0,true);
    v.setUint8(o+68,p.mapId||0);v.setUint8(o+69,p.place||0);v.setUint16(o+70,p.countdown||0,true);
    v.setUint32(o+72,p.raceTicks||0,true);v.setUint16(o+76,p.ramps||0,true);v.setUint16(o+78,p.jumps||0,true);v.setUint8(o+80,p.trick||0);v.setUint8(o+81,p.heldItem||0);v.setUint8(o+82,p.wing||0);v.setUint8(o+83,p.hat||0);['shieldTicks','turboTicks','slowTicks','guardTicks','foamTicks','dolphinTicks','slipTicks'].forEach((key,j)=>v.setUint16(o+84+j*2,p[key]||0,true));v.setUint32(o+100,p.slipTarget||0,true);v.setUint8(o+104,p.slipActive||0);v.setUint8(o+105,p.bot?1:0);v.setUint8(o+106,Math.max(0,Math.min(255,(p.itemRollEnd||0)-(p.raceTicks||0))));
  }); return v.buffer;
}
export function states(v) {
  const n = v.getUint16(12, true);
  if (v.byteLength !== 14 + n * 108 || n > 8) throw Error('Invalid snapshot');
  return Array.from({length:n}, (_, i) => {
    const o = 14 + i * 108, p = { id:v.getUint32(o,true), seq:v.getUint32(o+4,true),character:v.getUint8(o+28),board:v.getUint8(o+29),wing:v.getUint8(o+82),hat:v.getUint8(o+83),nick:readName(v,o+30),impulse:v.getFloat32(o+64,true) };
    Object.assign(p,{mapId:v.getUint8(o+68),place:v.getUint8(o+69),countdown:v.getUint16(o+70,true),raceTicks:v.getUint32(o+72,true),ramps:v.getUint16(o+76,true),jumps:v.getUint16(o+78,true),trick:v.getUint8(o+80)});
    ['x','z','y','vy','energy'].forEach((k,j) => { p[k] = v.getFloat32(o+8+j*4,true); });
    p.heldItem=v.getUint8(o+81);['shieldTicks','turboTicks','slowTicks','guardTicks','foamTicks','dolphinTicks','slipTicks'].forEach((key,j)=>p[key]=v.getUint16(o+84+j*2,true));p.slipTarget=v.getUint32(o+100,true);p.slipActive=v.getUint8(o+104);p.bot=v.getUint8(o+105);p.itemRollEnd=p.raceTicks+v.getUint8(o+106);return p;
  });
}
function writeName(v,offset,name) {
  const target=new Uint8Array(v.buffer,v.byteOffset+offset+1,32);
  const {written}=new TextEncoder().encodeInto(name.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,16),target);
  v.setUint8(offset,written);
}
function readName(v,offset) {
  const n=v.getUint8(offset);if(n>32) throw Error('Invalid name');
  return new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(v.buffer,v.byteOffset+offset+1,n));
}
// PROFILE (49 bytes): 12 skin · 13 tabla · 14..46 nick (1+32) · 47 wings · 48 hat.
// Se acepta también el formato antiguo de 47 bytes (sin wings/hat -> 0).
export function profilePacket(profile,legacy=false) {
  const v=packet(TYPE.PROFILE,legacy?47:49);v.setUint8(12,profile.character|0);v.setUint8(13,profile.board|0);writeName(v,14,profile.nick||'Surfer');
  if(!legacy){v.setUint8(47,profile.wing|0);v.setUint8(48,profile.hat|0);}return v.buffer;
}
export function readProfile(v) {
 const long=v.byteLength===49;
 if((v.byteLength!==47&&!long) || v.getUint8(12)>4 || v.getUint8(13)>=boardSkins.length) throw Error('Invalid appearance');
 const wing=long?v.getUint8(47):0,hat=long?v.getUint8(48):0;
 // Límites reales del catálogo (base + items subidos desde el panel, añadidos al final).
 if(wing>=wingFiles.length||hat>=hats.length) throw Error('Invalid appearance');
  const nick=readName(v,14).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,16)||'Surfer';
  return {character:v.getUint8(12),board:v.getUint8(13),wing,hat,nick};
}

// ROOM_REQUEST: 12 modo · 13 mapa · 14..19 código · 20 capacidad · 21 bots · 22 privada.
// Tamaño: 21 bytes (sin bots) · 22 (+ bots en el byte 21) · 23 (+ privada en el byte 22:
// la sala no aparece en Buscar salas y solo se entra con su código).
export function roomRequest(mode,mapId=0,code='',capacity=8,bots=null,isPrivate=false){
 const size=isPrivate?23:bots===null?21:22;
 const v=packet(TYPE.ROOM_REQUEST,size);v.setUint8(12,mode);v.setUint8(13,mapId);v.setUint8(20,capacity);if(size>21)v.setUint8(21,bots|0);if(size>22)v.setUint8(22,1);
 for(let i=0;i<6;i++)v.setUint8(14+i,code.charCodeAt(i)||0);return v.buffer;
}
// ROOM_STATE: 12 anfitrión · 16..21 código · 22 mapa · 23 en carrera · 24 capacidad · 25 bots pedidos por el anfitrión.
export function roomState(room){
 const v=packet(TYPE.ROOM_STATE,26);v.setUint32(12,room.hostId,true);
 for(let i=0;i<6;i++)v.setUint8(16+i,room.code.charCodeAt(i));v.setUint8(22,room.mapId);v.setUint8(23,room.started?1:0);v.setUint8(24,room.capacity||8);v.setUint8(25,room.botTarget||0);return v.buffer;
}
export function readRoom(v){if(v.byteLength!==25&&v.byteLength!==26)throw Error('Invalid room');return {hostId:v.getUint32(12,true),code:String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+16,6)),mapId:v.getUint8(22),started:!!v.getUint8(23),capacity:v.getUint8(24),botTarget:v.byteLength>25?v.getUint8(25):0};}
// ROOM_BOTS (13 bytes): el anfitrión cambia la cantidad de bots en la sala de espera (byte 12).
export function roomBots(count){const v=packet(TYPE.ROOM_BOTS,13);v.setUint8(12,count);return v.buffer;}
