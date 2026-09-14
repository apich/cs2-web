import * as THREE from 'three';
import { WEAPON_BALLISTICS } from '../shared/weapon-ballistics.js';
import { raycastWorldContact } from '../shared/physics.js';

const up = new THREE.Vector3(0, 1, 0);
const zAxis = new THREE.Vector3(0, 0, 1);
export const MAX_DECALS = 200;

function createConcreteHoleTexture() {
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const cx = 128, cy = 128;

  // 1. Soft outer powdery dust/soot halo
  const outerGrad = ctx.createRadialGradient(cx, cy, 36, cx, cy, 120);
  outerGrad.addColorStop(0, 'rgba(20, 18, 16, 0.75)');
  outerGrad.addColorStop(0.3, 'rgba(40, 36, 32, 0.52)');
  outerGrad.addColorStop(0.65, 'rgba(80, 75, 68, 0.25)');
  outerGrad.addColorStop(1, 'rgba(110, 105, 95, 0)');
  ctx.fillStyle = outerGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 122, 0, Math.PI * 2);
  ctx.fill();

  // 2. Chipped concrete rim (jagged fractured star with chalky stone highlight)
  ctx.save();
  ctx.beginPath();
  const rimPoints = 26;
  for (let i = 0; i <= rimPoints; i++) {
    const angle = (i / rimPoints) * Math.PI * 2;
    const r = 52 + Math.sin(angle * 7 + 1.2) * 9 + Math.cos(angle * 13) * 6;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const rimGrad = ctx.createRadialGradient(cx, cy, 24, cx, cy, 68);
  rimGrad.addColorStop(0, 'rgba(25, 23, 20, 0.98)');
  rimGrad.addColorStop(0.5, 'rgba(185, 175, 160, 0.95)');
  rimGrad.addColorStop(0.85, 'rgba(115, 107, 96, 0.70)');
  rimGrad.addColorStop(1, 'rgba(60, 55, 50, 0)');
  ctx.fillStyle = rimGrad;
  ctx.fill();

  // Fine concrete grit & chipped specks
  ctx.fillStyle = 'rgba(215, 205, 190, 0.85)';
  for (let i = 0; i < 24; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 38 + Math.random() * 32;
    const size = 1.2 + Math.random() * 2.2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 3. Radial micro-cracks shooting out from impact center
  ctx.save();
  ctx.strokeStyle = 'rgba(14, 12, 10, 0.92)';
  ctx.lineWidth = 2.4;
  const numCracks = 10;
  for (let i = 0; i < numCracks; i++) {
    const baseAngle = (i / numCracks) * Math.PI * 2 + (Math.sin(i * 3.7) * 0.25);
    ctx.beginPath();
    let currR = 20;
    let currA = baseAngle;
    ctx.moveTo(cx + Math.cos(currA) * currR, cy + Math.sin(currA) * currR);
    const maxR = 75 + Math.abs(Math.sin(i * 2.3)) * 42;
    while (currR < maxR) {
      currR += 10 + Math.random() * 12;
      currA += (Math.random() - 0.5) * 0.35;
      ctx.lineTo(cx + Math.cos(currA) * currR, cy + Math.sin(currA) * currR);
    }
    ctx.stroke();
  }
  ctx.restore();

  // 4. Center deep cavity (dark blackened pit)
  ctx.save();
  ctx.beginPath();
  const innerPoints = 18;
  for (let i = 0; i <= innerPoints; i++) {
    const angle = (i / innerPoints) * Math.PI * 2;
    const r = 26 + Math.sin(angle * 5) * 5 + Math.cos(angle * 9) * 3;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const pitGrad = ctx.createRadialGradient(cx - 4, cy - 4, 3, cx, cy, 32);
  pitGrad.addColorStop(0, '#000000');
  pitGrad.addColorStop(0.65, '#0c0b0a');
  pitGrad.addColorStop(1, '#221f1a');
  ctx.fillStyle = pitGrad;
  ctx.fill();

  // Inner rim crease highlight for 3D depth perception
  ctx.strokeStyle = 'rgba(225, 215, 200, 0.65)';
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.arc(cx, cy, 28, 0.1 * Math.PI, 0.65 * Math.PI);
  ctx.stroke();
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createDustPuffTexture() {
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(220, 210, 190, 0.85)');
  grad.addColorStop(0.4, 'rgba(190, 180, 160, 0.50)');
  grad.addColorStop(0.8, 'rgba(160, 150, 135, 0.18)');
  grad.addColorStop(1, 'rgba(140, 130, 120, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function getDecalScale(weapon) {
  if (['awp', 'ssg08', 'scar20'].includes(weapon)) return 0.26;
  if (['ak47', 'm4a4', 'm4a1', 'galilar', 'famas', 'sg553', 'aug'].includes(weapon)) return 0.15;
  if (weapon === 'deagle') return 0.18;
  if (['mp9', 'mac10', 'mp7', 'bizon', 'ump'].includes(weapon)) return 0.12;
  if (['pistol', 'usp', 'p250', 'fiveseven', 'elite', 'tec9'].includes(weapon)) return 0.10;
  return 0.08;
}

/** Bounded reusable geometry; events use the server's real collision endpoints. */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.counts = new Map();
    this.pool = [];
    this.geometry = new THREE.CylinderGeometry(1, 1, 1, 4);
    this.impactGeo = new THREE.SphereGeometry(0.025, 5, 4);

    // Decal system
    this.decalGeometry = new THREE.PlaneGeometry(1, 1);
    this.concreteHoleTex = createConcreteHoleTexture();
    this.dustPuffTex = createDustPuffTexture();
    this.decals = [];
    this.decalPool = [];
    this.sparks = [];
    this.sparkPool = [];
    this.dustPuffs = [];
    this.dustPool = [];
    this.sparkGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.04, 3);
  }

  spawn(a, b, { impact = false, sniper = false } = {}) {
    if (this.items.length >= 96) this.recycle(this.items.shift());
    let item = this.pool.pop();
    if (!item) {
      const material = new THREE.MeshBasicMaterial({ color: 0xffe3a5, transparent: true, depthWrite: false, toneMapped: false });
      item = { obj: new THREE.Mesh(this.geometry, material) };
      item.obj.frustumCulled = false;
    }
    const length = a.distanceTo(b);
    item.obj.geometry = impact ? this.impactGeo : this.geometry;
    item.obj.position.copy(a).lerp(b, 0.5);
    item.obj.scale.set(impact ? 1 : sniper ? 0.009 : 0.006, impact ? 1 : Math.max(0.001, length), impact ? 1 : sniper ? 0.009 : 0.006);
    if (!impact) item.obj.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    else item.obj.quaternion.identity();
    item.life = item.max = impact ? 0.12 : sniper ? 0.16 : 0.085;
    item.obj.material.opacity = impact ? 0.95 : 0.8;
    this.scene.add(item.obj);
    this.items.push(item);
  }

  spawnDecal(hitPoint, normal, weapon) {
    if (this.decals.length >= MAX_DECALS) {
      const old = this.decals.shift();
      old.mesh.removeFromParent();
      this.decalPool.push(old);
    }

    let decal = this.decalPool.pop();
    if (!decal) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.concreteHoleTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1.5,
        polygonOffsetUnits: -3,
        toneMapped: false
      });
      decal = { mesh: new THREE.Mesh(this.decalGeometry, mat), life: 45.0, maxLife: 45.0 };
      decal.mesh.frustumCulled = false;
    }

    // Offset slightly along normal to prevent z-fighting
    decal.mesh.position.copy(hitPoint).addScaledVector(normal, 0.0025);
    // Align plane normal (facing +Z) to surface normal
    decal.mesh.quaternion.setFromUnitVectors(zAxis, normal);
    // Add random spin around the normal for natural variety
    const roll = Math.random() * Math.PI * 2;
    decal.mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, roll));

    const scale = getDecalScale(weapon);
    decal.mesh.scale.set(scale, scale, 1);
    decal.mesh.material.opacity = 0.95;
    decal.life = decal.maxLife = 45.0;

    this.scene.add(decal.mesh);
    this.decals.push(decal);
  }

  spawnImpactFX(hitPoint, normal, incomingDir) {
    // 1. Dust puff sprite
    let puff = this.dustPool.pop();
    if (!puff) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.dustPuffTex,
        transparent: true,
        depthWrite: false,
        toneMapped: false
      });
      puff = { mesh: new THREE.Mesh(this.decalGeometry, mat), life: 0.28, maxLife: 0.28 };
      puff.mesh.frustumCulled = false;
    }
    puff.mesh.position.copy(hitPoint).addScaledVector(normal, 0.012);
    puff.mesh.quaternion.setFromUnitVectors(zAxis, normal);
    puff.mesh.scale.set(0.08, 0.08, 1);
    puff.mesh.material.opacity = 0.65;
    puff.life = puff.maxLife = 0.28;
    this.scene.add(puff.mesh);
    this.dustPuffs.push(puff);

    // 2. High-speed ricochet sparks (3-5 sparks along reflection vector)
    const refl = incomingDir.clone().sub(normal.clone().multiplyScalar(2 * incomingDir.dot(normal))).normalize();
    const numSparks = 4;
    for (let i = 0; i < numSparks; i++) {
      let spark = this.sparkPool.pop();
      if (!spark) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffdf80, transparent: true, depthWrite: false, toneMapped: false });
        spark = { mesh: new THREE.Mesh(this.sparkGeo, mat), vel: new THREE.Vector3(), life: 0.12, maxLife: 0.12 };
        spark.mesh.frustumCulled = false;
      }
      spark.mesh.position.copy(hitPoint).addScaledVector(normal, 0.005);
      spark.vel.copy(refl).add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.3) * 0.9, (Math.random() - 0.5) * 0.9)).normalize();
      spark.vel.multiplyScalar(3.0 + Math.random() * 4.5);
      spark.mesh.quaternion.setFromUnitVectors(up, spark.vel.clone().normalize());
      spark.life = spark.maxLife = 0.09 + Math.random() * 0.06;
      spark.mesh.material.opacity = 1.0;
      this.scene.add(spark.mesh);
      this.sparks.push(spark);
    }
  }

  shot(origin, end, own = false, { weapon = 'ak47', shooterId = 'local', muzzle = null, hitWorld = false, segments = [] } = {}) {
    const now = performance.now();
    const previous = this.counts.get(shooterId);
    const count = !previous || now - previous.time > 350 ? 0 : previous.count + 1;
    this.counts.set(shooterId, { count, time: now });
    if (this.counts.size > 24) this.counts.delete(this.counts.keys().next().value);

    const frequency = WEAPON_BALLISTICS[weapon]?.tracerFrequency || 0;
    const b = new THREE.Vector3(end.x, end.y, end.z);
    const a = muzzle?.clone?.() || new THREE.Vector3(origin.x, origin.y, origin.z);

    if (frequency && count % frequency === 0) {
      if (own && !muzzle) a.addScaledVector(b.clone().sub(a).normalize(), 0.55);
      this.spawn(a, b, { sniper: ['awp', 'ssg08', 'scar20'].includes(weapon) });
    }

    if (hitWorld) {
      const dir = b.clone().sub(a).normalize();
      const dist = a.distanceTo(b);
      // Query surface normal at contact point using collision BVH
      let normal = dir.clone().negate();
      try {
        const contact = raycastWorldContact(a, dir, dist + 0.35);
        if (contact?.normal) {
          normal.set(contact.normal.x, contact.normal.y, contact.normal.z).normalize();
        }
      } catch {}

      // Spawn persistent CS2 bullet decal
      this.spawnDecal(b, normal, weapon);
      // Spawn hit spark and dust puff
      this.spawnImpactFX(b, normal, dir);
      // Brief impact glow
      this.spawn(b, b, { impact: true });
    }

    for (const segment of segments.slice(0, 4)) {
      const p = new THREE.Vector3(segment.exit.x, segment.exit.y, segment.exit.z);
      this.spawn(p, p, { impact: true });
    }
  }

  recycle(item) {
    item.obj.removeFromParent();
    this.pool.push(item);
  }

  update(dt) {
    // 1. Update tracers and momentary impact spheres
    for (let i = this.items.length - 1; i >= 0; i--) {
      const e = this.items[i];
      e.life -= dt;
      if (e.life <= 0) {
        this.items.splice(i, 1);
        this.recycle(e);
      } else {
        e.obj.material.opacity = 0.8 * (e.life / e.max);
      }
    }

    // 2. Update ricochet sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        s.mesh.removeFromParent();
        this.sparkPool.push(s);
      } else {
        s.mesh.position.addScaledVector(s.vel, dt);
        s.vel.y -= 9.8 * dt;
        s.mesh.material.opacity = Math.max(0, s.life / s.maxLife);
      }
    }

    // 3. Update dust puffs
    for (let i = this.dustPuffs.length - 1; i >= 0; i--) {
      const p = this.dustPuffs[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.dustPuffs.splice(i, 1);
        p.mesh.removeFromParent();
        this.dustPool.push(p);
      } else {
        const progress = 1.0 - (p.life / p.maxLife);
        const curScale = 0.08 + progress * 0.22;
        p.mesh.scale.set(curScale, curScale, 1);
        p.mesh.material.opacity = 0.65 * (1.0 - progress);
      }
    }

    // 4. Update persistent decals
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.decals.splice(i, 1);
        d.mesh.removeFromParent();
        this.decalPool.push(d);
      } else if (d.life < 10.0) {
        d.mesh.material.opacity = 0.95 * (d.life / 10.0);
      }
    }
  }

  clear() {
    for (const e of this.items) this.recycle(e);
    this.items.length = 0;
    this.counts.clear();

    for (const d of this.decals) {
      d.mesh.removeFromParent();
      this.decalPool.push(d);
    }
    this.decals.length = 0;

    for (const s of this.sparks) {
      s.mesh.removeFromParent();
      this.sparkPool.push(s);
    }
    this.sparks.length = 0;

    for (const p of this.dustPuffs) {
      p.mesh.removeFromParent();
      this.dustPool.push(p);
    }
    this.dustPuffs.length = 0;
  }

  dispose() {
    this.clear();
    for (const e of this.pool) e.obj.material.dispose();
    this.pool.length = 0;
    this.geometry.dispose();
    this.impactGeo.dispose();

    for (const d of this.decalPool) d.mesh.material.dispose();
    this.decalPool.length = 0;
    this.decalGeometry.dispose();
    this.concreteHoleTex.dispose();
    this.dustPuffTex.dispose();

    for (const s of this.sparkPool) s.mesh.material.dispose();
    this.sparkPool.length = 0;
    this.sparkGeo.dispose();

    for (const p of this.dustPool) p.mesh.material.dispose();
    this.dustPool.length = 0;
  }
}

