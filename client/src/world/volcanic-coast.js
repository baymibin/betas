import {trackFrame} from '../shared/track.js';
import {LAP_LENGTH} from '../shared/course.js';

// Visual scenery only. All meshes are strictly outside the playable racing ribbon.
export function buildVolcanicCoast(B, scene, sand, kind = 'tropical', mapId = 0) {
  const batches = new Map(), animatedWaves = [], animatedWaterfalls = [], crownCards=[], foliageCards=[];

  function mat(name, hex, emit = 0.08, spec = 0.08) {
    const m = new B.StandardMaterial('env-' + name, scene);
    m.diffuseColor = B.Color3.FromHexString(hex);
    m.emissiveColor = m.diffuseColor.scale(emit);
    m.specularColor = new B.Color3(spec, spec, spec);
    m.backFaceCulling = false;
    batches.set(m, []);
    return m;
  }

  // Color Palette specifically tailored to match Image B's vibrant tropical aesthetic
  const cliffRock = mat('cliff-rock', '#edeae4', 0.03, 0.04);
  const cliffHighlight = mat('cliff-highlight', '#d4cbbd', 0.03, 0.05);
  const cliffAlbedo = new B.Texture('./assets/images/environment/cliff-albedo.webp',scene);
  cliffAlbedo.wrapU=cliffAlbedo.wrapV=B.Texture.WRAP_ADDRESSMODE;
  cliffAlbedo.anisotropicFilteringLevel=4;
  cliffRock.diffuseTexture=cliffAlbedo;
  cliffHighlight.diffuseTexture=cliffAlbedo;
  const jungleCanopy = mat('jungle-canopy', '#438b39', 0.18, 0.04);
  const jungleLight = mat('jungle-light', '#86b945', 0.22, 0.05);
  const jungleEmerald = mat('jungle-emerald', '#1e5f2a', 0.14, 0.03);

  const palmTrunk = mat('palm-trunk', '#9e6d3a', 0.14, 0.05);
  const palmRing = mat('palm-ring', '#baa078', 0.16, 0.04);
  const palmLeafTop = mat('palm-leaf-top', '#63a62e', 0.08, 0.08); // Sunlit vibrant lime
  const palmLeafBottom = mat('palm-leaf-bottom', '#398936', 0.08, 0.04); // Deep tropical emerald
  const coconutMat = mat('coconut', '#4a3319', 0.12, 0.08);
  const crownTexture=new B.Texture('./assets/images/environment/palm-crown.webp',scene);
  crownTexture.hasAlpha=true;
  const crownMaterial=new B.StandardMaterial('env-palm-crown',scene);
  crownMaterial.diffuseTexture=crownTexture;
  crownMaterial.opacityTexture=crownTexture;
  crownMaterial.backFaceCulling=false;
  crownMaterial.specularColor=B.Color3.Black();
  crownMaterial.transparencyMode=B.Material.MATERIAL_ALPHATEST;
  crownMaterial.alphaCutOff=.30;

  const beachSandMat = mat('golden-sand', '#fed68f', 0.16, 0.04);
  const islandSandTexture=new B.Texture('./assets/images/environment/painted-sand-v2.webp',scene);
  islandSandTexture.wrapU=islandSandTexture.wrapV=B.Texture.WRAP_ADDRESSMODE;
  islandSandTexture.anisotropicFilteringLevel=4;
  beachSandMat.diffuseTexture=islandSandTexture;
  const wetSandMat = mat('wet-sand', '#caa160', 0.22, 0.35); // Glossy wet sand along shoreline
  const beachBoulder = mat('beach-boulder', '#d9d3ca', 0.06, 0.04);
  const beachStoneLight = mat('stone-light', '#f0e9d9', 0.05, 0.05);
  beachBoulder.diffuseTexture=cliffAlbedo;
  beachStoneLight.diffuseTexture=cliffAlbedo;

  // Underwater rocks & seabed visible through crystal-clear water (exact match for Image B)
  const coral = mapId === 0;
  // Bahia Coral: a sandy turquoise bed and darker reef stones so the clear
  // water keeps its saturation instead of turning milky.
  const underwaterSeabed = mat('underwater-sand', coral ? '#2a8fb6' : '#91c9b0', coral ? 0.12 : 0.08, 0.04);
  const underwaterRock = mat('submerged-rock', coral ? '#3f7f86' : '#b4d5c3', 0.11, 0.08);
  const underwaterRockDeep = mat('submerged-rock-deep', coral ? '#2f6570' : '#9bc6b7', 0.10, 0.06);
  underwaterRock.diffuseTexture=cliffAlbedo;
  underwaterRockDeep.diffuseTexture=cliffAlbedo;

  const pureWhiteFoam = mat('pure-white-foam', '#ffffff', 0.45, 0.15);
  const waterSplash = mat('water-splash', '#e8fdff', 0.65, 0.10);

  // Props: Umbrellas, loungers, flowers, starfish
  const umbrellaRed = mat('umbrella-red', '#e53935', 0.32, 0.12);
  const umbrellaBlue = mat('umbrella-blue', '#1e88e5', 0.32, 0.12);
  const umbrellaWhite = mat('umbrella-white', '#fcfaf5', 0.40, 0.06);
  const woodLounger = mat('teak-wood', '#9c6633', 0.16, 0.06);
  const hibiscusCoral = mat('hibiscus-red', '#ff3d57', 0.38, 0.10);
  const flowerYellow = mat('flower-yellow', '#ffd033', 0.42, 0.10);
  const starfishMat = mat('starfish-orange', '#ff6d00', 0.36, 0.08);
  const seashellMat = mat('seashell-ivory', '#fff0dc', 0.35, 0.12);

  // Soft contact shadows
  const contact = mat('contact-shadow', '#48686d');
  contact.alpha = 0.22;
  contact.disableLighting = true;
  contact.backFaceCulling = false;

  // ---- Bahia Coral art kit (only built for map 0) -------------------------
  let strataRock=null, jungleCardMat=null, flowerCardMat=null, waterfallMat=null, lagoonMist=null;
  const coralLeafMats=[];
  if(coral){
    // Blocky painted rock (cliff-albedo) reads like the reference cliffs.
    strataRock=mat('coral-cliff-rock','#d6d1c8',0.22,0.05);strataRock.diffuseTexture=cliffAlbedo;
    const cardMaterial=(name,path,cut)=>{
      const t=new B.Texture(path,scene);t.hasAlpha=true;
      const m=new B.StandardMaterial(name,scene);
      m.diffuseTexture=t;m.opacityTexture=t;m.specularColor=B.Color3.Black();
      m.emissiveColor=new B.Color3(.22,.25,.18);m.backFaceCulling=false;
      m.transparencyMode=B.Material.MATERIAL_ALPHATEST;m.alphaCutOff=cut;
      batches.set(m,[]);return m;
    };
    // Copa de selva generada (generate-mountain-textures.py) para la cima de los acantilados.
    jungleCardMat=cardMaterial('env-coral-jungle-card','./assets/images/environment/vegetation/cliff-canopy.png',.4);
    flowerCardMat=cardMaterial('env-coral-flower-card','./assets/images/environment/tropical-foliage.png',.28);
    coralLeafMats.push(mat('coral-leaf-lime','#8cc63f',0.12,0.10),mat('coral-leaf-green','#4fa03a',0.10,0.08),mat('coral-leaf-deep','#2f7d3a',0.10,0.06));
    const flow=new B.Texture('./assets/images/environment/waterfalls/waterfall-flow.webp',scene);
    flow.hasAlpha=true;flow.wrapV=B.Texture.WRAP_ADDRESSMODE;flow.vScale=2.2;
    waterfallMat=new B.StandardMaterial('env-coral-waterfall',scene);
    waterfallMat.diffuseTexture=flow;waterfallMat.opacityTexture=flow;
    waterfallMat.emissiveColor=new B.Color3(.62,.78,.86);waterfallMat.specularColor=B.Color3.Black();
    waterfallMat.backFaceCulling=false;waterfallMat.disableLighting=false;
    lagoonMist=new B.Texture('./assets/images/environment/particles/splash-droplet.png',scene);
    lagoonMist.hasAlpha=true;
  }
  // Card facing the course: width runs along the track tangent at distance d.
  // Three crossed canopy cards so the vegetation never collapses into a line.
  function canopyCluster(d,lateral,y,width,height){
    for(const turn of [0,Math.PI/3,-Math.PI/3]){
      const c=card(jungleCardMat,d,lateral,y,width*(turn?0.8:1),height);
      c.rotation.y+=turn;
    }
  }
  function card(material,d,lateral,y,width,height,list){
    const p=trackFrame(d,lateral);
    const c=B.MeshBuilder.CreatePlane('coral-card',{width,height,sideOrientation:B.Mesh.DOUBLESIDE},scene);
    c.position.set(p.x,y+height*.5,p.z);c.rotation.y=Math.atan2(p.rx,p.rz)+Math.PI/2;
    c.material=material;c.isPickable=false;c.checkCollisions=false;
    batches.get(material).push(c);return c;
  }

  function put(mesh, m) {
    mesh.material = m;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    batches.get(m).push(mesh);
    return mesh;
  }

  function shade(x, y, z, size) {
    const m = B.MeshBuilder.CreateDisc('soft-shadow', {radius: size, tessellation: 16}, scene);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y + 0.016, z);
    put(m, contact);
  }

  // -------------------------------------------------------------------------
  // 1. UNDERWATER SEABED & SUBMERGED BOULDERS (Crucial for Image B's depth)
  // -------------------------------------------------------------------------
  // Smooth sloping seabed ribbon
  const seabedOffsets = [-12.5, -6.0, 0.0, 8.0, 18.0, 36.0, 68.0];
  const seabedPaths = seabedOffsets.map(x => Array.from({length: 241}, (_, i) => {
    const p = trackFrame(i * 4, x);
    const depth = x < -10 ? -0.45 : (x < 4 ? -0.95 : -1.35);
    return new B.Vector3(p.x, depth, p.z);
  }));
  const seafloor = B.MeshBuilder.CreateRibbon('visible-seafloor', {pathArray: seabedPaths, sideOrientation: B.Mesh.DOUBLESIDE}, scene);
  put(seafloor, underwaterSeabed);

  // Submerged smooth river stones: Placed strictly on the bottom corners of view
  // (Underwater depth ~0.35m beneath surface y=0, completely submerged)
  const underwaterBoulders = [
    // Bottom-Left cluster (as seen in lower-left of Image B)
    {dist: 2,  xOff: 10.8, y: -0.96, sx: 1.5, sy: 0.42, sz: 1.3, mat: underwaterRock},
    {dist: 5,  xOff: 11.3, y: -0.98, sx: 1.8, sy: 0.46, sz: 1.5, mat: underwaterRockDeep},
    {dist: 9,  xOff: 10.6, y: -1.02, sx: 1.3, sy: 0.38, sz: 1.1, mat: underwaterRock},
    // Bottom-Right cluster (as seen in lower-right of Image B)
    {dist: 3,  xOff: -10.4, y: -0.96, sx: 1.5, sy: 0.40, sz: 1.3, mat: underwaterRock},
    {dist: 6,  xOff: -11.1, y: -0.99, sx: 1.7, sy: 0.43, sz: 1.5, mat: underwaterRockDeep},
    {dist: 10, xOff: -10.7, y: -1.01, sx: 1.3, sy: 0.38, sz: 1.1, mat: underwaterRock}
  ];

  for (let i = 0; i < underwaterBoulders.length; i++) {
    const b = underwaterBoulders[i];
    const p = trackFrame(b.dist, b.xOff);
    const rock = B.MeshBuilder.CreateIcoSphere('underwater-boulder-' + i, {radius: 1, subdivisions: 2, flat: true}, scene);
    rock.position.set(p.x, b.y, p.z);
    rock.scaling.set(b.sx, b.sy, b.sz);
    put(rock, b.mat);
  }

  // Periodic submerged pebbles along shallow margins (fully underwater)
  for (let i = 0; i < 45; i++) {
    const d = (i * 22) % LAP_LENGTH;
    const lateral = (i % 2 === 0 ? 10.8 : -10.8);
    const p = trackFrame(d, lateral);
    const m = B.MeshBuilder.CreateIcoSphere('submerged-stone-' + i, {radius: 0.8, subdivisions: 1, flat: true}, scene);
    m.position.set(p.x, -0.85, p.z);
    m.scaling.set(1.2, 0.45, 1.3);
    put(m, i % 2 ? underwaterRock : underwaterRockDeep);
  }

  // -------------------------------------------------------------------------
  // 2. WET SHORELINE STRIP & BEACH BOULDERS
  // -------------------------------------------------------------------------
  // Glossy wet sand strip along the beach edge (x = -11.9 to -14.5)
  const wetStripPaths = [-11.9, -13.2, -14.5].map(x => Array.from({length: 241}, (_, i) => {
    const p = trackFrame(i * 4, x);
    const y = 0.08 + Math.max(0, -x - 11.9) * 0.18;
    return new B.Vector3(p.x, y, p.z);
  }));
  const wetSandStrip = B.MeshBuilder.CreateRibbon('wet-sand-strip', {pathArray: wetStripPaths, sideOrientation: B.Mesh.DOUBLESIDE}, scene);
  put(wetSandStrip, wetSandMat);

  // Thin broken foam follows the existing lane edge. It is visual only.
  const edgeFoam=mat('edge-foam','#e7fcfa',.17,.08);
  edgeFoam.alpha=.58;
  for(const lateral of [-12.05]){
    const paths=[0,1].map(side=>Array.from({length:481},(_,i)=>{
      const d=i*LAP_LENGTH/480;
      const variation=.25*Math.sin(d*.19)+.13*Math.sin(d*.53);
      const x=lateral+(lateral<0?-1:1)*(side===0?.1:.55+variation);
      const p=trackFrame(d,x);
      return new B.Vector3(p.x,.075,p.z);
    }));
    put(B.MeshBuilder.CreateRibbon('shore-break-foam',{pathArray:paths,sideOrientation:B.Mesh.DOUBLESIDE},scene),edgeFoam);
  }

  // Coastal granite boulders along the sand (natural sizes, matching Image B)
  const shoreBoulders = [
    {dist: 8,   x: -18.5, s: 1.4, h: 1.1, mat: beachBoulder},
    {dist: 16,  x: -19.2, s: 1.6, h: 1.2, mat: beachStoneLight},
    {dist: 28,  x: -18.8, s: 1.5, h: 1.0, mat: beachBoulder},
    {dist: 48,  x: -24.5, s: 1.8, h: 1.3, mat: beachStoneLight},
    {dist: 72,  x: -20.0, s: 1.7, h: 1.2, mat: beachBoulder},
    {dist: 120, x: -19.5, s: 1.6, h: 1.1, mat: beachStoneLight}
  ];

  for (let i = 0; i < shoreBoulders.length; i++) {
    const sb = shoreBoulders[i];
    const p = trackFrame(sb.dist, sb.x);
    const sandY = 0.14 + (-sb.x - 11.9) * 0.22;
    const bMesh = B.MeshBuilder.CreateSphere('shore-boulder-' + i, {diameter: 2, segments: 10}, scene);
    bMesh.position.set(p.x, sandY + sb.h * 0.25, p.z);
    bMesh.scaling.set(sb.s, sb.h, sb.s * 0.9);
    put(bMesh, sb.mat);
    shade(p.x, sandY, p.z, sb.s * 1.1);
  }

  // -------------------------------------------------------------------------
  // 3. LUSH TROPICAL PALM TREES (Curved trunks, rich fronds, coconuts)
  // -------------------------------------------------------------------------
  function createVolumetricPalm(x, y, z, height, leanAngle, seed) {
    // 7-segment curved trunk leaning toward ocean
    const trunkCurve = 1.1 + Math.sin(seed) * 0.4;
    const path = Array.from({length: 8}, (_, i) => {
      const t = i / 7;
      return new B.Vector3(
        x + Math.sin(leanAngle) * trunkCurve * (t * t),
        y + height * t,
        z + Math.cos(leanAngle) * trunkCurve * (t * t)
      );
    });

    const trunk = B.MeshBuilder.CreateTube('curved-trunk', {
      path,
      radiusFunction: i => 0.34 - i * 0.022,
      tessellation: 10,
      cap: B.Mesh.CAP_ALL
    }, scene);
    put(trunk, palmTrunk);
    shade(x, y, z, 1.4);

    // Decorative bark rings
    for (let k = 1; k < 7; k++) {
      const ring = B.MeshBuilder.CreateTorus('trunk-ring', {
        diameter: 0.65 - k * 0.038,
        thickness: 0.035,
        tessellation: 10
      }, scene);
      ring.position.copyFrom(path[k]);
      put(ring, palmRing);
    }

    const crownPos = path[7];
    const crownCard=B.MeshBuilder.CreatePlane('palm-leaf-detail',{width:8.0,height:5.3},scene);
    crownCard.position.set(crownPos.x,crownPos.y-.7,crownPos.z);
    crownCard.billboardMode=B.Mesh.BILLBOARDMODE_Y;
    crownCard.material=crownMaterial;
    crownCard.isPickable=false;
    crownCard.checkCollisions=false;
    crownCards.push(crownCard);

    // Hanging coconut cluster
    for (let c = 0; c < 4; c++) {
      const ca = c * (Math.PI / 2) + 0.3;
      const coco = B.MeshBuilder.CreateSphere('coco', {diameter: 0.48, segments: 8}, scene);
      coco.position.set(
        crownPos.x + Math.cos(ca) * 0.32,
        crownPos.y - 0.22,
        crownPos.z + Math.sin(ca) * 0.32
      );
      coco.scaling.set(0.85, 1.1, 0.85);
      put(coco, coconutMat);
    }

    // 12-14 Layered Tropical Palm Fronds (Top sunlit lime, lower deep emerald)
    const frondCount = coral ? 15 : 13;
    for (let f = 0; f < frondCount; f++) {
      const a = (f * Math.PI * 2) / frondCount + seed;
      const frondLen = 3.1 + (f % 3) * 0.5;
      const isTopTier = f % 2 === 0;

      const positions = [], indices = [], normals = [];
      const segments = 9;

      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        // Natural curved arch with drooping tip
        const arch = Math.sin(t * Math.PI) * (isTopTier ? 1.0 : 0.6) - (t * t) * (isTopTier ? 1.6 : 2.1);
        const leaflet = s === 0 || s === segments ? 1 : (s % 2 ? 0.66 : 1.0);
        const width = Math.sin(t * Math.PI) * 1.3 * leaflet + 0.02;

        const cx = crownPos.x + Math.cos(a) * frondLen * t;
        const cy = crownPos.y + arch;
        const cz = crownPos.z + Math.sin(a) * frondLen * t;

        // V-shaped frond profile
        const perpX = -Math.sin(a) * width * 0.5;
        const perpZ = Math.cos(a) * width * 0.5;

        // Left edge, spine, right edge
        positions.push(cx - perpX, cy - width * 0.15, cz - perpZ);
        positions.push(cx, cy, cz);
        positions.push(cx + perpX, cy - width * 0.15, cz + perpZ);
      }

      for (let s = 0; s < segments; s++) {
        const base = s * 3;
        // Two triangles for left flap
        indices.push(base, base + 3, base + 1);
        indices.push(base + 1, base + 3, base + 4);
        // Two triangles for right flap
        indices.push(base + 1, base + 4, base + 2);
        indices.push(base + 2, base + 4, base + 5);
      }

      B.VertexData.ComputeNormals(positions, indices, normals);
      const data = new B.VertexData();
      data.positions = positions;
      data.indices = indices;
      data.normals = normals;
      data.uvs = new Array((positions.length / 3) * 2).fill(0);

      const frondMesh = new B.Mesh('volumetric-frond', scene);
      data.applyToMesh(frondMesh);
      if (coral) {
        const tone = (Math.floor(Math.abs(seed) * 7) + f) % 5;
        put(frondMesh, isTopTier ? coralLeafMats[tone < 3 ? 0 : 1] : coralLeafMats[tone < 2 ? 1 : 2]);
      } else put(frondMesh, isTopTier ? palmLeafTop : palmLeafBottom);
    }
  }

  // Shore palms standing on the beach berm
  for (let i = 0; i < 78; i++) {
    const d = (i * LAP_LENGTH) / 78 + 4;
    const lateral = -17 - (i % 3) * 2.8;
    const p = trackFrame(d, lateral);
    const sandY = 0.12 + (-lateral - 11.9) * 0.22;
    const lean = 0.3 + (i % 5) * 0.15;
    createVolumetricPalm(p.x, sandY, p.z, 6.2 + (i % 4) * 0.7, lean, i * 0.8);
  }

  // -------------------------------------------------------------------------
  // 4. TROPICAL FLORA, BUSHES & STARFISH ON THE BEACH
  // -------------------------------------------------------------------------
  // Stylized broadleaf plant (banana/elephant-ear style) for Bahia Coral.
  function broadleafPlant(x, y, z, s, seed) {
    const leaves = 9;
    for (let l = 0; l < leaves; l++) {
      const a = seed * 1.7 + l * (Math.PI * 2 / leaves) + Math.sin(l * 3.1 + seed) * .25;
      const len = s * (1.05 + .35 * ((l * 7 + Math.floor(seed)) % 3) / 2);
      const lift = .55 + .35 * ((l + Math.floor(seed)) % 3) / 2;
      const positions = [], indices = [], normals = [];
      const seg = 6;
      for (let k = 0; k <= seg; k++) {
        const t = k / seg;
        const w = Math.sin(t * Math.PI) * .38 * s + .01;
        const r = len * t;
        const h = y + .12 + Math.sin(t * 1.9) * lift * s - t * t * .55 * s;
        const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
        const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
        positions.push(cx - px, h - w * .22, cz - pz, cx, h + .03, cz, cx + px, h - w * .22, cz + pz);
      }
      for (let k = 0; k < seg; k++) {
        const b = k * 3;
        indices.push(b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 1, b + 4, b + 2, b + 2, b + 4, b + 5);
      }
      B.VertexData.ComputeNormals(positions, indices, normals);
      const vd = new B.VertexData(); vd.positions = positions; vd.indices = indices; vd.normals = normals;
      vd.uvs = new Array(positions.length / 3 * 2).fill(0);
      const leaf = new B.Mesh('broadleaf', scene); vd.applyToMesh(leaf);
      put(leaf, coralLeafMats[(((l + Math.floor(seed)) % 3) + 3) % 3]);
    }
    if (Math.floor(seed) % 2 === 0) {
      for (let f = 0; f < 3; f++) {
        const fa = seed + f * 2.1, fr = s * .45;
        for (let petal = 0; petal < 5; petal++) {
          const pa = petal * 6.283 / 5;
          const fl = B.MeshBuilder.CreateSphere('hibiscus-petal', {diameter: .34, segments: 5}, scene);
          fl.position.set(x + Math.cos(fa) * fr + Math.cos(pa) * .13, y + s * .75, z + Math.sin(fa) * fr + Math.sin(pa) * .13);
          fl.scaling.set(.85, .36, .85); put(fl, f % 2 ? flowerYellow : hibiscusCoral);
        }
      }
    }
    shade(x, y, z, s * 1.2);
  }

  function tropicalBush(x, y, z, s = 1.2) {
    if (coral) { broadleafPlant(x, y, z, s * 1.05, x * .13 + z * .07); return; }
    for (let i = 0; i < 5; i++) {
      const a = i * 1.25;
      const sh = B.MeshBuilder.CreateIcoSphere('shrub', {radius: 1, subdivisions: 2, flat: true}, scene);
      sh.position.set(x + Math.cos(a) * s * 0.5, y + s * 0.45 + (i === 4 ? s * 0.35 : 0), z + Math.sin(a) * s * 0.5);
      sh.scaling.set(s * 0.65, s * 0.55, s * 0.65);
      put(sh, i % 2 === 0 ? jungleCanopy : jungleLight);
    }
    // Broad coral hibiscus petals read from the player's camera distance.
    for(let petal=0;petal<5;petal++){
      const a=petal*6.283/5;
      const fl=B.MeshBuilder.CreateSphere('hibiscus-petal',{diameter:.52,segments:6},scene);
      fl.position.set(x+Math.cos(a)*.20,y+s*1.0,z+Math.sin(a)*.20);
      fl.scaling.set(.85,.38,.85);
      put(fl,hibiscusCoral);
    }
    const flowerCenter=B.MeshBuilder.CreateSphere('hibiscus-center',{diameter:.19,segments:6},scene);
    flowerCenter.position.set(x,y+s*1.04,z);put(flowerCenter,flowerYellow);
    shade(x, y, z, s * 1.1);
  }

  const foliageTexture=new B.Texture('./assets/images/environment/tropical-foliage.png',scene);
  foliageTexture.hasAlpha=true;
  const foliageMaterial=new B.StandardMaterial('env-flowering-foliage',scene);
  foliageMaterial.diffuseTexture=foliageTexture;
  foliageMaterial.opacityTexture=foliageTexture;
  foliageMaterial.emissiveColor=new B.Color3(.17,.20,.13);
  foliageMaterial.specularColor=B.Color3.Black();
  foliageMaterial.backFaceCulling=false;
  foliageMaterial.transparencyMode=B.Material.MATERIAL_ALPHATEST;
  foliageMaterial.alphaCutOff=.25;

  for (let i = 0; i < 85; i++) {
    const d = (i * 12 + 6) % LAP_LENGTH;
    const lateral = -16 - (i % 4) * 2.2;
    const p = trackFrame(d, lateral);
    const sandY = 0.12 + (-lateral - 11.9) * 0.22;
    const bushSize=1.1+(i%3)*.35;
    tropicalBush(p.x,sandY,p.z,bushSize);
    if(i%2===0){
      const width=5.0+(i%4)*.6;
      const foliage=B.MeshBuilder.CreatePlane('flowering-foliage',{width,height:width*.48},scene);
      foliage.position.set(p.x,sandY+width*.24,p.z);
      foliage.billboardMode=B.Mesh.BILLBOARDMODE_Y;
      foliage.material=foliageMaterial;
      foliage.isPickable=false;
      foliage.checkCollisions=false;
      foliageCards.push(foliage);
    }
  }

  // Starfish and seashells scattered on the golden sand
  for (let i = 0; i < 65; i++) {
    const d = (i * 15 + 2) % LAP_LENGTH;
    const lateral = -13.5 - (i % 3) * 1.1;
    const p = trackFrame(d, lateral);
    const sandY = 0.10 + (-lateral - 11.9) * 0.22;

    if (i % 2 === 0) {
      // Starfish with 5 arms
      for (let a = 0; a < 5; a++) {
        const ang = a * ((Math.PI * 2) / 5);
        const arm = B.MeshBuilder.CreateBox('star-arm', {width: 0.12, height: 0.05, depth: 0.32}, scene);
        arm.position.set(p.x + Math.cos(ang) * 0.16, sandY + 0.03, p.z + Math.sin(ang) * 0.16);
        arm.rotation.y = -ang;
        put(arm, starfishMat);
      }
    } else {
      // Shell
      const shell = B.MeshBuilder.CreateSphere('shell', {diameter: 0.28, segments: 6}, scene);
      shell.position.set(p.x, sandY + 0.04, p.z);
      shell.scaling.set(1.0, 0.4, 0.8);
      put(shell, seashellMat);
    }
  }

  if(coral){
    // Grey granite boulder groups with planted gaps, like the reference beach.
    for(let i=0;i<26;i++){
      const d=(i*37+11)%LAP_LENGTH,lateral=-19-(i%3)*2.6;
      const p=trackFrame(d,lateral),sandY=.12+(-lateral-11.9)*.22;
      for(let k=0;k<3;k++){
        const rr=.9+((i+k)%3)*.45,a=k*2.1+i;
        const rock=B.MeshBuilder.CreateIcoSphere('beach-granite',{radius:rr,subdivisions:1,flat:true},scene);
        const q=trackFrame(d+Math.cos(a)*1.4,lateral+Math.sin(a)*1.1);
        rock.position.set(q.x,sandY+rr*.35,q.z);rock.scaling.set(1.25,.8+(k%2)*.3,1.05);rock.rotation.y=a;
        put(rock,strataRock);
      }
      broadleafPlant(p.x,sandY,p.z,1.0+(i%3)*.25,i+.3);
      shade(p.x,sandY,p.z,2.6);
    }
    // Low cumulus banks around the bay horizon (reuses the sky cloud sprite).
    const cloudMat=scene.getMaterialByName('tropical-cumulus-mat');
    if(cloudMat){
      for(let i=0;i<10;i++){
        const a=i/10*Math.PI*2+.2,rad=330+(i%3)*45;
        const c=B.MeshBuilder.CreatePlane('coral-cumulus',{width:150+(i%4)*30,height:56+(i%3)*12},scene);
        c.position.set(Math.cos(a)*rad,34+(i%4)*9,Math.sin(a)*rad*.85);
        c.billboardMode=B.Mesh.BILLBOARDMODE_ALL;c.material=cloudMat;c.isPickable=false;c.applyFog=false;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. RESORT PARASOLS & TEAK SUN LOUNGERS (Vibrant Stripes as in Image B)
  // -------------------------------------------------------------------------
  for (let i = 0; i < 22; i++) {
    const d = (i * 44 + 14) % LAP_LENGTH;
    const lateral = -16.5 - (i % 2) * 2.5;
    const p = trackFrame(d, lateral);
    const sandY = 0.14 + (-lateral - 11.9) * 0.22;
    const poleH = 2.9;

    // Wooden pole
    const pole = B.MeshBuilder.CreateCylinder('pole', {height: poleH, diameter: 0.10, tessellation: 8}, scene);
    pole.position.set(p.x, sandY + poleH * 0.5, p.z);
    put(pole, woodLounger);

    // 8-Segment Canopy with Alternating Bold Stripes (Red/White or Blue/White)
    const stripeColor = i % 2 === 0 ? umbrellaRed : umbrellaBlue;
    for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI) / 4;
      const b = ((j + 1) * Math.PI) / 4;
      const rad = 2.4;

      const positions = [
        p.x, sandY + poleH + 0.45, p.z,
        p.x + Math.cos(a) * rad, sandY + poleH, p.z + Math.sin(a) * rad,
        p.x + Math.cos(b) * rad, sandY + poleH, p.z + Math.sin(b) * rad
      ];
      const indices = [0, 2, 1];
      const normals = [];
      B.VertexData.ComputeNormals(positions, indices, normals);

      const data = new B.VertexData();
      data.positions = positions;
      data.indices = indices;
      data.normals = normals;
      data.uvs = [0, 0, 0, 0, 0, 0];

      const panel = new B.Mesh('parasol-panel', scene);
      data.applyToMesh(panel);
      put(panel, j % 2 === 0 ? stripeColor : umbrellaWhite);
    }

    // Wooden Sun Lounger (tumbona) next to parasol
    const lounger = B.MeshBuilder.CreateBox('lounger', {width: 0.85, height: 0.18, depth: 2.1}, scene);
    lounger.position.set(p.x + 1.2, sandY + 0.35, p.z + 0.4);
    lounger.rotation.y = p.yaw;
    put(lounger, woodLounger);

    const backrest = B.MeshBuilder.CreateBox('backrest', {width: 0.85, height: 0.14, depth: 1.0}, scene);
    backrest.position.set(p.x + 1.2, sandY + 0.68, p.z - 0.7);
    backrest.rotation.x = 0.55;
    backrest.rotation.y = p.yaw;
    put(backrest, umbrellaWhite);

    shade(p.x, sandY, p.z, 2.0);
  }

  // -------------------------------------------------------------------------
  // 6. MAJESTIC TROPICAL MOUNTAIN BLUFFS & CASCADING WATERFALLS (Image B)
  // -------------------------------------------------------------------------
  // Coastal geology is built in course coordinates, never in camera coordinates.
  // Each outcrop is a compact group of tapering, irregular stone columns.
  function outcrop(x,y,z,r,h,seed){
    const mesh=B.MeshBuilder.CreateCylinder('coastal-rock',{height:h,diameterTop:r*1.25,diameterBottom:r*2,tessellation:9,subdivisions:4},scene);
    const pos=mesh.getVerticesData(B.VertexBuffer.PositionKind);
    for(let k=0;k<pos.length;k+=3){
      const a=Math.atan2(pos[k+2],pos[k]),t=(pos[k+1]/h+.5);
      const f=1+.12*Math.sin(a*3+seed)+.06*Math.cos(a*5+t*3+seed);
      pos[k]*=f;pos[k+2]*=f;
    }
    mesh.updateVerticesData(B.VertexBuffer.PositionKind,pos);
    mesh.convertToFlatShadedMesh();mesh.position.set(x,y+h/2,z);
    put(mesh,coral?strataRock:(seed%2?cliffHighlight:cliffRock));
    // A fitted, irregular turf cap reads as vegetation on the cliff, not a
    // floating row of wide green discs.
    const cap=B.MeshBuilder.CreateCylinder('cliff-turf',{height:.56,diameterTop:r*1.12,diameterBottom:r*1.20,tessellation:9},scene);
    const capPos=cap.getVerticesData(B.VertexBuffer.PositionKind);
    for(let k=0;k<capPos.length;k+=3){
      const a=Math.atan2(capPos[k+2],capPos[k]);
      const f=1+.07*Math.sin(a*3+seed)+.04*Math.cos(a*5-seed);
      capPos[k]*=f;capPos[k+2]*=f;
    }
    cap.updateVerticesData(B.VertexBuffer.PositionKind,capPos);
    cap.convertToFlatShadedMesh();cap.position.set(x,y+h+.04,z);
    put(cap,jungleCanopy);
    for(let j=0;j<3;j++){
      const a=seed+j*2.2;
      const tuft=B.MeshBuilder.CreateIcoSphere('cliff-shrub',{radius:1,subdivisions:1,flat:true},scene);
      tuft.position.set(x+Math.cos(a)*r*.32,y+h+.55,z+Math.sin(a)*r*.32);
      tuft.scaling.set(r*.11,.62,r*.11);
      put(tuft,j%2?jungleLight:jungleEmerald);
    }
    for(let j=0;j<3;j++){
      const a=seed+j*2.1;
      for(let k=0;k<4;k++){
        const vine=B.MeshBuilder.CreateSphere('hanging-leaves',{diameter:.7,segments:6},scene);
        vine.position.set(x+Math.cos(a)*r*.7,y+h-.5-k*.65,z+Math.sin(a)*r*.7);
        vine.scaling.set(.8,1.2-k*.16,.7);put(vine,jungleLight);
      }
    }
  }
  const coralWaterfalls=[],fallBases=[];
  function coralWaterfall(d,lateral,r,h){
    const top=3+h-.6, bottom=4.4, rows=12;
    const paths=[-1,1].map(side=>Array.from({length:rows+1},(_,k)=>{
      const t=k/rows, lat=lateral+r*(.64+.42*t)+.35;
      const q=trackFrame(d+side*(2.3+.9*t),lat);
      return new B.Vector3(q.x,top-(top-bottom)*t,q.z);
    }));
    const fall=B.MeshBuilder.CreateRibbon('coral-waterfall',{pathArray:paths,sideOrientation:B.Mesh.DOUBLESIDE},scene);
    // Double-sided ribbons duplicate their vertices: repeat the UV layout per face.
    const uv=[];for(let side=0;side<2;side++)for(let k=0;k<=rows;k++)uv.push(side,k/rows);
    const copies=fall.getTotalVertices()/(uv.length/2);
    fall.setVerticesData(B.VertexBuffer.UVKind,Array.from({length:copies},()=>uv).flat());
    fall.material=waterfallMat;fall.isPickable=false;fall.checkCollisions=false;
    const base=trackFrame(d,lateral+r*1.08+.4);
    const pool=B.MeshBuilder.CreateDisc('coral-fall-pool',{radius:2.2,tessellation:18},scene);
    pool.rotation.x=Math.PI/2;pool.position.set(base.x,bottom+.05,base.z);pool.scaling.set(1,1.4,1);
    put(pool,pureWhiteFoam);
    fallBases.push(new B.Vector3(base.x,bottom+.2,base.z));
    coralWaterfalls.push(fall);
    return fall;
  }
  // Layered low-poly ranges: individual faceted peaks (green jungle slopes,
  // rock shoulders) that fade into aerial haze with distance.
  function coralRange(offset,baseHeight,amplitude,haze,seed,count){
    const hazeColor=new B.Color3(.58,.78,.92);
    for(let i=0;i<count;i++){
      const u=(i+.5*Math.sin(i*2.3+seed))/count;
      const d=u*LAP_LENGTH;
      const h=baseHeight*(.55+.45*Math.abs(Math.sin(i*1.37+seed)))+amplitude*Math.pow(Math.abs(Math.sin(i*.61+seed*1.9)),3);
      const w=h*(.9+.5*Math.abs(Math.cos(i*.9+seed)));
      const q=trackFrame(d,offset-(i%3)*9);
      const peak=B.MeshBuilder.CreateCylinder('coral-peak',{height:h,diameterTop:w*.08,diameterBottom:w*1.9,tessellation:7,subdivisions:4},scene);
      const pos=peak.getVerticesData(B.VertexBuffer.PositionKind);
      for(let k=0;k<pos.length;k+=3){
        const a=Math.atan2(pos[k+2],pos[k]),t=pos[k+1]/h+.5;
        const f=1+.22*Math.sin(a*2+i+seed)+.12*Math.sin(a*5-i)+.10*Math.sin(t*9+a*3);
        pos[k]*=f;pos[k+2]*=f;pos[k+1]+=Math.sin(a*3+i)*h*.03*(1-t);
      }
      peak.updateVerticesData(B.VertexBuffer.PositionKind,pos);
      peak.convertToFlatShadedMesh();
      const P=peak.getVerticesData(B.VertexBuffer.PositionKind),Nn=peak.getVerticesData(B.VertexBuffer.NormalKind),col=[];
      for(let v=0;v<P.length;v+=9){
        const y=(P[v+1]+P[v+4]+P[v+7])/3/h+.5,ny=(Nn[v+1]+Nn[v+4]+Nn[v+7])/3;
        const n=Math.sin(P[v]*.9+P[v+2]*.7+i)*.5+.5;
        // Color from the texture; vertex colour keeps low-poly facet shading.
        let c=new B.Color3(1,1,1).scale(.74+.34*Math.max(0,ny)+.06*(n-.5));
        c=B.Color3.Lerp(c,hazeColor,haze);
        for(let k=0;k<3;k++)col.push(c.r,c.g,c.b,1);
      }
      peak.setVerticesData(B.VertexBuffer.ColorKind,col);
      peak.position.set(q.x,-2+h/2,q.z);peak.rotation.y=i*1.3+seed;
      put(peak,rangeMat);
    }
  }
  const rangeMat=coral?mat('coral-range','#ffffff',0.12,0):null;
  if(rangeMat){
    // Roca facetada con musgo y selva en la base (generate-mountain-textures.py).
    const rangeTex=new B.Texture('./assets/images/environment/mountains/mountain-rock-jungle.webp',scene,false,true,B.Texture.TRILINEAR_SAMPLINGMODE);
    rangeTex.wrapU=B.Texture.WRAP_ADDRESSMODE;rangeTex.wrapV=B.Texture.CLAMP_ADDRESSMODE;
    rangeTex.uScale=2;rangeTex.anisotropicFilteringLevel=4;
    rangeMat.diffuseTexture=rangeTex;
  }
  function coralArch(d,lateral,seed){
    const p=trackFrame(d,lateral),span=9,rise=11;
    const path=Array.from({length:17},(_,k)=>{const a=Math.PI*k/16;return new B.Vector3(Math.cos(a)*span,Math.sin(a)*rise,Math.sin(a*3+seed)*.8);});
    const arc=B.MeshBuilder.CreateTube('coral-arch',{path,radiusFunction:k=>2.4+1.3*Math.abs(Math.cos(Math.PI*k/16))+.3*Math.sin(k*1.9+seed),tessellation:8,cap:B.Mesh.CAP_ALL},scene);
    arc.convertToFlatShadedMesh();
    arc.position.set(p.x,-1.5,p.z);arc.rotation.y=Math.atan2(p.rx,p.rz)+Math.PI/2;
    put(arc,strataRock);
    for(const side of [-1,1]){
      const q=trackFrame(d+side*span*.9,lateral);
      outcrop(q.x,-1.5,q.z,3.2,9+seed%3,seed+side);
    }
    canopyCluster(d,lateral-.5,rise-1.6,span*1.2,4.6);
  }

  for(let i=0;i<20;i++){
    const d=i*LAP_LENGTH/20+24;
    const lateral=-51-(i%3)*7;
    const p=trackFrame(d,lateral);
    const h=18+(i%4)*3.5,r=15+(i%3)*2;
    outcrop(p.x,3,p.z,r,h,i);
    for(let j=0;j<3;j++){
      const a=i+j*2.1;
      outcrop(p.x+Math.cos(a)*r*.85,2,p.z+Math.sin(a)*r*.85,r*.72,h*(.55+j*.1),i+j+1);
    }
    createVolumetricPalm(p.x,3+h,p.z,4.5,.4,i);
    if(i%2===0)createVolumetricPalm(p.x-r*.55,2+h*.65,p.z+r*.35,4.1,.65,i+17);
    if(coral){
      // Lush canopy spilling over the cliff rim and a planted base, facing the course.
      for(let k=-1;k<=1;k++)canopyCluster(d+k*r*.55,lateral+r*.3,3+h-2.2-Math.abs(k)*1.2,r*(k?0.85:1.05),r*(k?0.4:0.5));
      card(jungleCardMat,d+r*.2,lateral+r*.95,3.2,r*1.1,r*.42);
      card(flowerCardMat,d-r*.45,lateral+r*1.05,3.4,r*.8,r*.34);
      if(i%3!==2)coralWaterfall(d+(i%2?-.25:.25)*r,lateral,r,h);
    }
    if(!coral&&i%4===1){
      const q=trackFrame(d,lateral+r*.72);
      const falls=B.MeshBuilder.CreateRibbon('waterfall',{pathArray:[
        Array.from({length:15},(_,k)=>new B.Vector3(q.x-1.1,3+h-k*h/14,q.z+.15*Math.sin(k))),
        Array.from({length:15},(_,k)=>new B.Vector3(q.x+1.1,3+h-k*h/14,q.z+.15*Math.sin(k)))
      ],sideOrientation:B.Mesh.DOUBLESIDE},scene);put(falls,waterSplash);
    }
  }
  // One mesh and one particle system for every waterfall keeps draw calls flat.
  if(coralWaterfalls.length){
    const merged=B.Mesh.MergeMeshes(coralWaterfalls,true,true);
    merged.name='coral-waterfalls';merged.material=waterfallMat;merged.isPickable=false;merged.freezeWorldMatrix();
    coralWaterfalls.length=0;coralWaterfalls.push(merged);
    const mist=new B.ParticleSystem('coral-fall-mist',60*fallBases.length,scene);
    mist.particleTexture=lagoonMist;mist.emitter=B.Vector3.Zero();
    mist.startPositionFunction=(world,pos)=>{
      const base=fallBases[(Math.random()*fallBases.length)|0];
      pos.set(base.x+(Math.random()-.5)*2.8,base.y+Math.random()*.3,base.z+(Math.random()-.5)*2.8);
    };
    mist.color1=new B.Color4(1,1,1,.75);mist.color2=new B.Color4(.85,.96,1,.55);mist.colorDead=new B.Color4(1,1,1,0);
    mist.minSize=.35;mist.maxSize=1.1;mist.minLifeTime=.6;mist.maxLifeTime=1.4;mist.emitRate=26*fallBases.length;
    mist.direction1=new B.Vector3(-.6,1.2,-.6);mist.direction2=new B.Vector3(.6,2.4,.6);mist.gravity=new B.Vector3(0,-1.2,0);
    mist.minEmitPower=.6;mist.maxEmitPower=1.4;mist.blendMode=B.ParticleSystem.BLENDMODE_STANDARD;mist.start();
  }
  // Two quiet mountain silhouettes add depth beyond the near cliffs.
  // They are scenery at the outside of the course, with no physics mesh.
  const distantRock=mat('distant-ridge','#7baabd',.18,0);
  const distantGreen=mat('distant-green','#729f91',.13,0);
  distantRock.alpha=.73;distantGreen.alpha=.84;
  if(coral){
    coralRange(-96,26,22,.20,1.3,34);
    coralRange(-150,40,30,.34,4.1,30);
    coralRange(-220,55,34,.56,7.7,26);
  }
  for(const [offset,material,baseHeight] of (coral?[]:[[-152,distantRock,34],[-111,distantGreen,21]])){
    const ground=[],ridge=[];
    for(let i=0;i<=192;i++){
      const d=i*LAP_LENGTH/192,p=trackFrame(d,offset);
      const peak=Math.pow(Math.max(0,Math.sin(i*.39+offset)),5)*13;
      const undulation=Math.sin(i*.14+offset)*7+Math.sin(i*.31)*3;
      ground.push(new B.Vector3(p.x,-2,p.z));
      ridge.push(new B.Vector3(p.x,baseHeight+undulation+peak,p.z));
    }
    put(B.MeshBuilder.CreateRibbon('distant-mountains',{pathArray:[ground,ridge],sideOrientation:B.Mesh.DOUBLESIDE},scene),material);
  }
  // Small islands safely outside every segment of the navigable ribbon.
  const shoreSamples=Array.from({length:241},(_,i)=>trackFrame(i*LAP_LENGTH/240));
  for(let i=0;i<18;i++){
    const p=trackFrame(i*LAP_LENGTH/18+18,35);
    if(!shoreSamples.every(q=>Math.hypot(q.x-p.x,q.z-p.z)>23))continue;
    const island=B.MeshBuilder.CreateSphere('sand-islet',{diameter:2,segments:20},scene);
    island.position.set(p.x,-.35,p.z);island.scaling.set(6,1.1,4.8);put(island,beachSandMat);
    outcrop(p.x+1,.25,p.z+1,1.5,2.4,i);
    createVolumetricPalm(p.x-1,.6,p.z,5.6,.6,i);
    tropicalBush(p.x+2,.5,p.z-1,.9);
  }
  if(coral){
    // Rocky islets like the reference: stacked boulders, palms and planted rims.
    for(let i=0;i<9;i++){
      const d=i*LAP_LENGTH/9+52,lat=30+(i%3)*6;
      const p=trackFrame(d,lat);
      if(!shoreSamples.every(q=>Math.hypot(q.x-p.x,q.z-p.z)>22))continue;
      for(let k=0;k<4;k++){
        const a=k*1.7+i,rr=1.6+(k%2)*.9;
        const rock=B.MeshBuilder.CreateIcoSphere('islet-rock',{radius:rr,subdivisions:1,flat:true},scene);
        rock.position.set(p.x+Math.cos(a)*2.4,-.3+rr*.35,p.z+Math.sin(a)*2.4);
        rock.scaling.set(1.2,.9+(k%3)*.35,1);rock.rotation.y=a;put(rock,strataRock);
      }
      const isle=B.MeshBuilder.CreateSphere('islet-sand',{diameter:2,segments:14},scene);
      isle.position.set(p.x,-.45,p.z);isle.scaling.set(4.8,.9,3.8);put(isle,beachSandMat);
      createVolumetricPalm(p.x-.8,.4,p.z+.6,5.4+(i%3)*.8,.5+(i%2)*.3,i*1.9);
      if(i%2===0)createVolumetricPalm(p.x+1.2,.3,p.z-.8,4.6,.9,i*2.7);
      broadleafPlant(p.x+1.6,.25,p.z+1.1,.9,i+.5);
      card(flowerCardMat,d,lat-3.2,.1,5.2,2.3);
    }
    for(const [d,lat,seed] of [[330,58,3],[770,64,7]]){
      const p=trackFrame(d,lat);
      if(shoreSamples.every(q=>Math.hypot(q.x-p.x,q.z-p.z)>30))coralArch(d,lat,seed);
    }
  }

  // -------------------------------------------------------------------------
  // 7. ROLLING TROPICAL BREAKERS & SWELLS IN THE BAY
  // -------------------------------------------------------------------------
  // Outer decorative waves breaking with curling white froth
  const centerline = Array.from({length: 241}, (_, i) => trackFrame(i * 4));
  function safe(x, z, r) {
    return centerline.every(p => Math.hypot(p.x - x, p.z - z) > r + 14);
  }
  const breakerMat=mat('breaker-turquoise','#ffffff',.05,.50);
  breakerMat.alpha=.72;
  const breakerRim=mat('breaker-rim','#dcfbff',.34,.18);
  breakerRim.alpha=.84;

  for (let i = 0; i < (coral ? 0 : 14); i++) {
    const d = i * 70 + 35;
    const p = trackFrame(d, 26);
    if (!safe(p.x, p.z, 7)) continue;

    const waveRoot = new B.TransformNode('breaker-root', scene);
    waveRoot.position.set(p.x, 0, p.z);
    waveRoot.rotation.y = p.yaw;

    // Curved wave curl surface
    const profile = [[-4.5, 0], [-2.2, 0.3], [-0.9, 1.1], [0, 1.8], [0.7, 2.1], [1.2, 1.8], [1.6, 0.7], [2.6, 0]];
    const paths = profile.map(([z, y]) => Array.from({length: 19}, (_, j) => {
      const x = (j - 9) * 0.9;
      const edge = Math.sin((j / 18) * Math.PI);
      return new B.Vector3(x, y * edge + .08*Math.sin(x*.72+i), z + 0.35 * Math.cos(x * 0.45));
    }));

    const breaker = B.MeshBuilder.CreateRibbon('breaker-wave', {pathArray: paths, sideOrientation: B.Mesh.DOUBLESIDE}, scene);
    const positions=breaker.getVerticesData(B.VertexBuffer.PositionKind);
    const colors=[];
    for(let v=0;v<positions.length;v+=3){
      const height=Math.max(0,Math.min(1,positions[v+1]/2.1));
      colors.push(.035+.34*height,.42+.40*height,.62+.30*height,1);
    }
    breaker.setVerticesData(B.VertexBuffer.ColorKind,colors);
    breaker.parent = waveRoot;
    breaker.material = breakerMat;
    breaker.isPickable = false;

    // A narrow irregular sheet ties the foam to the curl instead of leaving
    // isolated white beads floating behind a flat turquoise surface.
    const rimPaths=[0,1].map(side=>Array.from({length:31},(_,j)=>{
      const x=(j-15)*.54;
      const edge=Math.sin(j/30*Math.PI);
      const wobble=.09*Math.sin(j*1.9+i);
      return new B.Vector3(x,edge*(side ? 2.08 : 1.77)+wobble,
        .68+.34*Math.cos(x*.45)+(side ? .12 : -.09));
    }));
    const rim=B.MeshBuilder.CreateRibbon('breaker-crest',{pathArray:rimPaths,sideOrientation:B.Mesh.DOUBLESIDE},scene);
    rim.parent=waveRoot;
    rim.material=breakerRim;
    rim.isPickable=false;
    rim.checkCollisions=false;

    // Frothy curling crest line
    const froth = [];
    for (let j = 1; j < 36; j++) {
      const x = (j - 18) * 0.45;
      const m = B.MeshBuilder.CreateSphere('froth', {diameter: 0.35 + (j%5)*.07, segments: 8}, scene);
      m.position.set(x, 2.1 * Math.sin((j / 36) * Math.PI) + 0.08 + .15*Math.sin(j*2.7), 0.7 + 0.35 * Math.cos(x * 0.45));
      m.scaling.set(1.0+(j%3)*.24, 0.55, 0.6+(j%4)*.13);
      froth.push(m);
    }
    const mergedFroth = B.Mesh.MergeMeshes(froth, true, true);
    if (mergedFroth) {
      mergedFroth.parent = waveRoot;
      mergedFroth.material = pureWhiteFoam;
      mergedFroth.isPickable = false;
    }

    animatedWaves.push({root: waveRoot, d, phase: i * 0.75});
  }

  // -------------------------------------------------------------------------
  // 8. COMBINE & OPTIMIZE GEOMETRIES BY MATERIAL (60 FPS)
  // -------------------------------------------------------------------------
  const environmentMeshes = [];
  for (const [material, meshes] of batches) {
    if (!meshes.length) continue;
    meshes.forEach(m => m.computeWorldMatrix(true));
    const combined = B.Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
    if (combined) {
      combined.name = 'env-batch-' + material.name;
      combined.material = material;
      combined.isPickable = false;
      combined.checkCollisions = false;
      combined.receiveShadows = true;
      combined.freezeWorldMatrix();
      environmentMeshes.push(combined);
    }
  }

  // Separate environmental lighting preserves the existing player illumination.
  const envMeshes=environmentMeshes.concat(coralWaterfalls,crownCards,foliageCards,animatedWaves.flatMap(w=>w.root.getChildMeshes()),scene.meshes.filter(m=>m.material&&(m.material===sand||/^(hut-|board-red|board-yellow|board-cyan|torch-|tropical-cumulus)/.test(m.material.name))));
  for(const light of scene.lights.filter(l=>l.name==='sun'||l.name==='hemi')){
    light.excludedMeshes=light.excludedMeshes.filter(m=>!m.isDisposed()).concat(envMeshes);
  }
  let sun=scene.getLightByName('coast-sun');
  if(!sun)sun=new B.DirectionalLight('coast-sun',new B.Vector3(-.45,-1,.35),scene);
  sun.intensity=coral?1.12:.95;sun.diffuse=coral?new B.Color3(1,.95,.84):new B.Color3(1,.94,.81);sun.includedOnlyMeshes=envMeshes;
  let fill=scene.getLightByName('coast-fill');
  if(!fill)fill=new B.HemisphericLight('coast-fill',new B.Vector3(0,1,0),scene);
  fill.intensity=coral?.62:.55;fill.diffuse=new B.Color3(.8,.91,1);fill.groundColor=coral?new B.Color3(.30,.42,.36):new B.Color3(.26,.38,.35);fill.includedOnlyMeshes=envMeshes;
  return {
    reflectionMeshes:environmentMeshes.filter(mesh=>mesh.material.alpha===1 && mesh.material!==contact),
    update(time, distance) {
      if (waterfallMat) waterfallMat.diffuseTexture.vOffset = -(time * 0.9) % 1;
      for (const w of animatedWaves) {
        const diff = Math.abs((((distance - w.d + 480) % 960) + 960) % 960 - 480);
        w.root.setEnabled(diff < 220);
        w.root.position.y = 0.08 * Math.sin(time * 1.3 + w.phase);
        w.root.scaling.y = 0.92 + 0.10 * Math.sin(time * 0.9 + w.phase);
      }
    }
  };
}
