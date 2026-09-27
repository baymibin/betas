import {trackFrame} from '../shared/track.js';
import {LAP_LENGTH} from '../shared/course.js';

export function addBeachSpectators(B, scene) {
  const colors = [
    '#ffffff', // 0: White / skin highlight
    '#32d2c9', // 1: Vibrant Cyan
    '#ff6552', // 2: Coral red
    '#ffd152', // 3: Sunny yellow
    '#9d77f2', // 4: Neon violet
    '#4ade80', // 5: Tropical mint
    '#fcf8ec', // 6: Warm cream
    '#1c2833', // 7: Deep sunglasses/shadow
    '#a87445'  // 8: Deckchair wood
  ];

  const materials = colors.map((hex, i) => {
    const m = new B.StandardMaterial('crowd-mat-' + i, scene);
    m.diffuseColor = B.Color3.FromHexString(hex);
    m.emissiveColor = m.diffuseColor.scale(i === 7 ? 0.05 : 0.35);
    m.specularColor = new B.Color3(0.08, 0.08, 0.08);
    m.backFaceCulling = false;
    return m;
  });

  const batches = materials.map(() => []);

  function add(mesh, matIndex, root, x, y, z) {
    mesh.material = materials[matIndex];
    mesh.parent = root;
    mesh.position.set(x, y, z);
    mesh.isPickable = false;
    batches[matIndex].push(mesh);
    return mesh;
  }

  function ball(root, x, y, z, r, matIndex) {
    return add(B.MeshBuilder.CreateSphere('spectator-sphere', {diameter: r * 2, segments: 10}, scene), matIndex, root, x, y, z);
  }

  function box(root, x, y, z, w, h, d, matIndex, rx = 0, ry = 0, rz = 0) {
    const m = add(B.MeshBuilder.CreateBox('spectator-box', {width: w, height: h, depth: d}, scene), matIndex, root, x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    return m;
  }

  function limb(root, a, b, r, matIndex) {
    const start = new B.Vector3(...a), end = new B.Vector3(...b);
    const delta = end.subtract(start);
    const len = delta.length();
    const mid = start.add(end).scale(0.5);
    const m = add(B.MeshBuilder.CreateCylinder('spectator-limb', {height: len, diameter: r * 2, tessellation: 8}, scene), matIndex, root, mid.x, mid.y, mid.z);
    if (len > 0.001) {
      m.rotationQuaternion = B.Quaternion.FromUnitVectorsToRef(B.Axis.Y, delta.normalize(), new B.Quaternion());
    }
    // Add smooth joint caps at endpoints so limbs connect seamlessly without gaps
    ball(root, a[0], a[1], a[2], r * 1.05, matIndex);
    ball(root, b[0], b[1], b[2], r * 1.05, matIndex);
    return m;
  }

  // Four intentional spectator hubs
  const hubs = [
    { startDist: 26, endDist: 72, count: 10, lateralMin: -15.5, lateralMax: -19.5, type: 'cheer' },
    { startDist: 345, endDist: 395, count: 10, lateralMin: -16.0, lateralMax: -21.0, type: 'lounge' },
    { startDist: 512, endDist: 558, count: 8, lateralMin: -16.5, lateralMax: -20.5, type: 'lookout' },
    { startDist: 825, endDist: 875, count: 8, lateralMin: -15.5, lateralMax: -19.0, type: 'finish' }
  ];

  const roots = [];
  let specId = 0;

  for (const hub of hubs) {
    for (let k = 0; k < hub.count; k++, specId++) {
      const frac = hub.count > 1 ? k / (hub.count - 1) : 0.5;
      const distance = hub.startDist + frac * (hub.endDist - hub.startDist);
      const lat = hub.lateralMin + (Math.sin(specId * 3.7) * 0.5 + 0.5) * (hub.lateralMax - hub.lateralMin);
      const p = trackFrame(distance, lat);
      const root = new B.TransformNode('spectator-' + specId, scene);
      roots.push(root);

      const sandY = p.y + 0.12 + (-lat - 11.9) * 0.22;
      root.position.set(p.x, sandY, p.z);
      root.rotation.y = p.yaw + Math.PI / 2 + (Math.sin(specId * 2.3) * 0.35);

      const skinMat = (specId % 2 === 0) ? 0 : 6;
      const suitMat = 1 + (specId % 5); // Cycling cyan, coral, yellow, violet, mint
      const pose = hub.type === 'lounge' ? (specId % 2 === 0 ? 2 : 0) : (specId % 3);

      if (pose === 2) {
        // Sitting on low-poly deckchair
        box(root, 0, 0.45, 0, 0.65, 0.08, 1.4, 8, -0.22, 0, 0); // seat
        box(root, 0, 0.72, -0.48, 0.65, 0.08, 0.85, 8, 0.65, 0, 0); // backrest
        box(root, 0, 0.48, 0.02, 0.56, 0.04, 1.35, suitMat, -0.22, 0, 0); // canvas sling

        // Seated body
        ball(root, 0, 1.35, -0.32, 0.22, skinMat); // head
        limb(root, [0, 0.58, -0.1], [0, 1.15, -0.28], 0.09, skinMat); // spine
        // Seated legs
        for (const side of [-1, 1]) {
          limb(root, [side * 0.14, 0.58, -0.1], [side * 0.16, 0.55, 0.38], 0.075, suitMat);
          limb(root, [side * 0.16, 0.55, 0.38], [side * 0.18, 0.14, 0.75], 0.07, skinMat);
          // Relaxed arms
          limb(root, [side * 0.26, 1.1, -0.24], [side * 0.38, 0.65, 0.15], 0.065, skinMat);
        }
      } else {
        // Standing spectator (Pose 0: cheering arms up, Pose 1: holding surfboard or waving)
        ball(root, 0, 1.82, 0, 0.23, skinMat); // head
        box(root, 0, 1.84, 0.18, 0.32, 0.10, 0.12, 7); // stylish low-poly sunglasses
        limb(root, [0, 0.96, 0], [0, 1.62, 0], 0.09, skinMat); // torso
        box(root, 0, 0.94, 0, 0.36, 0.26, 0.24, suitMat); // shorts

        // Legs
        for (const side of [-1, 1]) {
          limb(root, [side * 0.11, 0.92, 0], [side * 0.13, 0.12, 0], 0.075, skinMat);
        }

        if (pose === 0) {
          // Cheering: arms raised in celebration
          for (const side of [-1, 1]) {
            limb(root, [0, 1.54, 0], [side * 0.38, 1.95, 0], 0.065, skinMat);
            limb(root, [side * 0.38, 1.95, 0], [side * 0.52, 2.35, 0], 0.06, skinMat);
          }
        } else {
          // One hand on hip, one hand resting on a 3D low poly surfboard
          limb(root, [0, 1.54, 0], [-0.35, 1.25, 0.05], 0.065, skinMat);
          limb(root, [-0.35, 1.25, 0.05], [-0.22, 1.05, 0.02], 0.06, skinMat);

          limb(root, [0, 1.54, 0], [0.42, 1.45, 0.15], 0.065, skinMat);
          limb(root, [0.42, 1.45, 0.15], [0.65, 1.35, 0.25], 0.06, skinMat);

          // Upright low poly surfboard planted in the sand next to spectator
          const surfBoard = B.MeshBuilder.CreateBox('beach-fan-board', {width: 0.12, height: 2.1, depth: 0.46}, scene);
          surfBoard.parent = root;
          surfBoard.position.set(0.68, 0.95, 0.25);
          surfBoard.rotation.set(-0.15, 0.2, 0.12);
          surfBoard.material = materials[suitMat];
          surfBoard.isPickable = false;
          batches[suitMat].push(surfBoard);
        }
      }

      // Beach Parasol (every 3 spectators)
      if (specId % 3 === 0) {
        const px = -1.3, pz = -0.7;
        limb(root, [px, 0, pz], [px, 2.7, pz], 0.045, 8);
        // 6-faceted conical low-poly umbrella canopy
        for (let j = 0; j < 6; j++) {
          const panel = B.MeshBuilder.CreateCylinder('parasol-facet', {
            diameterTop: 0.04,
            diameterBottom: 2.6,
            height: 0.52,
            tessellation: 6,
            arc: 1 / 6,
            enclose: true
          }, scene);
          panel.parent = root;
          panel.position.set(px, 2.65, pz);
          panel.rotation.y = j * Math.PI / 3;
          panel.material = materials[j % 2 === 0 ? suitMat : 6];
          panel.isPickable = false;
          batches[j % 2 === 0 ? suitMat : 6].push(panel);
        }
      }
    }
  }

  // Merge static meshes into lightweight material batches
  for (let m = 0; m < batches.length; m++) {
    const parts = batches[m];
    if (!parts.length) continue;
    parts.forEach(p => p.computeWorldMatrix(true));
    const merged = B.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (merged) {
      merged.material = materials[m];
      merged.freezeWorldMatrix();
      merged.isPickable = false;
      merged.receiveShadows = true;
    }
  }

  roots.forEach(r => r.dispose());
}
