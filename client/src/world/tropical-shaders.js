// Environment-only shaders and skybox generator.
// Gerstner wave displacement and CPU movement calculations remain 100% unchanged.

export const tropicalWaterFragment = `
precision highp float;
varying vec3 vWorldPos, vNormal;
varying float vCrest;
varying vec2 vUV;
uniform vec3 uCameraPos, uDeep, uShallow, uShore, uFogColor, uSunDir;
uniform float uTime, uFogDensity, uStyle, uCausticStrength;
uniform sampler2D uNormalTex, uFoamTex, uCausticTex, uLaceTex;
uniform samplerCube uSky;

vec2 hash(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

// Legacy animated Voronoi caustics (used by the other circuits).
float caustic(vec2 p) {
  vec2 g = floor(p), f = fract(p);
  float a = 9.0, b = 9.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 q = vec2(float(x), float(y));
      vec2 h = hash(g + q);
      vec2 d = q + 0.5 + 0.35 * sin(uTime * 0.55 + 6.2831 * h) - f;
      float v = dot(d, d);
      if (v < a) { b = a; a = v; } else { b = min(b, v); }
    }
  }
  return 1.0 - smoothstep(0.015, 0.10, b - a);
}

vec4 legacyWater() {
  vec2 p = vWorldPos.xz;
  float shore = clamp(vUV.x, 0.0, 1.0);
  vec3 V = normalize(uCameraPos - vWorldPos);
  vec2 n1 = texture2D(uNormalTex, p * 0.048 + vec2(uTime * 0.010, -uTime * 0.014)).rb - 0.5;
  vec2 n2 = texture2D(uNormalTex, p * 0.105 + vec2(-uTime * 0.016, uTime * 0.009)).rb - 0.5;
  vec3 N = normalize(vNormal + vec3((n1.x + n2.x) * 0.42, 0.0, (n1.y + n2.y) * 0.42));
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.5);
  vec3 deepCol = vec3(0.00, 0.33, 0.55);
  vec3 shallowCol = vec3(0.01, 0.61, 0.72);
  vec3 shoreCol = vec3(0.13, 0.79, 0.75);
  float depthGrad = clamp(0.10 + shore * 0.65 + n1.x * 0.12, 0.0, 1.0);
  vec3 col = mix(deepCol, shallowCol, depthGrad);
  col = mix(col, shoreCol, smoothstep(0.65, 1.0, shore) * 0.65);
  float distToCam = length(uCameraPos - vWorldPos);
  col = mix(col, deepCol, smoothstep(25.0, 105.0, distToCam) * 0.42);
  float c1 = caustic(p * 0.55 + vec2(sin(p.y * 1.2 + uTime * 0.35), cos(p.x * 1.1 - uTime * 0.45)) * 0.38 + n1 * 0.45);
  float caustics = c1 * (.65 + .35 * sin(p.x*.38+p.y*.26+uTime*.3));
  col += vec3(0.75, 1.0, 0.95) * caustics * (0.035 + shore * 0.095) * (1.0 - fresnel * 0.65);
  vec3 reflection = mix(vec3(0.20, 0.65, 0.95), vec3(0.75, 0.94, 1.0), clamp(N.y * 0.5, 0.0, 1.0));
  vec3 reflected = pow(max(textureCube(uSky, reflect(-V, N)).rgb, vec3(0.0)), vec3(0.4545));
  col = mix(col, mix(reflection, reflected, 0.70), 0.025 + fresnel * 0.22);
  vec3 H = normalize(V + uSunDir);
  col += vec3(1.0, 0.96, 0.82) * pow(max(dot(N, H), 0.0), 120.0) * 0.55;
  float noise = texture2D(uFoamTex, p * 0.18 + vec2(uTime * 0.022, 0.0)).r;
  float waveFront1 = sin(p.x * 0.22 + sin(p.y * 0.14) * 1.5 + (noise-.5)*1.1 - uTime * 1.8);
  float waveFront2 = sin(p.x * 0.12 - p.y * 0.08 - uTime * 1.2 + 2.4);
  float swellFoam1 = smoothstep(0.84, 0.98, waveFront1) * smoothstep(0.42, 0.66, noise);
  float swellFoam2 = smoothstep(0.90, 0.995, waveFront2) * smoothstep(0.50, 0.73, noise);
  float shoreFoam = smoothstep(0.91, 0.995, shore) * smoothstep(0.20, 0.55, noise);
  float crestFoam = smoothstep(0.25, 0.46, vCrest) * smoothstep(0.35, 0.68, noise);
  float foam = clamp(swellFoam1 * 0.65 + swellFoam2 * 0.35 + shoreFoam * 1.25 + crestFoam * 0.8, 0.0, 1.0);
  col = mix(col, vec3(0.98, 1.0, 1.0), foam);
  float fog = distToCam * uFogDensity;
  col = mix(col, uFogColor, 1.0 - exp(-fog * fog));
  float depthAlpha = clamp(0.72 + distToCam * 0.0025 + (1.0 - shore) * 0.15, 0.72, 0.96);
  return vec4(pow(max(col, vec3(0.0)), vec3(2.2)), mix(depthAlpha, 1.0, foam));
}

// Bahia Coral: stylized crystal-clear tropical lagoon.
vec4 coralWater() {
  vec2 p = vWorldPos.xz;
  float shore = clamp(vUV.x, 0.0, 1.0);          // 1 = beach edge, 0 = open sea
  vec3 toCam = uCameraPos - vWorldPos;
  float distToCam = length(toCam);
  vec3 V = toCam / distToCam;

  // Two scrolling ripple layers over the Gerstner normal.
  vec2 n1 = texture2D(uNormalTex, p * 0.055 + vec2(uTime * 0.012, -uTime * 0.017)).rb - 0.5;
  vec2 n2 = texture2D(uNormalTex, p * 0.140 + vec2(-uTime * 0.021, uTime * 0.011)).rb - 0.5;
  float rippleFade = 1.0 - smoothstep(30.0, 120.0, distToCam);
  vec3 N = normalize(vNormal + vec3((n1.x + n2.x) * 0.55, 0.0, (n1.y + n2.y) * 0.55) * (0.35 + 0.65 * rippleFade));
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);

  // Seabed variation: soft darker patches (rocks/seagrass) read through shallow water.
  float bed = texture2D(uCausticTex, p * 0.018).b;
  float bed2 = texture2D(uCausticTex, p * 0.047 + 0.37).b;
  float patches = smoothstep(0.52, 0.74, bed * 0.65 + bed2 * 0.35);

  // Depth palette: deep royal blue -> azure lane -> luminous turquoise shallows.
  float depth = clamp(1.0 - shore * 1.08 + (bed - 0.5) * 0.18, 0.0, 1.0);
  vec3 col = mix(uShore, uShallow, smoothstep(0.0, 0.22, depth));
  col = mix(col, uDeep, smoothstep(0.30, 0.85, depth));
  col = mix(col, col * vec3(0.55, 0.72, 0.80), patches * (1.0 - depth) * 0.55);
  col = mix(col, uDeep * 0.92, smoothstep(40.0, 190.0, distToCam) * 0.35);

  // Caustic web: two drifting line fields multiplied for the sharp crossing pattern.
  vec2 cw = n1 * 0.06;
  float ca = texture2D(uCausticTex, p * 0.105 + vec2(uTime * 0.021, uTime * 0.013) + cw).r;
  float cb = texture2D(uCausticTex, p * 0.083 + vec2(-uTime * 0.017, uTime * 0.024) - cw).g;
  float web = clamp(ca * 0.75 + cb * 0.75 + ca * cb * 1.6, 0.0, 1.6);
  float causticMask = (0.35 + 0.65 * smoothstep(0.05, 0.85, 1.0 - depth)) * rippleFade * (1.0 - fresnel);
  col += vec3(0.55, 0.95, 1.0) * web * uCausticStrength * causticMask;

  // Sky reflection, stronger at grazing angles toward the horizon.
  vec3 reflected = pow(max(textureCube(uSky, reflect(-V, N)).rgb, vec3(0.0)), vec3(0.4545));
  vec3 skyTint = mix(vec3(0.30, 0.66, 0.98), reflected, 0.6);
  col = mix(col, skyTint, clamp(0.04 + fresnel * 0.55, 0.0, 0.62));

  // Sun: broad sheen plus crisp sparkles on ripple facets.
  vec3 H = normalize(V + uSunDir);
  float nh = max(dot(N, H), 0.0);
  col += vec3(1.0, 0.97, 0.86) * (pow(nh, 90.0) * 0.16 + pow(nh, 1400.0) * 2.2);

  // Foam: crest streaks, lacy shore break and a few drifting lines. No cloud-like blobs.
  float lace = texture2D(uLaceTex, p * 0.16 + vec2(uTime * 0.018, uTime * 0.006)).a;
  float lace2 = texture2D(uLaceTex, p * 0.34 - vec2(uTime * 0.01, uTime * 0.02)).a;
  float crestFoam = smoothstep(0.20, 0.40, vCrest) * smoothstep(0.35, 0.75, lace);
  float front = sin(p.x * 0.20 + sin(p.y * 0.11) * 1.7 - uTime * 1.6);
  float front2 = sin(p.x * 0.13 - p.y * 0.09 - uTime * 1.1 + 1.7);
  float streaks = (smoothstep(0.90, 0.995, front) + smoothstep(0.93, 0.998, front2) * 0.8) * smoothstep(0.42, 0.8, lace2) * (0.45 + 0.55 * depth);
  float edge = smoothstep(0.945, 0.995, shore);
  float shoreBand = edge * smoothstep(0.15, 0.55, lace + 0.35 * sin(uTime * 1.3 + p.y * 0.35));
  float shoreLace = smoothstep(0.86, 0.945, shore) * smoothstep(0.55, 0.9, lace2) * 0.8;
  float foam = clamp(crestFoam * 0.75 + streaks * 0.55 + shoreBand * 1.1 + shoreLace, 0.0, 1.0);
  col = mix(col, vec3(0.97, 1.0, 1.0), foam);

  // Atmospheric perspective only in the distance.
  float fog = distToCam * uFogDensity * 0.8;
  col = mix(col, uFogColor, 1.0 - exp(-fog * fog));

  // Clarity: the shallows show the seabed near the camera, depth becomes opaque.
  float alpha = mix(0.62, 0.94, smoothstep(0.05, 0.6, depth));
  alpha = mix(alpha, 0.97, smoothstep(18.0, 90.0, distToCam));
  alpha = clamp(alpha + fresnel * 0.35 + web * 0.04, 0.0, 1.0);
  alpha = mix(alpha, 1.0, foam);
  return vec4(pow(max(col, vec3(0.0)), vec3(2.2)), alpha);
}

void main() {
  gl_FragColor = uStyle > 0.5 ? coralWater() : legacyWater();
}`;

