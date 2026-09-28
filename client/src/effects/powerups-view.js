import {ITEMS,itemRolling} from '../shared/powerups.js';
import {trackFrame} from '../shared/track.js';
import {settings,playSound} from '../ui/home-ui.js';

export function createPowerView(B, scene, use) {
  const hud = document.createElement('div');
  hud.id = 'power-hud';
  hud.hidden = true;
  hud.innerHTML = `
    <button id="use-power" aria-label="Usar habilidad">
      <div class="power-icon-wrapper">
        <img class="power-icon" alt="" src="/assets/images/powerups/power-cube-holo.webp">
      </div>
      <strong>Caja misteriosa</strong>
      <small>Recoge una caja · E para usar</small>
    </button>
    <div id="power-timers"></div>
    <div id="power-warning" role="status"></div>
  `;
  document.body.append(hud);

  const foam = document.createElement('div');
  foam.id = 'foam-screen';
  foam.hidden = true;
  document.body.append(foam);

  const button = hud.querySelector('button');
  const icon = hud.querySelector('.power-icon');
  const itemName=hud.querySelector('strong');
  const itemHint=hud.querySelector('small');
  const timerNode=hud.querySelector('#power-timers');
  const warningNode=hud.querySelector('#power-warning');
  // Decode roulette icons before a pickup, outside the racing render loop.
  const iconCache = Array.from({length: 8}, (_, i) => {
    const img = new Image(); img.src = '/assets/images/powerups/power-' + (i + 1) + '.webp';
    return img;
  });
  const iconsReady=Promise.allSettled(iconCache.map(img=>img.decode?.()));
  button.onclick = use;

  const style = document.createElement('style');
  style.textContent = `
    #power-hud {
      position: fixed;
      bottom: 48px;
      right: 24px;
      z-index: 25;
      width: 196px;
      color: white;
      text-align: center;
      font: 600 13px 'Baloo 2', system-ui, sans-serif;
      pointer-events: auto;
    }
    #power-hud[hidden] { display: none; }
    #use-power {
      width: 100%;
      border: 1.5px solid rgba(78, 231, 220, 0.55);
      border-radius: 18px;
      background: rgba(6, 32, 46, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-shadow: 0 10px 30px rgba(0, 18, 28, 0.45), 0 0 18px rgba(78, 231, 220, 0.25);
      color: white;
      padding: 10px 8px 12px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      transition: transform 0.15s ease, border-color 0.2s ease, box-shadow 0.2s ease;
    }
    #use-power:not(:disabled):hover {
      transform: translateY(-2px);
      border-color: #ffd15c;
      box-shadow: 0 12px 35px rgba(0, 18, 28, 0.5), 0 0 24px rgba(255, 209, 92, 0.4);
    }
    #use-power:not(:disabled):active {
      transform: translateY(1px);
    }
    #use-power:disabled {
      cursor: default;
      opacity: 0.82;
    }
    .power-icon-wrapper {
      width: 82px;
      height: 82px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle, rgba(78, 231, 220, 0.22) 0%, rgba(6, 32, 46, 0) 70%);
      border-radius: 14px;
    }
    .power-icon {
      width: 74px;
      height: 74px;
      object-fit: contain;
      filter: drop-shadow(0 0 12px rgba(78, 231, 220, 0.55));
      transition: transform 0.2s cubic-bezier(0.18, 0.89, 0.32, 1.28);
    }
    #use-power:not(:disabled) .power-icon {
      animation: powerIconFloat 2s ease-in-out infinite;
    }
    @keyframes powerIconFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px) scale(1.04); }
    }
    #use-power strong {
      display: block;
      margin-top: 6px;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.5px;
      color: #fff;
      text-shadow: 0 2px 6px rgba(0,0,0,0.6);
    }
    #use-power small {
      display: block;
      margin-top: 2px;
      font-size: 10.5px;
      color: #a8f0e5;
    }
    #power-timers {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 11px;
      font-weight: 700;
      color: #61ffe4;
      text-shadow: 0 1px 4px rgba(0,0,0,0.8);
    }
    #power-warning {
      margin-top: 6px;
      font-size: 11.5px;
      font-weight: 800;
      color: #ff6e6e;
      letter-spacing: 0.5px;
      text-shadow: 0 0 10px rgba(255, 110, 110, 0.7);
      animation: warningPulse 0.8s ease-in-out infinite alternate;
    }
    @keyframes warningPulse {
      from { opacity: 0.75; transform: scale(0.98); }
      to { opacity: 1; transform: scale(1.03); }
    }
    #foam-screen {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 19;
      background: radial-gradient(ellipse at center, transparent 58%, rgba(220, 255, 255, 0.42) 78%, rgba(255, 255, 255, 0.92) 100%);
      box-shadow: inset 0 0 90px 30px rgba(200, 255, 255, 0.65);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
    }
    #foam-screen[hidden] { display: none; }
    body:has(#overlay:not(.hidden)) #power-hud { display: none; }
    @media (max-width: 600px) {
      #power-hud {
        width: 140px;
        right: 12px;
        bottom: 85px;
      }
      .power-icon-wrapper { width: 56px; height: 56px; }
      .power-icon { width: 50px; height: 50px; }
      #use-power strong { font-size: 12px; }
    }
  `;
  document.head.append(style);

  function material(name, hex, emission = 0.25) {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseColor = B.Color3.FromHexString(hex);
    m.emissiveColor = m.diffuseColor.scale(emission);
    m.specularColor = new B.Color3(0.3, 0.3, 0.3);
    m.specularPower = 32;
    return m;
  }

  // Futuristic Holographic Tropical Mystery Box Material
  const crateMat = material('power-crate-holo', '#ffffff', 0.4);
  crateMat.diffuseTexture = new B.Texture('/assets/images/powerups/power-cube-holo.webp', scene);
  crateMat.alpha = 0.92;
  crateMat.backFaceCulling = false;

  const coreMat = material('power-core-gold', '#ffd15c', 1.8);
  coreMat.disableLighting = true;

  const neonTrimMat = material('power-trim-cyan', '#3df2d6', 1.5);
  neonTrimMat.disableLighting = true;

  const water = material('power-water', '#4cf5e3', 1.2);
  const gold = material('power-gold', '#ffca58', 1.2);
  const white = material('power-foam', '#ddffff', 0.9);
  const coco = material('coconut-shell', '#6b4624', 0.3);
  const cocoLeaf = material('coconut-leaf', '#3cd070', 0.6);

  const glow = new B.GlowLayer('power-glow', scene, {blurKernelSize: 24, mainTextureRatio: 0.35});
  glow.intensity = 0.55;

  const glowing = new Set(), glowMeshes = new Map();
  const GLOW_RANGE = 90;
  // Mete o saca las mallas de un avatar del GlowLayer (solo mientras tiene un poder activo).
  function setAvatarGlow(root, on) {
    if (on === glowMeshes.has(root)) return;
    if (on) {
      const meshes = root.getChildMeshes().filter(m => !m.metadata?.excludePowerGlow);
      meshes.forEach(m => glow.addIncludedOnlyMesh(m));
      glowMeshes.set(root, meshes);
      if (!root.__glowDisposeHook) {
        root.__glowDisposeHook = true;
        root.onDisposeObservable.add(() => { setAvatarGlow(root, false); glowing.delete(root); });
      }
    } else {
      glowMeshes.get(root).forEach(m => glow.removeIncludedOnlyMesh(m));
      glowMeshes.delete(root);
    }
  }

  // Cajas sorpresa: cubos que giran con el arte original en cada cara
  // (power-cube-holo.webp = caja sorpresa, power-5.webp = caja trampa roja).
  function boxArtMat(name, url) {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseTexture = new B.Texture(url, scene, false, true, B.Texture.TRILINEAR_SAMPLINGMODE);
    m.diffuseColor = new B.Color3(1, 1, 1);
    m.emissiveColor = new B.Color3(0.62, 0.62, 0.62);   // brillo propio: el diseño se ve vivo en todas las caras
    m.specularColor = new B.Color3(0.12, 0.12, 0.12);
    return m;
  }
  const mysteryBoxMat = boxArtMat('mystery-box-art', '/assets/images/powerups/power-cube-holo.webp');
  const trapBoxMat = boxArtMat('trap-box-art', '/assets/images/powerups/power-5.webp');
  function boxCube(name, mat, parent) {
    const cube = B.MeshBuilder.CreateBox(name, {size: 1.4}, scene);   // la imagen completa en las 6 caras
    cube.material = mat;
    cube.parent = parent;
    cube.isPickable = false;
    return cube;
  }

  const crates = Array.from({length: 12}, (_, i) => {
    const root = new B.TransformNode('mystery-box-' + i, scene);
    boxCube('mystery-box-cube', mysteryBoxMat, root);
    root.setEnabled(false);
    return root;
  });

  const entities = new Map();
  let taken = new Set(), locallyTaken = new Set(), lastItem = 0, lastTime = 0, shown = null;
  let lastTimerHtml='',lastWarning='';
  const visibleBoxes=[],live=new Set();

  // 16 Faceted Low Poly Crystal Shards for Burst Effect
  const fragments = Array.from({length: 16}, (_, i) => {
    const isPyramid = i % 2 === 0;
    const m = isPyramid
      ? B.MeshBuilder.CreatePolyhedron('shard-' + i, {type: 1, size: 0.18}, scene)
      : B.MeshBuilder.CreateBox('shard-' + i, {size: 0.22}, scene);
    m.material = i % 3 === 0 ? coreMat : i % 3 === 1 ? neonTrimMat : crateMat;
    m.isPickable = false;
    m.setEnabled(false);
    return m;
  });
  let burst = null;

  function hide() {
    if(!hud.hidden)hud.hidden=true;
    if(!foam.hidden)foam.hidden=true;
    if(glow.isEnabled)glow.isEnabled=false;
    for (const m of crates)if(m.isEnabled())m.setEnabled(false);
    for (const m of entities.values())if(m.isEnabled())m.setEnabled(false);
    for (const m of fragments)if(m.isEnabled())m.setEnabled(false);
    for (const root of glowing) if (!root.isDisposed()) root.setPowerGlow?.(0);
    glowing.clear();
    for (const root of [...glowMeshes.keys()]) setAvatarGlow(root, false);
  }

  // 8 Legible & Stylized In-World Powerup Entities
  function effect(e) {
    const root = new B.TransformNode('power-effect-' + e.kind, scene);

    if (e.kind === 3) {
      // 3. Coco Buscador: 3D Faceted Coconut with glowing rocket flame & aerodynamic fin
      const nut = B.MeshBuilder.CreateIcoSphere('coco-nut', {radius: 0.45, subdivisions: 1, flat: true}, scene);
      nut.parent = root;
      nut.material = coco;

      const leaf = B.MeshBuilder.CreateBox('coco-fin', {width: 0.1, height: 0.35, depth: 0.55}, scene);
      leaf.parent = root;
      leaf.position.set(0, 0.42, -0.15);
      leaf.rotation.x = -0.4;
      leaf.material = cocoLeaf;

      // Rocket flame jet trail behind coconut
      for (let j = 0; j < 4; j++) {
        const jet = B.MeshBuilder.CreateSphere('coco-flame', {diameter: 0.32 - j * 0.06, segments: 6}, scene);
        jet.parent = root;
        jet.position.set(0, 0, j * 0.35 + 0.45);
        jet.material = gold;
      }
    } else if (e.kind === 4) {
      // 4. Remolino: pequeño remolino sutil como un círculo limpio en el agua
      const disc = B.MeshBuilder.CreateDisc('whirlpool-disc', {radius: 0.85, tessellation: 24}, scene);
      disc.rotation.x = Math.PI / 2;
      disc.position.y = 0.02;
      disc.material = water;
      disc.parent = root;

      const ring = B.MeshBuilder.CreateTorus('whirlpool-rim', {diameter: 1.7, thickness: 0.06, tessellation: 24}, scene);
      ring.position.y = 0.03;
      ring.material = white;
      ring.parent = root;
    } else if (e.kind === 5) {
      // 5. Pulso: caja trampa roja, cubo con su arte original (power-5.webp)
      boxCube('trap-box-cube', trapBoxMat, root);
    } else if (e.kind === 6) {
      // 6. Espuma Cegadora: Cluster of stylized low poly foam bubbles & water droplets
      for (let j = 0; j < 6; j++) {
        const bubble = B.MeshBuilder.CreateIcoSphere('foam-bubble', {
          radius: 0.28 + (j % 3) * 0.12,
          subdivisions: 1,
          flat: true
        }, scene);
        bubble.parent = root;
        bubble.position.set(
          Math.sin(j * 1.6) * 0.45,
          Math.cos(j * 2.1) * 0.35 + 0.2,
          j * 0.35 - 0.8
        );
        bubble.material = white;
      }
    } else {
      // Fallback projectile
      const sphere = B.MeshBuilder.CreateSphere('power-sphere', {diameter: 0.8, segments: 10}, scene);
      sphere.parent = root;
      sphere.material = white;
    }

    root.getChildMeshes().forEach(m => {
      m.isPickable = false;
      if (e.kind !== 4 && e.kind !== 5) glow.addIncludedOnlyMesh(m);
    });
    root.metadata = {x: e.x, z: e.z, y: e.y};
    return root;
  }

  return {
    hide,
    async warmup() {
      // Compile all three fragment materials while the loading screen is up,
      // before the first mystery box makes them visible during a race.
      await Promise.allSettled([
        iconsReady,
        ...[fragments[0],fragments[1],fragments[2]].map(mesh=>mesh.material.forceCompilationAsync?.(mesh))
      ]);
    },
    reset() {
      taken = new Set();
      locallyTaken = new Set();
      lastItem = 0;
      shown = null;
      burst = null;
      lastTimerHtml='';lastWarning='';lastTime=0;
      hide();
      for (const m of entities.values()) {
        for (const child of m.getChildMeshes()) glow.removeIncludedOnlyMesh(child);
        m.dispose();
      }
      entities.clear();
    },
    update(p, world, players, time, running, avatar, rivals) {
      if (!p || !world || !running) {
        hide();
        return;
      }
      const dt = Math.min(0.1, Math.max(0, time - lastTime));
      lastTime = time;
      const boxes = world.boxes || [];
      visibleBoxes.length=0;
      for(const box of boxes)if(!world.taken.has(box.id)&&box.z<p.z+12&&box.z>p.z-190)visibleBoxes.push(box);

      // Flotación y giro de cubo (mismo movimiento que antes).
      crates.forEach((root, i) => {
        const box = visibleBoxes[i];
        if(root.isEnabled()!==!!box)root.setEnabled(!!box);
        if (box) {
          const f = trackFrame(-box.z, box.x);
          const bob = 0.16 * Math.sin(time * 3.2 + box.id);
          root.position.set(f.x, f.y + box.y + bob, f.z);
          root.rotation.set(0.12 * Math.sin(time * 2 + box.id), time * 1.5 + box.id, 0.08 * Math.cos(time * 1.8 + box.id));
        }
      });

      // Authoritative pickup synchronization - triggers burst and sound only when powerup is actually awarded
      for (const id of world.taken) {
        if (!taken.has(id)) {
          taken.add(id);
          const box = boxes[id];
          if (box && Math.abs(box.z - p.z) < 35) {
            const f = trackFrame(-box.z, box.x);
            burst = {x: f.x, y: f.y + box.y, z: f.z, start: time};
            playSound('impact');
          }
        }
      }

      const burstAge=burst?time-burst.start:9;
      const burstVisible=burstAge<.65&&settings.effects;
      fragments.forEach((m, i) => {
        if(m.isEnabled()!==burstVisible)m.setEnabled(burstVisible);
        if (burstVisible) {
          const a = i * (Math.PI * 2 / 16);
          const speed = 4.5 + (i % 4) * 0.8;
          m.position.set(
            burst.x + Math.sin(a) * burstAge * speed,
            burst.y + burstAge * 2.5 - burstAge * burstAge * 7.5,
            burst.z + Math.cos(a) * burstAge * speed
          );
          m.rotation.set(burstAge * 6 + i, i * 2, burstAge * 5);
          m.scaling.setAll(Math.max(0.01, 1 - burstAge / 0.65));
        }
      });

      // Ability Roulette & Display
      // La ruleta la decide la simulación (itemRollEnd frente a raceTicks, igual en servidor,
      // práctica y predicción): gira hasta su tick final o hasta que se pulsa E.
      lastItem = p.heldItem;
      const rolling = itemRolling(p);
      const kind = rolling ? 1 + Math.floor(time * 12) % 8 : p.heldItem;
      const isPending = !!p.heldItem;

      if(hud.hidden===isPending)hud.hidden=!isPending;
      if (isPending) {
        const buttonClass=kind?'has-power':'';
        if(button.className!==buttonClass)button.className=buttonClass;
        const item = ITEMS[kind] || 'Caja misteriosa';
        const iconSrc = kind ? iconCache[kind - 1].src : '/assets/images/powerups/power-cube-holo.webp';
        const key = rolling ? -kind : kind;
        if (shown !== key) {
          itemName.textContent = rolling ? 'Ruleta de poderes' : item;
          itemHint.textContent = rolling ? 'E para parar la ruleta' : 'E para usar';
          icon.src = iconSrc;
          shown = key;
        }
      }

      // Timers display
      const activeTimers = [
        ['shieldTicks', 'Inmune (Tiki)'],
        ['turboTicks', 'Turbo Cohete'],
        ['slipTicks', 'Estela Líder'],
        ['slowTicks', 'Frenado']
      ].filter(([k]) => p[k] > 0);

      const timerHtml = activeTimers
        .map(([k, name]) => `<div><span>${name}:</span> ${(p[k] / 30).toFixed(1)}s</div>`)
        .join('');
      if(lastTimerHtml!==timerHtml){timerNode.innerHTML=timerHtml;lastTimerHtml=timerHtml;}

      // Coco approaching or Foam warning
      const leader = (players || []).find(q => q.id === p.slipTarget);
      const isTargetedByCoco = world.entities.some(e => e.kind === 3 && e.target === p.id);

      const warning = p.slipTicks && leader
        ? ((p.slipActive ? '★ Estela activa: ' : 'Sigue a ') + (leader.nick || 'Surfer'))
        : p.foamTicks
        ? '¡Espuma en la vista!'
        : isTargetedByCoco
        ? '⚠️ ¡Coco buscador acercándose!'
        : '';
      if(lastWarning!==warning){warningNode.textContent=warning;lastWarning=warning;}

      const foamHidden=!(p.foamTicks>0);
      if(foam.hidden!==foamHidden)foam.hidden=foamHidden;
      const foamOpacity=settings.effects?'1':'0.4';
      if(foam.style.opacity!==foamOpacity)foam.style.opacity=foamOpacity;

      // Live Entities update
      live.clear();
      for (const e of world.entities) {
        live.add(e.id);
        let root = entities.get(e.id);
        if (!root) {
          root = effect(e);
          entities.set(e.id, root);
        }
        if(!root.isEnabled())root.setEnabled(true);

        const pos = root.metadata;
        const blend = 1 - Math.exp(-25 * dt);
        for (const k of ['x', 'z', 'y']) pos[k] += (e[k] - pos[k]) * blend;
        const f = trackFrame(-pos.z, pos.x);

        if (e.kind === 4) {
          // Remolino: sits cleanly flat on the water surface and stays there
          root.position.set(f.x, f.y + 0.02, f.z);
          root.rotation.y = time * 0.8;
        } else if (e.kind === 5) {
          // Caja trampa: quieta sobre el agua, flotando y girando como un cubo
          const bob = 0.16 * Math.sin(time * 3.2 + e.id);
          root.position.set(f.x, f.y + 0.9 + bob, f.z);
          root.rotation.set(0.12 * Math.sin(time * 2 + e.id), time * 1.5 + e.id, 0.08 * Math.cos(time * 1.8 + e.id));
        } else {
          root.position.set(f.x, f.y + pos.y + 0.15, f.z);
          if (e.kind === 3 || e.kind === 6) {
            root.rotation.y = f.yaw;
          } else {
            root.rotation.y = time * 3;
          }
        }

        const scale = 1;
        root.scaling.setAll(scale);
        root.getChildMeshes().forEach((m, i) => {
          const enabled=i===0||settings.effects;
          if(m.isEnabled()!==enabled)m.setEnabled(enabled);
        });
      }

      for (const [id, m] of entities) {
        if (!live.has(id)) {
          for (const child of m.getChildMeshes()) glow.removeIncludedOnlyMesh(child);
          m.dispose();
          entities.delete(id);
        }
      }

      // Avatar & Rivals aura synchronization. Solo los avatares con poder activo entran en el
      // GlowLayer: con 7 bots, meter siempre los 8 avatares obligaba a redibujarlos todos en la
      // pasada de brillo en cada frame.
      const fancy = settings.effects && settings.quality !== 'low';
      let glowNearby = false;
      for (const q of players || []) {
        const root = q.id === p.id ? avatar : rivals?.get(q.id);
        if (!root) continue;
        const kind = q.shieldTicks ? 1 : q.turboTicks ? 2 : q.dolphinTicks ? 7 : q.slipActive ? 8 : 0;
        root.setPowerGlow?.(kind, fancy ? 1 : 0.35);
        const shine = !!kind && fancy && root.isEnabled() && Math.abs(q.z - p.z) < GLOW_RANGE;
        setAvatarGlow(root, shine);
        if (shine) glowNearby = true;
        if (kind) glowing.add(root);
        else glowing.delete(root);
      }
      // El GlowLayer (pasada extra + desenfoque) solo se enciende si hay algo cerca que brille.
      // Remolinos y trampas (4 y 5) no brillan: al no caducar lo dejaban encendido toda la carrera.
      const needsGlow = fancy && (glowNearby || world.entities.some(e => e.kind !== 4 && e.kind !== 5 && Math.abs(e.z - p.z) < GLOW_RANGE));
      if(glow.isEnabled!==needsGlow)glow.isEnabled=needsGlow;
    }
  };
}
