import {createStickAvatar} from '../characters/stick-avatar.js';
import {boardSkins} from '../shared/board-cosmetics.js';

// A small, independent Babylon scene renders only while the shop is open.
export function createShopPreview(canvas) {
  let engine, scene, camera, avatar, boardStand, boardMaterial, running=false;
  let selection={character:0,board:0,wing:0,hat:0};
  let start=0, dragStart=null, angle=0;
  const B=window.BABYLON;
  const boardTextures=new Map();

  function material(name, color, emissive=0) {
    const mat=new B.StandardMaterial(name,scene);
    mat.diffuseColor=B.Color3.FromHexString(color);
    mat.emissiveColor=mat.diffuseColor.scale(emissive);
    mat.specularColor=new B.Color3(.22,.22,.22);
    return mat;
  }
  function init() {
    if(scene || !B) return;
    engine=new B.Engine(canvas,true,{alpha:true,antialias:true,powerPreference:'low-power'});
    engine.setHardwareScalingLevel(Math.max(1,window.devicePixelRatio/1.5));
    scene=new B.Scene(engine);
    scene.clearColor=new B.Color4(0,0,0,0);
    scene.autoClear=true;
    camera=new B.ArcRotateCamera('shop-camera',-Math.PI/2,1.32,4.85,new B.Vector3(0,1.12,0),scene);
    camera.lowerRadiusLimit=4.85;camera.upperRadiusLimit=4.85;
    scene.activeCamera=camera;
    const ambient=new B.HemisphericLight('shop-ambient',new B.Vector3(0,1,0),scene);
    ambient.intensity=.9;
    const sun=new B.DirectionalLight('shop-sun',new B.Vector3(-.6,-1,.35),scene);
    sun.intensity=.85;

    // The showcase island is a layered rock ledge. Its top carries both the
    // surfer and the standing board; separate foam flecks blend it into the
    // backdrop water without drawing a circular outline around the model.
    const cx=.12;
    const positions=[],colors=[],uvs=[],indices=[];
    const topColors=['#e2d7c9','#d8d2c7','#cad0d0','#e8dacc'];
    const sideColors=['#a8b7b9','#c2b9ab','#d1c3af','#aab4b7','#bcb1a8'];
    function face(a,b,c,hex,isTop=false){
      const color=B.Color3.FromHexString(hex);
      for(const p of [a,b,c]){
        positions.push(...p);
        colors.push(color.r,color.g,color.b,1);
        uvs.push((p[0]-cx)*.48+.5,isTop?(p[2]-.1)*.72+.5:(p[1]+.48)*1.4);
        indices.push(indices.length);
      }
    }
    const segments=18;
    const ring=(i,rx,rz,y)=>{
      const a=i*Math.PI*2/segments;
      const rough=1+.038*Math.sin(i*2.7)+.024*Math.cos(i*4.1);
      return [cx+Math.cos(a)*rx*rough,y+.014*Math.sin(i*3.1),.1+Math.sin(a)*rz*rough];
    };
    for(let i=0;i<segments;i++){
      const next=i+1;
      const innerA=ring(i,.74,.39,.087),innerB=ring(next,.74,.39,.087);
      const topA=ring(i,1.48,.79,.065),topB=ring(next,1.48,.79,.065);
      const shoulderA=ring(i,1.58,.88,-.20),shoulderB=ring(next,1.58,.88,-.20);
      const footA=ring(i,1.66,.95,-.48),footB=ring(next,1.66,.95,-.48);
      face([cx,.095,.1],innerA,innerB,topColors[i%topColors.length],true);
      face(innerA,topA,topB,topColors[(i+1)%topColors.length],true);
      face(innerA,topB,innerB,topColors[(i+1)%topColors.length],true);
      face(topA,shoulderA,shoulderB,sideColors[i%sideColors.length]);
      face(topA,shoulderB,topB,sideColors[i%sideColors.length]);
      face(shoulderA,footA,footB,sideColors[(i+2)%sideColors.length]);
      face(shoulderA,footB,shoulderB,sideColors[(i+2)%sideColors.length]);
    }
    const ledge=new B.Mesh('shop-faceted-rock-ledge',scene);
    const ledgeData=new B.VertexData();
    ledgeData.positions=positions;ledgeData.indices=indices;ledgeData.colors=colors;ledgeData.uvs=uvs;
    ledgeData.normals=[];
    B.VertexData.ComputeNormals(positions,indices,ledgeData.normals);
    ledgeData.applyToMesh(ledge);
    const ledgeMat=material('shop-rock-facets','#ffffff');
    const rockTexture=new B.Texture('/assets/images/shop/shop-preview-pedestal-rock.webp',scene,false,true);
    rockTexture.wrapU=B.Texture.WRAP_ADDRESSMODE;
    rockTexture.wrapV=B.Texture.WRAP_ADDRESSMODE;
    ledgeMat.diffuseTexture=rockTexture;
    ledgeMat.backFaceCulling=false;
    ledgeMat.specularColor=new B.Color3(.06,.06,.06);
    ledge.material=ledgeMat;

    const cliffShades=['#4b5252','#625e57','#776b5d'];
    for(let i=0;i<6;i++){
      const fragment=B.MeshBuilder.CreateIcoSphere('shop-cliff-fragment',{radius:.26,subdivisions:1,flat:true},scene);
      fragment.position.set(-1.22+i*.53,-.34,-.62-(i%3)*.06);
      fragment.scaling.set(1.12,.76,.88);
      fragment.rotation.set(.12*i,.32*i,.2*i);
      const fragmentMat=material('shop-cliff-shade-'+i,cliffShades[i%cliffShades.length]);
      fragmentMat.diffuseTexture=rockTexture;
      fragment.material=fragmentMat;
    }

    const foam=material('shop-water-foam','#ecffff',.85);
    foam.disableLighting=true;
    foam.alpha=.84;
    const seaGlass=material('shop-water-glint','#67dce6',.9);
    seaGlass.disableLighting=true;
    seaGlass.alpha=.62;
    for(let i=0;i<25;i++){
      const a=i*Math.PI*2/25+.18;
      const distance=1.04+(i%4)*.035;
      const fleck=B.MeshBuilder.CreateSphere('shop-foam-fleck',{diameter:1,segments:6},scene);
      fleck.position.set(cx+Math.cos(a)*1.65*distance,-.47,.1+Math.sin(a)*.94*distance);
      fleck.scaling.set(.035+(i%3)*.012,.012,.07+(i%4)*.012);
      fleck.rotation.y=a;
      fleck.material=i%5===0?seaGlass:foam;
    }
    for(const [index,a] of [3.42,3.86,4.33,4.86,5.39,5.77].entries()){
      for(let part=0;part<3;part++){
        const splash=B.MeshBuilder.CreateSphere('shop-shore-splash',{diameter:1,segments:7},scene);
        splash.position.set(cx+Math.cos(a)*1.72+(part-1)*.075,-.48,.1+Math.sin(a)*.96+(part%2)*.045);
        splash.scaling.set(.07+(index%3)*.015,.025,.045+part*.012);
        splash.material=part===1?seaGlass:foam;
      }
    }

    const leaf=material('shop-island-leaf','#3b8c68',.12);
    const leafLight=material('shop-island-leaf-light','#73b97c',.12);
    for(const [x,z] of [[-1.23,.55],[1.38,.50],[-1.13,-.52]]){
      for(let i=0;i<4;i++){
        const blade=B.MeshBuilder.CreateSphere('shop-tropical-leaf',{diameter:1,segments:7},scene);
        const a=i*Math.PI/2+.3;
        blade.position.set(x+Math.cos(a)*.12,.14,z+Math.sin(a)*.10);
        blade.scaling.set(.20,.07,.09);
        blade.rotation.y=a;
        blade.material=i%2?leaf:leafLight;
      }
    }

    boardStand=B.MeshBuilder.CreatePlane('shop-display-board',{width:1.17,height:2.7,sideOrientation:B.Mesh.DOUBLESIDE},scene);
    boardStand.position.set(1.28,1.21,.55);
    boardStand.rotation.z=-.15;
    boardMaterial=new B.StandardMaterial('shop-display-board-material',scene);
    boardMaterial.diffuseColor=B.Color3.White();
    boardMaterial.emissiveColor=new B.Color3(.25,.25,.25);
    boardMaterial.useAlphaFromDiffuseTexture=true;
    boardMaterial.transparencyMode=B.Material.MATERIAL_ALPHATEST;
    boardMaterial.backFaceCulling=false;
    boardStand.material=boardMaterial;
    rebuild();
    start=performance.now();
  }
  function rebuild() {
    if(!scene) return;
    avatar?.disposeAvatar();
    avatar=createStickAvatar(B,scene,null,selection.character,selection.board,selection.wing,selection.hat|0);
    avatar.position.x=-.52;
    avatar.scaling.setAll(1.15);
    // In the showcase the deck is viewed at a steep angle. Let its artwork
    // supply some of its own light so the selected WebP remains legible,
    // without changing the board material used during a race.
    const deckArtwork=avatar.getChildMeshes().find(mesh=>mesh.name==='deck-artwork-surface');
    if(deckArtwork?.material?.diffuseTexture){
      const art=deckArtwork.material;
      art.emissiveTexture=art.diffuseTexture;
      art.emissiveColor=new B.Color3(.68,.68,.68);
      art.specularColor=new B.Color3(.06,.06,.06);
    }
    let texture=boardTextures.get(selection.board);
    if(!texture){
      texture=new B.Texture(boardSkins[selection.board].file,scene,false,true);
      texture.hasAlpha=true;
      boardTextures.set(selection.board,texture);
    }
    boardMaterial.diffuseTexture=texture;
    boardMaterial.opacityTexture=texture;
  }
  function frame() {
    if(!running) return;
    const t=(performance.now()-start)/1000;
    avatar?.animate(t,.1*Math.sin(t*.7),0,false,false,0,angle);
    camera.alpha=-Math.PI/2+angle*.4;
    scene.render();
  }
  const resize=()=>{if(running)engine?.resize();};
  window.addEventListener('resize',resize);
  canvas.addEventListener('pointerdown',event=>{dragStart={x:event.clientX,angle};canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{if(dragStart)angle=Math.max(-.9,Math.min(.9,dragStart.angle+(event.clientX-dragStart.x)/260));});
  canvas.addEventListener('pointerup',()=>{dragStart=null;});
  canvas.addEventListener('pointercancel',()=>{dragStart=null;});
  return {
    open(value){selection={...value};init();if(!scene)return;rebuild();if(running)return;running=true;requestAnimationFrame(resize);engine.runRenderLoop(frame);},
    update(value){selection={...value};rebuild();},
    close(){running=false;engine?.stopRenderLoop(frame);}
  };
}
