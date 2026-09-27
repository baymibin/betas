import {MAPS} from '../shared/maps.js';
import {buildVolcanicCoast} from './volcanic-coast.js';

export function applyMapTheme(B, scene, id, {sand, water, decor}) {
  water.backFaceCulling=true;
  water.needDepthPrePass=true;
  const m = MAPS[id];
  const kind = m.kind;

  const sands=['#fff4dc','#f7e9c1','#ffe1b4','#f8dfaf','#d0c7ca','#e4f5f3','#e1e7b8','#d3d4ee'];
  if(!sand.diffuseTexture){
    const tex=new B.Texture('./assets/images/environment/painted-sand-v2.webp',scene);
    tex.wrapU=tex.wrapV=B.Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel=4;
    sand.diffuseTexture=tex;
  }
  sand.bumpTexture=null;sand.diffuseColor=B.Color3.FromHexString(sands[id]);
  sand.emissiveColor=sand.diffuseColor.scale(.04);sand.specularColor=B.Color3.Black();
  scene.fogColor=B.Color3.FromHexString(id===7?'#8db7d6':'#a6ddf5');scene.fogDensity=.0022;
  scene.clearColor=new B.Color4(scene.fogColor.r,scene.fogColor.g,scene.fogColor.b,1);
  const sky=scene.getMaterialByName('skyMat');
  // The procedural sky supplies its own tropical daylight gradient.
  const sun=scene.getLightByName('sun');if(sun){sun.intensity=2.3;sun.diffuse=B.Color3.FromHexString('#fffcf0');}
  const hemi=scene.getLightByName('hemi');if(hemi){hemi.intensity=0.85;hemi.diffuse=B.Color3.FromHexString('#e0f5ff');hemi.groundColor=B.Color3.FromHexString('#78e2d7');}
  water.setColor3('uFogColor',scene.fogColor);water.setFloat('uFogDensity',scene.fogDensity);
  for (const node of decor) node.setEnabled(false);
  const art=buildVolcanicCoast(B, scene, sand, kind, id);
  const reflection=scene.environmentTexture;
  if(Array.isArray(reflection?.renderList)){
    reflection.renderList.length=0;
    const skyboxMesh=scene.getMeshByName('sky');
    if(skyboxMesh)reflection.renderList.push(skyboxMesh);
    reflection.renderList.push(...art.reflectionMeshes);
    reflection.refreshRate=B.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    reflection.resetRefreshCounter?.();
  }

  // High-contrast, tailored water gradients for each environment
  const waterPalettes = {
    tropical: {deep: '#008bad', shallow: '#2fe4da'},
    lagoon:   {deep: '#078f9f', shallow: '#71ebcd'},
    sunset:   {deep: '#378fc2', shallow: '#91e4e5'},
    desert:   {deep: '#0d9dc3', shallow: '#68e8e5'},
    volcanic: {deep: '#278bac', shallow: '#65dad8'},
    ice:      {deep: '#318fc1', shallow: '#a1f0f5'},
    mangrove: {deep: '#138f9c', shallow: '#67e2c8'},
    night:    {deep: '#427cb8', shallow: '#8bdbe6'}
  };

  const wp = waterPalettes[kind] || {deep: m.water, shallow: '#4ee7dc'};
  water.setColor3('uDeep', B.Color3.FromHexString(wp.deep));
  water.setColor3('uShallow', B.Color3.FromHexString(wp.shallow));
  // Bahia Coral uses the crystal lagoon shading; the other circuits keep the legacy branch.
  const coral = id === 0;
  // Tropical colour grade for Bahia Coral only (reset for the other circuits).
  const ip = scene.imageProcessingConfiguration;
  if (ip) {
    ip.colorCurvesEnabled = coral;
    if (coral) {
      const curves = new B.ColorCurves();
      curves.globalSaturation = 28;
      curves.highlightsSaturation = -10;
      curves.shadowsHue = 200; curves.shadowsDensity = 12; curves.shadowsSaturation = 30;
      ip.colorCurves = curves;
    }
  }
  water.setFloat('uStyle', coral ? 1 : 0);
  if (coral) {
    water.setColor3('uDeep', B.Color3.FromHexString('#0650a6'));
    water.setColor3('uShallow', B.Color3.FromHexString('#0d95d2'));
    water.setColor3('uShore', B.Color3.FromHexString('#38dcd4'));
    water.setFloat('uCausticStrength', 0.27);
  }
  return art;
}
