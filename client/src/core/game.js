import './catalog-remote.js';   // items subidos desde el panel, antes de crear avatares
import {tropicalWaterFragment,createTropicalSky} from '../world/tropical-shaders.js';
import {createPowerWorld,stepPowerWorld} from '../shared/powerups.js';
import {botLooks,createBotPlayer,createBrain,botInput} from '../shared/bot-ai.js';
import {createPowerView} from '../effects/powerups-view.js';
import {createRoomUI} from '../ui/rooms.js';
import {settings, playSound, startMatchAudio, stopMatchAudio} from '../ui/home-ui.js';
import {MAPS,isMapEnabled} from '../shared/maps.js';
import {setTrackMap} from '../shared/track.js';
import {createRaceUI,TRICKS} from '../ui/race-ui.js';
import {applyMapTheme} from '../world/map-theme.js';
import {addBeachHuts} from '../world/beach-huts.js';
import {addBeachSpectators} from '../world/spectators.js';
import {trackFrame,trackBounds} from '../shared/track.js';
import {createTrackView} from '../world/track-view.js';
import {paintedMaterial} from '../world/environment-art.js';
import {addTropicalCoast} from '../world/coast.js';
import {createCourseView} from '../world/course-view.js';
import {SURF_LIMIT,courseSection,SECTION,rampHeight,raceProgress,LAP_LENGTH,TOTAL_LAPS} from '../shared/course.js';
import {createPlayer,advance,DT,playerSpeed} from '../shared/simulation.js';
import { SurfNetwork } from '../network/network.js';
import { profile } from '../ui/shop.js';
import {createStickAvatar} from '../characters/stick-avatar.js';

(function(){
"use strict";

const fatalEl = document.getElementById('fatal');
function fatal(msg){
  fatalEl.style.display = 'flex';
  fatalEl.innerHTML = '<div><b>No se pudo iniciar el juego</b><br><br>' + msg + '</div>';
  const l = document.getElementById('loading'); if(l) l.classList.add('gone');
}
if(!window.BABYLON){ fatal('No se pudo cargar Babylon.js desde el CDN.<br>Comprueba tu conexiÃ³n a internet y recarga la pÃ¡gina.'); return; }

// ?hq fija la calidad mÃ¡xima y desactiva el ajuste automÃ¡tico (Ãºtil para capturas)
const PARAMS = new URLSearchParams(window.location.search);
const LOCK_QUALITY = PARAMS.has('hq');

// =====================================================================
//  CONFIG
// =====================================================================
const CFG = {
  oceanWidth: 26,
  oceanLength: 480,
  laneOffset: [-1.9, 0, 1.9],
  lateralLimit: SURF_LIMIT,
  spawnGap: 9,
  speedGrowth: 0.55,
  baseSpeed: 9.5,
  gravity: -24,
  jumpForce: 8.6,
  rampBoost: 1.35,
  slideTime: 0.5,
  boostMult: 1.85,
  boostDrain: 0.42,
  fogColor: '#a6e7f7',
  fogDensity: 0.0028,
};

// Sun direction, shared by sky / light / water so everything agrees.
// Kept well off to the left of the chase camera: a sun dead ahead blows the
// sky out to white and hides the blue.
const SUN_DIR = new BABYLON.Vector3(-0.72, 0.62, -0.30).normalize();

// Gerstner wave table.
// Wavelengths are chosen so the whole field repeats exactly every 120 units
// along Z -- that lets us re-centre the wave origin during an endless run
// without ever seeing a seam, and keeps shader floats small.
const WAVES = [
  { dx: 1.0, dz: 0.0, amp: 0.170, len: 24.0, steep: 0.64, speed: 0.90 },
  { dx: 0.0, dz: 1.0, amp: 0.125, len: 20.0, steep: 0.60, speed: 1.05 },
  { dx: 0.6, dz: 0.8, amp: 0.080, len: 12.0, steep: 0.52, speed: 1.35 },
  { dx: 0.8, dz: 0.6, amp: 0.058, len: 12.0, steep: 0.52, speed: 1.60 },
];
const WAVE_PERIOD_Z = 120;
const TAU = Math.PI * 2;

// JS mirror of the GLSL wave sum -- the board really rides this surface.
function oceanSample(x, z, t, out){
  let dy = 0, nx = 0, ny = 0, nz = 0;
  for(let i=0;i<WAVES.length;i++){
    const w = WAVES[i];
    const k = TAU / w.len;
    const f = k * (w.dx * x + w.dz * z) + w.speed * k * t;
    const S = Math.sin(f), C = Math.cos(f);
    const wa = k * w.amp;
    const q = w.steep / Math.max(wa * 4, 0.0001);
    dy += w.amp * S;
    nx += -w.dx * wa * C;
    nz += -w.dz * wa * C;
    ny += -q * wa * S;
  }
  out.y = dy;
  out.nx = nx; out.ny = 1 + ny; out.nz = nz;
  return out;
}
const _samp = { y:0, nx:0, ny:1, nz:0 };

// =====================================================================
//  ENGINE / SCENE
// =====================================================================
const canvas = document.getElementById('render-canvas');
let engine;
try{
  engine = new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    powerPreference: 'high-performance',
    disableWebGL2Support: false,
  }, false);
}catch(e){
  fatal('Tu navegador no soporta WebGL.<br>' + e.message);
  return;
}
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1,1.5));

const scene = new BABYLON.Scene(engine);
scene.clearColor = BABYLON.Color4.FromColor3(BABYLON.Color3.FromHexString('#8fd0e6'));
scene.ambientColor = new BABYLON.Color3(0.35, 0.42, 0.46);
scene.skipPointerMovePicking = true;
scene.autoClear = true;
scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
scene.fogColor = BABYLON.Color3.FromHexString(CFG.fogColor);
scene.fogDensity = CFG.fogDensity;

const camera = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(0, 4.6, 8.5), scene);
camera.minZ = 0.25;
// must comfortably exceed the skybox radius, or the whole sky is clipped away
camera.maxZ = 3200;
camera.fov = 1.02;
camera.inputs.clear();
camera.rotation = BABYLON.Vector3.Zero();
const _camTarget = new BABYLON.Vector3();

