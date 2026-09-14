import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadedSkin, requestSkin, retainSkin, releaseSkin } from './skin-assets.js';
import { disposeInstanceSkeletons } from './resource-lifecycle.js';
import { EQUIPMENT, UTILITY_IDS } from '../shared/equipment.js';

function pointToSegmentDistance(p, s1, s2) {
  const dx = s2.x - s1.x, dy = s2.y - s1.y, dz = s2.z - s1.z;
  const lenSq = dx * dx + dy * dy + dz * dz;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((p.x - s1.x) * dx + (p.y - s1.y) * dy + (p.z - s1.z) * dz) / lenSq)) : 0;
  return Math.hypot(p.x - (s1.x + t * dx), p.y - (s1.y + t * dy), p.z - (s1.z + t * dz));
}

function createSmokeNoise() {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let seed = 1337;
  function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
  for (let i = 255; i > 0; i--) {
    const n = Math.floor(rnd() * (i + 1));
    const q = p[i]; p[i] = p[n]; p[n] = q;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  function grad(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2.0 * v : 2.0 * v);
  }
  return function(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const fx = (3 - 2 * x) * x * x, fy = (3 - 2 * y) * y * y;
    const p0 = perm[X] + Y, p1 = perm[X + 1] + Y;
    return (1 - fy) * ((1 - fx) * grad(perm[p0], x, y) + fx * grad(perm[p1], x - 1, y)) +
           fy * ((1 - fx) * grad(perm[p0 + 1], x, y - 1) + fx * grad(perm[p1 + 1], x - 1, y - 1));
  };
}

function createProceduralSmokeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(128, 128);
  const data = imgData.data;
  const noise = createSmokeNoise();

  function fbm(x, y) {
    return noise(x, y) * 0.53 + noise(x * 2.1, y * 2.1) * 0.27 + noise(x * 4.3, y * 4.3) * 0.14 + noise(x * 8.7, y * 8.7) * 0.06;
  }

  for (let j = 0; j < 128; j++) {
    for (let i = 0; i < 128; i++) {
      const u = (i / 127) * 2 - 1;
      const v = (j / 127) * 2 - 1;
      const r = Math.hypot(u, v);
      const idx = (j * 128 + i) * 4;

      if (r >= 0.98) {
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = 0;
        continue;
      }

      // 2-level domain warping for curl/swirl fluid turbulence
      const qx = fbm(u * 2.2 + 1.3, v * 2.2 + 3.7);
      const qy = fbm(u * 2.2 + 4.1, v * 2.2 + 1.9);
      const turb = fbm(u * 2.6 + qx * 1.1, v * 2.6 + qy * 1.1);

      // Perturbed radial distance
      const dist = r + turb * 0.26;
      let a = 0;
      if (dist <= 0.42) {
        a = 1.0;
      } else if (dist < 0.96) {
        const f = 1.0 - (dist - 0.42) / (0.96 - 0.42);
        a = f * f * (3 - 2 * f);
        a = Math.min(1.0, Math.max(0.0, a * (1.0 + turb * 0.32)));
      }

      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(a * 255);
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createProceduralFlameSpritesheet() {
  const cols = 4, rows = 4;
  const frameW = 64, frameH = 128;
  const totalW = cols * frameW, totalH = rows * frameH;
  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(totalW, totalH);
  const data = imgData.data;
  const noise = createSmokeNoise();

  function fbm(x, y) {
    return noise(x, y) * 0.53 + noise(x * 2.1, y * 2.1) * 0.27 + noise(x * 4.3, y * 4.3) * 0.14 + noise(x * 8.7, y * 8.7) * 0.06;
  }

  for (let frame = 0; frame < 16; frame++) {
    const col = frame % cols;
    const row = Math.floor(frame / cols);
    const startX = col * frameW;
    const startY = row * frameH;
    const phase = (frame / 16) * Math.PI * 2;

    for (let py = 0; py < frameH; py++) {
      const v = 1 - py / (frameH - 1);
      const bottomFeather = Math.min(1, v / 0.06);
      const baseWidth = (0.28 + 0.35 * Math.sin(Math.min(1, v * 2.8) * Math.PI * 0.5)) * Math.pow(Math.max(0, 1 - v), 0.55);

      for (let px = 0; px < frameW; px++) {
        const u = (px / (frameW - 1)) * 2 - 1;
        const flowY = v * 3.5 - phase * 0.65;
        const warpX = fbm(u * 2.5 + Math.sin(phase) * 0.5, flowY);
        const sway = Math.sin(v * 7.0 + phase) * 0.14 * v;
        const centerDist = Math.abs(u - sway + warpX * 0.32) / Math.max(0.001, baseWidth);

        if (centerDist >= 1.0 || v >= 0.98) continue;

        const flameShape = Math.max(0, 1.0 - centerDist * centerDist);
        const tipFade = Math.pow(1 - v, 0.4);
        const alpha = flameShape * tipFade * bottomFeather;

        const gx = startX + px;
        const gy = startY + py;
        const idx = (gy * totalW + gx) * 4;

        let r, g, b;
        if (v < 0.35 && centerDist < 0.55) {
          const t = Math.max(0, 1.0 - (centerDist / 0.55));
          r = 255;
          g = Math.round(140 + 80 * t * (1 - v / 0.35));
          b = Math.round(20 + 70 * t * (1 - v / 0.35));
        } else if (v < 0.70) {
          const t = (v - 0.35) / (0.70 - 0.35);
          r = Math.round(255 - t * 40);
          g = Math.round(140 * (1 - t * 0.8));
          b = 0;
        } else {
          const t = (v - 0.70) / (1.0 - 0.70);
          r = Math.round(215 * (1 - t * 0.65));
          g = Math.round(28 * (1 - t));
          b = 0;
        }

        const valveScale = 0.65;
        data[idx] = Math.round(r * valveScale);
        data[idx + 1] = Math.round(g * valveScale);
        data[idx + 2] = Math.round(b * valveScale);
        data[idx + 3] = Math.round(alpha * 255);
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createProceduralFireCarpetTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(128, 128);
  const data = imgData.data;
  const noise = createSmokeNoise();

  function fbm(x, y) {
    return noise(x, y) * 0.53 + noise(x * 2.1, y * 2.1) * 0.27 + noise(x * 4.3, y * 4.3) * 0.14 + noise(x * 8.7, y * 8.7) * 0.06;
  }

  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const u = (x / 127) * 2 - 1;
      const v = (y / 127) * 2 - 1;
      const r = Math.hypot(u, v);
      const idx = (y * 128 + x) * 4;

      if (r >= 0.95) continue;

      const turb = fbm(u * 3.2 + 2.1, v * 3.2 + 1.4);
      const perturbedR = r + turb * 0.25;
      if (perturbedR >= 0.95) continue;

      const normDist = Math.max(0, perturbedR / 0.95);
      const fade = Math.pow(1 - normDist, 1.8);

      // Charred dark soot (#151210) with subtle embers in micro-cracks (NO yellow pancake!)
      const crack = Math.abs(fbm(u * 6.0, v * 6.0));
      const isEmber = normDist < 0.45 && crack > 0.35;

      let rCol, gCol, bCol, aCol;
      if (isEmber) {
        const emberT = (crack - 0.35) / 0.65;
        rCol = Math.round(180 * emberT);
        gCol = Math.round(40 * emberT);
        bCol = 0;
        aCol = Math.round(190 * fade);
      } else {
        rCol = Math.round(20 * (1 - normDist * 0.4));
        gCol = Math.round(18 * (1 - normDist * 0.4));
        bCol = Math.round(16 * (1 - normDist * 0.4));
        aCol = Math.round(160 * fade);
      }

      data[idx] = rCol;
      data[idx + 1] = gCol;
      data[idx + 2] = bCol;
      data[idx + 3] = aCol;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** CS2 volumetric smoke shader, explosion VFX, and bounded utility projectile effects. */
export class UtilityEffects {
  constructor(scene) {
    this.scene = scene;
    this.projectiles = new Map();
    this.smokes = [];
    this.fires = [];
    this.carves = [];
    this.activeExplosions = [];
    this.scorchDecals = [];
    this.clock = 0;
    this.grenadeGeometry = new THREE.CapsuleGeometry(0.045, 0.08, 3, 6);
    this.planeGeo = new THREE.PlaneGeometry(1, 1);
    this.materials = Object.fromEntries(
      [...UTILITY_IDS, 'defusekit'].map(id => [
        id,
        new THREE.MeshStandardMaterial({
          color: EQUIPMENT[id].color || '#66849c',
          metalness: 0.4,
          roughness: 0.6
        })
      ])
    );

    // 1. Procedural fractal curl-noise smoke puff texture with 100% opaque core
    this.smokeTexture = createProceduralSmokeTexture();

    // 2. CS2 Volumetric Shader Uniforms (Directional sunlight, self-shadowing & carving)
    this.smokeUniforms = {
      uSunDirection: { value: new THREE.Vector3(0.38, 0.88, 0.28).normalize() },
      uSunColor: { value: new THREE.Color(0.91, 0.93, 0.89) },
      uShadowColor: { value: new THREE.Color(0.16, 0.18, 0.15) },
      uBulletCount: { value: 0 },
      uBulletStarts: { value: new Float32Array(16 * 3) },
      uBulletEnds: { value: new Float32Array(16 * 3) },
      uBulletRadii: { value: new Float32Array(16) },
      uExplosionCount: { value: 0 },
      uExplosionPositions: { value: new Float32Array(4 * 3) },
      uExplosionRadii: { value: new Float32Array(4) }
    };

    this.smokeMaterial = new THREE.MeshBasicMaterial({
      map: this.smokeTexture,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.smokeMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.smokeUniforms);
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aCloudCenter;
        attribute float aCloudRadius;
        varying vec3 vSmokeWorldPos;
        varying vec2 vLocalUV;
        varying vec3 vCloudCenter;
        varying float vCloudRadius;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vLocalUV = transformed.xy;
        vCloudCenter = aCloudCenter;
        vCloudRadius = aCloudRadius;
        vec4 worldPosCalc = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          worldPosCalc = instanceMatrix * worldPosCalc;
        #endif
        worldPosCalc = modelMatrix * worldPosCalc;
        vSmokeWorldPos = worldPosCalc.xyz;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vSmokeWorldPos;
        varying vec2 vLocalUV;
        varying vec3 vCloudCenter;
        varying float vCloudRadius;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uShadowColor;
        uniform int uBulletCount;
        uniform vec3 uBulletStarts[16];
        uniform vec3 uBulletEnds[16];
        uniform float uBulletRadii[16];
        uniform int uExplosionCount;
        uniform vec3 uExplosionPositions[4];
        uniform float uExplosionRadii[4];`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 macroOffset = vSmokeWorldPos - vCloudCenter;
        float distFromCenter = length(macroOffset);
        vec3 macroDir = vec3(macroOffset.x, macroOffset.y * 1.8 + 0.35, macroOffset.z);
        vec3 macroNorm = normalize(macroDir);

        vec2 pUv = vLocalUV * 2.0;
        float rSq = dot(pUv, pUv);
        float nZ = sqrt(max(0.0, 1.0 - min(1.0, rSq)));
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 camForward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vec3 microNorm = normalize(camRight * pUv.x + camUp * pUv.y + camForward * nZ);

        vec3 worldNorm = normalize(mix(microNorm, macroNorm, 0.80));

        float nDotL = dot(worldNorm, uSunDirection);
        float sunFactor = clamp(nDotL * 0.52 + 0.48, 0.0, 1.0);
        float depthRatio = clamp(distFromCenter / max(0.6, vCloudRadius), 0.0, 1.0);
        float groundY = vCloudCenter.y - 1.25;
        float heightRatio = clamp((vSmokeWorldPos.y - groundY) / (vCloudRadius * 0.65), 0.0, 1.0);

        float ao = clamp(depthRatio * 0.55 + heightRatio * 0.45, 0.22, 1.0);
        ao = smoothstep(0.12, 0.95, ao);

        vec3 sunLit = uSunColor * (sunFactor * 0.85 + 0.15);
        vec3 shadowLit = uShadowColor * (ao * 0.75 + 0.25);
        vec3 cloudColor = mix(shadowLit, sunLit, sunFactor * (0.35 + 0.65 * heightRatio));
        diffuseColor.rgb = cloudColor;

        float coreBoost = smoothstep(0.04, 0.55, diffuseColor.a);
        diffuseColor.a = mix(diffuseColor.a, 1.0, coreBoost * 0.65);

        float carveFade = 1.0;
        for (int i = 0; i < 4; i++) {
          if (i >= uExplosionCount) break;
          float d = distance(vSmokeWorldPos, uExplosionPositions[i]);
          float r = uExplosionRadii[i];
          if (d < r) {
            carveFade = 0.0;
            break;
          } else if (d < r + 0.45) {
            carveFade *= smoothstep(0.0, 1.0, (d - r) / 0.45);
          }
        }
        if (carveFade > 0.001) {
          for (int j = 0; j < 16; j++) {
            if (j >= uBulletCount) break;
            vec3 ba = uBulletEnds[j] - uBulletStarts[j];
            vec3 pa = vSmokeWorldPos - uBulletStarts[j];
            float l2 = dot(ba, ba);
            float h = l2 > 0.0001 ? clamp(dot(pa, ba) / l2, 0.0, 1.0) : 0.0;
            float d = length(pa - ba * h);
            float br = uBulletRadii[j];
            if (d < br) {
              carveFade = 0.0;
              break;
            } else if (d < br + 0.18) {
              carveFade *= smoothstep(0.0, 1.0, (d - br) / 0.18);
            }
          }
        }
        diffuseColor.a *= carveFade;
        if (diffuseColor.a < 0.005) discard;`
      );
    };

    // Dedicated instanced mesh and attributes for volumetric smoke
    this.smokeGeo = new THREE.PlaneGeometry(1, 1);
    const maxSmokeInstances = 20 * 56;
    this.smokeCloudCenters = new Float32Array(maxSmokeInstances * 3);
    this.smokeCloudRadii = new Float32Array(maxSmokeInstances);
    this.smokeGeo.setAttribute('aCloudCenter', new THREE.InstancedBufferAttribute(this.smokeCloudCenters, 3));
    this.smokeGeo.setAttribute('aCloudRadius', new THREE.InstancedBufferAttribute(this.smokeCloudRadii, 1));

    this.smokeMesh = new THREE.InstancedMesh(this.smokeGeo, this.smokeMaterial, maxSmokeInstances);
    this.smokeMesh.count = 0;
    this.smokeMesh.frustumCulled = false;
    scene.add(this.smokeMesh);

    this.rollAxis = new THREE.Vector3(0, 0, 1);
    this.rollQuat = new THREE.Quaternion();

    // 3. Valve CS2 / Source Official Inferno Animated Flame & Ground Scorch VFX
    this.fireTexture = createProceduralFlameSpritesheet();
    this.fireUniforms = {
      uTime: { value: 0 }
    };
    this.fireMaterial = new THREE.MeshBasicMaterial({
      map: this.fireTexture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      opacity: 0.85
    });

    this.fireMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.fireUniforms.uTime;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec2 vFlameUv;
        attribute float aPhase;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        float frame = mod(floor((uTime * 20.0) + aPhase * 16.0), 16.0);
        float col = mod(frame, 4.0);
        float row = floor(frame / 4.0);
        vFlameUv = vec2((uv.x + col) * 0.25, (uv.y + (3.0 - row)) * 0.25);`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        varying vec2 vFlameUv;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sampledColor = texture2D( map, vFlameUv );
          diffuseColor *= sampledColor;
        #endif`
      );
    };

    // Ground-anchored unit plane geometry (bottom edge at y = 0, top at y = 1)
    this.flameGeo = new THREE.PlaneGeometry(1, 1);
    this.flameGeo.translate(0, 0.5, 0); // Pivot at ground bottom!
    
    const maxFlames = 12 * 60 * 2;
    const flamePhases = new Float32Array(maxFlames);
    for (let i = 0; i < maxFlames; i++) {
      flamePhases[i] = (i * 0.173 + (i % 7) * 0.11) % 1.0;
    }
    this.flameGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(flamePhases, 1));

    this.fireMesh = new THREE.InstancedMesh(this.flameGeo, this.fireMaterial, maxFlames);
    this.fireMesh.count = 0;
    this.fireMesh.frustumCulled = false;
    scene.add(this.fireMesh);

    this.fireCarpetTexture = createProceduralFireCarpetTexture();
    this.fireCarpetMaterial = new THREE.MeshBasicMaterial({
      map: this.fireCarpetTexture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      opacity: 0.65
    });
    this.fireCarpetMesh = new THREE.InstancedMesh(this.planeGeo, this.fireCarpetMaterial, 12);
    this.fireCarpetMesh.count = 0;
    this.fireCarpetMesh.frustumCulled = false;
    scene.add(this.fireCarpetMesh);

    // 4. CS2 Authentic Explosion Textures
    const fCanvas = document.createElement('canvas');
    fCanvas.width = fCanvas.height = 128;
    const fCtx = fCanvas.getContext('2d');
    const fGrad = fCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    fGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    fGrad.addColorStop(0.18, 'rgba(255, 240, 160, 0.98)');
    fGrad.addColorStop(0.42, 'rgba(255, 140, 25, 0.85)');
    fGrad.addColorStop(0.72, 'rgba(220, 55, 10, 0.45)');
    fGrad.addColorStop(1, 'rgba(120, 20, 0, 0)');
    fCtx.fillStyle = fGrad;
    fCtx.fillRect(0, 0, 128, 128);
    this.fireballTexture = new THREE.CanvasTexture(fCanvas);
    this.fireballTexture.colorSpace = THREE.SRGBColorSpace;

    const sCanvas = document.createElement('canvas');
    sCanvas.width = sCanvas.height = 128;
    const sCtx = sCanvas.getContext('2d');
    const sGrad = sCtx.createRadialGradient(64, 64, 30, 64, 64, 64);
    sGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    sGrad.addColorStop(0.65, 'rgba(255, 230, 180, 0)');
    sGrad.addColorStop(0.85, 'rgba(255, 210, 140, 0.85)');
    sGrad.addColorStop(0.95, 'rgba(255, 180, 90, 0.45)');
    sGrad.addColorStop(1, 'rgba(255, 140, 40, 0)');
    sCtx.fillStyle = sGrad;
    sCtx.fillRect(0, 0, 128, 128);
    this.shockwaveTexture = new THREE.CanvasTexture(sCanvas);
    this.shockwaveTexture.colorSpace = THREE.SRGBColorSpace;

    const dCanvas = document.createElement('canvas');
    dCanvas.width = dCanvas.height = 128;
    const dCtx = dCanvas.getContext('2d');
    const dGrad = dCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    dGrad.addColorStop(0, 'rgba(38, 35, 32, 0.95)');
    dGrad.addColorStop(0.48, 'rgba(48, 45, 42, 0.78)');
    dGrad.addColorStop(0.82, 'rgba(60, 56, 52, 0.35)');
    dGrad.addColorStop(1, 'rgba(60, 56, 52, 0)');
    dCtx.fillStyle = dGrad;
    dCtx.fillRect(0, 0, 128, 128);
    this.sootTexture = new THREE.CanvasTexture(dCanvas);
    this.sootTexture.colorSpace = THREE.SRGBColorSpace;

    const gCanvas = document.createElement('canvas');
    gCanvas.width = gCanvas.height = 128;
    const gCtx = gCanvas.getContext('2d');
    const gGrad = gCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gGrad.addColorStop(0, 'rgba(18, 16, 14, 0.88)');
    gGrad.addColorStop(0.38, 'rgba(28, 24, 20, 0.65)');
    gGrad.addColorStop(0.75, 'rgba(42, 38, 34, 0.3)');
    gGrad.addColorStop(1, 'rgba(42, 38, 34, 0)');
    gCtx.fillStyle = gGrad;
    gCtx.fillRect(0, 0, 128, 128);
    this.scorchTexture = new THREE.CanvasTexture(gCanvas);
    this.scorchTexture.colorSpace = THREE.SRGBColorSpace;

    const spCanvas = document.createElement('canvas');
    spCanvas.width = spCanvas.height = 32;
    const spCtx = spCanvas.getContext('2d');
    const spGrad = spCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
    spGrad.addColorStop(0, 'rgba(255, 255, 240, 1)');
    spGrad.addColorStop(0.35, 'rgba(255, 200, 60, 0.95)');
    spGrad.addColorStop(0.7, 'rgba(255, 100, 20, 0.45)');
    spGrad.addColorStop(1, 'rgba(200, 40, 0, 0)');
    spCtx.fillStyle = spGrad;
    spCtx.fillRect(0, 0, 32, 32);
    this.sparkTexture = new THREE.CanvasTexture(spCanvas);
    this.sparkTexture.colorSpace = THREE.SRGBColorSpace;

    // CS2 Molotov Layer 3: Billowing Black Soot Smoke Plume
    this.fireSmokeMaterial = new THREE.MeshBasicMaterial({
      map: this.sootTexture,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.fireSmokeMesh = new THREE.InstancedMesh(this.planeGeo, this.fireSmokeMaterial, 12 * 50);
    this.fireSmokeMesh.count = 0;
    this.fireSmokeMesh.frustumCulled = false;
    scene.add(this.fireSmokeMesh);

    // CS2 Molotov Layer 4: Ascending Golden Embers & Sparks
    this.fireSparkMaterial = new THREE.MeshBasicMaterial({
      map: this.sparkTexture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    this.fireSparkMesh = new THREE.InstancedMesh(this.planeGeo, this.fireSparkMaterial, 12 * 40);
    this.fireSparkMesh.count = 0;
    this.fireSparkMesh.frustumCulled = false;
    scene.add(this.fireSparkMesh);

    // CS2 Molotov Layer 5: Dynamic Flickering Point Lights
    this.fireLights = [
      new THREE.PointLight(0xff6611, 0, 11, 1.8),
      new THREE.PointLight(0xff6611, 0, 11, 1.8)
    ];
    for (const light of this.fireLights) {
      scene.add(light);
    }

    this.transform = new THREE.Object3D();
    this.direction = new THREE.Vector3();

    // CS2 Flashbang Layer 1: Frozen Retinal Burn Afterimage
    this.flashCanvas = document.createElement('canvas');
    this.flashCanvas.id = 'flash-afterimage';
    this.flashCanvas.style.position = 'fixed';
    this.flashCanvas.style.inset = '0';
    this.flashCanvas.style.width = '100%';
    this.flashCanvas.style.height = '100%';
    this.flashCanvas.style.pointerEvents = 'none';
    this.flashCanvas.style.zIndex = '55';
    this.flashCanvas.style.opacity = '0';
    this.flashCanvas.style.filter = 'brightness(1.55) contrast(1.35) saturate(0.35)';
    document.body.append(this.flashCanvas);
    this.flashCtx = this.flashCanvas.getContext('2d');

    // CS2 Flashbang Layer 2: 100% Solid Blinding Whiteout (Covers HUD and scene)
    this.flash = document.createElement('div');
    this.flash.className = 'utility-screen';
    this.flash.id = 'flash-effect';
    this.flash.style.position = 'fixed';
    this.flash.style.inset = '0';
    this.flash.style.pointerEvents = 'none';
    this.flash.style.zIndex = '60';
    this.flash.style.opacity = '0';
    this.flash.style.background = '#ffffff';
    document.body.append(this.flash);

    this.fog = document.createElement('div');
    this.fog.className = 'utility-screen smoke-screen';
    this.fog.id = 'smoke-effect';
    document.body.append(this.fog);

    this.flashRemaining = 0;
    this.flashDuration = 0;
    this.flashExposure = 0;
    this.flashHoldTime = 0;
    this.flashDecayTime = 0;
    this.needsCapture = false;
    this.crosshair = null;
  }

  captureFrame(domElement) {
    this.needsCapture = false;
    if (!this.flashCanvas || !domElement || !domElement.width) return;
    if (this.flashCanvas.width !== domElement.width || this.flashCanvas.height !== domElement.height) {
      this.flashCanvas.width = domElement.width;
      this.flashCanvas.height = domElement.height;
    }
    this.flashCtx.drawImage(domElement, 0, 0);
  }

  carveBullet(start, end, radius = 0.24, duration = 0.7, recoverDuration = 0.25) {
    this.carves.push({
      id: Math.random(),
      type: 'bullet',
      start: { x: start.x, y: start.y, z: start.z },
      end: { x: end.x, y: end.y, z: end.z },
      radius,
      duration,
      recoverDuration,
      age: 0
    });
    if (this.carves.length > 40) this.carves.shift();
  }

  disperseSmoke(explosionPoint, radius = 3.5, duration = 2.5, recoverDuration = 0.6) {
    this.carves.push({
      id: Math.random(),
      type: 'explosion',
      x: explosionPoint.x,
      y: explosionPoint.y,
      z: explosionPoint.z,
      radius,
      duration,
      recoverDuration,
      age: 0
    });
    if (this.carves.length > 40) this.carves.shift();
  }

  spawnExplosion(origin) {
    // 1. Incandescent Fireball (Additive billboard)
    const fireballMat = new THREE.MeshBasicMaterial({
      map: this.fireballTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    const fireball = new THREE.Mesh(this.planeGeo, fireballMat);
    fireball.position.set(origin.x, origin.y + 0.45, origin.z);
    fireball.scale.setScalar(0.6);
    this.scene.add(fireball);

    // 2. Shockwave Ring (Ground expanding wave)
    const ringMat = new THREE.MeshBasicMaterial({
      map: this.shockwaveTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const ring = new THREE.Mesh(this.planeGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(origin.x, origin.y + 0.04, origin.z);
    ring.scale.setScalar(0.5);
    this.scene.add(ring);

    // 3. Dynamic Light Flash
    const light = new THREE.PointLight(0xffb545, 5.5, 16);
    light.position.set(origin.x, origin.y + 0.7, origin.z);
    this.scene.add(light);

    // 4. Flying Shrapnel Sparks (20 particles)
    const sparks = [];
    for (let i = 0; i < 20; i++) {
      const sparkMat = new THREE.MeshBasicMaterial({
        map: this.sparkTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(this.planeGeo, sparkMat);
      mesh.position.set(origin.x, origin.y + 0.25, origin.z);
      mesh.scale.setScalar(0.12 + Math.random() * 0.08);
      this.scene.add(mesh);

      const speed = 12 + Math.random() * 14;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.42;
      sparks.push({
        mesh,
        vx: Math.cos(theta) * Math.sin(phi) * speed,
        vy: Math.cos(phi) * speed + 2.5,
        vz: Math.sin(theta) * Math.sin(phi) * speed,
        life: 0.35 + Math.random() * 0.22,
        maxLife: 0.57
      });
    }

    // 5. Dark Soot & Dust Plumes (10 clouds)
    const soots = [];
    for (let i = 0; i < 10; i++) {
      const sootMat = new THREE.MeshBasicMaterial({
        map: this.sootTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.85
      });
      const mesh = new THREE.Mesh(this.planeGeo, sootMat);
      const angle = (i / 10) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const speed = 1.2 + Math.random() * 2.0;
      const vx = Math.cos(angle) * speed;
      const vy = 1.6 + Math.random() * 2.4;
      const vz = Math.sin(angle) * speed;
      mesh.position.set(origin.x + vx * 0.08, origin.y + 0.25, origin.z + vz * 0.08);
      mesh.scale.setScalar(0.7);
      this.scene.add(mesh);
      soots.push({
        mesh,
        vx,
        vy,
        vz,
        scale: 0.7,
        life: 0.85 + Math.random() * 0.35,
        maxLife: 1.2
      });
    }

    // 6. Ground Scorch Decal (Carbon charred burn)
    const scorchMat = new THREE.MeshBasicMaterial({
      map: this.scorchTexture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1
    });
    const scorch = new THREE.Mesh(this.planeGeo, scorchMat);
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.set(origin.x, origin.y + 0.015, origin.z);
    scorch.scale.setScalar(2.6);
    this.scene.add(scorch);
    this.scorchDecals.push({ mesh: scorch, age: 0, maxAge: 8.0 });
    if (this.scorchDecals.length > 12) {
      const old = this.scorchDecals.shift();
      old.mesh.removeFromParent();
      old.mesh.material.dispose();
    }

    this.activeExplosions.push({
      fireball,
      ring,
      light,
      sparks,
      soots,
      age: 0
    });
  }

  sync(snapshot) {
    this.fires = (snapshot.fires || []).slice(-12).map(f => ({ ...f }));
    const existingSmokes = new Map(this.smokes.map(s => [s.id, s]));
    this.smokes = (snapshot.smokes || []).slice(-20).map(s => {
      const prev = existingSmokes.get(s.id);
      return {
        ...s,
        age: s.age ?? (prev ? prev.age : 0),
        carves: (s.carves || []).map(c => ({ ...c }))
      };
    });

    for (const s of snapshot.smokes || []) {
      for (const sc of s.carves || []) {
        if (!this.carves.some(c => c.id === sc.id || (c.type === sc.type && c.type === 'explosion' && Math.hypot(c.x - sc.x, c.y - sc.y, c.z - sc.z) < 0.4))) {
          this.carves.push({ ...sc });
        }
      }
    }

    const visible = new Set();
    for (const p of [
      ...(snapshot.grenades || []).slice(-40),
      ...(snapshot.decoys || []).slice(-20),
      ...(snapshot.defuseKits || []).slice(-20).map(k => ({ ...k, weapon: 'defusekit' }))
    ]) {
      visible.add(p.id);
      let entry = this.projectiles.get(p.id);
      if (!entry) {
        const mesh = new THREE.Mesh(this.grenadeGeometry, this.materials[p.weapon]);
        this.scene.add(mesh);
        entry = { mesh };
        this.projectiles.set(p.id, entry);
      }
      entry.state = p;
      entry.age = 0;
      requestSkin(p.weapon);
      if (!entry.original && loadedSkin(p.weapon)) {
        entry.mesh.removeFromParent();
        entry.mesh = clone(loadedSkin(p.weapon).scene);
        entry.original = p.weapon;
        retainSkin(p.weapon);
        this.scene.add(entry.mesh);
      }
      if (!entry.positioned) {
        entry.mesh.position.set(p.x, p.y, p.z);
        entry.positioned = true;
      }
    }
    for (const [id, entry] of this.projectiles) {
      if (!visible.has(id)) {
        entry.mesh.removeFromParent();
        if (entry.original) {
          disposeInstanceSkeletons(entry.mesh);
          releaseSkin(entry.original);
        }
        this.projectiles.delete(id);
      }
    }
  }

  event(event, myId) {
    if (event.type === 'flash') {
      const hit = event.affected?.find(p => p.playerId === myId);
      if (hit && hit.duration > 0) {
        this.flashDuration = Math.max(this.flashRemaining, hit.duration);
        this.flashRemaining = this.flashDuration;
        this.flashExposure = Math.max(this.flashExposure, hit.exposure || 1.0);
        this.flashHoldTime = hit.holdTime !== undefined ? hit.holdTime : (this.flashDuration * 0.45);
        this.flashDecayTime = Math.max(0.1, this.flashDuration - this.flashHoldTime);
        this.needsCapture = true;
      }
    }
    if (event.type === 'explosion' && event.origin) {
      this.spawnExplosion(event.origin);
    }
  }

  update(dt, camera, visible = true) {
    this.flashRemaining = Math.max(0, this.flashRemaining - dt);
    if (!this.flashRemaining) {
      this.flashExposure = 0;
      this.flashDuration = 0;
      this.flashHoldTime = 0;
      this.flashDecayTime = 0;
      if (this.flash) this.flash.style.opacity = '0';
      if (this.flashCanvas) this.flashCanvas.style.opacity = '0';
      if (!this.crosshair) this.crosshair = document.getElementById('crosshair');
      if (this.crosshair) this.crosshair.style.opacity = '1';
    } else if (visible) {
      const elapsed = this.flashDuration - this.flashRemaining;
      let whiteAlpha = 0;
      let afterimageAlpha = 0;

      if (elapsed < this.flashHoldTime) {
        // Hold Phase: 100% solid pure whiteout covering entire screen and HUD
        whiteAlpha = this.flashExposure;
        afterimageAlpha = 0;
      } else {
        // Decay Phase: white fades down, revealing frozen retinal afterimage, then afterimage fades
        const p = Math.min(1, Math.max(0, (elapsed - this.flashHoldTime) / Math.max(0.01, this.flashDecayTime)));
        whiteAlpha = this.flashExposure * Math.max(0, 1.0 - Math.pow(p, 0.6));
        afterimageAlpha = this.flashExposure * Math.max(0, (1.0 - p) * 0.95);
      }

      this.flash.style.opacity = String(whiteAlpha);
      if (this.flashCanvas) this.flashCanvas.style.opacity = String(afterimageAlpha);
      if (!this.crosshair) this.crosshair = document.getElementById('crosshair');
      if (this.crosshair) this.crosshair.style.opacity = String(Math.max(0, 1.0 - (whiteAlpha + afterimageAlpha) * 1.3));
    }
    this.clock += dt;

    for (const entry of this.projectiles.values()) {
      entry.age = Math.min(0.1, entry.age + dt);
      const p = entry.state, moving = Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0) > 0.1;
      if (moving) {
        entry.mesh.rotation.x += dt * 6;
        entry.mesh.rotation.z += dt * 3;
      }
      this.direction.set(
        p.x + (p.vx || 0) * entry.age,
        p.y + (p.vy || 0) * entry.age - (moving ? EQUIPMENT[p.weapon].gravity * entry.age * entry.age * 0.5 : 0) + (p.weapon === 'defusekit' ? 0.06 : 0),
        p.z + (p.vz || 0) * entry.age
      );
      entry.mesh.position.lerp(this.direction, 1 - Math.exp(-35 * dt));
    }

    let flames = 0;
    let carpets = 0;
    let fireSmokes = 0;
    let fireSparks = 0;
    let lightIdx = 0;
    this.fireUniforms.uTime.value = this.clock;

    for (const fire of this.fires) {
      fire.remaining = Math.max(0, fire.remaining - dt);
      if (!fire.remaining) continue;

      const fade = Math.min(1, fire.remaining / 0.8);
      const cells = (fire.cells || []).slice(0, 60);
      if (!cells.length) continue;

      // Layer 1: Valve MolotovScorch - 1 smooth ground scorch decal at center of inferno
      if (carpets < 12) {
        const scorchRadius = 5.6 * fade;
        this.transform.position.set(fire.x, fire.y + 0.015, fire.z);
        this.transform.rotation.set(-Math.PI * 0.5, 0, 0);
        this.transform.scale.set(scorchRadius, scorchRadius, 1);
        this.transform.updateMatrix();
        this.fireCarpetMesh.setMatrixAt(carpets++, this.transform.matrix);
      }

      let sumX = 0, sumY = 0, sumZ = 0;

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        sumX += cell.x;
        sumY += cell.y;
        sumZ += cell.z;

        const dx = camera.position.x - cell.x;
        const dz = camera.position.z - cell.z;
        const camYaw = Math.atan2(dx, dz);

        // Valve Official DrawFire: Height 70~90 units (~1.8m-2.2m), anchored to ground at cell.y
        const h0 = (1.85 + Math.sin(this.clock * 12 + i * 2.3) * 0.22) * fade;
        const w0 = h0 * 0.72;

        // Card 1: Facing camera horizontally, anchored to ground (cell.y)
        if (flames < 12 * 60 * 2) {
          this.transform.position.set(cell.x, cell.y, cell.z);
          this.transform.rotation.set(0, camYaw, 0);
          this.transform.scale.set(w0, h0, 1);
          this.transform.updateMatrix();
          this.fireMesh.setMatrixAt(flames++, this.transform.matrix);
        }

        // Card 2: Crossed partner card at ~72 deg offset for 3D body
        if (flames < 12 * 60 * 2) {
          const h1 = (1.70 + Math.cos(this.clock * 14 + i * 2.7) * 0.18) * fade;
          const w1 = h1 * 0.68;
          this.transform.position.set(cell.x, cell.y, cell.z);
          this.transform.rotation.set(0, camYaw + 1.25, 0);
          this.transform.scale.set(w1, h1, 1);
          this.transform.updateMatrix();
          this.fireMesh.setMatrixAt(flames++, this.transform.matrix);
        }
      }

      // Layer 3: Rising Soot Smoke Column (Spawns ABOVE flame tips: y + 1.8m -> 4.8m)
      const numSmokePuffs = Math.min(24, cells.length);
      for (let s = 0; s < numSmokePuffs; s++) {
        if (fireSmokes >= 12 * 50) break;
        const baseCell = cells[s % cells.length];
        const cycle = (this.clock * 0.45 + s * 0.15) % 1.0;
        const py = baseCell.y + 1.8 + cycle * 3.0;
        const drift = 0.2 + cycle * 0.9;
        const px = baseCell.x + Math.sin(this.clock * 1.1 + s * 1.5) * drift;
        const pz = baseCell.z + Math.cos(this.clock * 0.9 + s * 1.9) * drift;
        const scale = (1.1 + cycle * 2.0) * Math.sin(cycle * Math.PI) * fade;
        if (scale > 0.05) {
          this.transform.position.set(px, py, pz);
          this.rollQuat.setFromAxisAngle(this.rollAxis, s * 1.618 + cycle * 0.6);
          this.transform.quaternion.copy(camera.quaternion).multiply(this.rollQuat);
          this.transform.scale.setScalar(scale);
          this.transform.updateMatrix();
          this.fireSmokeMesh.setMatrixAt(fireSmokes++, this.transform.matrix);
        }
      }

      // Layer 4: Ascending Golden Embers & Sparks
      const numSparks = Math.min(18, cells.length);
      for (let sp = 0; sp < numSparks; sp++) {
        if (fireSparks >= 12 * 40) break;
        const spCell = cells[(sp * 3) % cells.length];
        const spCycle = (this.clock * 1.8 + sp * 0.22) % 1.0;
        const py = spCell.y + 0.4 + spCycle * 3.2;
        const vortexR = 0.12 + spCycle * 0.45;
        const vortexAng = this.clock * 4.5 + sp * 2.2 + spCycle * 6.2;
        const px = spCell.x + Math.cos(vortexAng) * vortexR;
        const pz = spCell.z + Math.sin(vortexAng) * vortexR;
        const spScale = (0.09 + Math.sin(sp * 3.7) * 0.03) * (1.0 - spCycle * 0.65) * fade;
        if (spScale > 0.02) {
          this.transform.position.set(px, py, pz);
          this.transform.quaternion.copy(camera.quaternion);
          this.transform.scale.setScalar(spScale);
          this.transform.updateMatrix();
          this.fireSparkMesh.setMatrixAt(fireSparks++, this.transform.matrix);
        }
      }

      // Layer 5: Dynamic Flickering Point Light (Valve: color 254, 100, 10)
      if (lightIdx < this.fireLights.length) {
        const light = this.fireLights[lightIdx++];
        light.position.set(sumX / cells.length, sumY / cells.length + 0.8, sumZ / cells.length);
        const flicker = 3.6 + Math.sin(this.clock * 17 + lightIdx) * 0.6 + Math.sin(this.clock * 29 + lightIdx * 2) * 0.4;
        light.intensity = flicker * fade;
      }
    }

    while (lightIdx < this.fireLights.length) {
      this.fireLights[lightIdx++].intensity = 0;
    }

    this.fireCarpetMesh.count = carpets;
    this.fireCarpetMesh.instanceMatrix.needsUpdate = true;

    this.fireMesh.count = flames;
    this.fireMesh.instanceMatrix.needsUpdate = true;

    this.fireSmokeMesh.count = fireSmokes;
    this.fireSmokeMesh.instanceMatrix.needsUpdate = true;

    this.fireSparkMesh.count = fireSparks;
    this.fireSparkMesh.instanceMatrix.needsUpdate = true;

    // Update active carves lifecycle
    for (const c of this.carves) c.age = (c.age || 0) + dt;
    this.carves = this.carves.filter(c => c.age < c.duration);

    // Calculate effective radii and upload to shader uniforms
    const activeExplosions = [];
    const activeBullets = [];
    for (const c of this.carves) {
      if (c.type === 'explosion' && activeExplosions.length < 4) {
        const blastExpandTime = 0.18;
        const fullTime = c.duration - (c.recoverDuration || 0.6);
        let effR;
        if (c.age < blastExpandTime) {
          effR = c.radius * (1 - Math.pow(1 - c.age / blastExpandTime, 2));
        } else if (c.age < fullTime) {
          effR = c.radius;
        } else {
          const rec = (c.age - fullTime) / Math.max(0.01, c.recoverDuration || 0.6);
          effR = c.radius * Math.max(0, 1 - rec * rec);
        }
        if (effR > 0.01) activeExplosions.push({ x: c.x, y: c.y, z: c.z, radius: effR });
      } else if (c.type === 'bullet' && activeBullets.length < 16) {
        const punchTime = 0.05;
        const fullTime = c.duration - (c.recoverDuration || 0.25);
        let effR;
        if (c.age < punchTime) {
          effR = c.radius * (c.age / punchTime);
        } else if (c.age < fullTime) {
          effR = c.radius;
        } else {
          const rec = (c.age - fullTime) / Math.max(0.01, c.recoverDuration || 0.25);
          effR = c.radius * Math.max(0, 1 - rec);
        }
        if (effR > 0.01) activeBullets.push({ start: c.start, end: c.end, radius: effR });
      }
    }

    this.smokeUniforms.uExplosionCount.value = activeExplosions.length;
    for (let i = 0; i < activeExplosions.length; i++) {
      const e = activeExplosions[i];
      this.smokeUniforms.uExplosionPositions.value[i * 3] = e.x;
      this.smokeUniforms.uExplosionPositions.value[i * 3 + 1] = e.y;
      this.smokeUniforms.uExplosionPositions.value[i * 3 + 2] = e.z;
      this.smokeUniforms.uExplosionRadii.value[i] = e.radius;
    }

    this.smokeUniforms.uBulletCount.value = activeBullets.length;
    for (let j = 0; j < activeBullets.length; j++) {
      const b = activeBullets[j];
      this.smokeUniforms.uBulletStarts.value[j * 3] = b.start.x;
      this.smokeUniforms.uBulletStarts.value[j * 3 + 1] = b.start.y;
      this.smokeUniforms.uBulletStarts.value[j * 3 + 2] = b.start.z;
      this.smokeUniforms.uBulletEnds.value[j * 3] = b.end.x;
      this.smokeUniforms.uBulletEnds.value[j * 3 + 1] = b.end.y;
      this.smokeUniforms.uBulletEnds.value[j * 3 + 2] = b.end.z;
      this.smokeUniforms.uBulletRadii.value[j] = b.radius;
    }

    let count = 0, inside = 0;
    for (const cloud of this.smokes) {
      cloud.age = (cloud.age || 0) + dt;
      cloud.remaining = Math.max(0, cloud.remaining - dt);
      if (!cloud.remaining) continue;

      // CS2 Bloom: 1.8s progressive expansion from canister on ground
      const bloomProg = Math.min(1, cloud.age / 1.8);
      const bloomEase = 1 - Math.pow(1 - bloomProg, 3); // Cubic ease-out
      const currentRadius = cloud.radius * (0.15 + 0.85 * bloomEase);
      const fadeFactor = Math.min(1, cloud.remaining / 2.2);
      const densityAlpha = Math.min(1, cloud.age / 0.6);

      // Check if camera is inside active carve hole (disable screen fog)
      let cameraInCarve = false;
      for (const exp of activeExplosions) {
        if (camera.position.distanceTo(new THREE.Vector3(exp.x, exp.y, exp.z)) < exp.radius) {
          cameraInCarve = true;
          break;
        }
      }
      if (!cameraInCarve) {
        for (const b of activeBullets) {
          if (pointToSegmentDistance(camera.position, b.start, b.end) < b.radius + 0.12) {
            cameraInCarve = true;
            break;
          }
        }
      }
      if (!cameraInCarve) {
        const distance = camera.position.distanceTo(new THREE.Vector3(cloud.x, cloud.y, cloud.z));
        inside = Math.max(
          inside,
          THREE.MathUtils.clamp((currentRadius - distance) / Math.max(0.5, currentRadius * 0.3), 0, 1) * densityAlpha
        );
      }

      // Ground-hugging CS2 dome geometry:
      // Canister resting position is on ground: groundY = cloud.y - 1.3
      const groundY = cloud.y - 1.3;
      const centerY = groundY + 1.25 * (0.2 + 0.8 * bloomEase);

      // Tier 1: Base Foundation Puffs (8 massive overlapping puffs for seamless solid core)
      const numBase = 8;
      for (let i = 0; i < numBase; i++) {
        const angle = i * (Math.PI * 2 / numBase);
        const rad = currentRadius * (i === 0 ? 0.03 : 0.20);
        const px = cloud.x + Math.cos(angle) * rad;
        const py = centerY + (i === 0 ? 0 : 0.12 * Math.sin(i * 2.1)) * (0.2 + 0.8 * bloomEase);
        const pz = cloud.z + Math.sin(angle) * rad;
        const pScale = currentRadius * (i === 0 ? 1.45 : 1.30) * fadeFactor;
        const roll = i * 0.785 + cloud.age * 0.035 * (i % 2 === 0 ? 1 : -1);

        if (pScale > 0.02) {
          this.smokeCloudCenters[count * 3] = cloud.x;
          this.smokeCloudCenters[count * 3 + 1] = centerY;
          this.smokeCloudCenters[count * 3 + 2] = cloud.z;
          this.smokeCloudRadii[count] = currentRadius;

          this.transform.position.set(px, py, pz);
          this.rollQuat.setFromAxisAngle(this.rollAxis, roll);
          this.transform.quaternion.copy(camera.quaternion).multiply(this.rollQuat);
          this.transform.scale.setScalar(pScale);
          this.transform.updateMatrix();
          this.smokeMesh.setMatrixAt(count++, this.transform.matrix);
        }
      }

      // Tier 2: Mid-Volume Infilling Puffs (24 puffs filling internal space)
      const numMid = 24;
      for (let i = 0; i < numMid; i++) {
        const angle = i * 2.399963;
        const hFrac = (i / (numMid - 1)) * 2 - 1;
        const rSpread = Math.sqrt(Math.max(0, 1 - hFrac * hFrac));
        const rad = currentRadius * (0.20 + 0.48 * rSpread);
        const px = cloud.x + Math.cos(angle) * rad;
        const py = centerY + hFrac * 0.95 * (0.2 + 0.8 * bloomEase);
        const pz = cloud.z + Math.sin(angle) * rad;
        const pScale = currentRadius * (0.85 + 0.18 * Math.sin(i * 3.1)) * fadeFactor;
        const roll = i * 1.618 + cloud.age * 0.045 * (i % 2 === 0 ? 1 : -1);

        if (pScale > 0.02) {
          this.smokeCloudCenters[count * 3] = cloud.x;
          this.smokeCloudCenters[count * 3 + 1] = centerY;
          this.smokeCloudCenters[count * 3 + 2] = cloud.z;
          this.smokeCloudRadii[count] = currentRadius;

          this.transform.position.set(px, py, pz);
          this.rollQuat.setFromAxisAngle(this.rollAxis, roll);
          this.transform.quaternion.copy(camera.quaternion).multiply(this.rollQuat);
          this.transform.scale.setScalar(pScale);
          this.transform.updateMatrix();
          this.smokeMesh.setMatrixAt(count++, this.transform.matrix);
        }
      }

      // Tier 3: Outer Wispy Boundary Puffs (24 organic puffs with fractal perimeter)
      const numOuter = 24;
      for (let i = 0; i < numOuter; i++) {
        const angle = i * 2.399963 + 1.15;
        const hFrac = (i / (numOuter - 1)) * 2 - 1;
        const rSpread = Math.sqrt(Math.max(0, 1 - hFrac * hFrac));
        const jitter = 0.07 * Math.sin(i * 4.7 + cloud.age * 0.2);
        const rad = currentRadius * (0.60 + 0.35 * rSpread + jitter);
        const px = cloud.x + Math.cos(angle) * rad;
        const py = centerY + hFrac * 1.1 * (0.2 + 0.8 * bloomEase);
        const pz = cloud.z + Math.sin(angle) * rad;
        const pScale = currentRadius * (0.55 + 0.16 * Math.cos(i * 2.5)) * fadeFactor;
        const roll = i * 2.718 + cloud.age * 0.05 * (i % 2 === 0 ? 1 : -1);

        if (pScale > 0.02) {
          this.smokeCloudCenters[count * 3] = cloud.x;
          this.smokeCloudCenters[count * 3 + 1] = centerY;
          this.smokeCloudCenters[count * 3 + 2] = cloud.z;
          this.smokeCloudRadii[count] = currentRadius;

          this.transform.position.set(px, py, pz);
          this.rollQuat.setFromAxisAngle(this.rollAxis, roll);
          this.transform.quaternion.copy(camera.quaternion).multiply(this.rollQuat);
          this.transform.scale.setScalar(pScale);
          this.transform.updateMatrix();
          this.smokeMesh.setMatrixAt(count++, this.transform.matrix);
        }
      }
    }
    this.smokeMesh.count = count;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    if (this.smokeGeo.attributes.aCloudCenter) {
      this.smokeGeo.attributes.aCloudCenter.needsUpdate = true;
      this.smokeGeo.attributes.aCloudRadius.needsUpdate = true;
    }
    this.fog.style.opacity = visible ? String(inside) : '0';

    // 5. Update CS2 Explosion VFX lifecycle
    for (let i = this.activeExplosions.length - 1; i >= 0; i--) {
      const exp = this.activeExplosions[i];
      exp.age += dt;

      // A. Core Fireball Burst (0.22s)
      if (exp.fireball) {
        if (exp.age < 0.22) {
          const p = exp.age / 0.22;
          const scale = 0.6 + Math.sin(Math.min(1, p * 2.2) * Math.PI * 0.5) * 3.2;
          exp.fireball.scale.setScalar(scale);
          exp.fireball.quaternion.copy(camera.quaternion);
          exp.fireball.material.opacity = Math.max(0, 1 - p * p);
        } else {
          exp.fireball.removeFromParent();
          exp.fireball.material.dispose();
          exp.fireball = null;
        }
      }

      // B. Dynamic Light Flash (0.12s)
      if (exp.light) {
        if (exp.age < 0.12) {
          exp.light.intensity = 5.5 * (1 - exp.age / 0.12);
        } else {
          exp.light.removeFromParent();
          exp.light.dispose();
          exp.light = null;
        }
      }

      // C. Shockwave Blast Ring (0.28s)
      if (exp.ring) {
        if (exp.age < 0.28) {
          const p = exp.age / 0.28;
          const scale = 0.5 + p * 4.2;
          exp.ring.scale.set(scale, scale, 1);
          exp.ring.material.opacity = 0.85 * (1 - p);
        } else {
          exp.ring.removeFromParent();
          exp.ring.material.dispose();
          exp.ring = null;
        }
      }

      // D. Flying Shrapnel Sparks
      for (let sIdx = exp.sparks.length - 1; sIdx >= 0; sIdx--) {
        const s = exp.sparks[sIdx];
        s.life -= dt;
        if (s.life <= 0) {
          s.mesh.removeFromParent();
          s.mesh.material.dispose();
          exp.sparks.splice(sIdx, 1);
        } else {
          s.vy -= 18 * dt;
          s.mesh.position.x += s.vx * dt;
          s.mesh.position.y += s.vy * dt;
          s.mesh.position.z += s.vz * dt;
          s.mesh.quaternion.copy(camera.quaternion);
          s.mesh.material.opacity = Math.min(1, s.life / 0.22);
        }
      }

      // E. Dark Soot & Dust Plumes
      for (let stIdx = exp.soots.length - 1; stIdx >= 0; stIdx--) {
        const st = exp.soots[stIdx];
        st.life -= dt;
        if (st.life <= 0) {
          st.mesh.removeFromParent();
          st.mesh.material.dispose();
          exp.soots.splice(stIdx, 1);
        } else {
          st.vx *= 0.94;
          st.vy *= 0.94;
          st.vz *= 0.94;
          st.mesh.position.x += st.vx * dt;
          st.mesh.position.y += st.vy * dt;
          st.mesh.position.z += st.vz * dt;
          st.scale += dt * 2.2;
          st.mesh.scale.setScalar(st.scale);
          st.mesh.quaternion.copy(camera.quaternion);
          st.mesh.material.opacity = 0.82 * (st.life / st.maxLife);
        }
      }

      if (!exp.fireball && !exp.light && !exp.ring && exp.sparks.length === 0 && exp.soots.length === 0) {
        this.activeExplosions.splice(i, 1);
      }
    }

    // 6. Update Ground Scorch Decals
    for (let i = this.scorchDecals.length - 1; i >= 0; i--) {
      const sc = this.scorchDecals[i];
      sc.age += dt;
      if (sc.age >= sc.maxAge) {
        sc.mesh.removeFromParent();
        sc.mesh.material.dispose();
        this.scorchDecals.splice(i, 1);
      } else if (sc.age > 5.0) {
        sc.mesh.material.opacity = Math.max(0, 1 - (sc.age - 5.0) / 3.0);
      }
    }
  }

  resetFlash() {
    this.flashRemaining = 0;
    this.flashExposure = 0;
    this.flashDuration = 0;
    this.flashHoldTime = 0;
    this.flashDecayTime = 0;
    this.needsCapture = false;
    if (this.flash) this.flash.style.opacity = '0';
    if (this.flashCanvas) this.flashCanvas.style.opacity = '0';
    if (!this.crosshair) this.crosshair = document.getElementById('crosshair');
    if (this.crosshair) this.crosshair.style.opacity = '1';
  }

  clear() {
    for (const p of this.projectiles.values()) {
      p.mesh.removeFromParent();
      if (p.original) {
        disposeInstanceSkeletons(p.mesh);
        releaseSkin(p.original);
      }
    }
    this.projectiles.clear();
    this.smokes = [];
    this.fires = [];
    this.carves = [];
    this.fireMesh.count = 0;
    this.fireCarpetMesh.count = 0;
    this.fireSmokeMesh.count = 0;
    this.fireSparkMesh.count = 0;
    for (const light of this.fireLights) light.intensity = 0;
    this.smokeMesh.count = 0;
    this.resetFlash();
    this.fog.style.opacity = '0';

    for (const exp of this.activeExplosions) {
      if (exp.fireball) { exp.fireball.removeFromParent(); exp.fireball.material.dispose(); }
      if (exp.ring) { exp.ring.removeFromParent(); exp.ring.material.dispose(); }
      if (exp.light) { exp.light.removeFromParent(); exp.light.dispose(); }
      for (const s of exp.sparks) { s.mesh.removeFromParent(); s.mesh.material.dispose(); }
      for (const st of exp.soots) { st.mesh.removeFromParent(); st.mesh.material.dispose(); }
    }
    this.activeExplosions = [];

    for (const sc of this.scorchDecals) {
      sc.mesh.removeFromParent();
      sc.mesh.material.dispose();
    }
    this.scorchDecals = [];
  }

  dispose() {
    this.clear();
    this.fireMesh.removeFromParent();
    this.flameGeo.dispose();
    this.fireMaterial.dispose();
    this.fireTexture.dispose();
    this.fireCarpetMesh.removeFromParent();
    this.fireCarpetMaterial.dispose();
    this.fireCarpetTexture.dispose();
    this.fireSmokeMesh.removeFromParent();
    this.fireSmokeMaterial.dispose();
    this.fireSparkMesh.removeFromParent();
    this.fireSparkMaterial.dispose();
    for (const light of this.fireLights) {
      light.removeFromParent();
      light.dispose();
    }
    this.smokeMesh.removeFromParent();
    this.smokeMesh.geometry.dispose();
    this.smokeMaterial.dispose();
    this.smokeTexture.dispose();
    this.fireballTexture.dispose();
    this.shockwaveTexture.dispose();
    this.sootTexture.dispose();
    this.scorchTexture.dispose();
    this.sparkTexture.dispose();
    this.planeGeo.dispose();
    this.grenadeGeometry.dispose();
    Object.values(this.materials).forEach(m => m.dispose());
    this.flash.remove();
    if (this.flashCanvas) this.flashCanvas.remove();
    this.fog.remove();
  }
}
