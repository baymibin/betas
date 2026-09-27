import {LAP_LENGTH} from './course.js';
const TAU=Math.PI*2,COUNT=2048;
let activeMap=0;
export function setTrackMap(id){activeMap=Math.max(0,Math.min(7,id|0));}
export function getTrackMap(){return activeMap;}
function shape(t,id){
 const lobes=[2,3,2,3,4,2,3,4][id],depth=[.12,.16,.2,.11,.12,.23,.19,.16][id];
 const r=1+depth*Math.cos(lobes*t+id*.47)+.035*Math.sin((lobes+1)*t);
 return {x:(138+id*3)*Math.cos(t)*r,z:(105+id*2)*Math.sin(t)*r};
}
const tables=Array.from({length:8},(_,id)=>{const samples=[];let length=0;
for(let i=0;i<=COUNT;i++){
 const t=Math.PI/2+i/COUNT*TAU,{x,z}=shape(t,id);
 if(i)length+=Math.hypot(x-samples[i-1].x,z-samples[i-1].z);
 samples.push({t,x,z,s:length});
}
return {samples,length,bounds:{minX:Math.min(...samples.map(p=>p.x)),maxX:Math.max(...samples.map(p=>p.x)),minZ:Math.min(...samples.map(p=>p.z)),maxZ:Math.max(...samples.map(p=>p.z))}};});
// Distance along the course is authoritative; world coordinates are a closed,
// arc-length parametrized coastal loop without intersections.
export function trackFrame(distance,lateral=0,mapId=activeMap){
 const {samples,length}=tables[mapId]||tables[0];
 const s=((distance%LAP_LENGTH)+LAP_LENGTH)%LAP_LENGTH/LAP_LENGTH*length;
 let lo=0,hi=COUNT;while(hi-lo>1){const mid=(lo+hi)>>1;if(samples[mid].s<=s)lo=mid;else hi=mid;}
 const a=samples[lo],b=samples[hi],f=(s-a.s)/(b.s-a.s),t=a.t+(b.t-a.t)*f;
 const pos=shape(t,mapId),next=shape(t+.0001,mapId),prev=shape(t-.0001,mapId);
 const dx=next.x-prev.x,dz=next.z-prev.z,n=Math.hypot(dx,dz);
 const rx=-dz/n,rz=dx/n;
 const y=0;
 return {x:pos.x+rx*lateral,z:pos.z+rz*lateral,y,yaw:Math.atan2(-dx,-dz),rx,rz};
}

export function trackBounds(mapId=activeMap){return tables[mapId].bounds;}
