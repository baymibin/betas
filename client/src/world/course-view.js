import {trackFrame, getTrackMap} from '../shared/track.js';
import {courseSection, RAIL_X, SECTION, LAP_LENGTH} from '../shared/course.js';

export function createCourseView(B, scene) {
  function stdMat(name, hex, emit = 0.2, spec = 0.1) {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseColor = B.Color3.FromHexString(hex);
    m.emissiveColor = m.diffuseColor.scale(emit);
    m.specularColor = new B.Color3(spec, spec, spec);
    m.backFaceCulling = false;
    return m;
  }

  const whiteRailMat = stdMat('course-white-rail', '#ffffff', 0.52, 0.15);
  const rampBody = stdMat('ramp-body', '#f5b83d', 0.40, 0.12);
  const rampEdge = stdMat('ramp-edge-dark', '#d6972a', 0.30, 0.08);
  const neonCyan = new B.StandardMaterial('ramp-neon-cyan', scene);
  neonCyan.emissiveColor = B.Color3.FromHexString('#ffdf6d');
  neonCyan.disableLighting = true;

  // Chevron texture for high visibility launch boost
  const arrowTex = new B.DynamicTexture('ramp-arrow-tex', {width: 256, height: 512}, scene, true);
  const actx = arrowTex.getContext();
  actx.fillStyle = '#ffbe3b';
  actx.fillRect(0, 0, 256, 512);

  for (let i = 0; i < 4; i++) {
    const cy = 90 + i * 110;
    actx.fillStyle = '#ffffff';
    actx.beginPath();
    actx.moveTo(128, cy - 35);
    actx.lineTo(220, cy + 30);
    actx.lineTo(195, cy + 45);
    actx.lineTo(128, cy);
    actx.lineTo(61, cy + 45);
    actx.lineTo(36, cy + 30);
    actx.closePath();
    actx.fill();
  }
  arrowTex.update();

  const rampSurfaceMat = new B.StandardMaterial('ramp-surface-mat', scene);
  rampSurfaceMat.diffuseTexture = arrowTex;
  rampSurfaceMat.emissiveTexture = arrowTex;
  rampSurfaceMat.diffuseColor = B.Color3.Black();
  rampSurfaceMat.emissiveColor = B.Color3.White();
  rampSurfaceMat.disableLighting = true;
  rampSurfaceMat.backFaceCulling = false;

  function box(name, w, h, d, parent, x, y, z, mat, rx = 0, ry = 0, rz = 0) {
    const m = B.MeshBuilder.CreateBox(name, {width: w, height: h, depth: d}, scene);
    m.parent = parent;
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    m.material = mat;
    return m;
  }

  // 1. Sleek Track Boundary Rails: Pure white posts with dome caps & double rails (Image B)
  const pylon = B.MeshBuilder.CreateCylinder('bound-pylon', {diameter: 0.24, height: 1.5, tessellation: 12}, scene);
  pylon.position.set(0, 0.25, 0);
  const pylonCap = B.MeshBuilder.CreateSphere('bound-pylon-cap', {diameter: 0.26, segments: 10}, scene);
  pylonCap.position.set(0, 1.0, 0);
  const railUpper = B.MeshBuilder.CreateBox('bound-rail-upper', {width: 0.10, height: 0.15, depth: 7.96}, scene);
  railUpper.position.set(0, 0.72, -4);
  const railLower = B.MeshBuilder.CreateBox('bound-rail-lower', {width: 0.09, height: 0.13, depth: 7.96}, scene);
  railLower.position.set(0, 0.32, -4);

  const boundary = B.Mesh.MergeMeshes([pylon, pylonCap, railUpper, railLower], true, true);
  boundary.material = whiteRailMat;
  boundary.isPickable = false;

  const matrices = new Float32Array((LAP_LENGTH / 8) * 2 * 16);
  let offset = 0;
  for (let d = 0; d < LAP_LENGTH; d += 8) {
    for (const side of [-1, 1]) {
      const p = trackFrame(d, side * (RAIL_X - getTrackMap() * 0.4));
      B.Matrix.Compose(
        B.Vector3.One(),
        B.Quaternion.FromEulerAngles(0, p.yaw, 0),
        new B.Vector3(p.x, p.y, p.z)
      ).copyToArray(matrices, offset);
      offset += 16;
    }
  }
  boundary.thinInstanceSetBuffer('matrix', matrices, 16, true);
  boundary.thinInstanceRefreshBoundingInfo();
  boundary.freezeWorldMatrix();

  // Course Safety Buoy Cones (Image B red & white safety cones floating along boundary)
  const buoyRedMat = stdMat('course-buoy-red', '#e6392a', 0.40, 0.08);
  const buoyWhiteMat = stdMat('course-buoy-white', '#ffffff', 0.52, 0.12);

  // Red conical parts
  const bLower = B.MeshBuilder.CreateCylinder('course-buoy-lower', {diameterBottom: 0.82, diameterTop: 0.58, height: 0.42, tessellation: 14}, scene);
  bLower.position.set(0, 0.35, 0);
  const bUpper = B.MeshBuilder.CreateCylinder('course-buoy-upper', {diameterBottom: 0.44, diameterTop: 0.18, height: 0.38, tessellation: 14}, scene);
  bUpper.position.set(0, 1.07, 0);
  const bKnob = B.MeshBuilder.CreateSphere('course-buoy-knob', {diameter: 0.22, segments: 8}, scene);
  bKnob.position.set(0, 1.28, 0);

  const redMerged = B.Mesh.MergeMeshes([bLower, bUpper, bKnob], true, true);
  redMerged.material = buoyRedMat;
  redMerged.isPickable = false;

  // White reflective collar and band
  const bFloat = B.MeshBuilder.CreateCylinder('course-buoy-float', {diameter: 0.96, height: 0.14, tessellation: 14}, scene);
  bFloat.position.set(0, 0.07, 0);
  const bMid = B.MeshBuilder.CreateCylinder('course-buoy-mid', {diameterBottom: 0.58, diameterTop: 0.44, height: 0.32, tessellation: 14}, scene);
  bMid.position.set(0, 0.72, 0);

  const whiteMerged = B.Mesh.MergeMeshes([bFloat, bMid], true, true);
  whiteMerged.material = buoyWhiteMat;
  whiteMerged.isPickable = false;

  const buoyIntervals = [];
  for (let d = 8; d < LAP_LENGTH; d += 16) {
    buoyIntervals.push({dist: d, side: 1}); // Left fence (Image B: d = 8, 24, 40...)
    if (d % 32 === 0) buoyIntervals.push({dist: d + 8, side: -1}); // Right fence
  }
  const buoyMatrices = new Float32Array(buoyIntervals.length * 16);
  let bOffset = 0;
  for (const bi of buoyIntervals) {
    const p = trackFrame(bi.dist, bi.side * (RAIL_X - getTrackMap() * 0.4 - 0.45));
    B.Matrix.Compose(
      B.Vector3.One(),
      B.Quaternion.FromEulerAngles(0, p.yaw, 0),
      new B.Vector3(p.x, 0.0, p.z)
    ).copyToArray(buoyMatrices, bOffset);
    bOffset += 16;
  }
  redMerged.thinInstanceSetBuffer('matrix', buoyMatrices, 16, true);
  redMerged.thinInstanceRefreshBoundingInfo();
  redMerged.freezeWorldMatrix();

  whiteMerged.thinInstanceSetBuffer('matrix', buoyMatrices, 16, true);
  whiteMerged.thinInstanceRefreshBoundingInfo();
  whiteMerged.freezeWorldMatrix();

  // 2. Start / Finish Gate
  const finish = new B.TransformNode('finish-gate', scene);
  const start = trackFrame(0);
  finish.position.set(start.x, start.y, start.z);
  finish.rotation.y = start.yaw;
  const gateWidth = (RAIL_X - getTrackMap() * 0.4) * 2 + 1.2;

  for (const side of [-1, 1]) {
    box('finish-pylon', 0.45, 7.5, 0.45, finish, (side * gateWidth) / 2, 3.5, 0, rampBody);
    box('finish-pylon-neon', 0.12, 7.2, 0.12, finish, (side * gateWidth) / 2, 3.5, 0.24, neonCyan);
  }

  const flagTexture = new B.DynamicTexture('finish-flag', {width: 512, height: 128}, scene, false);
  const fctx = flagTexture.getContext();
  fctx.fillStyle = '#0a3644';
  fctx.fillRect(0, 0, 512, 128);
  // Stylized border
  fctx.strokeStyle = '#e8fff6';
  fctx.lineWidth = 6;
  fctx.strokeRect(6, 6, 500, 116);
  // Title
  fctx.fillStyle = '#fff9eb';
  fctx.font = 'bold 42px "Baloo 2", sans-serif';
  fctx.textAlign = 'center';
  fctx.fillText('SALIDA / META', 256, 64);
  // Chequered strip
  for (let i = 0; i < 32; i++) {
    fctx.fillStyle = i % 2 ? '#e8fff6' : '#08252e';
    fctx.fillRect(16 + i * 15, 96, 15, 20);
  }
  flagTexture.update();

  const flagMat = new B.StandardMaterial('finish-flag-material', scene);
  flagMat.diffuseTexture = flagTexture;
  flagMat.emissiveTexture = flagTexture;
  flagMat.diffuseColor = B.Color3.Black();
  flagMat.emissiveColor = B.Color3.White();
  flagMat.disableLighting = true;
  flagMat.backFaceCulling = false;

  const banner = B.MeshBuilder.CreatePlane('finish-banner', {width: gateWidth, height: 1.6}, scene);
  banner.parent = finish;
  banner.position.y = 6.6;
  banner.rotation.y = Math.PI;
  banner.material = flagMat;

  // 3. Jump Boost Ramps with full structural volume and animated neon
  const slope = Math.atan(0.25);
  const sections = Array.from({length: 9}, () => {
    const ramp = new B.TransformNode('boost-ramp', scene);

    // Solid wedge foundation supporting the ramp down to the water surface
    const foundation = box('launch-foundation', 3.2, 0.65, 4.1, ramp, 0, 0.05, 0, rampBody);

    // Launch Surface Deck
    const surface = box('launch-surface', 3.16, 0.16, 4.2, ramp, 0, 0.48, 0, rampBody, slope, 0, 0);

    // Chevron Arrow Graphic
    const skin = B.MeshBuilder.CreateGround('ramp-art', {width: 3.1, height: 4.1}, scene);
    skin.parent = ramp;
    skin.position.set(0, 0.58, 0);
    skin.rotation.x = slope;
    skin.material = rampSurfaceMat;

    // Glowing Neon Guide Rails on both sides
    for (const x of [-1.62, 1.62]) {
      const rail = box('ramp-edge-rail', 0.14, 0.28, 4.3, ramp, x, 0.58, 0, neonCyan, slope, 0, 0);
    }

    // Mid-section track barrier
    const divider = new B.TransformNode('division', scene);
    box('division-base', 2.8, 0.35, 1.4, divider, 0, 0.05, 0, rampEdge);
    box('division-core', 2.7, 0.75, 0.32, divider, 0, 0.52, 0, rampBody);
    box('division-neon', 2.85, 0.12, 0.36, divider, 0, 0.94, 0, neonCyan);

    return {ramp, divider};
  });

  return {
    nodes: sections.flatMap(s => [s.ramp, s.divider]),
    update(z, time) {
      const first = Math.max(0, Math.floor((-z - 32) / SECTION) - 1);
      sections.forEach(({ramp, divider}, i) => {
        const s = courseSection(first + i);
        ramp.position.set(s.x, 0, s.z + 2);
        divider.position.set(-s.x * 0.6, 0, s.z - 24);
      });
      // Subtle pulse on ramp neon
      const glow = .9 + Math.sin(time * 2) * .06;
      neonCyan.emissiveColor.set(.8 * glow, .96 * glow, .9 * glow);
    }
  };
}