export function createTropicalSky(B, scene) {
  if(new URLSearchParams(location.search).has('environment-check')){
    let count=0;const frames=[];
    const observer=scene.onAfterRenderObservable.add(()=>{
      if(!document.getElementById('overlay')?.classList.contains('hidden'))return;
      if(++count<=180)return;
      frames.push(scene.getEngine().getDeltaTime());
      if(frames.length===300){
        const mean=frames.reduce((a,b)=>a+b,0)/frames.length;
        console.info('[environment-check]',JSON.stringify({fps:1000/mean,meanFrameMs:mean,meshes:scene.meshes.length}));
        scene.onAfterRenderObservable.remove(observer);
      }
    });
  }

  B.Effect.ShadersStore.tropicalSkyVertexShader = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    varying vec3 dir;
    void main() {
      dir = position;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }
  `;

  // Deep vibrant azure tropical sky gradient matching Image B
  B.Effect.ShadersStore.tropicalSkyFragmentShader = `
    precision highp float;
    varying vec3 dir;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                 mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    float fbm(vec2 p) {
      return noise(p) * 0.56 + noise(p * 2.05) * 0.28 + noise(p * 4.12) * 0.16;
    }

    void main() {
      vec3 d = normalize(dir);
      float h = max(d.y, 0.0);

      // Azure Blue Sky Gradient: Rich deep blue zenith -> Tropical cyan-blue -> Sunlit luminous horizon
      vec3 zenith = vec3(0.05, 0.43, 0.94);
      vec3 midSky = vec3(0.16, 0.64, 0.98);
      vec3 horizon = vec3(0.57, 0.86, 1.0);

      vec3 skyColor = mix(horizon, midSky, smoothstep(0.0, 0.28, h));
      skyColor = mix(skyColor, zenith, smoothstep(0.28, 0.85, h));

      // Wispy background cirrus clouds
      vec2 p = d.xz / (h + 0.15) * 2.2;
      float n = fbm(p + vec2(0.05, 0.02));
      float cloud = smoothstep(0.50, 0.68, n) * smoothstep(0.03, 0.18, h) * (1.0 - smoothstep(0.65, 0.90, h));
      vec3 cloudColor = vec3(1.0, 0.99, 0.97);

      vec3 finalCol = mix(skyColor, cloudColor, cloud * 0.75);
      gl_FragColor = vec4(pow(finalCol, vec3(2.2)), 1.0);
    }
  `;

  const m = new B.ShaderMaterial('skyMat', scene, {
    vertex: 'tropicalSky',
    fragment: 'tropicalSky'
  }, {
    attributes: ['position'],
    uniforms: ['worldViewProjection']
  });
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  m.fogEnabled = false;

  // Soft cloud silhouettes keep their detailed shape at any course angle.
  const cloudTexture=new B.Texture('./assets/images/environment/tropical-clouds.png',scene);
  cloudTexture.hasAlpha=true;
  const cloudMat=new B.StandardMaterial('tropical-cumulus-mat',scene);
  cloudMat.diffuseTexture=cloudTexture;
  cloudMat.opacityTexture=cloudTexture;
  cloudMat.emissiveTexture=cloudTexture;
  cloudMat.diffuseColor=B.Color3.Black();
  cloudMat.emissiveColor=B.Color3.White();
  cloudMat.specularColor=B.Color3.Black();
  cloudMat.disableLighting=true;
  cloudMat.fogEnabled=false;
  cloudMat.backFaceCulling=false;
  cloudMat.transparencyMode=B.Material.MATERIAL_ALPHATEST;
  cloudMat.alphaCutOff=.16;
  const clusterAngles=[.15,.55,1.05,1.65,2.25,2.85,3.45,4.15,4.85,5.55];
  for(let i=0;i<clusterAngles.length;i++){
    const a=clusterAngles[i],rad=460+(i%3)*55;
    const cloud=B.MeshBuilder.CreatePlane('tropical-cumulus-cluster',{width:185+(i%3)*23,height:66+(i%2)*9},scene);
    cloud.position.set(Math.cos(a)*rad,80+(i%4)*15,Math.sin(a)*rad);
    cloud.billboardMode=B.Mesh.BILLBOARDMODE_ALL;
    cloud.material=cloudMat;
    cloud.isPickable=false;
    cloud.checkCollisions=false;
    cloud.applyFog=false;
  }

  // Flock of distant tropical seabirds (gaviotas) soaring across the bay
  const birdMat = new B.StandardMaterial('seabird-mat', scene);
  birdMat.diffuseColor = new B.Color3(1, 1, 1);
  birdMat.emissiveColor = new B.Color3(0.85, 0.90, 0.95);
  birdMat.specularColor = B.Color3.Black();
  birdMat.backFaceCulling = false;

  const birds = [];
  const birdConfigs = [
    {x: -42, y: 22, z: 82, rotY: 0.25, scale: 0.85},
    {x: -48, y: 24, z: 86, rotY: 0.25, scale: 0.75},
    {x: -36, y: 23, z: 78, rotY: 0.25, scale: 0.80},
    {x: -56, y: 26, z: 90, rotY: 0.25, scale: 0.70},
    {x: -64, y: 28, z: 94, rotY: 0.25, scale: 0.65}
  ];

  for (let i = 0; i < birdConfigs.length; i++) {
    const c = birdConfigs[i];
    // Stylized V-wing silhouette
    const leftWing = B.MeshBuilder.CreateBox('bird-lw', {width: 1.6 * c.scale, height: 0.08 * c.scale, depth: 0.45 * c.scale}, scene);
    leftWing.position.set(c.x - 0.7 * c.scale, c.y, c.z);
    leftWing.rotation.set(0, c.rotY, -0.28);

    const rightWing = B.MeshBuilder.CreateBox('bird-rw', {width: 1.6 * c.scale, height: 0.08 * c.scale, depth: 0.45 * c.scale}, scene);
    rightWing.position.set(c.x + 0.7 * c.scale, c.y, c.z);
    rightWing.rotation.set(0, c.rotY, 0.28);

    leftWing.material = birdMat;
    rightWing.material = birdMat;
    birds.push(leftWing, rightWing);
  }

  const mergedBirds = B.Mesh.MergeMeshes(birds, true, true);
  if (mergedBirds) {
    mergedBirds.name = 'distant-seabirds';
    mergedBirds.material = birdMat;
    mergedBirds.isPickable = false;
    mergedBirds.freezeWorldMatrix();
  }

  return m;
}
