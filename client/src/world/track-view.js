import {trackFrame} from '../shared/track.js';
import {rampHeight,LAP_LENGTH} from '../shared/course.js';
export function createTrackView(B,scene,{sand,water,beach,grass,ocean}) {
 beach.setEnabled(false);grass.setEnabled(false);
 ocean.scaling.set(2.5,1,2.5);
 function ribbon(name,offsets,material,height) {
  const pathArray=offsets.map(x=>Array.from({length:481},(_,i)=>{
   const d=i/480*LAP_LENGTH;
   const p=trackFrame(d,x);
   return new B.Vector3(p.x,p.y+height(x,d),p.z);
  }));
  const m=B.MeshBuilder.CreateRibbon(name,{pathArray,sideOrientation:B.Mesh.DOUBLESIDE},scene);
  if(name==='coastal-loop-coast'){
   const normals=m.getVerticesData(B.VertexBuffer.NormalKind);for(let n=0;n<normals.length;n+=3)if(normals[n+1]<0){normals[n]*=-1;normals[n+1]*=-1;normals[n+2]*=-1;}m.setVerticesData(B.VertexBuffer.NormalKind,normals);
   const uv=[];
   for(let side=0;side<2;side++)for(const x of offsets)for(let i=0;i<=480;i++){
    uv.push((-x-11.9)/14,i/480*LAP_LENGTH/14);
   }
   m.setVerticesData(B.VertexBuffer.UVKind,uv);
  } else if(name==='coastal-loop-water'){
   const uv=[];
   for(let side=0;side<2;side++){
    for(const x of offsets){
     const shoreT = x <= -12.0 ? 1.0 : x >= 36.0 ? 0.0 : Math.max(0, Math.min(1, 1 - (x + 12.0) / 36.0));
     for(let i=0;i<=480;i++){
      uv.push(shoreT, i/480*LAP_LENGTH/12);
     }
    }
   }
   m.setVerticesData(B.VertexBuffer.UVKind,uv);
  }
  m.material=material;m.isPickable=false;return m;
 }
 const waterOffsets = [-12.2,-10,-8,-6,-4,-2,0,2,4,6,8,10,12,16,20,24,32,40,52,72,95];
 ribbon('coastal-loop-water',waterOffsets,water,()=>.02);
 const coastOffsets = [-11.9, -15.5, -21.0, -28.0, -38.0, -52.0];
 ribbon('coastal-loop-coast',coastOffsets,sand,(x,d)=>{
  const inland = -x - 11.9;
  return .12 + Math.min(inland * .22, 4.6) + Math.sin(d * .035 + x * .1) * Math.min(.35, inland * .03);
 });
 const saved=[];const cache=new WeakMap();let rideY=null;const targetVector=new B.Vector3();
 function save(node){let state=cache.get(node);if(!state){state={node,p:node.position.clone(),r:node.rotation?.clone()};cache.set(node,state);}state.p.copyFrom(node.position);state.r?.copyFrom(node.rotation);state.visible=node.isVisible;saved.push(state);return state;}
 function project(node){
  save(node);const p=trackFrame(-node.position.z,node.position.x);
  node.position.set(p.x,node.position.y+p.y,p.z);if(!node.billboardMode)node.rotation.y+=p.yaw;
 }
 return {
  render({player,camera,decor,course,rivals,wakes,sky,sun,waterMaterial,air,sample,dt,lookBack=false},draw){
   const sourceZ=player.position.z,sourceX=player.position.x;
   const camPosition=camera.position.clone(),camRotation=camera.rotation.clone();
   for(const node of [player,...decor,...course,...rivals,...wakes])project(node);
   
   const p=trackFrame(-sourceZ,sourceX);
   const deck=rampHeight(sourceX,sourceZ);
   const targetY=.12+Math.max(air,deck)+(deck>0?0:sample(p.x,p.z));
   if(rideY===null || sourceZ>-.5)rideY=targetY;
   rideY+=(targetY-rideY)*(1-Math.exp(-18*dt));
   player.position.y=p.y+Math.max(rideY,deck+.10);
   for(const rival of rivals)rival.position.y=trackFrame(-cache.get(rival).p.z).y+(rival.remoteAir||0)+sample(rival.position.x,rival.position.z)+.12;
   const cam=trackFrame(lookBack?-sourceZ+Math.abs(camPosition.z-sourceZ):-camPosition.z,camPosition.x);
   camera.position.set(cam.x,camPosition.y+cam.y,cam.z);
   const target=trackFrame(-sourceZ+(lookBack?-7:7),sourceX*.7);
   targetVector.set(target.x,target.y+1.6,target.z);
   camera.setTarget(targetVector);
   camera.rotation.z=camRotation.z;
   save(ocean);ocean.position.set(p.x,-1.2,p.z);
   save(sky);sky.position.set(p.x,sky.position.y+p.y,p.z);
   save(sun);sun.position.set(p.x-55,p.y+65,p.z-25);
   waterMaterial.setVector3('uCameraPos',camera.position);
   try{draw();}finally{
    for(const {node,p,r,visible} of saved){node.position.copyFrom(p);if(r)node.rotation.copyFrom(r);if(visible!==undefined)node.isVisible=visible;}saved.length=0;
    camera.position.copyFrom(camPosition);camera.rotation.copyFrom(camRotation);
   }
  }
 };
}


