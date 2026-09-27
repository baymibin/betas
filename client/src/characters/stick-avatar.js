import {setGlow} from '../world/material-color.js';
import {boardSkins} from '../shared/board-cosmetics.js';

export const characterColors = ['#f6faf8', '#60ded9', '#ffba61', '#c2a5ff', '#ff829b'];
export const boardColors = boardSkins.map(skin=>skin.color);
const boardTextures = new WeakMap();

function boardTexture(B, scene, index) {
  let cache=boardTextures.get(scene);
  if(!cache){cache=new Map();boardTextures.set(scene,cache);}
  if(!cache.has(index)){
    const texture=new B.Texture(boardSkins[index].file,scene,false,true);
    texture.hasAlpha=true;
    texture.wrapU=B.Texture.CLAMP_ADDRESSMODE;
    texture.wrapV=B.Texture.CLAMP_ADDRESSMODE;
    cache.set(index,texture);
  }
  return cache.get(index);
}

export function borderColor(hex) {
  const parts = hex.slice(1).match(/../g).map(v => Math.round(parseInt(v, 16) * 0.72));
  return '#' + parts.map(v => v.toString(16).padStart(2, '0')).join('');
}

// 3D Low Poly Futuristic Stickman and Surfboard
export function createStickAvatar(B, scene, parent, character = 0, board = 0, wing = 0) {
  const root = new B.TransformNode('stick-surfer', scene);
  root.parent = parent;

  const materials = [];
  const textures = [];

  function makeStdMat(name, hex, spec = 0.28, emissiveRatio = 0.08) {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseColor = B.Color3.FromHexString(hex);
    m.specularColor = new B.Color3(spec, spec, spec);
    m.specularPower = 32;
    m.emissiveColor = m.diffuseColor.scale(emissiveRatio);
    m.backFaceCulling = false;
    materials.push(m);
    return m;
  }

  const skinColor = characterColors[character] || characterColors[0];
  const skinIndex=boardSkins[board]?board:0;
  const boardColor = boardColors[skinIndex];
  const borderHex = borderColor(skinColor);

  const bodyMat = makeStdMat('stick-body', skinColor, 0.22, 0.06);
  const borderMat = makeStdMat('stick-border', borderHex, 0.16, 0.04);
  const deckMat = makeStdMat('stick-deck', boardColor, 0.38, 0.12);

  const neon = new B.StandardMaterial('board-neon', scene);
  neon.diffuseColor = B.Color3.FromHexString(boardColor);
  neon.emissiveColor = neon.diffuseColor.scale(1.4);
  neon.disableLighting = true;
  materials.push(neon);

  // =========================================================================
  // 1. SURFBOARD MODELING (5 Distinct Futuristic Silhouettes)
  // =========================================================================
  const deckRoot = new B.TransformNode('deck', scene);
  deckRoot.parent = root;

  function makeBoard() {
    const halfWidth=boardSkins[skinIndex].width*0.5;
    const halfLength=1.42;

    // Keep a real, rounded 3D hull for banking, jumps and side views.
    const hull=B.MeshBuilder.CreateSphere('deck-main',{diameter:2,segments:32},scene);
    hull.parent=deckRoot;
    hull.scaling.set(halfWidth,0.08,halfLength);
    hull.position.y=0.08;
    hull.material=deckMat;
    hull.isPickable=false;

    // The cropped WebP follows the curved upper surface instead of floating
    // on a flat billboard. Transparent pixels reveal the matching 3D hull.
    const artworkMat=makeStdMat('deck-artwork','#ffffff',0.32,0.12);
    artworkMat.diffuseTexture=boardTexture(B,scene,skinIndex);
    artworkMat.useAlphaFromDiffuseTexture=true;
    artworkMat.transparencyMode=B.Material.MATERIAL_ALPHATEST;
    artworkMat.alphaCutOff=0.04;
    const rows=48,columns=12,positions=[],uvs=[],indices=[];
    for(let row=0;row<=rows;row++){
      const zNorm=-0.998+1.996*row/rows;
      const rowRadius=Math.sqrt(1-zNorm*zNorm);
      for(let column=0;column<=columns;column++){
        const xNorm=-1+2*column/columns;
        const x=xNorm*halfWidth*rowRadius;
        const crown=Math.sqrt(Math.max(0,1-zNorm*zNorm-(x/halfWidth)**2));
        positions.push(x,0.08+0.08*crown+0.004,zNorm*halfLength);
        uvs.push((x/halfWidth+1)*0.5,(1-zNorm)*0.5);
      }
    }
    for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
      const a=row*(columns+1)+column,b=a+columns+1;
      indices.push(a,b,a+1,a+1,b,b+1);
    }
    const artwork=new B.Mesh('deck-artwork-surface',scene);
    const geometry=new B.VertexData();
    geometry.positions=positions;
    geometry.indices=indices;
    geometry.uvs=uvs;
    geometry.normals=[];
    B.VertexData.ComputeNormals(positions,indices,geometry.normals);
    geometry.applyToMesh(artwork);
    artwork.parent=deckRoot;
    artwork.material=artworkMat;
    artwork.isPickable=false;

    const rim=B.MeshBuilder.CreateTorus('deck-rim',{diameter:2,thickness:0.025,tessellation:64},scene);
    rim.parent=deckRoot;
    rim.scaling.set(halfWidth,1,halfLength);
    rim.position.y=0.08;
    rim.material=neon;
    rim.isPickable=false;
  }

  makeBoard();

  // =========================================================================
  // 2. STICKMAN MODELING (Pure Line Stroke Stickman, Clean Geometry)
  // =========================================================================
  const rig = new B.TransformNode('stick-rig', scene);
  rig.parent = root;

  // Clean spherical stickman head (no sunglasses, visor, or protrusions)
  const head = B.MeshBuilder.CreateSphere('round-head', {diameter: 0.44, segments: 24}, scene);
  head.parent = rig;
  head.material = bodyMat;

  // Uniform stroke line thickness (looks like a clean 3D line drawing, no bulging balls)
  const strokeDiameter = 0.095;

  // Seamless joint caps matching the exact stroke thickness to smoothly round corners
  // 0: Hips, 1: Chest/Shoulders, 2: Left Shoulder, 3: Left Hand,
  // 4: Right Shoulder, 5: Right Hand, 6: Left Knee, 7: Left Foot, 8: Right Knee, 9: Right Foot
  const joints = Array.from({length: 10}, (_, i) => {
    const m = B.MeshBuilder.CreateSphere('joint-' + i, {diameter: strokeDiameter, segments: 10}, scene);
    m.parent = rig;
    m.material = bodyMat;
    return m;
  });

  // Skeletal limb links: [startJoint, endJoint]
  const links = [
    [0, 1], // Spine
    [1, 2], // Left Upper Arm
    [2, 3], // Left Forearm
    [1, 4], // Right Upper Arm
    [4, 5], // Right Forearm
    [0, 6], // Left Thigh
    [6, 7], // Left Shin
    [0, 8], // Right Thigh
    [8, 9]  // Right Shin
  ];

  const limbs = links.map((_, i) => {
    const m = B.MeshBuilder.CreateCylinder('limb-' + i, {
      height: 1,
      diameter: strokeDiameter,
      tessellation: 12
    }, scene);
    m.parent = rig;
    m.material = bodyMat;
    m.rotationQuaternion = B.Quaternion.Identity();
    return m;
  });

  // 3D Animated Wings Accessory (9 High-Resolution Spritesheets from Root)
  const WING_FILES = [
    'angel_wings.webp',
    'aqua_wings.webp',
    'fire_wings.webp',
    'crystal_wings.webp',
    'nature_wings.webp',
    'bat_demon_wings.webp',
    'crimson_butterfly_wings.webp',
    'dark_demon_wings.webp',
    'mechanical_demon_wings.webp'
  ];

  let wingPlane = null, wingTex = null;
  const wingIndex = Number(wing);
  if (wingIndex >= 0 && wingIndex < WING_FILES.length) {
    wingPlane = B.MeshBuilder.CreatePlane('stick-wings', {width: 1.45, height: 1.45}, scene);
    wingPlane.parent = rig;
    wingPlane.rotation.y = Math.PI; // Face towards camera (viewed from behind)
    wingPlane.isPickable = false;
    wingPlane.metadata = {excludePowerGlow: true};

    wingTex = new B.Texture('/assets/images/wings/' + WING_FILES[wingIndex], scene, true, false);
    wingTex.hasAlpha = true;
    wingTex.uScale = 0.25; // 4 columns
    wingTex.vScale = 0.5;  // 2 rows
    wingTex.wrapU = B.Texture.CLAMP_ADDRESSMODE;
    wingTex.wrapV = B.Texture.CLAMP_ADDRESSMODE;
    textures.push(wingTex);

    const wingMat = new B.StandardMaterial('stick-wing-mat', scene);
    wingMat.diffuseTexture = wingTex;
    wingMat.useAlphaFromDiffuseTexture = true;
    wingMat.diffuseColor = new B.Color3(1, 1, 1);
    wingMat.emissiveColor = new B.Color3(0.95, 0.95, 0.95);
    wingMat.specularColor = new B.Color3(0.15, 0.15, 0.15);
    wingMat.backFaceCulling = false;
    materials.push(wingMat);
    wingPlane.material = wingMat;
  }

  const points = Array.from({length: 10}, () => new B.Vector3());
  const up = new B.Vector3(0, 1, 0), axis = new B.Vector3(), direction = new B.Vector3();

  // Animation State Registers
  let lastTime = 0;
  let lean = 0;
  let airPose = 0;
  let compression = 0;
  let impactPulse = 0;
  let previousSpeed = 0;
  let bobPhase = 0;

  // =========================================================================
  // 3. TEN ANIMATION STATES WITH SMOOTH BLENDING
  // =========================================================================
  root.animate = (time, steer = 0, jump = 0, slide = false, boost = false, landing = 0, spin = 0) => {
    const dt = Math.max(0.001, Math.min(0.1, time - lastTime));
    lastTime = time;

    // Smooth exponential blending
    const blend = 1 - Math.exp(-14 * dt);
    lean += (steer - lean) * blend;
    airPose += ((jump > 0.05 ? 1 : 0) - airPose) * blend;
    compression += ((slide ? 0.38 : boost ? 0.22 : landing * 0.32) - compression) * blend;
    impactPulse = Math.max(0, impactPulse - dt * 3.5);

    steer = lean;
    const crouch = compression;
    // 1. Idle vs 2. Dynamic Movement Breathing Sway
    const isLive = Math.abs(steer) > 0.02 || boost || jump > 0.05;
    bobPhase += dt * (isLive ? 5.2 : 2.2);
    const bob = Math.sin(bobPhase) * (isLive ? 0.03 : 0.02);
    const balanceSway = Math.sin(time * 3.8) * 0.04;

    // Joint positioning driven by hips and shoulders
    // 9. Turbo crouch / 8. Landing compression
    const hipY = 1.02 - crouch * 0.7 + bob;
    const shoulderY = 1.48 - crouch * 0.55 + bob;

    points[0].set(0, hipY, 0); // Hip
    points[1].set(steer * 0.16 + balanceSway, shoulderY, 0); // Chest

    // 4. Banking and arm balance in turns
    // Left Arm
    points[2].set(-0.32, shoulderY - 0.22 + airPose * 0.25 + steer * 0.18, 0.04);
    points[3].set(-0.54, shoulderY - 0.36 + airPose * 0.55 + steer * 0.28, -0.08);

    // Right Arm
    points[4].set(0.34, shoulderY - 0.18 + airPose * 0.25 - steer * 0.18, 0.02);
    points[5].set(0.58, shoulderY - 0.30 + airPose * 0.52 - steer * 0.28, -0.14);

    // 5. Rampa flexión / 6. Impulso despegue / 8. Aterrizaje
    // Left Leg (Forward foot planted on surfboard)
    points[6].set(-0.18, 0.58 - crouch * 0.52, 0.18);
    points[7].set(-0.22, 0.18, 0.44);

    // Right Leg (Back foot planted on surfboard tail)
    points[8].set(0.20, 0.58 - crouch * 0.52, -0.18);
    points[9].set(0.22, 0.18, -0.44);

    // Head smoothly tracks looking down the wave line
    head.position.set(points[1].x, shoulderY + 0.22, 0);
    head.rotation.y = -steer * 0.35;

    // Wings attached behind upper back, following spine, banking, and bobbing
    if (wingPlane && wingTex) {
      wingPlane.position.set(points[1].x, shoulderY - 0.08, 0.08);
      // Gentle wing flapping animation at ~10 FPS (8 frames in 4x2 grid)
      const frame = Math.floor(time * 10) % 8;
      const col = frame % 4;
      const row = Math.floor(frame / 4);
      wingTex.uOffset = col * 0.25;
      wingTex.vOffset = row === 0 ? 0.5 : 0.0;
    }

    // Update joint spheres
    for (let i = 0; i < joints.length; i++) {
      joints[i].position.copyFrom(points[i]);
    }

    // Connect and orient continuous limbs
    links.forEach(([a, b], i) => {
      points[b].subtractToRef(points[a], direction);
      const length = direction.length();
      if (length > 0.001) {
        direction.scaleInPlace(1 / length);
        const mesh = limbs[i];
        mesh.position.copyFrom(points[a]).addInPlace(points[b]).scaleInPlace(0.5);
        mesh.scaling.y = length + 0.04; // Encastre so no gaps exist at joints

        B.Vector3.CrossToRef(up, direction, axis);
        if (axis.lengthSquared() < 0.000001) axis.set(1, 0, 0);
        else axis.normalize();
        B.Quaternion.RotationAxisToRef(
          axis,
          Math.acos(Math.max(-1, Math.min(1, B.Vector3.Dot(up, direction)))),
          mesh.rotationQuaternion
        );
      }
    });

    // 4. Banking: Lean body and board into turn
    rig.rotation.z = -steer * 0.22;
    deckRoot.rotation.z = -steer * 0.16;
    deckRoot.rotation.x += ((boost ? -0.06 : 0) - deckRoot.rotation.x) * blend;
    root.rotation.y = spin;

    // Glowing accents pulse with speed & turbo
    const glow = 1.3 + Math.sin(time * 3.5) * 0.25 + (boost ? 1.0 : 0);
    setGlow(neon, glow);

    // Tiki Aura animation (smooth orbital spin and gentle breathing pulse)
    if (tikiAura && tikiAura.isEnabled()) {
      tikiAura.rotation.y = time * 2.2;
      tikiAura.rotation.x = Math.sin(time * 2.5) * 0.15;
      const pulse = 1.0 + 0.05 * Math.sin(time * 7);
      tikiAura.scaling.set(pulse, pulse, pulse);
    }

    // Rocket Thruster flame flicker
    if (rocketThrusterL) {
      const isTurboFlame = currentPowerKind === 2 || boost;
      rocketThrusterL.setEnabled(isTurboFlame);
      rocketThrusterR.setEnabled(isTurboFlame);
      const flameLen = 0.85 + 0.35 * Math.sin(time * 30);
      rocketThrusterL.scaling.set(1, flameLen, 1);
      rocketThrusterR.scaling.set(1, flameLen, 1);
    }
  };

  // =========================================================================
  // 7. FIVE DISTINCT TRICKS (Airborne acrobatic poses)
  // =========================================================================
  root.performTrick = (type, progress) => {
    rig.rotation.x = 0;
    root.rotation.z = 0;
    deckRoot.rotation.x = 0;
    deckRoot.rotation.y = 0;

    if (progress <= 0 || progress >= 1) return;

    const ease = progress * progress * (3 - 2 * progress);
    const pose = Math.sin(progress * Math.PI);

    if (type === 0) {
      // Trick 0: Aerial 360 (Surfer and board spin full 360 together)
      root.rotation.y = ease * Math.PI * 2;
      rig.rotation.x = pose * 0.35;
    } else if (type === 1) {
      // Trick 1: Shove-it (Board spins 360 horizontally beneath surfer)
      deckRoot.rotation.y = ease * Math.PI * 2;
      rig.position.y = pose * 0.25; // Surfer floats briefly while board spins
    } else if (type === 2) {
      // Trick 2: Method Grab (Board rolls 70° sideways, hand grabs rail)
      rig.rotation.x = pose * 0.65;
      deckRoot.rotation.z = pose * 1.15;
      deckRoot.rotation.x = -pose * 0.35;
    } else if (type === 3) {
      // Trick 3: Superman (Body extends horizontally backwards holding board)
      rig.rotation.x = -pose * 1.35;
      rig.position.z = -pose * 0.45;
      deckRoot.rotation.x = -pose * 0.3;
      root.rotation.z = pose * 0.25;
    } else if (type === 4) {
      // Trick 4: Tail Grab (Deep tuck, board pitches up 45°, grab tail)
      rig.rotation.x = pose * 0.95;
      deckRoot.rotation.x = -pose * 0.75;
      deckRoot.rotation.z = pose * 0.35;
    }
  };

  // 10. Reacción a impactos
  root.triggerImpact = () => {
    impactPulse = 1.0;
  };

  // Tiki Aura Bubble attached directly to root (never lags or detaches)
  const tikiAura = B.MeshBuilder.CreateIcoSphere('tiki-aura', {radius: 1.4, subdivisions: 1, flat: true}, scene);
  tikiAura.parent = root;
  tikiAura.position.set(0, 1.25, 0);
  const tikiMat = new B.StandardMaterial('tiki-aura-mat', scene);
  tikiMat.diffuseColor = B.Color3.FromHexString('#4ef2d2');
  tikiMat.emissiveColor = tikiMat.diffuseColor.scale(0.95);
  tikiMat.alpha = 0.38;
  tikiMat.backFaceCulling = false;
  tikiAura.material = tikiMat;
  tikiAura.isPickable = false;
  materials.push(tikiMat);

  const tikiRing = B.MeshBuilder.CreateTorus('tiki-ring', {diameter: 2.8, thickness: 0.04, tessellation: 24}, scene);
  tikiRing.parent = tikiAura;
  tikiRing.rotation.x = Math.PI / 4;
  tikiRing.material = tikiMat;
  tikiRing.isPickable = false;

  const tikiRing2 = B.MeshBuilder.CreateTorus('tiki-ring2', {diameter: 2.8, thickness: 0.04, tessellation: 24}, scene);
  tikiRing2.parent = tikiAura;
  tikiRing2.rotation.z = Math.PI / 4;
  tikiRing2.material = tikiMat;
  tikiRing2.isPickable = false;
  tikiAura.setEnabled(false);

  // Twin rocket jet flame cones under the board tail
  const rocketMat = new B.StandardMaterial('rocket-flame-mat', scene);
  rocketMat.diffuseColor = B.Color3.FromHexString('#ff9500');
  rocketMat.emissiveColor = B.Color3.FromHexString('#ffcc00');
  rocketMat.disableLighting = true;
  materials.push(rocketMat);

  const rocketThrusterL = B.MeshBuilder.CreateCylinder('rocket-flame-l', {diameterTop: 0.0, diameterBottom: 0.22, height: 0.85, tessellation: 6}, scene);
  rocketThrusterL.parent = deckRoot;
  rocketThrusterL.position.set(-0.22, 0.05, 1.35);
  rocketThrusterL.rotation.x = -Math.PI / 2;
  rocketThrusterL.material = rocketMat;
  rocketThrusterL.isPickable = false;
  rocketThrusterL.setEnabled(false);

  const rocketThrusterR = B.MeshBuilder.CreateCylinder('rocket-flame-r', {diameterTop: 0.0, diameterBottom: 0.22, height: 0.85, tessellation: 6}, scene);
  rocketThrusterR.parent = deckRoot;
  rocketThrusterR.position.set(0.22, 0.05, 1.35);
  rocketThrusterR.rotation.x = -Math.PI / 2;
  rocketThrusterR.material = rocketMat;
  rocketThrusterR.isPickable = false;
  rocketThrusterR.setEnabled(false);

  // Power Glow & Streaks
  const powerTrailMat = new B.StandardMaterial('power-trail-light', scene);
  powerTrailMat.disableLighting = true;
  powerTrailMat.emissiveColor = B.Color3.White();
  powerTrailMat.alpha = 0.65;
  materials.push(powerTrailMat);

  const powerTrails = Array.from({length: 6}, (_, i) => {
    const m = B.MeshBuilder.CreateSphere('surf-power-streak', {diameter: 1, segments: 6}, scene);
    m.parent = root;
    m.material = powerTrailMat;
    m.isPickable = false;
    m.setEnabled(false);
    return m;
  });

  let currentPowerKind = -1, currentPowerStrength = -1;
  root.setPowerGlow = (kind, strength = 1) => {
    if (kind === currentPowerKind && strength === currentPowerStrength) return;
    currentPowerKind = kind;
    currentPowerStrength = strength;
    const color = kind === 1
      ? B.Color3.FromHexString('#61ffe4')
      : kind === 2
      ? B.Color3.FromHexString('#ffb94c')
      : kind === 7
      ? B.Color3.FromHexString('#4acfff')
      : B.Color3.FromHexString('#cda0ff');

    powerTrailMat.emissiveColor = color;
    powerTrails.forEach((m, i) => {
      m.setEnabled([2, 7, 8].includes(kind) && strength >= 1);
      m.position.set((i % 2 ? 1 : -1) * (0.28 + Math.floor(i / 2) * 0.12), kind === 7 ? 0.3 + i * 0.32 : 0.02, kind === 7 ? 1.5 : 2 + i * 0.4);
      m.scaling.set(0.06, kind === 7 ? 0.22 : 0.05, kind === 7 ? 0.25 : 1.5 + i * 0.3);
    });

    bodyMat.emissiveColor = kind ? color.scale(0.65 * strength) : bodyMat.diffuseColor.scale(0.06);
    deckMat.emissiveColor = kind ? color.scale(0.9 * strength) : deckMat.diffuseColor.scale(0.12);

    tikiAura.setEnabled(kind === 1);
    const isTurbo = kind === 2;
    rocketThrusterL.setEnabled(isTurbo);
    rocketThrusterR.setEnabled(isTurbo);
  };

  root.disposeAvatar = () => {
    root.dispose();
    materials.forEach(m => m.dispose());
    textures.forEach(t => t.dispose());
  };

  root.animate(0);
  return root;
}

