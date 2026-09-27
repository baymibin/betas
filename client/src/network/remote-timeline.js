// Render on the server clock, not on irregular packet arrival times.
// Retardo de interpolación: ~3.3 ticks de 33 ms. Con 70 ms (2 ticks) cualquier jitter de red
// o del temporizador del servidor obligaba a extrapolar y los rivales se congelaban y saltaban.
export const INTERP_DELAY=110;
export class RemoteTimeline{
 constructor(){this.frames=[];this.offset=null;this.lastTick=-1;}
 push(tick,players,now){
  if(tick<=this.lastTick)return;this.lastTick=tick;
  const time=tick*1000/30,offset=now-time;
  this.offset=this.offset===null?offset:Math.min(offset,this.offset+.2);
  this.frames.push({time,players});if(this.frames.length>32)this.frames.shift();
 }
 sample(now){
  if(!this.frames.length)return [];
  const target=now-this.offset-INTERP_DELAY;let a=this.frames[0],b=a;
  for(const frame of this.frames){b=frame;if(frame.time>=target)break;a=frame;}
  const t=b.time>a.time?Math.max(0,Math.min(1,(target-a.time)/(b.time-a.time))):1;
  return b.players.map(p=>{
   const prev=a.players.find(x=>x.id===p.id)||p,r={...(t<1?prev:p)};
   for(const k of ['x','z','y'])r[k]=prev[k]+(p[k]-prev[k])*t;
   // A short gap may be bridged, but never extrapolate indefinitely.
   if(target>b.time&&this.frames.length>1){const older=this.frames.at(-2),q=older.players.find(x=>x.id===p.id),dt=b.time-older.time;
    if(q&&dt>0&&p.countdown===0&&!p.place){const extra=Math.min(50,target-b.time)/dt;r.x=p.x+(p.x-q.x)*extra;r.z=p.z+(p.z-q.z)*extra;r.y=Math.max(0,p.y+(p.y-q.y)*extra);}}
   return r;
  });
 }
}
