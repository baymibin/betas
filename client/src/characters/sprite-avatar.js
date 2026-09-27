// The same atlas is used by the shop and the in-world avatars; no per-frame images are fetched.
export function createSpriteAvatar(B,scene,parent,character,board,url) {
  const root=new B.TransformNode('sprite-avatar',scene);root.parent=parent;
  function plane(name,index,row,width,height,y) {
    const mesh=B.MeshBuilder.CreatePlane(name,{width,height},scene);mesh.parent=root;mesh.position.y=y;
    mesh.billboardMode=B.Mesh.BILLBOARDMODE_ALL;
    const texture=new B.Texture(url,scene,false,false);
    texture.hasAlpha=true;texture.uScale=.18;texture.vScale=row===0?-460/1024:-564/1024;texture.uOffset=index/5+.01;texture.vOffset=row===0?460/1024:1;
    const material=new B.StandardMaterial(name,scene);material.diffuseTexture=texture;material.emissiveColor=new B.Color3(1,1,1);material.disableLighting=true;material.backFaceCulling=false;material.useAlphaFromDiffuseTexture=true;material.transparencyMode=B.Material.MATERIAL_ALPHATESTANDBLEND;
    mesh.material=material;return mesh;
  }
  const deck=plane('sprite-board',board,1,1.8,2.8,.15);
  deck.billboardMode=0;deck.rotation.x=Math.PI/2;
  const animal=plane('sprite-character',character,0,1.65,2.6,1.1);animal.position.z=.03;
  root.disposeAvatar=()=>{ for(const m of root.getChildMeshes()) {m.material.diffuseTexture.dispose();m.material.dispose();}root.dispose(); };
  return root;
}