// 2D Previews with distinct silhouettes for shop and ranking
export function previewSvg(character, board, isBoard = false) {
  const color = isBoard ? boardColors[board] : characterColors[character];
  const border = borderColor(color);

  let drawing = '';
  if (isBoard) {
    if (board === 0) {
      // Sharp competition
      drawing = `<path d="M80 10L135 60L125 215L80 205L35 215L25 60Z" fill="${color}" stroke="${border}" stroke-width="5"/><path d="M80 20V195" stroke="#fff" stroke-width="4"/>`;
    } else if (board === 1) {
      // Swallow tail
      drawing = `<path d="M80 12C35 45 35 175 40 215L80 185L120 215C125 175 125 45 80 12Z" fill="${color}" stroke="${border}" stroke-width="5"/><circle cx="80" cy="165" r="10" fill="#fff"/>`;
    } else if (board === 2) {
      // Solar wing
      drawing = `<path d="M80 15C45 45 40 180 80 220C120 180 115 45 80 15Z" fill="${color}" stroke="${border}" stroke-width="5"/><path d="M25 110L42 125M135 110L118 125" stroke="${border}" stroke-width="6"/>`;
    } else if (board === 3) {
      // Hexagonal prism
      drawing = `<polygon points="80,12 128,55 124,185 80,218 36,185 32,55" fill="${color}" stroke="${border}" stroke-width="5"/><line x1="68" y1="35" x2="68" y2="195" stroke="#fff" stroke-width="3"/><line x1="92" y1="35" x2="92" y2="195" stroke="#fff" stroke-width="3"/>`;
    } else {
      // Cloud cruiser
      drawing = `<path d="M80 18C25 50 30 185 80 215C130 185 135 50 80 18Z" fill="${color}" stroke="${border}" stroke-width="5"/><path d="M50 70Q80 95 110 70" fill="none" stroke="#fff" stroke-width="4"/>`;
    }
  } else {
    drawing = `<g stroke="${border}" stroke-width="15" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M80 82L78 132M80 91L58 116L42 130M80 91L105 110L124 115M78 132L62 163L56 202M78 132L94 161L107 196"/></g><g stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M80 82L78 132M80 91L58 116L42 130M80 91L105 110L124 115M78 132L62 163L56 202M78 132L94 161L107 196"/></g><ellipse cx="80" cy="62" rx="18" ry="22" fill="${color}" stroke="${border}" stroke-width="3"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 235" aria-hidden="true">${drawing}</svg>`;
}

export function raceAvatarSvg(character = 0, board = 0) {
  const c = characterColors[character] || characterColors[0];
  const b = boardColors[board] || boardColors[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true"><path d="M8 87Q40 65 94 78Q72 103 8 87" fill="${b}" stroke="${borderColor(b)}" stroke-width="3"/><path d="M15 89Q50 80 87 81" fill="none" stroke="#fff" stroke-width="2"/><g fill="none" stroke="${borderColor(c)}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M52 33L44 57L28 68L28 82M44 57L62 68L76 80M49 41L29 43L17 35M49 41L66 43L81 35"/></g><g fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M52 33L44 57L28 68L28 82M44 57L62 68L76 80M49 41L29 43L17 35M49 41L66 43L81 35"/></g><circle cx="55" cy="21" r="11" fill="${c}" stroke="${borderColor(c)}" stroke-width="2"/></svg>`;
}
