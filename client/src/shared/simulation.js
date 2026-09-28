import {SURF_LIMIT,courseHits,rampHeight,LAP_LENGTH,TOTAL_LAPS} from './course.js';
export const DT = 1 / 30;
export function playerSpeed(p,boost=false,throttle=false){return p.countdown||p.place?0:p.slowTicks>0?8:p.turboTicks>0?38:p.impulse<0?7:p.impulse>0?28:p.slipActive&&p.slipTicks>0?31:boost?34:(throttle?21:16);}
export function createPlayer(id) { return {id,seq:0,x:0,z:0,y:0,vy:0,energy:1,impulse:0,mapId:0,countdown:0,raceTicks:0,ramps:0,jumps:0,place:0,trick:0,heldItem:0,itemRoll:0,shieldTicks:0,turboTicks:0,slowTicks:0,guardTicks:0,foamTicks:0,dolphinTicks:0,slipTicks:0,slipTarget:0,slipActive:0}; }
export function advance(p, axis, buttons) {
  if(p.countdown===65535)return;
  if(p.countdown>0){p.countdown--;return;}
  if(-p.z>=LAP_LENGTH*TOTAL_LAPS)return;
  p.raceTicks=(p.raceTicks||0)+1;
  for(const key of ['shieldTicks','turboTicks','slowTicks','guardTicks','foamTicks','dolphinTicks','slipTicks'])p[key]=Math.max(0,(p[key]||0)-1);
  const limit=SURF_LIMIT-(p.mapId||0)*.4;
  p.x = Math.max(-limit, Math.min(limit, p.x + axis * 7 * DT));
  if ((buttons & 1) && p.y === 0) {p.vy=6;p.jumps=(p.jumps||0)+1;p.trick=((p.id*17+p.jumps*7+(p.raceTicks||0)*3)%5); }
  const boost = (buttons & 2) && p.energy > 0.03;
  const throttle = !!(buttons & 8);
  p.energy = Math.max(0, Math.min(1, p.energy + (boost ? -0.4 : 0.12) * DT));
  p.impulse=p.impulse>0?Math.max(0,p.impulse-DT):Math.min(0,(p.impulse||0)+DT);
  const oldZ=p.z;
  p.z -= playerSpeed(p,boost,throttle) * DT;
  p.z=Math.max(-LAP_LENGTH*TOTAL_LAPS,p.z);
  courseHits(p,oldZ);
  p.vy -= 14 * DT; p.y = Math.max(rampHeight(p.x,p.z), p.y + p.vy * DT);
  if (p.y <= rampHeight(p.x,p.z)) {p.vy=0;if(p.dolphinTicks>0){p.dolphinTicks=0;p.turboTicks=Math.max(p.turboTicks,36);}}
}
