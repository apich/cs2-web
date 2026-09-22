// 首页大厅 3D 角色展示。
// 透明 canvas 叠加在 CSS 地图背景之上：角色由真实 GLB 骨骼模型驱动（AnimationMixer + 武器挂载），
// 脚底用 ShadowMaterial 在透明画布上投出真实投影，让角色"站在"背景场景里。
// 不单独开 requestAnimationFrame——渲染由 main.js 主循环 frame() 统一驱动，离开首页立即停止渲染。
import * as THREE from 'three';
import { loadModels, PlayerModel } from './models.js';

const AGENT_BY_TEAM = { CT: 'ct-sas', T: 't-phoenix' };
// 大厅展示用近战待机（knife/idle 循环），姿态更放松，不举步枪；后续想要耍帅动作可直接换动画名
const WEAPON_BY_TEAM = { CT: 'knife', T: 'knife' };
// 相机参数：角色脚部位于画面约 94% 高度、头部约 23%。DX 微负用于抵消角色轮廓/姿势导致的视觉偏心，保持屏幕正中观感。
const DIST = 3.7, DX = -0.08;
// 大厅相机位于 +Z 向前看，模型自带 rotation.y=π 面朝 -Z（游戏世界前方），因此 yaw 补 π 让角色正面朝向镜头。
const FACE_CAMERA_YAW = Math.PI + Math.atan2(-DX, DIST);

