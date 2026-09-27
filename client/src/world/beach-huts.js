import {trackFrame} from '../shared/track.js';

export function addBeachHuts(B, scene) {
  function stdMat(name, hex, emit = 0.2, spec = 0.1) {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseColor = B.Color3.FromHexString(hex);
    m.emissiveColor = m.diffuseColor.scale(emit);
    m.specularColor = new B.Color3(spec, spec, spec);
    m.backFaceCulling = false;
    return m;
  }

  const timber = stdMat('hut-timber', '#f0d8b5', 0.05, 0.08);
  const teakDark = stdMat('hut-teak', '#bba080', 0.04, 0.05);
  const woodAlbedo=new B.Texture('./assets/images/environment/painted-wood-v2.webp',scene);
  woodAlbedo.wrapU=woodAlbedo.wrapV=B.Texture.WRAP_ADDRESSMODE;
  woodAlbedo.anisotropicFilteringLevel=4;
  timber.diffuseTexture=woodAlbedo;
  teakDark.diffuseTexture=woodAlbedo;
  const roof = stdMat('hut-roof', '#169999', 0.25, 0.18); // Teal wooden pitched roof
  const roofTrim = stdMat('hut-roof-trim', '#22b6b6', 0.32, 0.22); // Vibrant cyan edge trim
  const canvas = stdMat('hut-canvas', '#fcf6e8', 0.40, 0.04);
  const whiteMat = stdMat('hut-white', '#ffffff', 0.45, 0.10);
  const redBoard = stdMat('board-red', '#e53935', 0.38, 0.15);
  const yellowBoard = stdMat('board-yellow', '#ffd033', 0.42, 0.15);
  const cyanBoard = stdMat('board-cyan', '#17c5d4', 0.40, 0.18);
  const bambooMat = stdMat('torch-bamboo', '#c29b62', 0.16, 0.06);

  const torchFlame = new B.StandardMaterial('torch-flame', scene);
  torchFlame.emissiveColor = B.Color3.FromHexString('#ff9d00');
  torchFlame.disableLighting = true;

  const batches = new Map([
    [timber, []], [teakDark, []], [roof, []], [roofTrim, []],
    [canvas, []], [whiteMat, []], [redBoard, []], [yellowBoard, []],
    [cyanBoard, []], [bambooMat, []], [torchFlame, []]
  ]);

  function box(root, name, x, y, z, w, h, d, mat, rx = 0, ry = 0, rz = 0) {
    const m = B.MeshBuilder.CreateBox(name, {width: w, height: h, depth: d}, scene);
    m.parent = root;
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    m.material = mat;
    m.isPickable = false;
    batches.get(mat).push(m);
    return m;
  }

  function cylinder(root, name, x, y, z, diam, h, mat, tess = 8) {
    const m = B.MeshBuilder.CreateCylinder(name, {diameter: diam, height: h, tessellation: tess}, scene);
    m.parent = root;
    m.position.set(x, y, z);
    m.material = mat;
    m.isPickable = false;
    batches.get(mat).push(m);
    return m;
  }

  const roots = [];
  const locations = [
    { dist: 42, xOffset: -21.2, rot: -0.05 },
    { dist: 365, xOffset: -23.0, rot: -0.2 },
    { dist: 532, xOffset: -24.0, rot: 0.1 },
    { dist: 846, xOffset: -22.0, rot: 0.0 }
  ];

  for (const loc of locations) {
    const root = new B.TransformNode('beach-pavilion', scene);
    const p = trackFrame(loc.dist, loc.xOffset);
    roots.push(root);
    const sandY = p.y + 0.12 + (-loc.xOffset - 11.9) * 0.22;
    root.position.set(p.x, sandY, p.z);
    root.rotation.y = p.yaw + loc.rot;

    // Platform / Deck
    box(root, 'deck-base', 0, 0.20, 0, 6.4, 0.36, 4.6, timber);
    for (const sx of [-2.9, 2.9]) {
      for (const sz of [-2.0, 2.0]) {
        cylinder(root, 'stilt', sx, -0.45, sz, 0.26, 1.4, teakDark, 8);
      }
    }

    // Four Main Structural Pillars
    for (const sx of [-2.8, 2.8]) {
      for (const sz of [-1.9, 1.9]) {
        box(root, 'pillar', sx, 1.9, sz, 0.26, 3.8, 0.26, timber);
      }
    }

    // Rear wall with geometric horizontal slatted louvers
    box(root, 'back-slat-frame', 0, 1.9, -1.9, 5.4, 3.2, 0.14, teakDark);
    for (let s = 0; s < 6; s++) {
      box(root, 'slat', 0, 0.7 + s * 0.52, -1.86, 5.2, 0.30, 0.08, timber);
    }

    // Front Service Counter
    box(root, 'bar-top', 0, 1.25, 1.45, 5.4, 0.20, 0.90, teakDark);
    box(root, 'bar-front', 0, 0.65, 1.82, 5.2, 1.0, 0.14, timber);
    box(root, 'bar-trim', 0, 1.22, 1.88, 5.3, 0.08, 0.06, whiteMat);

    // Pitched Tropical Roof with Overhang (Matching teal roof in Image B)
    for (const side of [-1, 1]) {
      box(root, 'sloping-roof', side * 1.55, 3.85, 0, 3.4, 0.16, 5.4, roof, 0, 0, -side * 0.28);
      box(root, 'roof-edge-trim', side * 3.22, 3.40, 0, 0.12, 0.18, 5.4, roofTrim, 0, 0, -side * 0.28);
    }
    box(root, 'roof-ridge', 0, 4.38, 0, 0.28, 0.24, 5.5, teakDark);

    // Horizontal ridge rafters under the overhang
    for (let j = 0; j < 9; j++) {
      for (const side of [-1, 1]) {
        box(root, 'roof-rafter', side * 1.55, 3.75, -2.4 + j * 0.6, 3.2, 0.08, 0.08, teakDark, 0, 0, -side * 0.28);
      }
    }

    // Deck Railings
    for (const side of [-1, 1]) {
      box(root, 'rail-top', side * 3.05, 1.15, 0, 0.12, 0.12, 4.4, timber);
      box(root, 'rail-mid', side * 3.05, 0.70, 0, 0.09, 0.09, 4.4, timber);
    }
    // Front lookout railing (with gap for surfboards)
    box(root, 'rail-front-left', -2.1, 1.15, 2.15, 1.6, 0.12, 0.12, timber);
    box(root, 'rail-front-right', 2.1, 1.15, 2.15, 1.6, 0.12, 0.12, timber);

    // Wooden entry steps leading down to sand
    for (let step = 0; step < 4; step++) {
      box(root, 'hut-stair', 1.7, -0.10 - step * 0.18, 2.6 + step * 0.40, 1.5, 0.20, 0.42, timber);
    }

    // -----------------------------------------------------------------------
    // TWO ICONIC SURFBOARDS LEANING IN FRONT (Exact match for Image B)
    // -----------------------------------------------------------------------
    // Board 1: Red surfboard with vertical white stripe and yellow pin
    const b1 = B.MeshBuilder.CreateSphere('lean-board-red', {diameter: 2, segments: 12}, scene);
    b1.scaling.set(0.12, 2.1, 0.46);
    b1.position.set(-0.85, 1.10, 2.25);
    b1.rotation.set(0.16, 0.10, -0.06);
    b1.parent = root;
    b1.material = redBoard;
    batches.get(redBoard).push(b1);

    const b1Stripe = B.MeshBuilder.CreateBox('lean-board-stripe', {width: 0.13, height: 1.8, depth: 0.12}, scene);
    b1Stripe.position.set(-0.85, 1.10, 2.26);
    b1Stripe.rotation.set(0.16, 0.10, -0.06);
    b1Stripe.parent = root;
    b1Stripe.material = whiteMat;
    batches.get(whiteMat).push(b1Stripe);

    // Board 2: Bright yellow surfboard with cyan nose tip
    const b2 = B.MeshBuilder.CreateSphere('lean-board-yellow', {diameter: 2, segments: 12}, scene);
    b2.scaling.set(0.12, 1.95, 0.44);
    b2.position.set(-0.25, 1.02, 2.22);
    b2.rotation.set(0.16, -0.08, 0.05);
    b2.parent = root;
    b2.material = yellowBoard;
    batches.get(yellowBoard).push(b2);

    const b2Tip = B.MeshBuilder.CreateSphere('lean-board-tip', {diameter: 2, segments: 10}, scene);
    b2Tip.scaling.set(0.125, 0.55, 0.45);
    b2Tip.position.set(-0.25, 1.65, 2.12);
    b2Tip.rotation.set(0.16, -0.08, 0.05);
    b2Tip.parent = root;
    b2Tip.material = cyanBoard;
    batches.get(cyanBoard).push(b2Tip);

    // -----------------------------------------------------------------------
    // BAMBOO TIKI TORCHES (Visible near hut deck in Image B)
    // -----------------------------------------------------------------------
    const torchPositions = [
      {x: 3.6, z: 2.2},
      {x: -3.6, z: 2.2},
      {x: 3.2, z: 4.2}
    ];
    for (let t = 0; t < torchPositions.length; t++) {
      const tp = torchPositions[t];
      // Bamboo pole
      cylinder(root, 'tiki-pole-' + t, tp.x, 0.8, tp.z, 0.10, 2.2, bambooMat, 6);
      // Cup holder
      cylinder(root, 'tiki-cup-' + t, tp.x, 1.95, tp.z, 0.22, 0.22, teakDark, 8);
      // Warm glowing flame
      const fl = B.MeshBuilder.CreateSphere('tiki-flame-' + t, {diameter: 0.28, segments: 8}, scene);
      fl.parent = root;
      fl.position.set(tp.x, 2.15, tp.z);
      fl.scaling.set(0.8, 1.5, 0.8);
      fl.material = torchFlame;
      batches.get(torchFlame).push(fl);
    }
  }

  // Merge each material batch into a single non-interactive static mesh
  for (const [mat, parts] of batches) {
    if (!parts.length) continue;
    parts.forEach(m => m.computeWorldMatrix(true));
    const merged = B.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (merged) {
      merged.material = mat;
      merged.freezeWorldMatrix();
      merged.isPickable = false;
      merged.receiveShadows = true;
    }
  }
  roots.forEach(r => r.dispose());
}
