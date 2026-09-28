import {courseSection,SURF_LIMIT,LAP_LENGTH,TOTAL_LAPS} from './course.js';
export const ITEMS=['','Bendición Tiki','Ola cohete','Coco buscador','Remolino','Pulso de marea','Espuma cegadora','Salto del delfín','Estela del líder'];
export function makeBoxes(seed=1){
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 return Array.from({length:48},(_,id)=>{const d=48+id*58+random()*16,air=random()<.35;
  if(air){const ramp=courseSection(Math.max(0,Math.round((d-32)/48)));return {id,x:ramp.x,z:ramp.z-10,y:3.4};}
  return {id,x:(random()*2-1)*6,z:-d,y:1.1};
 });
}
export const BOXES=makeBoxes(1);
export function createPowerWorld(seed=Math.floor(Math.random()*4294967296)){return {seed:seed>>>0,boxes:makeBoxes(seed),taken:new Set(),entities:[],nextId:1,previous:new Map()};}
export function hurt(p,ticks){if(p.shieldTicks>0||p.guardTicks>0)return false;p.slowTicks=ticks;p.guardTicks=ticks+45;return true;}
// Distancia a lo largo del circuito entre un jugador y un objeto fijo del agua, en el mismo
// punto de la vuelta (el circuito es cerrado: la vuelta 2 pasa por el mismo lugar que la 1).
function lapGap(p,e){let dz=(((-p.z)%LAP_LENGTH+LAP_LENGTH)%LAP_LENGTH)-(((-e.z)%LAP_LENGTH+LAP_LENGTH)%LAP_LENGTH);if(dz>LAP_LENGTH/2)dz-=LAP_LENGTH;if(dz<-LAP_LENGTH/2)dz+=LAP_LENGTH;return Math.hypot(p.x-e.x,dz);}
const ahead=(p,active)=>active.filter(q=>q.id!==p.id&&q.z<p.z).sort((a,b)=>b.z-a.z)[0];
// Efecto sobre uno mismo de Tiki (1), Ola cohete (2) y Delfín (7). Lo usan el servidor
// (stepPowerWorld) y la predicción del cliente, para aplicar exactamente la misma regla.
// Devuelve false si no se puede usar ahora (delfín en el aire).
export function applySelfPower(p,kind){
 if(kind===1){p.shieldTicks=240;p.slowTicks=0;p.foamTicks=0;if(p.impulse<0)p.impulse=0;return true;}
 if(kind===2){p.turboTicks=90;p.slowTicks=0;return true;}
 if(kind===7){if(p.y>=1.3)return false;p.vy=11;p.y=Math.max(.1,p.y);p.dolphinTicks=60;p.jumps++;p.trick=(p.jumps+p.id)%5;p.slowTicks=0;return true;}
 return false;
}
// Ruleta al coger una caja (como en Mario Kart): durante ITEM_ROLL_TICKS gira sola; pulsar E
// mientras gira solo la para y muestra el poder, y hay que volver a pulsar E para usarlo.
export const ITEM_ROLL_TICKS=75;
// Predicción local del uso de la habilidad propia: solo las que no dependen de otros jugadores.
// Mismas condiciones que stepPowerWorld (participante activo y con la habilidad en la mano).
export function predictSelfPower(p){
 const kind=p.heldItem;
 if(!kind||p.countdown!==0||p.place||-p.z>=LAP_LENGTH*TOTAL_LAPS)return;
 if(p.itemRoll>0){p.itemRoll=0;return;}
 if(kind!==1&&kind!==2&&kind!==7)return;
 if(applySelfPower(p,kind))p.heldItem=0;
}
export function stepPowerWorld(world,players,uses=[],random=Math.random){
 const active=players.filter(p=>p.countdown===0&&!p.place&&-p.z<2880);
 for(const p of active){
  // Ruleta girando: E la para (sin usar el poder); si no, se va agotando sola.
  if(p.heldItem&&p.itemRoll>0){if(uses.includes(p.id))p.itemRoll=0;else p.itemRoll--;}
  else if(uses.includes(p.id)&&p.heldItem){
   const kind=p.heldItem;p.heldItem=0;
   const spawn=(target=0,ttl=30)=>world.entities.push({id:world.nextId++,kind,owner:p.id,target,x:p.x,z:p.z,y:p.y+.7,ttl});
   if(kind===1||kind===2)applySelfPower(p,kind);
   if(kind===3){const target=ahead(p,active);if(target)spawn(target.id,120);else p.heldItem=kind;}
   // Remolino: queda fijo en el agua hasta que alguien lo atraviese (no caduca ni depende de la vuelta).
   if(kind===4){spawn(0,65000);Object.assign(world.entities.at(-1),{z:p.z+2,y:.1});}
   if(kind===5){spawn(0,65000);Object.assign(world.entities.at(-1),{z:p.z+2.5,y:1.1,age:0});for(const q of active)if(q.id!==p.id&&!q.shieldTicks&&!q.guardTicks&&Math.hypot(q.x-p.x,q.z-p.z)<10){const limit=SURF_LIMIT-(q.mapId||0)*.4;q.x=Math.max(-limit,Math.min(limit,q.x+(q.x>=p.x?2.5:-2.5)));q.guardTicks=30;}}
   if(kind===6)spawn(0,90);
   if(kind===7&&!applySelfPower(p,kind))p.heldItem=kind;
   if(kind===8){const target=ahead(p,active);if(target){p.slipTicks=150;p.slipTarget=target.id;}else p.heldItem=kind;}
  }
  const target=active.find(q=>q.id===p.slipTarget);p.slipActive=p.slipTicks>0&&target&&p.z-target.z>0&&p.z-target.z<45&&Math.abs(p.x-target.x)<3?1:0;
 }
 for(const box of world.boxes){if(world.taken.has(box.id))continue;
  const contenders=active.filter(p=>{
   if(p.heldItem)return false;
   const crossed=(world.previous.get(p.id)??p.z)>box.z&&p.z<=box.z;
   const overlap=p.z<=box.z&&p.z>=box.z-1.2;
   return (crossed||overlap)&&Math.abs(p.x-box.x)<1.45&&Math.abs(p.y+.8-box.y)<1.35;
  });
  contenders.sort((a,b)=>{const az=world.previous.get(a.id)??a.z,bz=world.previous.get(b.id)??b.z;return (az-box.z)/(az-a.z||1)-(bz-box.z)/(bz-b.z||1)||a.id-b.id;});
  const p=contenders[0];if(p){world.taken.add(box.id);const pool=ahead(p,active)?[1,2,2,3,4,5,6,7,8]:[1,2,4,5,6,7];p.heldItem=pool[Math.min(pool.length-1,Math.floor(random()*pool.length))];p.itemRoll=ITEM_ROLL_TICKS;}
 }
 for(const e of world.entities){e.age=(e.age||0)+1;if(e.kind!==5&&e.kind!==4)e.ttl--;
  if(e.kind===3){const target=active.find(p=>p.id===e.target);if(!target){e.ttl=0;continue;}
   const dx=target.x-e.x,dz=target.z-e.z,dy=target.y+.7-e.y,dist=Math.hypot(dx,dz,dy),step=48/30;
   if(dist<step+.8){hurt(target,45);e.ttl=0;}else{e.x+=dx/dist*step;e.z+=dz/dist*step;e.y+=dy/dist*step;}
  }else if(e.kind===4){for(const p of active)if(p.id!==e.owner&&p.y<.8&&lapGap(p,e)<1.8){hurt(p,60);e.ttl=0;break;}}
  else if(e.kind===5){
   for(const p of active){
    if(p.id===e.owner&&(e.age||0)<45)continue;
    if(lapGap(p,e)<1.8){
     e.ttl=0;
     if(p.shieldTicks>0)break;
     p.slowTicks=60;p.guardTicks=105;
     break;
    }
   }
  }
  else if(e.kind===6){const oldZ=e.z;e.z-=50/30;for(const p of active)if(p.id!==e.owner&&Math.abs(p.x-e.x)<1.5&&Math.abs(p.y+.7-e.y)<1.5&&p.z<=oldZ+1&&p.z>=e.z-1){if(!p.shieldTicks&&!p.guardTicks){p.foamTicks=60;p.guardTicks=75;}e.ttl=0;break;}}
 }
 world.entities=world.entities.filter(e=>e.ttl>0).slice(-64);
 for(const p of players)world.previous.set(p.id,p.z);
}