export function mountLobbyShowcase({ initialFaction = 'T' } = {}) {
  const menu = document.getElementById('menu');
  const canvas = document.createElement('canvas');
  canvas.className = 'lobby-showcase-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  menu.insertBefore(canvas, menu.querySelector('.menu-content'));

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1); // 全屏但内容单一，1x 足够并省去 2.25 倍填充开销
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  // 主光（投影）+ 半球环境（蓝灰天光 / 暖地色）+ 背光（边缘 rim-light）
  const sun = new THREE.DirectionalLight(0xfff1da, 2.6);
  sun.position.set(-2.6, 4.6, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.shadow.camera.left = -3; sun.shadow.camera.right = 3;
  sun.shadow.camera.top = 3.6; sun.shadow.camera.bottom = -1;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 14;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9db4c6, 0x2b2622, 0.8));
  const rim = new THREE.DirectionalLight(0x8fb4d4, 1.5);
  rim.position.set(-1.6, 1.2, -2.8);
  scene.add(rim);

  // 仅接收阴影的地面：透明画布上只画出投影，角色直接"站"在 CSS 背景上
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.4 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.006;
  ground.receiveShadow = true;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 30);
  camera.position.set(0, 1.52, DIST);
  camera.lookAt(0, 1.12, 0);

  const state = { ready: false, faction: initialFaction === 'CT' ? 'CT' : 'T', models: { CT: null, T: null }, tween: null, intro: null, lastW: 0, lastH: 0 };
  const materialBase = new WeakMap(); // material -> {transparent, opacity} 原始值

  function setOpacity(root, opacity) {
    root.traverse(o => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (!materialBase.has(m)) materialBase.set(m, { transparent: m.transparent, opacity: m.opacity });
        if (opacity >= 0.999 && !materialBase.get(m).transparent) { m.transparent = false; m.opacity = 1; return; }
        m.transparent = true;
        m.opacity = Math.max(0, Math.min(1, opacity));
      }
    });
  }

  const fakePlayer = weapon => ({ id: 'lobby', alive: true, x: DX, y: 0, z: 0, yaw: FACE_CAMERA_YAW, pitch: 0, vx: 0, vz: 0, crouch: false, grounded: true, weapon, skinId: null, slot: 1 });

  function build() {
    const mk = team => {
      const m = new PlayerModel(team, scene, AGENT_BY_TEAM[team]);
      m.ring.visible = false; // 大厅展示不需要脚下的队伍光圈
      const fake = fakePlayer(WEAPON_BY_TEAM[team]);
      m.update(fake, 0.016, { exactPosition: true, animationRate: 60 });
      return { m, fake };
    };
    const ct = mk('CT'), t = mk('T');
    // 模型原点在身体中段：按包围盒把脚对齐到 y=0，并按身高调整相机（头部约 26% 屏高、脚部约 94%）
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(ct.m.group);
    const floorOffset = -box.min.y;
    for (const it of [ct, t]) { it.m.group.position.y = floorOffset; it.fake.y = floorOffset; }
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * DIST;
    const lookY = 0.76 * halfH; // 角色上移：脚踩台面位于屏幕约 88% 高度，头部约 20%——整体居画面中心
    camera.position.y = lookY + 0.5;
    camera.lookAt(0, lookY, 0);
    ct.m.group.visible = state.faction === 'CT';
    t.m.group.visible = state.faction !== 'CT';
    state.models = { CT: ct, T: t };
    state.ready = true;
    menu.classList.add('lobby-3d');
    // 3D 展示接管视觉：移除 2D 半身立绘占位（含软阴影），只留模型
    document.getElementById('lobby-character-stage')?.replaceChildren();
    // 列出可用动画名，便于后续挑选"耍帅"待机动作
    console.debug('[lobby-showcase] animations:', Object.keys(ct.m.actions));
    // 入场动画：opacity 0→1、scale .97→1，约 700ms ease-out，之后进入 Idle 循环
    const hero = state.models[state.faction];
    hero.m.group.scale.setScalar(0.97);
    setOpacity(hero.m.group, 0);
    state.intro = { t: 0, dur: 0.7, hero };
  }
  // 与 loadGame() 共用同一份模型加载（models.js 内部已做 Promise 缓存），失败则保持 2D 立绘占位
  loadModels().then(build).catch(() => {});

  function fit() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width)), h = Math.max(2, Math.round(r.height));
    if (w === state.lastW && h === state.lastH) return;
    state.lastW = w; state.lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const easeOut = k => 1 - Math.pow(1 - k, 3);

  function update(dt, homeVisible) {
    if (!state.ready || !homeVisible) return;
    fit();
    const ndt = Math.min(0.05, dt || 0);
    if (state.intro) {
      const it = state.intro;
      it.t += ndt;
      const k = Math.min(1, it.t / it.dur), e = easeOut(k);
      it.hero.m.group.scale.setScalar(THREE.MathUtils.lerp(0.97, 1, e));
      setOpacity(it.hero.m.group, e);
      if (k >= 1) state.intro = null;
    }
    if (state.tween) {
      const tw = state.tween;
      tw.t += ndt;
      const k = Math.min(1, tw.t / tw.dur), e = easeOut(k);
      setOpacity(tw.cur.m.group, e);
      tw.cur.m.group.scale.setScalar(THREE.MathUtils.lerp(1.015, 1, e));
      setOpacity(tw.old.m.group, 1 - e);
      tw.old.m.group.scale.setScalar(THREE.MathUtils.lerp(1, 0.985, e));
      if (k >= 1) { tw.old.m.group.visible = false; tw.old.m.group.scale.setScalar(1); state.tween = null; }
    }
    for (const it of Object.values(state.models)) {
      if (it && it.m.group.visible) { it.m.update(it.fake, ndt, { exactPosition: true, animationRate: 60 }); it.m.ring.visible = false; }
    }
    renderer.render(scene, camera);
  }

  // 阵营切换：旧模型 opacity 1→0 / scale 1→0.985，新模型 0→1 / 1.015→1，约 400ms
  function setFaction(faction) {
    if (!state.ready || faction !== 'CT' && faction !== 'T' || faction === state.faction) return;
    const old = state.models[state.faction], cur = state.models[faction];
    if (!old || !cur) return;
    state.faction = faction;
    cur.m.group.visible = true;
    setOpacity(cur.m.group, 0);
    cur.m.group.scale.setScalar(1.015);
    state.tween = { old, cur, t: 0, dur: 0.4 };
  }

  function dispose() {
    state.intro = null; state.tween = null;
    for (const it of Object.values(state.models)) it?.m.dispose();
    renderer.dispose();
  }

  return { update, setFaction, dispose, isReady: () => state.ready };
}