// =====================================================================
//  MATERIAL HELPERS
// =====================================================================
function pbr(name, hex, roughness, metallic){
  const m = new BABYLON.PBRMaterial(name, scene);
  m.albedoColor = BABYLON.Color3.FromHexString(hex);
  m.roughness = roughness;
  m.metallic = metallic === undefined ? 0 : metallic;
  m.environmentIntensity = 1.0;
  m.usePhysicalLightFalloff = false;
  m.backFaceCulling = true;
  return m;
}
function unlit(name, hex, alpha){
  const m = new BABYLON.StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveColor = BABYLON.Color3.FromHexString(hex);
  m.diffuseColor = BABYLON.Color3.Black();
  m.specularColor = BABYLON.Color3.Black();
  if(alpha !== undefined){ m.alpha = alpha; }
  return m;
}
function softCircleTexture(name, size, midStop){
  const dt = new BABYLON.DynamicTexture(name, {width:size, height:size}, scene, true);
  const ctx = dt.getContext();
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(midStop === undefined ? 0.4 : midStop, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  dt.update();
  dt.hasAlpha = true;
  return dt;
}

// deterministic noise so the scenery is the same on every run
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// =====================================================================
//  SKY + SUN + IBL
// =====================================================================
const skybox = BABYLON.MeshBuilder.CreateBox('sky', {size: 3000}, scene);
const skyMat = createTropicalSky(BABYLON,scene);
skybox.material = skyMat;
skybox.infiniteDistance = true;
skybox.isPickable = false;
skybox.applyFog = false;

// mirror sky into a cube so water and PBR props get real reflections
let skyProbe = null;
try{
  skyProbe = new BABYLON.ReflectionProbe('skyProbe', 256, scene);
  skyProbe.renderList.push(skybox);
  skyProbe.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  scene.environmentTexture = skyProbe.cubeTexture;
  scene.environmentIntensity = 0.95;
}catch(e){
  skyProbe = null;
  scene.environmentIntensity = 0.6;
  console.warn('[surf] reflection probe unavailable, using analytic sky only', e);
}

const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0.85;
hemi.diffuse = BABYLON.Color3.FromHexString('#e0f5ff');
hemi.groundColor = BABYLON.Color3.FromHexString('#78e2d7');
hemi.specular = BABYLON.Color3.Black();

const sun = new BABYLON.DirectionalLight('sun', SUN_DIR.scale(-1), scene);
sun.position = SUN_DIR.scale(80);
sun.intensity = 2.3;
sun.diffuse = BABYLON.Color3.FromHexString('#fffcf0');
sun.specular = BABYLON.Color3.FromHexString('#fff8e6');
sun.autoUpdateExtends = false;
sun.orthoLeft = -16; sun.orthoRight = 16;
sun.orthoTop = 16;  sun.orthoBottom = -16;
sun.shadowMinZ = 1; sun.shadowMaxZ = 150;

const shadows = new BABYLON.ShadowGenerator(512, sun);
shadows.useBlurExponentialShadowMap = true;
shadows.blurKernel = 24;
shadows.depthScale = 60;
shadows.bias = 0.008;
shadows.normalBias = 0.018;
shadows.setDarkness(0.28);

// =====================================================================
//  POST PROCESSING (the "real camera" look)
// =====================================================================
let pipeline = null;
try{
  pipeline = new BABYLON.DefaultRenderingPipeline('defaultPipeline', true, scene, [camera]);
  pipeline.samples = 2;
  pipeline.fxaaEnabled = true;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.86;
  pipeline.bloomWeight = 0.16;
  pipeline.bloomKernel = 52;
  pipeline.bloomScale = 0.6;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipeline.imageProcessing.exposure = 1.08;
  pipeline.imageProcessing.contrast = 1.08;
  pipeline.imageProcessing.vignetteEnabled = false;
  pipeline.imageProcessing.vignetteWeight = 1.6;
  pipeline.imageProcessing.vignetteColor = new BABYLON.Color4(0.01, 0.08, 0.12, 0);
  pipeline.grainEnabled = false;
  pipeline.grain.intensity = 5.5;
  pipeline.grain.animated = true;
  pipeline.chromaticAberrationEnabled = false;
  pipeline.chromaticAberration.aberrationAmount = 6;
  pipeline.chromaticAberration.radialIntensity = 0.55;
}catch(e){
  pipeline = null;
  console.warn('[surf] post-processing pipeline unavailable', e);
}

// =====================================================================
//  OCEAN
// =====================================================================
const waveCalls = WAVES.map(function(w){
  return '  addWave(vec2(' + w.dx.toFixed(3) + ', ' + w.dz.toFixed(3) + '), ' +
         w.amp.toFixed(4) + ', ' + w.len.toFixed(2) + ', ' +
         w.steep.toFixed(3) + ', ' + w.speed.toFixed(3) + ', p, t, disp, nsum);';
}).join('\n');

// ---------------------------------------------------------------------
//  Ocean detail textures.
//  These are the "sprites" the sea needs: a tiling normal map for fine
//  ripple detail and a tiling spume map so foam breaks up organically.
//  Both are generated here as sum-of-periodic-sines / wrapped value noise
//  so they tile seamlessly and need no external files. If you ever want to
//  swap in hand-made art, drop a PNG in next to index.html and replace the
//  `oceanNormalTexture()` / `oceanFoamTexture()` calls with
//  `new BABYLON.Texture('water_normal.png', scene)` -- the shader only
//  cares that it is a tiling texture of the same kind.
// ---------------------------------------------------------------------
function oceanNormalTexture(size){
  const dt = new BABYLON.DynamicTexture('oceanNormal', {width:size, height:size}, scene, true);
  const ctx = dt.getContext();
  const rnd = mulberry32(90210);
  const lobes = [];
  for(let i=0;i<13;i++){
    const fx = Math.round((rnd() * 2 - 1) * 6);
    const fy = Math.round((rnd() * 2 - 1) * 6);
    if(fx === 0 && fy === 0) continue;
    lobes.push({
      fx: fx, fy: fy,
      amp: 1 / (1 + Math.sqrt(fx*fx + fy*fy) * 0.75),
      ph: rnd() * TAU,
    });
  }
  const height = function(u, v){
    let s = 0;
    for(let i=0;i<lobes.length;i++){
      const L = lobes[i];
      s += L.amp * Math.sin(TAU * (L.fx * u + L.fy * v) + L.ph);
    }
    return s;
  };
  const img = ctx.createImageData(size, size);
  const step = 1 / size;
  const strength = 2.6;
  for(let y=0;y<size;y++){
    const v = y * step;
    for(let x=0;x<size;x++){
      const u = x * step;
      const nx = -(height(u + step, v) - height(u - step, v)) * strength;
      const nz = -(height(u, v + step) - height(u, v - step)) * strength;
      const len = Math.sqrt(nx*nx + 1 + nz*nz);
      const o = (y * size + x) * 4;
      img.data[o]     = Math.round(((nx/len) * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round(((1/len)  * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round(((nz/len) * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  dt.update();
  dt.wrapU = dt.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  return dt;
}

function oceanFoamTexture(size){
  const dt = new BABYLON.DynamicTexture('oceanFoam', {width:size, height:size}, scene, true);
  const ctx = dt.getContext();
  const rnd = mulberry32(4711);
  const L = 8;
  const grid = [];
  for(let i=0;i<L*L;i++) grid.push(rnd());
  const at = function(gx, gy){
    return grid[(((gy % L) + L) % L) * L + (((gx % L) + L) % L)];
  };
  const fade = function(t){ return t*t*(3 - 2*t); };
  const noise = function(u, v){
    const x = u * L, y = v * L;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = fade(x - x0), ty = fade(y - y0);
    const a = at(x0, y0), b = at(x0+1, y0), c = at(x0, y0+1), d = at(x0+1, y0+1);
    return (a*(1-tx) + b*tx) * (1-ty) + (c*(1-tx) + d*tx) * ty;
  };
  const img = ctx.createImageData(size, size);
  for(let y=0;y<size;y++){
    const v = y / size;
    for(let x=0;x<size;x++){
      const u = x / size;
      let n = noise(u, v) * 0.55 + noise(u*2, v*2) * 0.28 + noise(u*4, v*4) * 0.17;
      // gentle contrast stretch only -- a hard threshold leaves almost the
      // whole map at zero and the spume term never fires
      n = Math.min(1, Math.max(0, (n - 0.15) / 0.70));
      const o = (y * size + x) * 4;
      const b = Math.round(n * 255);
      img.data[o] = b; img.data[o+1] = b; img.data[o+2] = b; img.data[o+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  dt.update();
  dt.wrapU = dt.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  return dt;
}

const oceanNormalTex = oceanNormalTexture(256);
const oceanFoamTex = oceanFoamTexture(256);

BABYLON.Effect.ShadersStore['surfOceanVertexShader'] = [
'precision highp float;',
'attribute vec3 position;',
'attribute vec2 uv;',
'uniform mat4 world;',
'uniform mat4 viewProjection;',
'uniform float uTime;',
'uniform vec2 uWaveOffset;',
'varying vec3 vWorldPos;',
'varying vec3 vNormal;',
'varying float vCrest;',
'varying vec2 vUV;',
'const float TAU = 6.28318530718;',
'void addWave(vec2 dir, float amp, float len, float steep, float speed, vec2 p, float t, inout vec3 disp, inout vec3 nsum){',
'  float w = TAU / len;',
'  float f = w * dot(dir, p) + speed * w * t;',
'  float S = sin(f);',
'  float C = cos(f);',
'  float wa = w * amp;',
'  float q = steep / max(wa * 4.0, 0.0001);',
'  disp.x += dir.x * q * amp * C;',
'  disp.z += dir.y * q * amp * C;',
'  disp.y += amp * S;',
'  nsum.x += -dir.x * wa * C;',
'  nsum.z += -dir.y * wa * C;',
'  nsum.y += -q * wa * S;',
'}',
'void main(void){',
'  vec4 wp0 = world * vec4(position, 1.0);',
'  vec2 p = wp0.xz;',
'  vec3 disp = vec3(0.0);',
'  vec3 nsum = vec3(0.0);',
'  float t = uTime;',
waveCalls,
'  vec3 wp = wp0.xyz + disp;',
'  gl_Position = viewProjection * vec4(wp, 1.0);',
'  vWorldPos = wp;',
'  vNormal = normalize(vec3(nsum.x, 1.0 + nsum.y, nsum.z));',
'  vCrest = disp.y;',
'  vUV = uv;',
'}'
].join('\n');

// Stylized surface shading only; Gerstner geometry and its CPU movement mirror stay intact.
BABYLON.Effect.ShadersStore['surfOceanFragmentShader'] = tropicalWaterFragment;

const oceanMat = new BABYLON.ShaderMaterial('oceanMat', scene, {
  vertex: 'surfOcean',
  fragment: 'surfOcean',
}, {
  attributes: ['position', 'uv'],
  uniforms: ['world', 'viewProjection', 'uTime', 'uWaveOffset', 'uCameraPos',
             'uSunDir', 'uSunColor', 'uDeep', 'uShallow', 'uSkyTop', 'uSkyHorizon',
             'uFogColor', 'uFogDensity', 'uEdgeX', 'uShore', 'uStyle', 'uCausticStrength'],
  samplers: ['uSky', 'uNormalTex', 'uFoamTex', 'uCausticTex', 'uLaceTex'],
  needAlphaBlending: true,
  needAlphaTesting: false,
});
oceanMat.backFaceCulling = false;
oceanMat.setVector3('uSunDir', SUN_DIR);
oceanMat.setColor3('uSunColor', BABYLON.Color3.FromHexString('#fffbf0'));
oceanMat.setColor3('uDeep', BABYLON.Color3.FromHexString('#073a54'));
oceanMat.setColor3('uShallow', BABYLON.Color3.FromHexString('#4beae2'));
oceanMat.setColor3('uSkyTop', BABYLON.Color3.FromHexString('#2994e6'));
oceanMat.setColor3('uSkyHorizon', BABYLON.Color3.FromHexString('#a8e7f5'));
oceanMat.setColor3('uFogColor', BABYLON.Color3.FromHexString(CFG.fogColor));
oceanMat.setFloat('uFogDensity', CFG.fogDensity);
oceanMat.setFloat('uEdgeX', CFG.oceanWidth / 2);
oceanMat.setVector2('uWaveOffset', new BABYLON.Vector2(0, 0));
oceanMat.setVector3('uCameraPos', BABYLON.Vector3.Zero());
if(skyProbe){ oceanMat.setTexture('uSky', skyProbe.cubeTexture); }
oceanMat.setTexture('uNormalTex', oceanNormalTex);
oceanMat.setTexture('uFoamTex', oceanFoamTex);
// Detail maps for the stylized lagoon look (generated by generate-environment-textures.py).
const oceanCausticTex = new BABYLON.Texture('./assets/images/environment/water/caustics.webp', scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
const oceanLaceTex = new BABYLON.Texture('./assets/images/environment/water/foam-lace.webp', scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
oceanCausticTex.wrapU = oceanCausticTex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
oceanLaceTex.wrapU = oceanLaceTex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
oceanMat.setTexture('uCausticTex', oceanCausticTex);
oceanMat.setTexture('uLaceTex', oceanLaceTex);
oceanMat.setFloat('uStyle', 0);
oceanMat.setFloat('uCausticStrength', 0.3);
oceanMat.setColor3('uShore', BABYLON.Color3.FromHexString('#5fe3d6'));

const ocean = BABYLON.MeshBuilder.CreateGround('ocean', {
  width: 420,
  height: CFG.oceanLength,
  subdivisionsX: 40,
  subdivisionsY: 96,
}, scene);
ocean.material = oceanMat;
ocean.isPickable = false;
ocean.alwaysSelectAsActiveMesh = true;
ocean.receiveShadows = false;

// =====================================================================
//  BEACHES
// =====================================================================
function sandTexture(){
  const S = 256;
  const dt = new BABYLON.DynamicTexture('sandTex', {width:S, height:S}, scene, true);
  const ctx = dt.getContext();
  ctx.fillStyle = '#e6cd9c';
  ctx.fillRect(0, 0, S, S);
  const rnd = mulberry32(1337);
  for(let i=0;i<9000;i++){
    const x = rnd()*S, y = rnd()*S, r = 0.5 + rnd()*1.5;
    const v = rnd();
    ctx.fillStyle = v < 0.42 ? 'rgba(196,166,114,0.55)'
                 : v < 0.78 ? 'rgba(252,240,214,0.55)'
                            : 'rgba(168,138,96,0.45)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  dt.update();
  dt.uScale = 26; dt.vScale = 120;
  return dt;
}
const sandMat = new BABYLON.StandardMaterial('tropical-sand', scene);
sandMat.diffuseColor = BABYLON.Color3.FromHexString('#f7dda1');
sandMat.emissiveColor = sandMat.diffuseColor.scale(0.25);
sandMat.specularColor = BABYLON.Color3.FromHexString('#50422c');
sandMat.specularPower = 28;
sandMat.backFaceCulling = false;
const BEACH_W = 85;
const BEACH_X = 11.9 + BEACH_W/2;

// matches the profile baked into buildBeach(), so scenery sits on the sand
function sandHeightAt(worldX){
  const inland=Math.max(0,Math.abs(worldX)-11.9);
  return .12+Math.min(inland*.23,4.8);
}
function buildBeach(sign){
  const beach=BABYLON.MeshBuilder.CreateGround('coast-ground',{width:BEACH_W,height:CFG.oceanLength+100,subdivisionsX:60,subdivisionsY:64,updatable:true},scene);
  const pos=beach.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  for(let i=0;i<pos.length;i+=3){
    const inland=pos[i]*sign+BEACH_W/2;
    pos[i+1]=.12+Math.min(inland*.23,4.8)+Math.sin(pos[i+2]*.035)*Math.min(.15,inland*.012);
  }
  beach.updateVerticesData(BABYLON.VertexBuffer.PositionKind,pos);
  const normals=[];BABYLON.VertexData.ComputeNormals(pos,beach.getIndices(),normals);beach.setVerticesData(BABYLON.VertexBuffer.NormalKind,normals);
  beach.material=sandMat;beach.position.x=sign*BEACH_X;beach.receiveShadows=true;beach.isPickable=false;return beach;
}
const beachL=buildBeach(-1),beachR=new BABYLON.TransformNode('unused-shore',scene);
// A raised, continuous green interior joins the sand instead of floating vegetation patches.
const grassMat=new BABYLON.StandardMaterial('coastal-grass',scene);
grassMat.diffuseColor=BABYLON.Color3.FromHexString('#528e35');grassMat.emissiveColor=grassMat.diffuseColor.scale(.22);grassMat.specularColor=BABYLON.Color3.Black();
const grass=BABYLON.MeshBuilder.CreateGround('coastal-interior',{width:72,height:CFG.oceanLength+100,subdivisionsX:20,subdivisionsY:32,updatable:true},scene);
grass.parent=beachL;grass.position.x=-6.5;grass.material=grassMat;
const gp=grass.getVerticesData(BABYLON.VertexBuffer.PositionKind);
for(let i=0;i<gp.length;i+=3)gp[i+1]=sandHeightAt(gp[i]+grass.position.x-BEACH_X)+.035;
grass.updateVerticesData(BABYLON.VertexBuffer.PositionKind,gp);
const gn=[];BABYLON.VertexData.ComputeNormals(gp,grass.getIndices(),gn);grass.setVerticesData(BABYLON.VertexBuffer.NormalKind,gn);

// =====================================================================
//  SCENERY BUILDERS
// =====================================================================
const rockMat = pbr('rockMat', '#8d8579', 0.92, 0.0);
const rockMatDark = pbr('rockMatDark', '#5d5c56', 0.95, 0.0);
const trunkMat = pbr('trunkMat', '#8a6a45', 0.88, 0.0);
const leafMatA = pbr('leafMatA', '#2f9b52', 0.7, 0.0);
const leafMatB = pbr('leafMatB', '#3fb968', 0.7, 0.0);
const leafMatC = pbr('leafMatC', '#1f7d40', 0.75, 0.0);
const leafMats = [leafMatA, leafMatB, leafMatC];
leafMats.forEach(m=>{m.emissiveColor=m.albedoColor.scale(.42);m.environmentIntensity=.35;});
const woodMat = pbr('woodMat', '#9d7a4f', 0.9, 0.0);
const bambooMat = pbr('bambooMat', '#d9bc7c', 0.72, 0.0);
const cocoMat = pbr('cocoMat', '#6d4a2a', 0.8, 0.0);
const parasolMatA = pbr('parasolMatA', '#ff6b4a', 0.62, 0.0);
const parasolMatB = pbr('parasolMatB', '#37d0dd', 0.62, 0.0);
const parasolMatC = pbr('parasolMatC', '#ffd15c', 0.62, 0.0);
const parasolMats = [parasolMatA, parasolMatB, parasolMatC];

// palm fronds are registered here so the whole coast can sway in the wind
const swayNodes = [];

function makeRockMesh(name, radius, detail, seed){
  const m = BABYLON.MeshBuilder.CreateIcoSphere(name, {radius: radius, subdivisions: detail, flat: true}, scene);
  const pos = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const rnd = mulberry32(seed);
  for(let i=0;i<pos.length;i+=3){
    const f = 0.72 + rnd()*0.56;
    pos[i] *= f; pos[i+1] *= f * (0.62 + rnd()*0.4); pos[i+2] *= f;
  }
  m.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
  const normals = [];
  BABYLON.VertexData.ComputeNormals(pos, m.getIndices(), normals);
  m.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
  m.material = rockMat;
  return m;
}

function makeFrond(name, len, width, droop, mat){
  const spine = [], left = [], right = [];
  const N = 9;
  for(let i=0;i<=N;i++){
    const t = i / N;
    const x = t * len;
    const y = -droop * t * t;
    const w = Math.max(0.006, width * Math.sin(Math.PI * Math.pow(t, 0.62)) * 0.5);
    spine.push(new BABYLON.Vector3(x, y + 0.02, 0));
    left.push(new BABYLON.Vector3(x, y, -w));
    right.push(new BABYLON.Vector3(x, y, w));
  }
  const m = BABYLON.MeshBuilder.CreateRibbon(name, {
    pathArray: [left, spine, right],
    sideOrientation: BABYLON.Mesh.DOUBLESIDE,
  }, scene);
  m.material = mat;
  return m;
}

function makePalm(seed){
  const rnd = mulberry32(seed);
  const root = new BABYLON.TransformNode('palm', scene);
  const height = 3.0 + rnd() * 3.2;
  const bend = (rnd() - 0.5) * 1.5;
  const path = [];
  const STEPS = 10;
  for(let i=0;i<=STEPS;i++){
    const t = i / STEPS;
    path.push(new BABYLON.Vector3(
      Math.sin(t * 1.25) * bend * t,
      t * height,
      Math.sin(t * 0.9 + seed) * 0.35 * t
    ));
  }
  const trunk = BABYLON.MeshBuilder.CreateTube('trunk', {
    path: path,
    tessellation: 10,
    cap: BABYLON.Mesh.CAP_ALL,
    radiusFunction: function(i, d){
      const t = i / STEPS;
      return 0.20 * (1 - t) + 0.085 * t + 0.02;
    },
  }, scene);
  trunk.material = trunkMat;
  root.addChild(trunk);

  const top = path[STEPS];
  const nFronds = 7 + Math.floor(rnd() * 4);
  for(let i=0;i<nFronds;i++){
    const len = 1.6 + rnd() * 1.5;
    const frond = makeFrond('frond', len, 0.75 + rnd() * 0.35, 0.85 + rnd() * 0.7,
                            leafMats[Math.floor(rnd() * leafMats.length)]);
    frond.parent = root;
    frond.position.copyFrom(top);
    frond.rotation.y = (TAU / nFronds) * i + rnd() * 0.35;
    frond.rotation.z = -0.15 - rnd() * 0.4;
    swayNodes.push({
      node: frond,
      baseZ: frond.rotation.z,
      baseY: frond.rotation.y,
      phase: rnd() * TAU,
      amp: 0.07 + rnd() * 0.09,
    });
  }
  for(let i=0;i<3;i++){
    const c = BABYLON.MeshBuilder.CreateSphere('coco', {diameter: 0.19, segments: 6}, scene);
    c.material = cocoMat;
    c.parent = root;
    c.position.set(top.x + (rnd()-0.5)*0.4, top.y - 0.18 - rnd()*0.12, top.z + (rnd()-0.5)*0.4);
  }
  root.getChildMeshes().forEach(function(m){
    m.isPickable = false;
    shadows.addShadowCaster(m);
  });
  return root;
}

function makeBeachRock(seed){
  const rnd = mulberry32(seed);
  const root = new BABYLON.TransformNode('beachRock', scene);
  const n = 2 + Math.floor(rnd() * 3);
  for(let i=0;i<n;i++){
    const r = makeRockMesh('rock', 0.35 + rnd() * 0.75, 1, seed * 31 + i);
    r.parent = root;
    r.position.set((rnd()-0.5)*1.5, 0.15 + rnd()*0.35, (rnd()-0.5)*1.5);
    r.rotation.set(rnd()*TAU, rnd()*TAU, rnd()*TAU);
    r.material = rnd() < 0.4 ? rockMatDark : rockMat;
    shadows.addShadowCaster(r);
  }
  return root;
}

function makeDriftwood(seed){
  const rnd = mulberry32(seed);
  const root = new BABYLON.TransformNode('driftwood', scene);
  const len = 2.2 + rnd() * 2.4;
  const path = [];
  for(let i=0;i<=6;i++){
    const t = i/6;
    path.push(new BABYLON.Vector3(0, Math.sin(t*2.0)*0.06, (t-0.5)*len));
  }
  const log = BABYLON.MeshBuilder.CreateTube('log', {
    path: path, tessellation: 8, cap: BABYLON.Mesh.CAP_ALL,
    radiusFunction: function(i){ const t = i/6; return 0.09 + 0.11 * (1 - t); },
  }, scene);
  log.material = woodMat;
  log.parent = root;
  log.position.y = 0.12;
  shadows.addShadowCaster(log);
  return root;
}

// ---------------------------------------------------------------------
//  BEACH SCENERY
//  Palms, parasols, rocks and driftwood along both shores, plus rocky
//  islets out in the water. Everything lives in a band that is recycled
//  around the surfer, so the coast never runs out however far you ride.
//  Palms sit right at the waterline: further inland they fall outside the
//  chase camera's frame and the coast reads as empty.
// ---------------------------------------------------------------------
const DECOR_SPAN = 270;
const DECOR_AHEAD = 95;
const decorItems = [];

function makeParasol(seed){
  const rnd = mulberry32(seed);
  const root = new BABYLON.TransformNode('parasol', scene);
  const pole = BABYLON.MeshBuilder.CreateCylinder('parasolPole', {
    diameter: 0.10, height: 2.4, tessellation: 8,
  }, scene);
  pole.material = bambooMat;
  pole.parent = root;
  pole.position.y = 1.2;
  const top = BABYLON.MeshBuilder.CreateCylinder('parasolTop', {
    diameterTop: 0.06, diameterBottom: 2.4, height: 0.66, tessellation: 16,
  }, scene);
  top.material = parasolMats[Math.floor(rnd() * parasolMats.length)];
  top.parent = root;
  top.position.y = 2.45;
  const ball = BABYLON.MeshBuilder.CreateSphere('parasolBall', {diameter: 0.16, segments: 8}, scene);
  ball.material = parasolMatA;
  ball.parent = root;
  ball.position.y = 2.80;
  shadows.addShadowCaster(top);
  shadows.addShadowCaster(pole);
  root.getChildMeshes().forEach(function(m){ m.isPickable = false; });
  return root;
}

// a half-submerged rock with a palm growing out of it, out in the water
function makeIslet(seed){
  const rnd = mulberry32(seed);
  const root = new BABYLON.TransformNode('islet', scene);
  const n = 2 + Math.floor(rnd() * 3);
  for(let i=0;i<n;i++){
    const r = makeRockMesh('isletRock', 0.55 + rnd() * 0.95, 1, seed * 11 + i);
    r.parent = root;
    r.position.set((rnd()-0.5) * 1.9, -0.10 + rnd() * 0.40, (rnd()-0.5) * 1.9);
    r.rotation.set(rnd() * TAU, rnd() * TAU, rnd() * TAU);
    r.material = rnd() < 0.5 ? rockMatDark : rockMat;
    shadows.addShadowCaster(r);
  }
  if(rnd() < 0.62){
    const p = makePalm(seed + 999);
    p.parent = root;
    p.scaling.setAll(0.55 + rnd() * 0.55);
    p.position.set((rnd()-0.5) * 0.9, 0.34, (rnd()-0.5) * 0.9);
    p.rotation.z = (rnd() - 0.5) * 0.34;
  }
  root.getChildMeshes().forEach(function(m){ m.isPickable = false; });
  return root;
}

(function buildScenery(){
  addTropicalCoast(BABYLON,scene,decorItems,sandHeightAt,DECOR_SPAN);
})();

function updateDecor(){
  const pz = playerRoot.position.z;
  for(let i=0;i<decorItems.length;i++){
    const d = decorItems[i];
    if(d.position.z > pz + DECOR_AHEAD) d.position.z -= DECOR_SPAN;
  }
}

// gentle wind through the fronds -- cheap, and it brings the coast alive
function updateSway(t){
  for(let i=0;i<swayNodes.length;i++){
    const s = swayNodes[i];
    const w = Math.sin(t * 1.15 + s.phase) * s.amp
            + Math.sin(t * 2.65 + s.phase * 1.7) * s.amp * 0.35;
    s.node.rotation.z = s.baseZ + w;
    s.node.rotation.y = s.baseY + Math.sin(t * 0.80 + s.phase) * 0.07;
  }
}

// =====================================================================
//  DISTANT SKYLINE + CLOUDS (kept at "infinity" by following the player)
// =====================================================================
const skylineRoot = new BABYLON.TransformNode('skyline', scene);

function cloudTexture(){
  const S = 256;
  const dt = new BABYLON.DynamicTexture('cloudTex', {width:S, height:S}, scene, true);
  const ctx = dt.getContext();
  ctx.clearRect(0, 0, S, S);
  const rnd = mulberry32(99);
  for(let i=0;i<26;i++){
    const x = 40 + rnd() * (S - 80);
    const y = 90 + rnd() * 80;
    const r = 22 + rnd() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.58)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.24)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  dt.update();
  dt.hasAlpha = true;
  return dt;
}
const cloudRoot = new BABYLON.TransformNode('cloudRoot', scene);
cloudRoot.parent = skylineRoot;

(function buildClouds(){
  const tex = cloudTexture();
  const mat = new BABYLON.StandardMaterial('cloudMat', scene);
  mat.disableLighting = true;
  mat.emissiveColor = BABYLON.Color3.White();
  mat.diffuseColor = BABYLON.Color3.Black();
  mat.specularColor = BABYLON.Color3.Black();
  mat.opacityTexture = tex;
  mat.emissiveTexture = tex;
  mat.backFaceCulling = false;
  mat.fogEnabled = false;
  mat.alphaMode = BABYLON.Engine.ALPHA_COMBINE;
  const rnd = mulberry32(2024);
  for(let i=0;i<12;i++){
    const p = BABYLON.MeshBuilder.CreatePlane('cloud', {size: 1, sideOrientation: BABYLON.Mesh.DOUBLESIDE}, scene);
    p.material = mat;
    p.parent = cloudRoot;
    const s = 60 + rnd() * 110;
    p.scaling.set(s * (1.4 + rnd()*0.7), s * (0.42 + rnd()*0.22), 1);
    const ang = rnd() * TAU;
    const rad = 340 + rnd() * 460;
    p.position.set(Math.cos(ang) * rad, 130 + rnd() * 150, Math.sin(ang) * rad - 300);
    p.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    p.isPickable = false;
    p.applyFog = false;
    p.renderingGroupId = 0;
  }
})();

// seagulls
const gulls = [];
(function buildGulls(){
  const mat = pbr('gullMat', '#f4f6f4', 0.7, 0);
  const rnd = mulberry32(555);
  for(let i=0;i<7;i++){
    const root = new BABYLON.TransformNode('gull', scene);
    root.parent = skylineRoot;
    const wingL = BABYLON.MeshBuilder.CreateBox('wL', {width: 1.5, height: 0.07, depth: 0.3}, scene);
    const wingR = BABYLON.MeshBuilder.CreateBox('wR', {width: 1.5, height: 0.07, depth: 0.3}, scene);
    const body = BABYLON.MeshBuilder.CreateSphere('gbody', {diameter: 0.42, segments: 6}, scene);
    body.scaling.set(1, 1, 1.9);
    [wingL, wingR, body].forEach(function(m){
      m.material = mat; m.parent = root; m.isPickable = false;
    });
    wingL.position.x = -0.78;
    wingR.position.x = 0.78;
    wingL.rotation.z = 0.12;
    wingR.rotation.z = -0.12;
    const ang = rnd() * TAU;
    root.position.set(Math.cos(ang) * (70 + rnd()*90), 16 + rnd()*22, Math.sin(ang) * (70 + rnd()*90) - 90);
    gulls.push({ root: root, wl: wingL, wr: wingR, phase: rnd() * TAU, speed: 0.5 + rnd() * 0.5, radius: 22 + rnd()*30 });
  }
})();

// =====================================================================
//  THE SURFER
// =====================================================================
const playerRoot = new BABYLON.TransformNode('playerRoot', scene);
const visualRoot = new BABYLON.TransformNode('visualRoot', scene);
visualRoot.parent = playerRoot;

const matBody   = pbr('matBody',   '#222a37', 0.46, 0.04);
const matBelly  = pbr('matBelly',  '#f7f8f4', 0.60, 0.0);
const matBeak   = pbr('matBeak',   '#f7a83c', 0.42, 0.0);
const matFeet   = pbr('matFeet',   '#ef8f2e', 0.52, 0.0);
const matEyeW   = pbr('matEyeW',   '#ffffff', 0.28, 0.0);
const matEyeB   = pbr('matEyeB',   '#101820', 0.18, 0.0);

function boardTexture(){
  const W = 128, H = 512;
  const dt = new BABYLON.DynamicTexture('boardTex', {width:W, height:H}, scene, true);
  const ctx = dt.getContext();
  ctx.fillStyle = '#fbf3df'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ff6b4a'; ctx.fillRect(0, H*0.30, W, H*0.06);
  ctx.fillStyle = '#1f8fa8'; ctx.fillRect(0, H*0.40, W, H*0.035);
  ctx.fillStyle = '#ffd15c'; ctx.fillRect(0, H*0.62, W, H*0.05);
  ctx.fillStyle = '#ff6b4a'; ctx.fillRect(0, H*0.86, W, H*0.04);
  // palm-ish emblem
  ctx.save();
  ctx.translate(W/2, H*0.20);
  ctx.fillStyle = 'rgba(255,107,74,0.9)';
  for(let i=0;i<5;i++){
    ctx.beginPath();
    ctx.ellipse(Math.cos(i/5*TAU)*16, Math.sin(i/5*TAU)*9, 15, 5, i/5*TAU, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  dt.update();
  return dt;
}
const boardMat = pbr('boardMat', '#faf3e0', 0.22, 0.06);
boardMat.albedoTexture = boardTexture();
boardMat.environmentIntensity = 1.1;

const finMat = pbr('finMat', '#ff8a5c', 0.35, 0.0);

// boardshorts: the Surf's Up look needs some colour on the character
function shortsTexture(){
  const W = 256, H = 128;
  const dt = new BABYLON.DynamicTexture('shortsTex', {width:W, height:H}, scene, true);
  const ctx = dt.getContext();
  ctx.fillStyle = '#ff6b4a'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fdf3df';
  ctx.beginPath();
  for(let x=0;x<=W;x+=4){
    const y = H*0.42 + Math.sin(x/W*TAU*3) * H*0.10;
    if(x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  for(let x=W;x>=0;x-=4){
    ctx.lineTo(x, H*0.64 + Math.sin(x/W*TAU*3) * H*0.10);
  }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1f8fa8'; ctx.fillRect(0, 0, W, H*0.13);
  const rnd = mulberry32(88);
  ctx.fillStyle = 'rgba(255,209,92,0.92)';
  for(let i=0;i<18;i++){
    ctx.beginPath(); ctx.arc(rnd()*W, rnd()*H*0.72, 3 + rnd()*4, 0, TAU); ctx.fill();
  }
  dt.update();
  return dt;
}
const matShorts = pbr('matShorts', '#ffffff', 0.58, 0.0);
matShorts.albedoTexture = shortsTexture();
const matCrest = pbr('matCrest', '#f2c344', 0.62, 0.0);

function createSurfer(){
  const g = new BABYLON.TransformNode('surfer', scene);
  g.parent = visualRoot;
  g.position.y = 0.16;
  g.rotation.y = 0.30;   // three-quarter surf stance

  // Everything above the deck hangs off `hips`, so the surfer can compress,
  // twist and pump while the feet stay planted on the board.
  const hips = new BABYLON.TransformNode('hips', scene);
  hips.parent = g;
  hips.position.y = 0.42;

  // ---- body
  const body = BABYLON.MeshBuilder.CreateCapsule('body', {
    height: 0.60, radius: 0.285, tessellation: 22, subdivisions: 2, capSubdivisions: 6,
  }, scene);
  body.material = matBody;
  body.parent = hips;
  body.position.y = 0.38;
  body.scaling.set(1.0, 1.0, 0.92);

  const belly = BABYLON.MeshBuilder.CreateSphere('belly', {diameter: 0.52, segments: 16}, scene);
  belly.material = matBelly;
  belly.parent = hips;
  belly.position.set(0, 0.34, -0.15);
  belly.scaling.set(0.87, 1.16, 0.55);

  const shorts = BABYLON.MeshBuilder.CreateCylinder('shorts', {
    diameterTop: 0.615, diameterBottom: 0.60, height: 0.30, tessellation: 18,
  }, scene);
  shorts.material = matShorts;
  shorts.parent = hips;
  shorts.position.y = 0.05;
  shorts.scaling.set(1.0, 1.0, 0.94);

  // ---- head on its own pivot so it can look where the surfer is going
  const headPivot = new BABYLON.TransformNode('headPivot', scene);
  headPivot.parent = hips;
  headPivot.position.y = 0.82;
  headPivot.rotation.y = -0.30;

  const head = BABYLON.MeshBuilder.CreateSphere('head', {diameter: 0.50, segments: 18}, scene);
  head.material = matBody;
  head.parent = headPivot;
  head.scaling.set(1.0, 0.98, 1.02);

  const cheekL = BABYLON.MeshBuilder.CreateSphere('cheekL', {diameter: 0.20, segments: 10}, scene);
  cheekL.material = matBelly; cheekL.parent = head;
  cheekL.position.set(-0.10, -0.03, -0.19);
  cheekL.scaling.set(0.72, 0.9, 0.5);
  const cheekR = cheekL.clone('cheekR');
  cheekR.position.x = 0.10;

  const beak = BABYLON.MeshBuilder.CreateCylinder('beak', {
    diameterTop: 0, diameterBottom: 0.14, height: 0.26, tessellation: 12,
  }, scene);
  beak.material = matBeak;
  beak.parent = head;
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, -0.03, -0.28);

  // eyes
  [-1, 1].forEach(function(s){
    const w = BABYLON.MeshBuilder.CreateSphere('eyeW', {diameter: 0.17, segments: 12}, scene);
    w.material = matEyeW; w.parent = head;
    w.position.set(s * 0.135, 0.10, -0.185);
    w.scaling.set(1, 1.05, 0.85);
    const b = BABYLON.MeshBuilder.CreateSphere('eyeB', {diameter: 0.092, segments: 10}, scene);
    b.material = matEyeB; b.parent = w;
    b.position.set(0, 0, -0.42);
    const gl = BABYLON.MeshBuilder.CreateSphere('eyeGl', {diameter: 0.032, segments: 6}, scene);
    gl.material = matEyeW; gl.parent = w;
    gl.position.set(-0.09, 0.13, -0.5);
    // brow gives the penguin its attitude
    const brow = BABYLON.MeshBuilder.CreateBox('brow', {width: 0.19, height: 0.035, depth: 0.05}, scene);
    brow.material = matBody; brow.parent = head;
    brow.position.set(s * 0.145, 0.22, -0.20);
    brow.rotation.z = s * 0.28;
  });

  // golden crest, so the head is not just a black ball
  for(let i=0;i<4;i++){
    const tuft = BABYLON.MeshBuilder.CreateCylinder('tuft', {
      diameterTop: 0, diameterBottom: 0.075, height: 0.17 + (i === 1 || i === 2 ? 0.06 : 0), tessellation: 6,
    }, scene);
    tuft.material = matCrest; tuft.parent = head;
    tuft.position.set((i - 1.5) * 0.075, 0.28, 0.03 + Math.abs(i - 1.5) * 0.035);
    tuft.rotation.z = (i - 1.5) * 0.36;
    tuft.rotation.x = -0.32 - Math.abs(i - 1.5) * 0.10;
  }

  // ---- flippers (pivot at the shoulder so they can swing)
  function flipper(side){
    const pivot = new BABYLON.TransformNode('shoulder', scene);
    pivot.parent = hips;
    pivot.position.set(side * 0.285, 0.56, -0.02);
    const arm = BABYLON.MeshBuilder.CreateCapsule('arm', {
      height: 0.42, radius: 0.078, tessellation: 12, subdivisions: 1,
    }, scene);
    arm.material = matBody;
    arm.parent = pivot;
    arm.position.y = -0.22;
    arm.scaling.set(1.0, 1.0, 0.45);
    return pivot;
  }
  const shoulderBack = flipper(1);
  const shoulderFront = flipper(-1);
  shoulderBack.rotation.z = -0.45;
  shoulderBack.rotation.x = 0.55;
  shoulderFront.rotation.z = 0.45;
  shoulderFront.rotation.x = -0.75;

  // ---- feet on the deck, staggered like a real stance
  function foot(x, z, rotY){
    const f = BABYLON.MeshBuilder.CreateSphere('foot', {diameter: 0.24, segments: 12}, scene);
    f.material = matFeet;
    f.parent = g;
    f.position.set(x, 0.24, z);
    f.scaling.set(0.72, 0.34, 1.55);
    f.rotation.y = rotY;
    return f;
  }
  const footBack = foot(0.10, 0.14, 0.30);
  const footFront = foot(-0.09, -0.17, 0.20);

  const tail = BABYLON.MeshBuilder.CreateCylinder('tail', {
    diameterTop: 0, diameterBottom: 0.20, height: 0.26, tessellation: 8,
  }, scene);
  tail.material = matBody; tail.parent = hips;
  tail.position.set(0, 0.13, 0.26);
  tail.rotation.x = 1.25;

  return {
    root: g, hips: hips, headPivot: headPivot, head: head, body: body,
    shoulderBack: shoulderBack, shoulderFront: shoulderFront,
    footBack: footBack, footFront: footFront,
  };
}

function createBoard(){
  const g = new BABYLON.TransformNode('boardRoot', scene);
  g.parent = visualRoot;

  const BL = 1.95;
  const path = [];
  const STEPS = 18;
  for(let i=0;i<=STEPS;i++){
    const t = i / STEPS;
    const z = BL/2 - BL*t;                    // t=1 (nose) points forward (-Z)
    const rocker = 0.085 * Math.pow(Math.abs(t*2 - 1), 2.0);
    path.push(new BABYLON.Vector3(0, rocker, z));
  }
  function widthAt(t){
    const tail = 0.40, mid = 1.0, nose = 0.055;
    if(t < 0.42) return tail + (mid - tail) * Math.sin((t/0.42) * Math.PI * 0.5);
    return mid + (nose - mid) * Math.pow((t - 0.42) / 0.58, 1.85);
  }
  const shape = [];
  const CS = 14;
  for(let i=0;i<CS;i++){
    const a = (i / CS) * TAU;
    shape.push(new BABYLON.Vector3(Math.cos(a) * 0.27, Math.sin(a) * 0.030, 0));
  }
  const board = BABYLON.MeshBuilder.ExtrudeShapeCustom('board', {
    shape: shape,
    path: path,
    scaleFunction: function(i){ return Math.max(0.05, widthAt(i / STEPS)); },
    rotationFunction: function(){ return 0; },
    closeShape: true,
    closePath: false,
    cap: BABYLON.Mesh.CAP_ALL,
    sideOrientation: BABYLON.Mesh.DOUBLESIDE,
  }, scene);
  board.material = boardMat;
  board.parent = g;
  board.position.y = 0.055;

  // thruster fins
  [[-0.16, 0.72, 0.20], [0.16, 0.72, 0.20], [0, 0.80, 0.055]].forEach(function(f, i){
    const fin = BABYLON.MeshBuilder.CreateCylinder('fin', {
      diameterTop: 0, diameterBottom: f[2] * 2, height: 0.17, tessellation: 3,
    }, scene);
    fin.material = finMat;
    fin.parent = g;
    fin.position.set(f[0], -0.045, f[1]);
    fin.rotation.y = Math.PI / 2;
    fin.rotation.z = Math.PI;
    fin.isPickable = false;
  });

  return { root: g, board: board };
}

const surfer = createSurfer();
const boardRig = createBoard();

// cartoon outlines -- the Surf's Up / cel-shaded signature
[surfer.root, boardRig.root].forEach(function(root){
  root.getChildMeshes().forEach(function(m){
    m.renderOutline = true;
    m.outlineColor = new BABYLON.Color3(0.055, 0.085, 0.12);
    m.outlineWidth = 0.014;
    m.isPickable = false;
  });
});
surfer.root.getChildMeshes().forEach(function(m){ shadows.addShadowCaster(m); });
boardRig.root.getChildMeshes().forEach(function(m){ shadows.addShadowCaster(m); });

// =====================================================================
//  SPRAY / WAKE
// =====================================================================
// Droplet sprite reads as water, not smoke (generate-environment-textures.py).
const sprayTex = new BABYLON.Texture('./assets/images/environment/particles/splash-droplet.png', scene);
sprayTex.hasAlpha = true;
const spray = new BABYLON.ParticleSystem('spray', 900, scene);
spray.particleTexture = sprayTex;
const sprayEmitter = new BABYLON.TransformNode('sprayEmitter', scene);
sprayEmitter.parent = visualRoot;
sprayEmitter.position.set(0, 0.25, 0.85);
spray.emitter = sprayEmitter;
spray.minEmitBox = new BABYLON.Vector3(-0.62, -0.08, -0.45);
spray.maxEmitBox = new BABYLON.Vector3(0.62, 0.30, 0.45);
spray.color1 = new BABYLON.Color4(1.0, 1.0, 1.0, 0.9);
spray.color2 = new BABYLON.Color4(0.78, 0.95, 1.0, 0.85);
spray.colorDead = new BABYLON.Color4(0.95, 1.0, 1.0, 0.0);
spray.minSize = 0.08; spray.maxSize = 0.34;
spray.minLifeTime = 0.20; spray.maxLifeTime = 0.60;
spray.emitRate = 0;
spray.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
spray.gravity = new BABYLON.Vector3(0, -6.5, 0);
spray.direction1 = new BABYLON.Vector3(-1.8, 0.8, 1.2);
spray.direction2 = new BABYLON.Vector3(1.8, 2.2, 3.6);
spray.minAngularSpeed = 0; spray.maxAngularSpeed = 4;
spray.minEmitPower = 1.0; spray.maxEmitPower = 3.2;
spray.updateSpeed = 0.012;
spray.start();

// flat foam patches left on the surface behind the board
const wakeGeo = BABYLON.MeshBuilder.CreateDisc('wake', {radius: 0.5, tessellation: 12}, scene);
wakeGeo.rotation.x = Math.PI / 2;
wakeGeo.bakeCurrentTransformIntoVertices();
wakeGeo.isPickable = false;
wakeGeo.setEnabled(false);
const wakeParts = [];
// V-shaped foam wake: lacy foam patches spread outward and fade with speed.
const wakeFoamTex = new BABYLON.Texture('./assets/images/environment/particles/wake-foam.webp', scene);
wakeFoamTex.hasAlpha = true;
wakeFoamTex.level = 1.7;
const wakeMat = new BABYLON.StandardMaterial('wakeMat', scene);
wakeMat.diffuseColor = BABYLON.Color3.Black();
wakeMat.specularColor = BABYLON.Color3.Black();
wakeMat.emissiveColor = new BABYLON.Color3(1.2, 1.25, 1.25);
wakeMat.opacityTexture = wakeFoamTex;
wakeMat.disableLighting = true;
wakeMat.backFaceCulling = false;
wakeMat.disableDepthWrite = true;
for(let i=0;i<44;i++){
  const m = wakeGeo.clone('wakePart' + i);
  m.material = wakeMat;
  m.parent = null;
  m.position.y = 0.02;
  m.rotation.y = i * 1.7;
  m.setEnabled(false);
  wakeParts.push({ mesh: m, mat: wakeMat, life: 0, maxLife: 1, vx: 0, grow: 1 });
}
let wakeSpawnT = 0;

// Bow foam: two lacy sheets hugging the board in a V. They ride with the
// player, scroll with speed and swell while boosting (visual only).
const bowFoamTex = new BABYLON.Texture('./assets/images/environment/particles/bow-foam.webp', scene);
bowFoamTex.hasAlpha = true;
bowFoamTex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
bowFoamTex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
bowFoamTex.vScale = 1.4;
bowFoamTex.level = 3.4;
const bowFoamMat = new BABYLON.StandardMaterial('bowFoamMat', scene);
bowFoamMat.diffuseColor = BABYLON.Color3.Black();
bowFoamMat.specularColor = BABYLON.Color3.Black();
bowFoamMat.emissiveColor = new BABYLON.Color3(1.25, 1.3, 1.3);
bowFoamMat.opacityTexture = bowFoamTex;
bowFoamMat.disableLighting = true;
bowFoamMat.backFaceCulling = false;
bowFoamMat.disableDepthWrite = true;
const bowFoam = [-1, 1].map(function(side){
  const m = BABYLON.MeshBuilder.CreateGround('bowFoam', {width: 2.3, height: 3.8, subdivisionsX: 1, subdivisionsY: 8}, scene);
  // Fade in at the nose, full beside the board, fade out toward the tail.
  const pos = m.getVerticesData(BABYLON.VertexBuffer.PositionKind), col = [];
  for(let v=0; v<pos.length; v+=3){
    const t = (pos[v+2] + 1.9) / 3.8;              // 0 = nose (forward), 1 = tail
    const a = Math.min(1, t / 0.18) * (1 - Math.max(0, (t - 0.62) / 0.38));
    col.push(1, 1, 1, Math.max(0, a));
  }
  m.setVerticesData(BABYLON.VertexBuffer.ColorKind, col);
  m.hasVertexAlpha = true;
  m.material = bowFoamMat;
  m.parent = playerRoot;
  m.rotation.y = side * 0.26;
  m.scaling.x = side;               // mirror so the dense edge touches the board
  m.position.set(side * 1.02, 0.05, -0.15);
  m.isPickable = false;
  m.visibility = 0;
  return m;
});


// speed streaks while boosting
const streakRoot = new BABYLON.TransformNode('streaks', scene);
streakRoot.parent = camera;
const streakMat = unlit('streakMat', '#dffaff', 0.30);
streakMat.alphaMode = BABYLON.Engine.ALPHA_ADD;
const streaks = [];
for(let i=0;i<26;i++){
  const s = BABYLON.MeshBuilder.CreatePlane('streak', {width: 0.02, height: 1.0}, scene);
  s.material = streakMat;
  s.parent = streakRoot;
  s.isPickable = false;
  s.position.set((Math.random()-0.5) * 9, (Math.random()-0.5) * 5, 2 + Math.random()*10);
  s.rotation.z = Math.random() * TAU;
  s.setEnabled(false);
  streaks.push(s);
}

// =====================================================================
//  OBSTACLES, PEARLS
// =====================================================================
const buoyMatA = pbr('buoyA', '#e6392a', 0.38, 0.04);
const buoyMatB = pbr('buoyB', '#ffffff', 0.45, 0.08);
const buoyBaseMat = pbr('buoyBase', '#f8fafc', 0.38, 0.05);
const flagMat = pbr('flagMat', '#ffd15c', 0.55, 0.0);
flagMat.backFaceCulling = false;
const flagMatAlt = pbr('flagMatAlt', '#ff6b4a', 0.55, 0.0);
flagMatAlt.backFaceCulling = false;
const rampMat = pbr('rampMat', '#ffbe3b', 0.40, 0.05);
rampMat.emissiveColor = BABYLON.Color3.FromHexString('#f59e0b');
rampMat.emissiveIntensity = 0.18;
const rampStripeMat = pbr('rampStripeMat', '#ffffff', 0.50, 0.05);

const obsRampTex = new BABYLON.DynamicTexture('obsRampTex', {width: 256, height: 256}, scene, false);
const octx = obsRampTex.getContext();
octx.fillStyle = '#ffbe3b';
octx.fillRect(0, 0, 256, 256);
for (let i = 0; i < 3; i++) {
  const cy = 48 + i * 78;
  octx.fillStyle = '#ffffff';
  octx.beginPath();
  octx.moveTo(128, cy - 26);
  octx.lineTo(208, cy + 22);
  octx.lineTo(184, cy + 36);
  octx.lineTo(128, cy + 3);
  octx.lineTo(72, cy + 36);
  octx.lineTo(48, cy + 22);
  octx.closePath();
  octx.fill();
}
obsRampTex.update();
const obsRampChevronMat = new BABYLON.StandardMaterial('obsRampChevronMat', scene);
obsRampChevronMat.diffuseTexture = obsRampTex;
obsRampChevronMat.emissiveTexture = obsRampTex;
obsRampChevronMat.emissiveColor = BABYLON.Color3.White();
obsRampChevronMat.disableLighting = true;
obsRampChevronMat.backFaceCulling = false;
const pearlMat = pbr('pearlMat', '#eafaf6', 0.12, 0.15);
pearlMat.emissiveColor = BABYLON.Color3.FromHexString('#3fb6c0');
pearlMat.emissiveIntensity = 0.6;
const ringMat = pbr('ringMat', '#ffd15c', 0.25, 0.25);
ringMat.emissiveColor = BABYLON.Color3.FromHexString('#c98a12');
ringMat.emissiveIntensity = 0.5;

function makeBuoy(){
  const g = new BABYLON.TransformNode('buoy', scene);
  // White floating collar base at water line (Image B)
  const collar = BABYLON.MeshBuilder.CreateCylinder('buoyCollar', {
    diameter: 0.94, height: 0.14, tessellation: 16
  }, scene);
  collar.material = buoyBaseMat;
  collar.parent = g;
  collar.position.y = 0.07;
  shadows.addShadowCaster(collar);

  // Red lower conical section
  const lower = BABYLON.MeshBuilder.CreateCylinder('buoyLower', {
    diameterBottom: 0.80, diameterTop: 0.58, height: 0.42, tessellation: 16
  }, scene);
  lower.material = buoyMatA;
  lower.parent = g;
  lower.position.y = 0.35;
  shadows.addShadowCaster(lower);

  // White middle reflective band
  const mid = BABYLON.MeshBuilder.CreateCylinder('buoyMid', {
    diameterBottom: 0.58, diameterTop: 0.44, height: 0.32, tessellation: 16
  }, scene);
  mid.material = buoyMatB;
  mid.parent = g;
  mid.position.y = 0.72;
  shadows.addShadowCaster(mid);

  // Red upper conical tip
  const upper = BABYLON.MeshBuilder.CreateCylinder('buoyUpper', {
    diameterBottom: 0.44, diameterTop: 0.18, height: 0.38, tessellation: 16
  }, scene);
  upper.material = buoyMatA;
  upper.parent = g;
  upper.position.y = 1.07;
  shadows.addShadowCaster(upper);

  // Rounded top cap
  const knob = BABYLON.MeshBuilder.CreateSphere('buoyKnob', {
    diameter: 0.22, segments: 10
  }, scene);
  knob.material = buoyMatA;
  knob.parent = g;
  knob.position.y = 1.28;
  shadows.addShadowCaster(knob);

  return g;
}

function makeRockObstacle(seed){
  const g = new BABYLON.TransformNode('rockObs', scene);
  const rnd = mulberry32(seed);
  const n = 2 + Math.floor(rnd() * 3);
  for(let i=0;i<n;i++){
    const r = makeRockMesh('obsRock', 0.34 + rnd()*0.36, 1, seed * 13 + i);
    r.parent = g;
    r.position.set((rnd()-0.5)*0.55, 0.24 + rnd()*0.30, (rnd()-0.5)*0.55);
    r.rotation.set(rnd()*TAU, rnd()*TAU, rnd()*TAU);
    r.material = rnd() < 0.45 ? rockMatDark : rockMat;
    r.renderOutline = true; r.outlineColor = new BABYLON.Color3(0.06,0.09,0.12); r.outlineWidth = 0.012;
    shadows.addShadowCaster(r);
  }
  return g;
}

function makeFlagGate(seed){
  const g = new BABYLON.TransformNode('flagGate', scene);
  const rnd = mulberry32(seed);
  const H = 1.55;
  [-0.92, 0.92].forEach(function(x){
    const pole = BABYLON.MeshBuilder.CreateCylinder('pole', {
      diameter: 0.10, height: H, tessellation: 10,
    }, scene);
    pole.material = bambooMat;
    pole.parent = g;
    pole.position.set(x, H/2, 0);
    shadows.addShadowCaster(pole);
  });
  const banner = BABYLON.MeshBuilder.CreatePlane('banner', {width: 1.9, height: 0.42, sideOrientation: BABYLON.Mesh.DOUBLESIDE}, scene);
  banner.material = rnd() < 0.5 ? flagMat : flagMatAlt;
  banner.parent = g;
  banner.position.set(0, 1.14, 0);
  banner.rotation.x = 0.06;
  const rope = BABYLON.MeshBuilder.CreateCylinder('rope', {diameter: 0.035, height: 1.9, tessellation: 6}, scene);
  rope.material = bambooMat;
  rope.parent = g;
  rope.position.set(0, 1.38, 0);
  rope.rotation.z = Math.PI/2;
  return g;
}

function makeRampObstacle(){
  const g = new BABYLON.TransformNode('ramp', scene);
  // Trapezoid side profile (base, sloped front, flat top, sloped back).
  // ExtrudeShape instead of ExtrudePolygon: the latter needs the `earcut`
  // library, which is not part of the Babylon UMD bundle.
  const profile = [
    new BABYLON.Vector3(0.00, 0.00, 0),
    new BABYLON.Vector3(0.72, 0.90, 0),
    new BABYLON.Vector3(1.34, 0.90, 0),
    new BABYLON.Vector3(1.98, 0.00, 0),
  ];
  const rampLen = 1.98, rampWidth = 1.7;
  const path = [
    new BABYLON.Vector3(0, 0, 0),
    new BABYLON.Vector3(0, 0, rampWidth * 0.5),
    new BABYLON.Vector3(0, 0, rampWidth),
  ];
  const mesh = BABYLON.MeshBuilder.ExtrudeShape('rampMesh', {
    shape: profile,
    path: path,
    closeShape: true,
    closePath: false,
    cap: BABYLON.Mesh.CAP_ALL,
    sideOrientation: BABYLON.Mesh.DOUBLESIDE,
  }, scene);
  mesh.material = rampMat;
  mesh.parent = g;
  mesh.rotation.y = Math.PI / 2;              // profile length -> Z, extrude -> X
  mesh.position.set(-rampWidth / 2, 0, rampLen / 2);
  mesh.renderOutline = true; mesh.outlineColor = new BABYLON.Color3(0.06,0.09,0.12); mesh.outlineWidth = 0.012;
  shadows.addShadowCaster(mesh);

  // Sloped launch face with glowing forward chevrons >>> (Image B)
  const chevrons = BABYLON.MeshBuilder.CreatePlane('rampChevrons', {width: 1.54, height: 1.14}, scene);
  chevrons.material = obsRampChevronMat;
  chevrons.parent = g;
  chevrons.rotation.x = Math.atan2(0.90, 0.72);
  chevrons.position.set(0, 0.46, 0.63);

  const stripe = BABYLON.MeshBuilder.CreateBox('rampStripe', {width: 1.54, height: 0.05, depth: 0.42}, scene);
  stripe.material = rampStripeMat;
  stripe.parent = g;
  stripe.position.set(0, 0.92, 0.06);
  return g;
}

function makeRing(){
  const g = new BABYLON.TransformNode('ring', scene);
  const t = BABYLON.MeshBuilder.CreateTorus('torus', {diameter: 2.5, thickness: 0.16, tessellation: 24}, scene);
  t.material = ringMat;
  t.parent = g;
  t.position.y = 1.15;
  t.renderOutline = true; t.outlineColor = new BABYLON.Color3(0.20,0.13,0.02); t.outlineWidth = 0.012;
  for(let i=0;i<6;i++){
    const d = BABYLON.MeshBuilder.CreateSphere('ringDot', {diameter: 0.13, segments: 6}, scene);
    d.material = pearlMat;
    d.parent = t;
    const a = (i/6) * TAU;
    d.position.set(Math.cos(a)*1.25, Math.sin(a)*1.25, 0);
  }
  return g;
}

const pearlProto = BABYLON.MeshBuilder.CreateSphere('pearl', {diameter: 0.36, segments: 14}, scene);
pearlProto.material = pearlMat;
pearlProto.renderOutline = true;
pearlProto.outlineColor = new BABYLON.Color3(0.10, 0.35, 0.38);
pearlProto.outlineWidth = 0.010;
pearlProto.setEnabled(false);

// =====================================================================
//  COURSE GEOMETRY
// =====================================================================
function curveOffsetAt(worldZ){ return 0; }
function curveSlopeAt(worldZ){
  return (curveOffsetAt(worldZ - 0.5) - curveOffsetAt(worldZ + 0.5)) / 1.0;
}

// =====================================================================
//  GAME STATE
// =====================================================================
let lateralOffset = 0;
let mouseNormX = 0, lastMouseMoveT = -10;
const keyState = { left: false, right: false };
// Algunos equipos repiten una tecla mantenida como pares keydown/keyup (sin e.repeat): entre
// cada par la tecla parecía soltada y el surfista avanzaba a trompicones o se paraba. Un keyup
// solo suelta de verdad la dirección KEY_HOLD_MS después del último keydown; si antes llega
// otro keydown de la misma tecla, sigue pulsada sin cortes. En un teclado normal, una
// pulsación mantenida se suelta al instante al levantar el dedo (su keydown es antiguo).
const KEY_HOLD_MS = 150;
const keyDownAt = { left: -1e9, right: -1e9 }, keyUpAt = { left: -1e9, right: -1e9 };
const steerHeld = side => keyState[side] || performance.now() < keyDownAt[side] + KEY_HOLD_MS;
function pressSteer(side, repeat){
  const other = side === 'left' ? 'right' : 'left', now = performance.now();
  if(!repeat){ if(!keyState[side] && now - keyUpAt[side] < KEY_HOLD_MS) inputStats.pairs = (inputStats.pairs||0) + 1; keyDownAt[side] = now; }
  keyState[side] = true; keyDownAt[other] = -1e9;   // la otra dirección se suelta ya, sin esperar
}
function releaseSteer(side){ keyState[side] = false; keyUpAt[side] = performance.now(); }
function clearSteer(){ keyState.left = keyState.right = false; keyDownAt.left = keyDownAt.right = -1e9; }
let isJumping = false, jumpVel = 0, airY = 0, airClock = 0, spinAngle = 0;
let isSliding = false, slideTimer = 0;
let running = false, distance = 0, pearlCount = 0, points = 0;
let baseSpeed = CFG.baseSpeed, speed = CFG.baseSpeed, animT = 0;
let nextSpawnZ = -20;
let lookBack=false;let boostHeld=false, throttleHeld=false, touchBoostUntil=0;
let isPaused = false;
let boostValue = 0, boostActive = false, boostTimer = 0;
let waveTime = 0, waveOriginZ = 0, waveOffsetY = 0;
let shake = 0, camRoll = 0, camFov = 1.02, cameraBack = 6.5;
let strafe = 0, landPulse = 0;
let elapsed = 0;

const obstacles = [];
const pearls = [];
const obstacleSeed = { n: 1 };

const overlay = document.getElementById('overlay');
const scoreEl = document.getElementById('score-val');
const coinsEl = document.getElementById('coins-val');
const boostFill = document.getElementById('boost-fill');
const boostWrap = document.getElementById('boost-wrap');
const boostVignette = document.getElementById('boost-vignette');
const trickEl = document.getElementById('trick');
const startBtn = document.getElementById('start-btn');
const bestStartEl = document.getElementById('best-start');
const BEST_KEY = 'surfsalvaje.best';

const pauseModal = document.getElementById('pause-modal');
const pauseResumeBtn = document.getElementById('pause-resume-btn');
const pauseQuitBtn = document.getElementById('pause-quit-btn');

function resumeGame() {
  if (!isPaused) return;
  isPaused = false;
  try { if (pauseModal?.open) pauseModal.close(); } catch {}
}

function pauseGame() {
  if (!running || isPaused) return;
  isPaused = true;
  try { pauseModal?.showModal(); } catch { pauseModal?.setAttribute('open', ''); }
}

function quitGame() {
  resumeGame();
  document.dispatchEvent(new CustomEvent('surf:menu'));
}

pauseResumeBtn?.addEventListener('click', resumeGame);
pauseQuitBtn?.addEventListener('click', quitGame);
pauseModal?.addEventListener('cancel', (e) => { e.preventDefault(); resumeGame(); });

let best = 0;
try{ best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; }catch(e){ best = 0; }
if(best > 0){ bestStartEl.style.display = 'block'; bestStartEl.textContent = 'Mejor marca: ' + best + ' m'; }

function showTrick(text){
  trickEl.textContent = text;
  trickEl.classList.remove('show');
  void trickEl.offsetWidth;
  trickEl.classList.add('show');
}

function disposeNode(node){
  if(!node) return;
  node.getChildMeshes().forEach(function(m){
    try{ shadows.removeShadowCaster(m); }catch(e){}
    m.dispose();
  });
  node.dispose();
}

function resetGame(){
  obstacles.forEach(function(o){ disposeNode(o.node); });
  obstacles.length = 0;
  pearls.forEach(function(p){ p.mesh.dispose(); });
  pearls.length = 0;
  wakeParts.forEach(function(w){ w.mesh.setEnabled(false); w.life = 0; });
  baseSpeed = CFG.baseSpeed; speed = CFG.baseSpeed;
  distance = 0; pearlCount = 0; points = 0;
  lateralOffset = 0;
  isJumping = false; jumpVel = 0; airY = 0; airClock = 0; spinAngle = 0;
  isSliding = false; slideTimer = 0;
  boostValue = 0; boostActive = false; boostHeld=false; throttleHeld=false; lookBack=false; document.body.classList.remove('looking-back'); touchBoostUntil=0; net.boostHeld=false; if(net) net.throttleHeld=false; isPaused=false;
  playerRoot.position.set(0, 0, 0);
  playerRoot.rotation.set(0, 0, 0);
  visualRoot.rotation.y = 0;
  visualRoot.scaling.y = 1;
  nextSpawnZ = -20;
  shake = 0; camRoll = 0; cameraBack = 6.5;
  strafe = 0; landPulse = 0;
  spray.emitRate = 0;
  scoreEl.textContent = '0';
  coinsEl.textContent = '0';
  boostFill.style.width = '0%';
  boostWrap.classList.remove('full');
  boostVignette.classList.remove('on');
  streaks.forEach(function(s){ s.setEnabled(false); });
  ocean.position.z = 0;
  beachL.position.z = 0;
  beachR.position.z = 0;
  skylineRoot.position.set(0, 0, 0);
  camera.position.set(0, 4.6, 8.5);
}

function startGame(){
  resetGame();
  const mapId = online ? net.player.mapId : (PARAMS.has('map') ? parseInt(PARAMS.get('map')) : 0);
  buildMap(mapId);raceUI.start(mapId);lastJump=0;lastRamp=0;lapsDone=0;trickStart=-10;
  localPowerWorld=createPowerWorld();powerView.reset();localPlayer={...createPlayer(0),mapId,countdown:90};Object.assign(localPrev,{x:localPlayer.x,y:localPlayer.y,z:localPlayer.z});localAccumulator=0;localButtons=0;
  // Modo solitario: 1 humano + 7 bots, creados solo al empezar la carrera (en línea los simula el servidor).
  clearPracticeBots();
  if(!online){
    const seed=(Math.random()*2**31)|0;
    practiceBots=botLooks(7,seed,[{character:profile.character,board:profile.board,wing:profile.wing}],[profile.nick]).map((look,i)=>{
      const player={...createBotPlayer(i+1,look,i,mapId),countdown:90};
      return {player,brain:createBrain(look,seed+i*7919,mapId),prev:{x:player.x,y:player.y,z:player.z}};
    });
    drawRivals(practiceBotStates(1),0);   // avatares (con su tabla y wings) listos durante la cuenta atrás
  }
  applyAppearance();
  document.activeElement?.blur?.();
  canvas.focus?.();
  overlay.classList.add('hidden');
  running = true;
  startMatchAudio();
}

function endGame(){
  running = false;
  stopMatchAudio();
  spray.emitRate = 0;
  streaks.forEach(function(s){ s.setEnabled(false); });
  boostVignette.classList.remove('on');
  const m = Math.floor(distance);
  if(m > best){
    best = m;
    try{ localStorage.setItem(BEST_KEY, String(best)); }catch(e){}
  }
  networkStatus.textContent = 'Fin de partida - ' + m + ' m';
  const result=online?net.authoritative:localPlayer;
  raceUI.finish(result,online||practiceBots.length>0,online?(net.players||[]):practiceField());
}
let online = false;
const networkStatus = document.getElementById('network-status');
const net = new SurfNetwork(text => { networkStatus.textContent = text; if(online && !net.player) { running=false; overlay.classList.remove('hidden'); startBtn.disabled=false; } });
const rivals = new Map();
let avatar=null,avatarAppearance='';const raceUI=createRaceUI();let lastRamp=0,lapsDone=0;let lastJump=0,trickStart=-10,trickType=0;
let localPowerWorld=createPowerWorld();const powerView=createPowerView(BABYLON,scene,()=>{if(!running)return;if(online)net.buttons|=4;else localButtons|=4;});
let localPlayer=createPlayer(0),localAccumulator=0,localButtons=0;const localPrev={x:0,y:0,z:0};
let practiceBots=[],practiceFinish=0;
function clearPracticeBots(){practiceBots=[];practiceFinish=0;for(const [id,mesh] of rivals){mesh.disposeAvatar();rivals.delete(id);}}
// Estado visual de los bots del solitario, interpolado entre ticks de simulación (30 Hz).
function practiceBotStates(alpha){return practiceBots.map(({player:p,prev})=>({...p,x:prev.x+(p.x-prev.x)*alpha,y:prev.y+(p.y-prev.y)*alpha,z:prev.z+(p.z-prev.z)*alpha}));}
function practiceField(){return [{...localPlayer,character:profile.character,board:profile.board,wing:profile.wing,hat:profile.hat|0,nick:profile.nick||'Tú'},...practiceBots.map(b=>b.player)];}
window.__surfDebug = { getPlayer: () => localPlayer, getWorld: () => localPowerWorld, getBots: () => practiceBots, getNet: () => net };
let worldArt=null,activeMapId=-1;
let courseView,trackView,mapObjects=[],mapMaterials=[];
function buildMap(id){
 // Circuitos bloqueados temporalmente: nunca se construye su escenario jugable.
 if(!isMapEnabled(id)){console.warn('[surf] circuito '+id+' no disponible; se usa Bahia Coral');id=0;}
 if(activeMapId===id&&worldArt&&courseView&&trackView)return;
 for(const obj of mapObjects)if(!obj.isDisposed())obj.dispose();for(const mat of mapMaterials)mat.dispose(false,true);
 setTrackMap(id);
 const before=new Set([...scene.meshes,...scene.transformNodes]),materials=new Set(scene.materials);
 courseView=createCourseView(BABYLON,scene);
 trackView=createTrackView(BABYLON,scene,{sand:sandMat,water:oceanMat,beach:beachL,grass,ocean});
 addBeachSpectators(BABYLON,scene);addBeachHuts(BABYLON,scene);
 worldArt=applyMapTheme(BABYLON,scene,id,{sand:sandMat,water:oceanMat,decor:decorItems});
 mapObjects=[...scene.meshes,...scene.transformNodes].filter(x=>!before.has(x));mapMaterials=scene.materials.filter(x=>!materials.has(x));
 activeMapId=id;
}
buildMap(PARAMS.has('map') ? parseInt(PARAMS.get('map')) : 0);
function applyAppearance() {
  const appearance=`${profile.character}|${profile.board}|${profile.wing}|${profile.hat|0}`;
  if(avatar&&avatarAppearance===appearance)return;
  avatar?.disposeAvatar();
  visualRoot.getChildMeshes().forEach(mesh=>mesh.setEnabled(false));
  avatar=createStickAvatar(BABYLON,scene,playerRoot,profile.character,profile.board,profile.wing,profile.hat|0);
  avatarAppearance=appearance;
}
document.addEventListener('surf:appearance',()=>{applyAppearance();net.sendProfile(profile);});
applyAppearance();
document.addEventListener('surf:menu',()=>{
  resumeGame();
  online=false;running=false;stopMatchAudio();net.close();raceUI.hide();powerView.hide();clearSteer();boostHeld=false;throttleHeld=false;
  for(const rival of rivals.values()) rival.setEnabled(false);
  clearPracticeBots();
  overlay.classList.remove('hidden');startBtn.disabled=false;
  networkStatus.textContent='Elige tu estilo y vuelve al agua';
});
document.getElementById('practice-btn').addEventListener('click', () => { online=false; net.close(); networkStatus.textContent='PRACTICA - SIN CONEXION'; startGame(); });
const roomUI=createRoomUI(net,profile,()=>{online=true;startGame();});
startBtn.innerHTML='JUGAR <span aria-hidden="true">➜</span>';
startBtn.addEventListener('click',()=>{online=false;running=false;roomUI.open('create');});
document.addEventListener('surf:rooms',()=>{online=false;running=false;roomUI.open('browse');});
function updateOnline(dt) {
  if(!online || !net.player) { for(const mesh of rivals.values()) mesh.setEnabled(false); return; }
  net.boostHeld=boostHeld || elapsed<touchBoostUntil;
  net.throttleHeld=throttleHeld;
  net.axis = steerAxis(net.player.x,CFG.lateralLimit);
  syncMovement(net.view(dt),dt,net.axis);
  drawRivals(net.timeline.sample(performance.now()),dt);
}
// Dibuja a los demás participantes (humanos remotos o bots) con SU equipamiento.
function drawRivals(samples,dt) {
  const live=new Set();
  for(const r of samples) {
    live.add(r.id); let mesh=rivals.get(r.id);
    // Cada rival se dibuja con SU equipamiento (skin, tabla, wings) recibido del servidor;
    // si lo cambia, se reconstruye solo ese avatar.
    const look=r.character+'|'+r.board+'|'+(r.wing||0)+'|'+(r.hat||0);
    if(mesh&&mesh.appearance!==look){mesh.disposeAvatar();rivals.delete(r.id);mesh=null;}
    if(!mesh) { mesh=createStickAvatar(BABYLON,scene,null,r.character,r.board,r.wing||0,r.hat||0);mesh.name=r.nick;mesh.appearance=look;rivals.set(r.id,mesh); }
    mesh.setEnabled(true);
    if(r.jumps>(mesh.lastJump||0)||r.ramps>(mesh.lastRamp||0)){mesh.trickAt=elapsed;mesh.trickKind=r.trick;}
    mesh.lastJump=r.jumps;mesh.lastRamp=r.ramps;
    // remoteSteer compara desplazamiento lateral con desplazamiento lateral (antes usaba la X del
    // mundo, que incluye la curva del circuito, y en las curvas el rival se inclinaba a tope).
    const prevX=mesh.lastX??r.x, z=r.z;mesh.lastX=r.x;
    const remoteAir=r.y;
    oceanSample(curveOffsetAt(z)+r.x,z-waveOriginZ,waveTime,_samp);
    mesh.position.set(curveOffsetAt(z)+r.x, _samp.y*.88+.04+remoteAir,z);
    mesh.remoteAir=remoteAir;mesh.remoteSteer=Math.max(-1,Math.min(1,(r.x-prevX)/Math.max(dt,.001)*.15));
  }
  for(const [id,mesh] of rivals) if(!live.has(id)) { mesh.disposeAvatar(); rivals.delete(id); }
}
// Teclado primero: con izquierda/derecha pulsada manda el teclado. Antes cualquier mousemove
// (también los que el navegador genera solo, sin mover el ratón) daba 0,22 s de control al
// ratón, que tiraba del surfista hacia la X del puntero (casi siempre el centro): se movía un
// poco y se frenaba, y había que pulsar varias veces.
function steerAxis(x,limit) {
  const left=steerHeld('left'),right=steerHeld('right'),keys=(left?1:0)-(right?1:0);
  if(left||right||(elapsed-lastMouseMoveT)>=.22)return keys;
  return Math.max(-1,Math.min(1,(-mouseNormX*limit-x)*2));
}
function inputAxis(p) { return steerAxis(p.x,SURF_LIMIT); }
// Diagnóstico de controles: abre el juego con ?debug para ver en pantalla qué recibe el
// navegador (teclas, de dónde sale el giro, posición y límite). Sirve para comparar lo que
// pasa en el equipo del jugador con lo que debería pasar.
const CLIENT_BUILD='controles-6';
const inputDebug=PARAMS.has('debug')?Object.assign(document.createElement('pre'),{id:'input-debug'}):null;
const inputStats={down:0,repeat:0,up:0,blur:0,last:''};
if(inputDebug){inputDebug.style.cssText='position:fixed;right:8px;top:200px;z-index:99;margin:0;padding:6px 8px;background:rgba(0,0,0,.72);color:#9ff;font:12px/1.35 monospace;pointer-events:none;white-space:pre';document.body.appendChild(inputDebug);}
console.info('[surf] cliente',CLIENT_BUILD);
function showInputDebug(p,axis,limit){
  if(!inputDebug||elapsed-(inputDebug.at||0)<.1)return;inputDebug.at=elapsed;
  const mouse=!(steerHeld('left')||steerHeld('right'))&&(elapsed-lastMouseMoveT)<.22;
  inputDebug.textContent=`versión ${CLIENT_BUILD} · ${online?'en línea':'práctica'}\n`+
    `teclas  izq ${steerHeld('left')?'SÍ':'no'}  der ${steerHeld('right')?'SÍ':'no'}  pares ${inputStats.pairs||0}\n`+
    `giro    ${axis.toFixed(2)} (${mouse?'RATÓN':'teclado'})\n`+
    `x       ${p.x.toFixed(2)} / límite ±${limit.toFixed(1)}\n`+
    `eventos down ${inputStats.down} rep ${inputStats.repeat} up ${inputStats.up} blur ${inputStats.blur} focus ${inputStats.focus||0} · foco ${document.hasFocus()?'SÍ':'NO'}\n`+
    `último  ${inputStats.last}`;
}
function syncMovement(p,dt,axis) {
  raceUI.update(p);raceUI.ranking(online?(net.players||[]):practiceField(),online?net.id:p.id);
  if(p.ramps>lastRamp){playSound('ramp');lastRamp=p.ramps;trickStart=elapsed;trickType=p.trick;showTrick('RAMPA - '+TRICKS[trickType]);}
  if(p.jumps>lastJump){playSound('jump');lastJump=p.jumps;trickStart=elapsed;trickType=p.trick;showTrick(TRICKS[trickType]);}
  // Vuelta completada: solo cuando el estado confirmado (servidor en línea, simulación local
  // en práctica) supera la distancia de la vuelta. Cada cliente mira únicamente a su jugador.
  const lapState=online?net.authoritative:p;
  if(running&&lapState&&!lapState.countdown){const race=raceProgress(lapState.z),done=race.finished?TOTAL_LAPS:race.lap-1;if(done>lapsDone){lapsDone=done;raceUI.lapComplete(done,TOTAL_LAPS);}}
  const wasAir=airY,previousBoost=boostActive;
  if(p.impulse < 0) avatar?.triggerImpact?.();
  strafe+=(axis-strafe)*Math.min(1,dt*8);
  if(wasAir>.05 && p.y===0) {landPulse=1;spray.manualEmitCount=45;}
  // p ya llega interpolado entre ticks: el suavizado puede ser más rápido (menos retraso visual).
  playerRoot.position.x+=(p.x-playerRoot.position.x)*(1-Math.exp(-30*dt));
  playerRoot.position.z+=(p.z-playerRoot.position.z)*(1-Math.exp(-30*dt));
  lateralOffset=p.x;distance=-p.z;airY=Math.max(p.y,rampHeight(p.x,p.z));isJumping=p.y>0;airClock=isJumping?airClock+dt:0;
  boostValue=p.energy;boostActive=p.turboTicks>0 || (p.slipActive>0&&p.slipTicks>0) || p.impulse>0 || ((boostHeld || elapsed<touchBoostUntil)&&p.energy>.03&&p.impulse>=0);speed=playerSpeed(p,boostActive,throttleHeld);animT+=dt*speed;
  if(boostActive&&!previousBoost&&p.impulse<=0)showTrick('TURBO');
  boostVignette.classList.toggle('on',boostActive&&settings.effects);streaks.forEach(s=>s.setEnabled(boostActive&&settings.effects&&settings.quality!=='low'));
  scoreEl.textContent=Math.floor(distance);coinsEl.textContent=Math.round(speed*3.6);boostFill.style.width=(boostValue*100)+'%';
  showInputDebug(p,axis,SURF_LIMIT-(p.mapId||0)*.4);
}
function updatePractice(dt) {
  const axis=inputAxis(localPlayer);localAccumulator=Math.min(.15,localAccumulator+dt);
  while(localAccumulator>=DT) {
    const everyone=[localPlayer,...practiceBots.map(b=>b.player)],uses=localButtons&4?[localPlayer.id]:[];
    localPrev.x=localPlayer.x;localPrev.y=localPlayer.y;localPrev.z=localPlayer.z;
    advance(localPlayer,axis,localButtons | ((boostHeld || elapsed<touchBoostUntil)?2:0) | (throttleHeld?8:0));
    if(-localPlayer.z>=LAP_LENGTH*TOTAL_LAPS&&!localPlayer.place&&practiceBots.length)localPlayer.place=++practiceFinish;
    // Bots: mismas reglas que el jugador (advance + stepPowerWorld); la IA solo elige las entradas.
    for(const bot of practiceBots){
      bot.prev.x=bot.player.x;bot.prev.y=bot.player.y;bot.prev.z=bot.player.z;
      const input=botInput(bot.brain,bot.player,localPowerWorld,everyone);
      advance(bot.player,input.axis,input.buttons);
      if(input.buttons&4)uses.push(bot.player.id);
      if(-bot.player.z>=LAP_LENGTH*TOTAL_LAPS&&!bot.player.place)bot.player.place=++practiceFinish;
    }
    stepPowerWorld(localPowerWorld,everyone,uses);localButtons=0;localAccumulator-=DT;
  }
  // Igual que los bots: el jugador se dibuja interpolado entre ticks (30 Hz) para no avanzar a saltos.
  const alpha=localAccumulator/DT;
  syncMovement({...localPlayer,x:localPrev.x+(localPlayer.x-localPrev.x)*alpha,y:localPrev.y+(localPlayer.y-localPrev.y)*alpha,z:localPrev.z+(localPlayer.z-localPrev.z)*alpha},dt,axis);
  if(practiceBots.length)drawRivals(practiceBotStates(localAccumulator/DT),dt);
}
// Mirar atrás (clic derecho sostenido). Con eventos pointer y en captura: Babylon hace
// preventDefault en pointerdown del canvas y eso anula los mousedown/mouseup de compatibilidad,
// por eso con 'mousedown' nunca se activaba sobre el juego.
// Se mira el estado real de los botones (e.buttons) en cada evento: si se suelta el derecho con
// otro botón pulsado, el navegador no manda pointerup sino pointermove, y antes la cámara se
// quedaba mirando atrás (y girar a los lados parecía trabado).
const setLookBack=v=>{if(lookBack===v)return;lookBack=v;document.body.classList.toggle('looking-back',v);};
const syncLookBack=e=>{const held=running&&(e.buttons&2)!==0;if(held&&e.type==='pointerdown')e.preventDefault();setLookBack(held);};
for(const type of ['pointerdown','pointermove','pointerup'])window.addEventListener(type,syncLookBack,true);
window.addEventListener('pointercancel',()=>setLookBack(false),true);
window.addEventListener('contextmenu',e=>{if(running)e.preventDefault();});
// Si otra ventana se pone delante (p. ej. el aviso de Windows de "Teclas especiales" o
// "Teclas filtro", que salta al pulsar Mayús 5 veces o mantenerla 8 s, o un overlay), el
// navegador deja de mandar las teclas al juego y el surfista se para aunque A/D sigan pulsadas.
// Se avisa en pantalla para que el jugador sepa que debe volver a hacer clic en el juego.
// El navegador puede mandar 'blur' sin que el jugador cambie de ventana, o perder el foco
// solo un instante (un aviso que aparece y se va). Antes cada 'blur' soltaba A/D al momento
// y el surfista se paraba aunque la tecla siguiera pulsada. Ahora solo se sueltan las teclas si
// el foco sigue fuera 400 ms después; si vuelve antes, el control sigue como estaba.
let blurTimer=0;
function releaseAllInput(){clearSteer();spaceHeld=false;boostHeld=false;throttleHeld=false;setLookBack(false);net.boostHeld=false;if(net)net.throttleHeld=false;net.axis=0;}
window.addEventListener('focus',()=>{clearTimeout(blurTimer);inputStats.focus=(inputStats.focus||0)+1;document.body.classList.remove('game-unfocused');});
window.addEventListener('pointerdown',()=>document.body.classList.remove('game-unfocused'),true);
window.addEventListener('blur',()=>{
  inputStats.blur++;inputStats.last='blur tras '+(inputStats.key||'-');
  clearTimeout(blurTimer);
  blurTimer=setTimeout(()=>{
    if(document.hasFocus()){inputStats.last+=' (falso: el juego seguía con el foco)';return;}
    inputStats.last+=' (la ventana perdió el foco)';
    if(running)document.body.classList.add('game-unfocused');
    releaseAllInput();
  },400);
});

// El sonido del salto lo pone syncMovement cuando el salto ocurre de verdad (p.jumps sube):
// antes sonaba también aquí, dos veces por salto, y en el aire aunque no se saltara.
function doJump(){ if(!running||isPaused)return;if(online)net.buttons|=1;else localButtons|=1; }
let spaceHeld=false;
function tryBoost(){ if(!running||isPaused)return;touchBoostUntil=elapsed+1.4;if(online)net.buttons|=2;else localButtons|=2; }

// =====================================================================
//  INPUT
// =====================================================================
window.addEventListener('keydown', function(e){
  if(e.key === 'Escape'){
    if(running){
      if(isPaused) resumeGame();
      else pauseGame();
      e.preventDefault();
      return;
    }
  }
  inputStats.key=e.key===' '?'Espacio':e.key;
  if(inputDebug&&/^(a|d|arrowleft|arrowright)$/i.test(e.key)){if(e.repeat)inputStats.repeat++;else inputStats.down++;inputStats.last='keydown '+e.key+(running?'':' (sin carrera)')+(isPaused?' (pausa)':'');}
  if(!running || isPaused) return;
  switch(e.key){
    case 'ArrowLeft': case 'a': case 'A': pressSteer('left',e.repeat); anchorMouse(); e.preventDefault(); break;
    case 'ArrowRight': case 'd': case 'D': pressSteer('right',e.repeat); anchorMouse(); e.preventDefault(); break;
    case ' ': if(!e.repeat&&!spaceHeld)doJump(); spaceHeld=true; e.preventDefault(); break;
    case 'e': case 'E': if(!e.repeat){if(online)net.buttons|=4;else localButtons|=4;}e.preventDefault();break;
    case 'Shift': case 'ShiftLeft': case 'ShiftRight': boostHeld=true; e.preventDefault(); break;
    case 'ArrowUp': case 'w': case 'W': throttleHeld=true; e.preventDefault(); break;
  }
}, { passive: false });
window.addEventListener('keyup', function(e){
  if(inputDebug&&/^(a|d|arrowleft|arrowright)$/i.test(e.key)){inputStats.up++;inputStats.last='keyup '+e.key;}
  // Un botón con el foco se activa con el keyup del espacio: durante la carrera no debe pasar.
  if(running&&(e.key===' '||e.key.startsWith('Arrow')))e.preventDefault();
  switch(e.key){
    case ' ': spaceHeld=false; break;
    case 'Shift': case 'ShiftLeft': case 'ShiftRight': boostHeld=false; net.boostHeld=false; break;
    case 'ArrowUp': case 'w': case 'W': throttleHeld=false; if(net)net.throttleHeld=false; break;
    case 'ArrowLeft': case 'a': case 'A': releaseSteer('left'); anchorMouse(); break;
    case 'ArrowRight': case 'd': case 'D': releaseSteer('right'); anchorMouse(); break;
  }
});

// Solo cuenta como dirigir con el ratón un movimiento claro del puntero: al menos
// MOUSE_STEER_PX en horizontal desde donde estaba al usar el teclado por última vez. Así un
// mousemove sin movimiento (el navegador los lanza cuando cambia lo que hay bajo el cursor) o
// el temblor de un touchpad o de un ratón apoyado no quitan el control al teclado.
const MOUSE_STEER_PX=24;
let mouseAnchorX=null;
function anchorMouse(){mouseAnchorX=null;lastMouseMoveT=-10;}
window.addEventListener('mousemove', function(e){
  if(mouseAnchorX===null)mouseAnchorX=e.clientX;
  if(Math.abs(e.clientX-mouseAnchorX)<MOUSE_STEER_PX&&(elapsed-lastMouseMoveT)>=.22)return;
  mouseAnchorX=e.clientX;
  mouseNormX = (e.clientX / window.innerWidth) * 2 - 1;
  lastMouseMoveT = elapsed;
});

let tsx = 0, tsy = 0, tActive = false, tMoved = false;
canvas.addEventListener('touchstart', function(e){
  if(!running) return;
  const t = e.changedTouches[0];
  tsx = t.clientX; tsy = t.clientY; tActive = true; tMoved = false;
  mouseNormX = (t.clientX / window.innerWidth) * 2 - 1;
  lastMouseMoveT = elapsed;
}, { passive: true });
canvas.addEventListener('touchmove', function(e){
  if(!running || !tActive) return;
  const t = e.changedTouches[0];
  if(Math.abs(t.clientX - tsx) > 6 || Math.abs(t.clientY - tsy) > 6) tMoved = true;
  mouseNormX = (t.clientX / window.innerWidth) * 2 - 1;
  lastMouseMoveT = elapsed;
}, { passive: true });
canvas.addEventListener('touchend', function(e){
  if(!running || !tActive) return;
  tActive = false;
  const t = e.changedTouches[0];
  const dy = t.clientY - tsy;
  if(Math.abs(dy) > 34){ if(dy < 0) doJump(); }
  else if(!tMoved) tryBoost();
}, { passive: true });

const boostBtn = document.getElementById('boost-btn');
boostBtn.addEventListener('touchstart', function(e){ e.preventDefault(); tryBoost(); }, { passive: false });
boostBtn.addEventListener('mousedown', function(e){ e.preventDefault(); tryBoost(); });
if('ontouchstart' in window || navigator.maxTouchPoints > 0){ document.body.classList.add('touch'); }

// =====================================================================
//  SPAWNING
// =====================================================================
function spawnObstacle(z){
  const lane = Math.floor(Math.random() * 3);
  const cx = curveOffsetAt(z) + CFG.laneOffset[lane];
  const r = Math.random();
  const seed = obstacleSeed.n++;
  let node, kind;
  if(r < 0.28){ node = makeBuoy(); kind = 'jump'; }
  else if(r < 0.52){ node = makeRockObstacle(seed); kind = 'block'; }
  else if(r < 0.76){ node = makeFlagGate(seed); kind = 'slide'; }
  else if(r < 0.94){ node = makeRampObstacle(); kind = 'ramp'; }
  else { node = makeRing(); kind = 'ring'; }
  node.position.set(cx, 0, z);
  node.getChildMeshes().forEach(function(m){ m.isPickable = false; });
  obstacles.push({ node: node, kind: kind, passed: false, boosted: false, phase: Math.random() * TAU });
}

function spawnPearlRow(z){
  const lane = Math.floor(Math.random() * 3);
  const count = 3 + Math.floor(Math.random() * 3);
  for(let i=0;i<count;i++){
    const zi = z - i * 0.95;
    const m = pearlProto.clone('pearlInst');
    m.setEnabled(true);
    m.parent = null;
    m.position.set(curveOffsetAt(zi) + CFG.laneOffset[lane], 0.95, zi);
    m.isPickable = false;
    pearls.push({ mesh: m, taken: false, phase: Math.random() * TAU });
  }
}

// =====================================================================
//  COLLISIONS
// =====================================================================
const HIT_Z = 0.62, HIT_X = 0.88;

function checkCollisions(){
  const px = playerRoot.position.x, pz = playerRoot.position.z;
  for(let i=0;i<obstacles.length;i++){
    const o = obstacles[i];
    if(o.passed) continue;
    const dz = Math.abs(o.node.position.z - pz);
    const dx = Math.abs(o.node.position.x - px);
    if(dz < HIT_Z && dx < HIT_X){
      if(o.kind === 'ramp'){
        if(!o.boosted && !isJumping && !isSliding){
          o.boosted = true;
          isJumping = true;
          jumpVel = CFG.jumpForce * CFG.rampBoost;
          airClock = 0;
          shake = Math.max(shake, 0.18);
        }
      } else if(o.kind === 'ring'){
        if(!o.boosted){
          o.boosted = true;
          boostValue = Math.min(1, boostValue + 0.5);
          points += 50;
          showTrick('Â¡ARO! +50');
          shake = Math.max(shake, 0.14);
        }
      } else if(o.kind === 'jump'){
        if(!isJumping || airY < 0.8){ endGame(); return; }
      } else if(o.kind === 'block'){
        endGame(); return;
      } else if(o.kind === 'slide'){
        if(!isSliding){ endGame(); return; }
      }
    }
    if(o.node.position.z > pz + 1) o.passed = true;
  }
  for(let i=0;i<pearls.length;i++){
    const c = pearls[i];
    if(c.taken) continue;
    const dz = Math.abs(c.mesh.position.z - pz);
    const dx = Math.abs(c.mesh.position.x - px);
    if(dz < 0.66 && dx < 0.76){
      c.taken = true;
      c.mesh.dispose();
      pearlCount++;
      coinsEl.textContent = pearlCount;
      boostValue = Math.min(1, boostValue + 0.10);
      if(pearlCount % 12 === 0){ points += 25; showTrick('Â¡COMBO! +25'); }
    }
  }
}

// =====================================================================
//  MINIMAP
// =====================================================================
const mmCanvas = document.getElementById('minimap-canvas');
const mmCtx = mmCanvas.getContext('2d');
let minimapBackground=null,minimapCacheMap=-1;
function drawMinimap(){
 const w=mmCanvas.width,h=mmCanvas.height,c=mmCtx;
 if(!minimapBackground||minimapCacheMap!==activeMapId||minimapBackground.width!==w||minimapBackground.height!==h){
   const background=document.createElement('canvas');background.width=w;background.height=h;
   const bg=background.getContext('2d');
   const bounds=trackBounds(),scale=Math.min((w-38)/(bounds.maxX-bounds.minX),(h-65)/(bounds.maxZ-bounds.minZ));
   const cx=(bounds.minX+bounds.maxX)/2,cz=(bounds.minZ+bounds.maxZ)/2;
   bg.beginPath();
   for(let i=0;i<=160;i++){
     const p=trackFrame(i/160*LAP_LENGTH);
     const x=w*.5+(p.x-cx)*scale,y=h*.45+(p.z-cz)*scale;
     if(i)bg.lineTo(x,y);else bg.moveTo(x,y);
   }
   bg.strokeStyle='#ffd59a';bg.lineWidth=22;bg.stroke();
   bg.strokeStyle='#14778b';bg.lineWidth=16;bg.stroke();
   bg.strokeStyle='#85dedb';bg.lineWidth=1;bg.setLineDash([4,5]);bg.stroke();bg.setLineDash([]);
   minimapBackground=background;minimapCacheMap=activeMapId;
   minimapBackground.mapScale=scale;minimapBackground.mapCenterX=cx;minimapBackground.mapCenterZ=cz;
 }
 c.clearRect(0,0,w,h);c.drawImage(minimapBackground,0,0);
 const point=f=>{const p=trackFrame(f*LAP_LENGTH);return {x:w*.5+(p.x-minimapBackground.mapCenterX)*minimapBackground.mapScale,y:h*.45+(p.z-minimapBackground.mapCenterZ)*minimapBackground.mapScale};};
 const dot=(z,color,size)=>{const p=point(raceProgress(z).fraction);c.beginPath();c.arc(p.x,p.y,size,0,TAU);c.fillStyle=color;c.fill();c.strokeStyle='#fff';c.lineWidth=2;c.stroke();};
 for(const r of online?(net.remote.at(-1)?.players||[]):practiceBots.map(b=>b.player))dot(r.z,r.bot?'#5ce8f0':'#ff8264',4);
 dot(-distance,'#ffdf61',7);
 const race=raceProgress(-distance);c.fillStyle='#fff';c.font='bold 19px sans-serif';c.textAlign='center';c.fillText(race.finished?'META':`VUELTA ${race.lap} / 3`,w/2,h-13);
 if(running&&race.finished&&(!online||net.authoritative?.place>0)){showTrick('3 VUELTAS COMPLETADAS');endGame();}
}

// =====================================================================
//  RENDER LOOP
// =====================================================================
function step(){
  if(isPaused){
    scene.render();
    return;
  }
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  elapsed += dt;
  waveTime = elapsed;
  worldArt?.update(waveTime,distance);

  // ---- ocean shading uniforms
  waveOriginZ = Math.round(playerRoot.position.z / WAVE_PERIOD_Z) * WAVE_PERIOD_Z;
  waveOffsetY = playerRoot.position.z - waveOriginZ;
  oceanMat.setFloat('uTime', waveTime);
  oceanMat.setVector2('uWaveOffset', new BABYLON.Vector2(0, waveOffsetY));
  oceanMat.setVector3('uCameraPos', camera.position);

  if(running){
    if(online) updateOnline(dt); else updatePractice(dt);
    const steerDelta=strafe*dt;
    // ---- ride the swell (visual only; collisions use airY)
    const rideFrame = trackFrame(-playerRoot.position.z, playerRoot.position.x);
    oceanSample(rideFrame.x, rideFrame.z, waveTime, _samp);
    const waveY = _samp.y;
    const ny = Math.max(0.35, _samp.ny);
    const wavePitch = (_samp.nz * Math.cos(rideFrame.yaw) + _samp.nx * Math.sin(rideFrame.yaw)) / ny;
    const waveRoll = (-_samp.nx * Math.cos(rideFrame.yaw) + _samp.nz * Math.sin(rideFrame.yaw)) / ny;
    playerRoot.position.y += (((rampHeight(lateralOffset,playerRoot.position.z)>0 ? 0 : waveY * .88) + .08 + airY) - playerRoot.position.y) * Math.min(1, dt * 18);

    // ---- attitude
    const rampDeck=rampHeight(lateralOffset,playerRoot.position.z);
    if(rampDeck>0)playerRoot.position.y=Math.max(playerRoot.position.y,rampDeck+.1);
    const slope = curveSlopeAt(playerRoot.position.z);
    const targetHeading = Math.max(-0.5, Math.min(0.5, (-steerDelta * 6) - slope * 0.4));
    playerRoot.rotation.y += (targetHeading - playerRoot.rotation.y) * Math.min(1, dt * 6);
    const bank = Math.max(-0.55, Math.min(0.55, -steerDelta * 10 - slope * 0.5));
    camRoll += ((-bank * 0.35) - camRoll) * Math.min(1, dt * 4);
    playerRoot.rotation.z += ((bank + waveRoll * 0.6) - playerRoot.rotation.z) * Math.min(1, dt * 7);
    playerRoot.rotation.x += ((rampDeck>0 ? Math.atan(.25) : wavePitch * 0.7) - playerRoot.rotation.x) * Math.min(1, dt * 6);

    // Keep the surfer facing the course in the air; jumps do not spin the camera or body.
    spinAngle=0;
    visualRoot.rotation.y = spinAngle;

    const targetScaleY = isSliding ? 0.58 : 1;
    visualRoot.scaling.y += (targetScaleY - visualRoot.scaling.y) * Math.min(1, dt * 14);

    // ---- surfer body language
    // Everything is driven off the hips: the body compresses, twists and
    // counter-balances while the feet stay planted on the deck.
    const spd = Math.max(0.6, speed / CFG.baseSpeed);
    const pumpRate = 2.0 + spd * 0.8 + (boostActive ? 1.1 : 0);
    const pump = Math.sin(animT * pumpRate * 0.5);
    const pump2 = Math.sin(animT * pumpRate * 0.5 + 1.55);
    const sway = Math.sin(animT * pumpRate * 0.5 + 0.85);

    landPulse = Math.max(0, landPulse - dt * 4.5);

    const crouch = (isSliding ? 0.30 : 0)
                 + (boostActive ? 0.90 : 0)
                 + (isJumping ? -0.70 : 0)
                 + landPulse * 1.10;

    surfer.hips.position.y = 0.42 + pump * 0.048 - crouch * 0.16;
    surfer.hips.rotation.x = 0.10 + pump2 * 0.055
                           + (isJumping ? -0.20 : 0.04)
                           + crouch * 0.17;
    surfer.hips.rotation.y = -strafe * 0.44;
    surfer.hips.rotation.z = strafe * 0.11;

    // head keeps looking down the line
    surfer.headPivot.rotation.y = -0.30 - strafe * 0.58;
    surfer.headPivot.rotation.z = -strafe * 0.17;
    surfer.headPivot.rotation.x = -0.06 + pump * 0.045;

    // arms counter-balance: the trailing arm lifts as the surfer leans
    const armOpen = isJumping ? 0.75 : 0;
    surfer.shoulderBack.rotation.x = 0.55 + sway * 0.22 - strafe * 0.60 - crouch * 0.38 - armOpen * 0.35;
    surfer.shoulderBack.rotation.z = -0.45 - strafe * 0.40 - armOpen * 0.55;
    surfer.shoulderFront.rotation.x = -0.75 - sway * 0.20 + strafe * 0.48 - crouch * 0.22 - armOpen * 0.30;
    surfer.shoulderFront.rotation.z = 0.45 + strafe * 0.34 + armOpen * 0.55;

    // feet roll with the board
    surfer.footBack.rotation.z = -strafe * 0.20 + pump * 0.05;
    surfer.footFront.rotation.z = -strafe * 0.12 + pump2 * 0.045;
    surfer.footBack.position.y = 0.24 + Math.abs(pump) * 0.010;
    surfer.footFront.position.y = 0.24 + Math.abs(pump2) * 0.010;

    // ---- camera
    const targetFov = boostActive ? 1.04 : 0.90;
    camFov += (targetFov - camFov) * Math.min(1, dt * 3.2);
    camera.fov = camFov;
    const camBack = boostActive ? 7.2 : 6.5;
    const camHeight = 4.5 + (isJumping ? 0.3 : 0);
    // Follow distance, not a lagging world position: acceleration must not kick the camera.
    cameraBack += (camBack - cameraBack) * (1 - Math.exp(-4 * dt));
    camera.position.z = playerRoot.position.z + cameraBack;
    camera.position.x += ((playerRoot.position.x * 0.52) - camera.position.x) * Math.min(1, dt * 3.5);
    camera.position.y += ((camHeight) - camera.position.y) * Math.min(1, dt * 3.5);
    if(shake > 0){
      // Impacts retain their visual feedback without random camera displacement.
      shake = Math.max(0, shake - dt * 1.6);
    }

    // ---- world follows the surfer
    ocean.position.z = playerRoot.position.z;
    beachL.position.z = playerRoot.position.z;
    beachR.position.z = playerRoot.position.z;
    skylineRoot.position.x = playerRoot.position.x;
    skylineRoot.position.z = playerRoot.position.z;
    skylineRoot.position.y = playerRoot.position.y * 0.25;
    sun.position.copyFrom(playerRoot.position).addInPlace(SUN_DIR.scale(80));
    ocean.position.x = 0;

    // ---- spray / wake
    const boosting = boostActive;
    // carving hard throws its own rooster tail, so the board feels connected
    spray.emitRate = 40 + Math.min(120, speed * 5.0) + Math.abs(strafe) * 190 + (boosting ? 190 : 0);
    spray.minEmitPower = boosting ? 1.8 : 1.0;
    spray.maxEmitPower = boosting ? 5.0 : 3.2;

    // Emit from the rails of the board so the splash is inside the chase camera view.
    sprayEmitter.position.set(
      -Math.sin(playerRoot.rotation.y) * 0.25,
      0.18 + airY * 0.5,
      Math.cos(playerRoot.rotation.y) * 0.25
    );

    wakeSpawnT -= dt;
    const wakeSpeed = Math.max(0, speed);
    const bowTarget = airY < 0.25 ? Math.min(1, wakeSpeed / 16) * (boosting ? 1.0 : 0.85) : 0;
    bowFoamTex.vOffset = (bowFoamTex.vOffset + dt * wakeSpeed * 0.09) % 1;
    for(const m of bowFoam){
      m.visibility += (bowTarget - m.visibility) * Math.min(1, dt * 6);
      m.scaling.z = 1;
      m.scaling.y = 1;
      m.position.z = boosting ? 0.05 : -0.15;
    }
    if(wakeSpawnT <= 0 && airY < 0.25 && wakeSpeed > 1.5){
      wakeSpawnT = boosting ? 0.03 : 0.045;
      const life = Math.min(1.35, 0.45 + wakeSpeed * 0.028 + (boosting ? 0.3 : 0));
      // one patch per side of the V plus a churn patch right behind the tail
      for(const side of [-1, 1, 0]){
        const wp = wakeParts.find(w => !w.mesh.isEnabled());
        if(!wp) break;
        wp.mesh.setEnabled(true);
        wp.life = wp.maxLife = side === 0 ? life * 0.6 : life;
        wp.vx = side * (2.6 + wakeSpeed * 0.13);
        wp.grow = side === 0 ? 2.2 : 3.0 + wakeSpeed * 0.07;
        const wz = playerRoot.position.z + 0.35 + Math.random() * 0.3;
        const wx = playerRoot.position.x + side * 0.35 + (Math.random() - 0.5) * 0.18;
        // Sample the wave field where the surface is really drawn (course space).
        const wf = trackFrame(-wz, wx);
        oceanSample(wf.x, wf.z, waveTime, _samp);
        wp.mesh.position.set(wx, _samp.y + 0.1, wz);
        const s0 = side === 0 ? 1.7 : 1.4;
        wp.mesh.scaling.set(s0, 1, s0 * 1.6);
        wp.mesh.visibility = 0.9;
      }
    }
    for(let i=0;i<wakeParts.length;i++){
      const wp = wakeParts[i];
      if(!wp.mesh.isEnabled()) continue;
      wp.life -= dt;
      wp.mesh.position.x += wp.vx * dt;
      wp.mesh.scaling.x += dt * wp.grow;
      wp.mesh.scaling.z += dt * wp.grow * 1.3;
      const k = Math.max(0, wp.life / wp.maxLife);
      wp.mesh.visibility = Math.min(0.9, k * 1.3) * (0.55 + 0.45 * k);
      if(wp.life <= 0) wp.mesh.setEnabled(false);
    }

    courseView.update(playerRoot.position.z,elapsed);
    // ---- recycle
    for(let i=obstacles.length-1;i>=0;i--){
      if(obstacles[i].node.position.z > playerRoot.position.z + 14){
        disposeNode(obstacles[i].node);
        obstacles.splice(i, 1);
      }
    }
    for(let i=pearls.length-1;i>=0;i--){
      if(pearls[i].mesh.position.z > playerRoot.position.z + 14){
        pearls[i].mesh.dispose();
        pearls.splice(i, 1);
      }
    }
    for(let i=0;i<pearls.length;i++){
      const c = pearls[i];
      c.mesh.rotation.y += dt * 3.4;
      oceanSample(c.mesh.position.x, c.mesh.position.z - waveOriginZ, waveTime, _samp);
      c.mesh.position.y = _samp.y + 0.82 + Math.sin(animT * 2.4 + c.phase) * 0.09;
    }
    for(let i=0;i<obstacles.length;i++){
      const o = obstacles[i];
      if(o.kind === 'jump' || o.kind === 'slide' || o.kind === 'ring'){
        oceanSample(o.node.position.x, o.node.position.z - waveOriginZ, waveTime, _samp);
        o.node.position.y = _samp.y * 0.9;
        o.node.rotation.z = _samp.nx * 0.35;
        o.node.rotation.x = -_samp.nz * 0.35;
      }
    }

    // ---- streaks
    if(boostActive){
      for(let i=0;i<streaks.length;i++){
        const s = streaks[i];
        s.position.z -= dt * 48;
        if(s.position.z < 1.5){
          s.position.z = 13 + Math.random() * 6;
          s.position.x = (Math.random() - 0.5) * 9;
          s.position.y = (Math.random() - 0.5) * 5;
        }
      }
    }
  } else {
    // idle / pre-start drift
    spray.emitRate = 0;
    const idleT = elapsed * 0.4;
    oceanSample(0, 0, waveTime, _samp);
    playerRoot.position.y += ((_samp.y * 0.88 + 0.04) - playerRoot.position.y) * Math.min(1, dt * 6);
    camFov += (1.02 - camFov) * Math.min(1, dt * 3);
    camera.fov = camFov;
    camera.position.z = 8.5 + Math.sin(idleT) * 0.5;
    camera.position.x += ((Math.sin(idleT * 0.6) * 0.9) - camera.position.x) * Math.min(1, dt * 1.2);
    camera.position.y += ((4.6 + Math.sin(idleT * 0.8) * 0.4) - camera.position.y) * Math.min(1, dt * 1.5);
    camera.rotation.z += (0 - camera.rotation.z) * Math.min(1, dt * 3);
    ocean.position.z += (0 - ocean.position.z) * Math.min(1, dt * 3);
    beachL.position.z = ocean.position.z;
    beachR.position.z = ocean.position.z;
    skylineRoot.position.z = ocean.position.z;
    skylineRoot.position.x += (0 - skylineRoot.position.x) * Math.min(1, dt * 3);
    const bobIdle = Math.sin(elapsed * 1.2) * 0.035;
    surfer.hips.position.y = 0.42 + bobIdle;
    surfer.hips.rotation.x = 0.10 + Math.sin(elapsed * 0.9) * 0.03;
    surfer.hips.rotation.y = Math.sin(elapsed * 0.45) * 0.07;
    surfer.hips.rotation.z = Math.sin(elapsed * 0.70) * 0.04;
    // waiting for the set: the penguin scans the horizon
    surfer.headPivot.rotation.y = -0.30 + Math.sin(elapsed * 0.55) * 0.38;
    surfer.headPivot.rotation.z = Math.sin(elapsed * 0.80) * 0.05;
    surfer.headPivot.rotation.x = -0.06 + Math.sin(elapsed * 1.1) * 0.05;
    surfer.shoulderBack.rotation.x = 0.55 + Math.sin(elapsed * 1.25) * 0.20;
    surfer.shoulderBack.rotation.z = -0.45 - Math.sin(elapsed * 1.05) * 0.10;
    surfer.shoulderFront.rotation.x = -0.75 - Math.sin(elapsed * 1.25 + 0.7) * 0.17;
    surfer.shoulderFront.rotation.z = 0.45 + Math.sin(elapsed * 1.05 + 0.4) * 0.09;
    surfer.footBack.rotation.z = 0;
    surfer.footFront.rotation.z = 0;
    strafe += (0 - strafe) * Math.min(1, dt * 3);
    landPulse = Math.max(0, landPulse - dt * 4.5);
    playerRoot.rotation.z += (0 - playerRoot.rotation.z) * Math.min(1, dt * 4);
    playerRoot.rotation.x += (0 - playerRoot.rotation.x) * Math.min(1, dt * 4);
  }

  camera.position.x = Math.max(-9, Math.min(9, camera.position.x));
  _camTarget.set(
    playerRoot.position.x * 0.55,
    1.25 + playerRoot.position.y * 0.5,
    playerRoot.position.z - 2.5
  );
  camera.setTarget(_camTarget);
  camera.rotation.z = camRoll;

  // ---- world animation that runs whether or not the run is live
  updateDecor();
  updateSway(elapsed);
  cloudRoot.rotation.y += dt * 0.006;
  for(let i=0;i<gulls.length;i++){
    const gl = gulls[i];
    const a = elapsed * gl.speed + gl.phase;
    gl.root.position.x = Math.cos(a) * gl.radius;
    gl.root.position.z = Math.sin(a) * gl.radius - 70;
    gl.root.position.y = 15 + Math.sin(a * 2.2) * 2.2;
    gl.root.rotation.y = -a + Math.PI / 2;
    const flap = Math.sin(elapsed * 6 + gl.phase) * 0.55;
    gl.wl.rotation.z = 0.12 + flap;
    gl.wr.rotation.z = -0.12 - flap;
  }

  drawMinimap();
  if(!running) courseView.update(playerRoot.position.z,elapsed);
  if(avatar){
   avatar.animate(elapsed,strafe,airY,isSliding,boostActive,landPulse,spinAngle);
   avatar.performTrick?.(trickType,Math.max(0,(elapsed-trickStart)/.8));
  }
  for(const rival of rivals.values()){rival.animate(elapsed,rival.remoteSteer||0,rival.remoteAir||0);if(rival.trickAt!==undefined)rival.performTrick?.(rival.trickKind,(elapsed-rival.trickAt)/.8);}
  powerView.update(online?(net.player||net.authoritative):localPlayer,online?net.powerWorld:localPowerWorld,online?net.players:[localPlayer,...practiceBots.map(b=>b.player)],elapsed,running,avatar,rivals);
  trackView.render({lookBack,player:playerRoot,camera,decor:decorItems,course:courseView.nodes,rivals:[...rivals.values()],wakes:wakeParts.filter(w=>w.mesh.isEnabled()).map(w=>w.mesh),sky:skylineRoot,sun,waterMaterial:oceanMat,air:airY,dt,sample:(x,z)=>oceanSample(x,z,waveTime,_samp).y},()=>scene.render());
}

// =====================================================================
//  BOOT
// =====================================================================
// El preloader (src/core/preloader.js) mide la carga real de las texturas de la
// escena y oculta la pantalla de carga solo cuando todo está listo.
let bootWarmupDone;
const bootWarmup = new Promise(function(resolve){ bootWarmupDone = resolve; });
window.SurfPreloader?.sceneCreated(scene, bootWarmup);
scene.executeWhenReady(async function(){
  await powerView.warmup();
  // Upload scene resources before exposing the game canvas to the player.
  scene.render();
  bootWarmupDone();
  if(window.SurfPreloader){
    await window.SurfPreloader.ready;
  } else {
    const l = document.getElementById('loading');
    if(l) l.classList.add('gone');
    setTimeout(function(){ if(l) l.style.display = 'none'; }, 600);
  }
  if(PARAMS.has('autoplay') || PARAMS.has('capture')){
    setTimeout(function(){
      document.getElementById('practice-btn')?.click();
      if(PARAMS.has('capture')){
        let captured = false;
        scene.onAfterRenderObservable.add(() => {
          if(!captured && distance > 35){
            captured = true;
            setTimeout(() => {
              BABYLON.Tools.CreateScreenshotUsingRenderTarget(engine, camera, {width: 1280, height: 720}, function(data){
                fetch('/save-screenshot', { method: 'POST', body: data }).then(() => {
                  console.log('Capture completed');
                });
              });
            }, 600);
          }
        });
      }
    }, 300);
  }
});

window.addEventListener('resize', function(){ engine.resize(); });
window.addEventListener('orientationchange', function(){ setTimeout(function(){ engine.resize(); }, 250); });

// handy handles for debugging / tweaking from the console
window.__surf = {
  BABYLON: BABYLON, engine: engine, scene: scene, camera: camera,
  get pipeline(){ return pipeline; },
  get probe(){ return skyProbe; },
  get decor(){ return decorItems; },
  get sway(){ return swayNodes; },
  get surfer(){ return surfer; },
  get player(){ return playerRoot; },
  get oceanMat(){ return oceanMat; },
  get state(){ return {
    running: running, distance: distance, speed: speed, pearls: pearlCount,
    points: points, boost: boostValue, boostActive: boostActive,
    obstacles: obstacles.length, isJumping: isJumping, isSliding: isSliding,
  }; },
  start: startGame,
};

// adaptive quality so weaker machines still hold a playable frame rate
let qualityStage = 0, fpsAccum = 0, fpsFrames = 0;
function watchQuality(dt){
  if(LOCK_QUALITY||settings.quality!=='auto'||!settings.effects) return;
  fpsAccum += dt; fpsFrames++;
  if(fpsAccum < 3) return;
  const fps = fpsFrames / fpsAccum;
  fpsAccum = 0; fpsFrames = 0;
  if(fps < 40 && qualityStage === 0){
    qualityStage = 1;
    if(pipeline){ pipeline.samples = 2; pipeline.bloomWeight = 0.16; }
  } else if(fps < 30 && qualityStage === 1){
    qualityStage = 2;
    engine.setHardwareScalingLevel(1);
    if(pipeline){ pipeline.bloomEnabled = false; pipeline.grainEnabled = false; }
  } else if(fps > 55 && qualityStage === 2){
    qualityStage = 1;
    engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
    if(pipeline){ pipeline.bloomEnabled = true; pipeline.grainEnabled = false; }
  }
}

function applyGraphics(){
 const low=settings.quality==='low',effects=settings.effects&&!low;
 engine.setHardwareScalingLevel(low?1.5:1/Math.min(window.devicePixelRatio||1,1.5));
 scene.shadowsEnabled=!low;scene.particlesEnabled=effects;
 if(pipeline){pipeline.samples=low?1:2;pipeline.bloomEnabled=effects;pipeline.chromaticAberrationEnabled=false;pipeline.grainEnabled=false;pipeline.imageProcessing.vignetteEnabled=false;}
 qualityStage=0;fpsAccum=0;fpsFrames=0;engine.resize();
}
document.addEventListener('surf:settings',applyGraphics);applyGraphics();
engine.runRenderLoop(function(){
  try{
    // The illustrated home covers the canvas; avoid spending GPU time behind it.
    if(!overlay.classList.contains('hidden')&&document.getElementById('loading').classList.contains('gone'))return;
    step();
    watchQuality(engine.getDeltaTime() / 1000);
  }catch(e){
    console.error('[surf] frame error', e);
    running = false;
    fatal('Error durante el render:<br><br>' + (e && e.message ? e.message : e));
    engine.stopRenderLoop();
  }
});

})();
