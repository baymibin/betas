export const SURF_LIMIT = 10;
export const RAIL_X = 10.65;
export const SECTION = 48;
export function courseSection(index) {
  return {index,z:-(32+index*SECTION),x:[0,-6,6,-3,3][((index%5)+5)%5]};
}
export function courseHits(p,oldZ) {
  const first=Math.max(0,Math.floor((-oldZ-32)/SECTION)-1);
  for(let i=first;i<=first+3;i++) {
    const ramp=courseSection(i);
    if(oldZ>ramp.z && p.z<=ramp.z && Math.abs(p.x-ramp.x)<1.65 && p.y<1.3) {p.y=1;p.vy=9;p.impulse=2.6;p.ramps=(p.ramps||0)+1;p.trick=((p.id||0)*13+p.ramps*7+(p.raceTicks||0))%5;}
    const dividerZ=ramp.z-24,dividerX=-ramp.x*.6;
    if(oldZ>dividerZ && p.z<=dividerZ && Math.abs(p.x-dividerX)<1.65 && p.y<.85 && !(p.shieldTicks>0)) p.impulse=-.85;
  }
}

export const LAP_LENGTH = 960;
export const TOTAL_LAPS = 3;
export function raceProgress(z) {
 const distance=Math.max(0,Math.min(LAP_LENGTH*TOTAL_LAPS,-z));
 return {distance,lap:Math.min(TOTAL_LAPS,Math.floor(distance/LAP_LENGTH)+1),fraction:(distance%LAP_LENGTH)/LAP_LENGTH,finished:distance>=LAP_LENGTH*TOTAL_LAPS};
}
export function rampHeight(x,z) {
 const i=Math.max(0,Math.round((-z-32)/SECTION)),r=courseSection(i);
 const along=r.z+4-z;
 return Math.abs(x-r.x)<1.65 && along>=0 && along<=4 ? along*.25 : 0;
}
