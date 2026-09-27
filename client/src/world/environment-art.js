// Shared textures and materials keep all repeated scenery on the same GPU resources.
export function paintedMaterial(B,scene,name,path,{alpha=false,u=1,v=1}={}) {
  const texture=new B.Texture(path,scene,false,true,B.Texture.TRILINEAR_SAMPLINGMODE);
  texture.uScale=u;texture.vScale=v;texture.anisotropicFilteringLevel=4;texture.hasAlpha=alpha;
  const material=new B.StandardMaterial(name,scene);
  material.diffuseTexture=texture;material.emissiveTexture=texture;
  material.diffuseColor=B.Color3.Black();material.emissiveColor=B.Color3.White();
  material.disableLighting=true;material.specularColor=B.Color3.Black();material.backFaceCulling=false;
  if(alpha){material.useAlphaFromDiffuseTexture=true;material.transparencyMode=B.Material.MATERIAL_ALPHATEST;material.alphaCutOff=.35;}
  return material;
}
