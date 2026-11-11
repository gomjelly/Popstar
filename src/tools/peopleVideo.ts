// 정면 촬영 테스트 영상 생성기(카메라 없는 개발 PC용).
// 거실에 어른(1.75m)과 아이(1.2m)가 카메라를 보고 서서, 정해진 대본대로 움직인다:
//   0~6초 준비 자세 → 6~13초 아이가 손을 들어 버튼 고르기 → 13~18초 어른 팔 벌려 뛰기
//   → 18~26초 서로 자리 바꾸기 → 26~30초 어른 손 들기 → 30~42초 아이가 화면 밖으로 나갔다 돌아오기
//   → 42~50초 다시 자리 바꾸기(처음 자리로 돌아와 반복 재생이 자연스럽다)
// 주소 옵션: ?people=2|1   녹화: window.__record(초) → webm(base64)

import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const PEOPLE = Number(params.get('people') ?? 2);
/** basic = 자리 바꾸기·나갔다 오기 대본, balloon = 양팔 펴기 보정 후 여기저기 손 뻗기 */
const SCRIPT = params.get('script') ?? 'basic';
export const DURATION = SCRIPT === 'balloon' ? 40 : 50;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const info = document.getElementById('info') as HTMLDivElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#d8d2c8');
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 50);
camera.position.set(0, 0.95, 0.4);
camera.lookAt(0, 0.85, -3);

scene.add(new THREE.HemisphereLight('#ffffff', '#7a6f62', 1.2));
const key = new THREE.DirectionalLight('#fff4e6', 2.0);
key.position.set(1.5, 4, 2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
scene.add(key);
const fill = new THREE.PointLight('#ffffff', 8, 14);
fill.position.set(-2, 2.5, 0.5);
scene.add(fill);

// ---------- 거실 ----------
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), new THREE.MeshStandardMaterial({ color: '#a77f5a', roughness: 0.8 }));
floor.rotation.x = -Math.PI / 2;
floor.position.z = -3;
floor.receiveShadow = true;
scene.add(floor);
const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), new THREE.MeshStandardMaterial({ color: '#eae4da', roughness: 0.95 }));
wall.position.set(0, 2.5, -5.2);
wall.receiveShadow = true;
scene.add(wall);
const rug = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshStandardMaterial({ color: '#5d7fa8', roughness: 1 }));
rug.rotation.x = -Math.PI / 2;
rug.position.set(0, 0.005, -3);
rug.receiveShadow = true;
scene.add(rug);
const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 0.35), new THREE.MeshStandardMaterial({ color: '#f4f1ea' }));
shelf.position.set(-3.6, 0.5, -5.0);
scene.add(shelf);
const plantPot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.4, 20), new THREE.MeshStandardMaterial({ color: '#b5654a' }));
plantPot.position.set(3.4, 0.2, -4.8);
scene.add(plantPot);
const plant = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), new THREE.MeshStandardMaterial({ color: '#4c8a4a' }));
plant.position.set(3.4, 0.75, -4.8);
scene.add(plant);

// ---------- 사람 ----------
const UP = new THREE.Vector3(0, 1, 0);
const unitSphere = new THREE.SphereGeometry(1, 24, 16);

class Limb {
  private cyl: THREE.Mesh;
  private capA: THREE.Mesh;
  private capB: THREE.Mesh;
  constructor(root: THREE.Object3D, mat: THREE.Material, rA: number, rB: number) {
    this.cyl = new THREE.Mesh(new THREE.CylinderGeometry(rB, rA, 1, 18), mat);
    this.capA = new THREE.Mesh(unitSphere, mat);
    this.capB = new THREE.Mesh(unitSphere, mat);
    this.capA.scale.setScalar(rA);
    this.capB.scale.setScalar(rB);
    for (const m of [this.cyl, this.capA, this.capB]) {
      m.castShadow = true;
      root.add(m);
    }
  }
  set(a: THREE.Vector3, b: THREE.Vector3): void {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    this.cyl.position.copy(a).addScaledVector(d, 0.5);
    this.cyl.scale.set(1, len, 1);
    this.cyl.quaternion.setFromUnitVectors(UP, d.normalize());
    this.capA.position.copy(a);
    this.capB.position.copy(b);
  }
}

interface LimbPose {
  abd: number; // 몸 옆으로 벌린 각도(도, 0 = 아래로)
  flex: number; // 앞으로 든 각도(도)
  bend: number; // 팔꿈치(팔: 바깥·위로 더 돌림) / 무릎(다리: 뒤로 굽힘)
}

interface BodyPose {
  x: number;
  z: number;
  bob: number;
  armL: LimbPose; // 사람 기준 왼팔
  armR: LimbPose;
  legL: LimbPose;
  legR: LimbPose;
  headYaw: number;
}

const rad = THREE.MathUtils.degToRad;

/** 정면 기준 팔다리 방향(사람 왼쪽 = 화면(카메라) 오른쪽 +x) */
function dirOf(side: number, abd: number, flex: number): THREE.Vector3 {
  const a = rad(abd);
  const f = rad(flex);
  return new THREE.Vector3(side * Math.sin(a) * Math.cos(f), -Math.cos(a) * Math.cos(f), Math.sin(f)).normalize();
}

class Person {
  readonly root = new THREE.Group();
  private torso: THREE.Mesh;
  private pelvis: THREE.Mesh;
  private head: THREE.Group;
  private neck: Limb;
  private limbs: { upper: Limb; fore: Limb; thigh: Limb; shin: Limb; hand: THREE.Mesh; shoe: THREE.Mesh }[] = [];

  constructor(readonly height: number, shirtColor: string, pantsColor: string, hairColor: string, readonly child: boolean) {
    const s = height / 1.75;
    const skin = new THREE.MeshStandardMaterial({ color: child ? '#e9b994' : '#d9a37e', roughness: 0.6 });
    const shirt = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.85 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: '#f3f3f3', roughness: 0.6 });
    const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.9 });
    scene.add(this.root);

    this.torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17 * s, 0.32 * s, 8, 20), shirt);
    this.torso.scale.set(1.15, 1, 0.7);
    this.torso.castShadow = true;
    this.root.add(this.torso);
    this.pelvis = new THREE.Mesh(unitSphere, pants);
    this.pelvis.scale.set(0.19 * s, 0.13 * s, 0.13 * s);
    this.pelvis.castShadow = true;
    this.root.add(this.pelvis);
    this.neck = new Limb(this.root, skin, 0.055 * s, 0.05 * s);

    // 머리(아이는 몸에 비해 머리가 크다)
    const hs = s * (child ? 1.22 : 1);
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(unitSphere, skin);
    skull.scale.set(0.095 * hs, 0.12 * hs, 0.105 * hs);
    skull.castShadow = true;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat);
    hair.scale.set(0.102 * hs, 0.13 * hs, 0.112 * hs);
    hair.position.set(0, 0.012 * hs, -0.008 * hs);
    hair.rotation.x = -0.35;
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a1a12', roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(unitSphere, white);
      eye.scale.set(0.018 * hs, 0.012 * hs, 0.008 * hs);
      eye.position.set(sx * 0.036 * hs, 0.018 * hs, 0.097 * hs);
      const pupil = new THREE.Mesh(unitSphere, dark);
      pupil.scale.setScalar(0.008 * hs);
      pupil.position.set(sx * 0.036 * hs, 0.018 * hs, 0.104 * hs);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.035 * hs, 0.006 * hs, 0.006 * hs), hairMat);
      brow.position.set(sx * 0.036 * hs, 0.042 * hs, 0.1 * hs);
      const ear = new THREE.Mesh(unitSphere, skin);
      ear.scale.set(0.015 * hs, 0.03 * hs, 0.02 * hs);
      ear.position.set(sx * 0.097 * hs, 0.005 * hs, 0);
      this.head.add(eye, pupil, brow, ear);
    }
    const nose = new THREE.Mesh(unitSphere, skin);
    nose.scale.set(0.016 * hs, 0.022 * hs, 0.02 * hs);
    nose.position.set(0, -0.008 * hs, 0.106 * hs);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.045 * hs, 0.008 * hs, 0.006 * hs), new THREE.MeshStandardMaterial({ color: '#a8423c' }));
    mouth.position.set(0, -0.05 * hs, 0.093 * hs);
    this.head.add(skull, hair, nose, mouth);
    this.root.add(this.head);

    for (let i = 0; i < 2; i++) {
      const hand = new THREE.Mesh(unitSphere, skin);
      hand.scale.set(0.04 * s, 0.05 * s, 0.025 * s);
      hand.castShadow = true;
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.07 * s, 0.24 * s), shoeMat);
      shoe.castShadow = true;
      this.root.add(hand, shoe);
      this.limbs.push({
        upper: new Limb(this.root, shirt, 0.055 * s, 0.047 * s),
        fore: new Limb(this.root, skin, 0.042 * s, 0.033 * s),
        thigh: new Limb(this.root, pants, 0.085 * s, 0.065 * s),
        shin: new Limb(this.root, pants, 0.062 * s, 0.048 * s),
        hand,
        shoe,
      });
    }
  }

  pose(p: BodyPose): void {
    const s = this.height / 1.75;
    const hs = s * (this.child ? 1.22 : 1);
    const base = new THREE.Vector3(p.x, 0, p.z);
    const legLen = (this.child ? 0.86 : 0.88) * s;
    const hip = base.clone().add(new THREE.Vector3(0, legLen + 0.08 * s + p.bob, 0));
    const shoulderY = hip.y + (this.child ? 0.5 : 0.52) * s;
    const shoulderC = new THREE.Vector3(p.x, shoulderY, p.z);
    this.pelvis.position.copy(hip).add(new THREE.Vector3(0, 0.03 * s, 0));
    this.torso.position.set(p.x, (hip.y + shoulderY) / 2 + 0.01 * s, p.z);
    const neckTop = shoulderC.clone().add(new THREE.Vector3(0, 0.1 * s, 0));
    this.neck.set(shoulderC, neckTop);
    this.head.position.copy(neckTop).add(new THREE.Vector3(0, 0.1 * hs, 0.01));
    this.head.rotation.y = rad(p.headYaw);

    const sides: [number, LimbPose, LimbPose][] = [
      [1, p.armL, p.legL], // 사람 왼쪽 = +x
      [-1, p.armR, p.legR],
    ];
    sides.forEach(([side, arm, leg], i) => {
      const L = this.limbs[i];
      const sh = shoulderC.clone().add(new THREE.Vector3(side * 0.19 * s, -0.03 * s, 0));
      const el = sh.clone().addScaledVector(dirOf(side, arm.abd, arm.flex), 0.29 * s);
      const wr = el.clone().addScaledVector(dirOf(side, arm.abd + arm.bend, arm.flex), 0.26 * s);
      L.upper.set(sh, el);
      L.fore.set(el, wr);
      const hd = dirOf(side, arm.abd + arm.bend, arm.flex);
      L.hand.position.copy(wr).addScaledVector(hd, 0.06 * s);
      L.hand.quaternion.setFromUnitVectors(UP, hd.clone().negate());

      const hp = hip.clone().add(new THREE.Vector3(side * 0.1 * s, 0, 0));
      const kn = hp.clone().addScaledVector(dirOf(side, leg.abd, leg.flex), 0.45 * s * (legLen / (0.88 * s)));
      const an = kn.clone().addScaledVector(dirOf(side, leg.abd, leg.flex - leg.bend), 0.43 * s * (legLen / (0.88 * s)));
      L.thigh.set(hp, kn);
      L.shin.set(kn, an);
      L.shoe.position.set(an.x, Math.max(0.035 * s, an.y - 0.03 * s), an.z + 0.06 * s);
    });
  }
}

// ---------- 대본 ----------
const adult = new Person(1.75, '#3f8f5a', '#2b3550', '#2a1d14', false);
const child = PEOPLE > 1 ? new Person(1.2, '#f2b632', '#6a3f8c', '#3b2414', true) : null;

const smooth = (a: number, b: number, t: number) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
const lerp = THREE.MathUtils.lerp;
const rest = (): LimbPose => ({ abd: 12, flex: 0, bend: 6 });
const legRest = (): LimbPose => ({ abd: 4, flex: 0, bend: 0 });

/** 걷는 다리: 이동 중일 때만 앞뒤로 흔든다 */
function walk(t: number, moving: number, phase = 0): { l: LimbPose; r: LimbPose; bob: number } {
  const w = Math.sin(t * 2 * Math.PI * 1.6 + phase) * moving;
  return {
    l: { abd: 4, flex: 22 * w, bend: Math.max(0, 30 * -w) * moving + 5 * moving },
    r: { abd: 4, flex: -22 * w, bend: Math.max(0, 30 * w) * moving + 5 * moving },
    bob: Math.abs(w) * 0.02,
  };
}

function adultPose(t: number): BodyPose {
  const p: BodyPose = { x: 0.55, z: -3.4, bob: 0, armL: rest(), armR: rest(), legL: legRest(), legR: legRest(), headYaw: 0 };
  if (PEOPLE === 1) p.x = 0;
  // 숨쉬기
  p.armL.abd += Math.sin(t * 1.3) * 2;
  p.armR.abd += Math.sin(t * 1.3 + 1) * 2;
  // 13~18초: 팔 벌려 뛰기
  if (t > 13 && t < 18) {
    const j = (1 - Math.cos((t - 13) * 2 * Math.PI * 0.8)) / 2;
    p.armL.abd = p.armR.abd = lerp(12, 160, j);
    p.legL.abd = p.legR.abd = lerp(4, 18, j);
    p.bob = Math.sin(j * Math.PI) * 0.04;
  }
  // 26~30초: 왼손 들기(화면에서는 거울 반전으로 왼쪽)
  const raise = smooth(26, 26.8, t) * (1 - smooth(29.3, 30, t));
  p.armL.abd = lerp(p.armL.abd, 100, raise);
  p.armL.flex = lerp(p.armL.flex, 30, raise);
  p.armL.bend = lerp(p.armL.bend, 35, raise);
  // 자리 바꾸기
  if (PEOPLE > 1) {
    const go1 = smooth(18, 26, t);
    const go2 = smooth(42, 50, t);
    p.x = lerp(lerp(0.55, -0.55, go1), 0.55, go2);
    const moving = (t > 18 && t < 26) || (t > 42 && t < 50) ? 1 : 0;
    const wk = walk(t, moving);
    if (moving) {
      p.legL = wk.l;
      p.legR = wk.r;
      p.bob = wk.bob;
    }
  }
  return p;
}

function childPose(t: number): BodyPose {
  const p: BodyPose = { x: -0.55, z: -2.7, bob: 0, armL: rest(), armR: rest(), legL: legRest(), legR: legRest(), headYaw: 0 };
  p.armL.abd += Math.sin(t * 1.7) * 2;
  p.armR.abd += Math.sin(t * 1.7 + 2) * 2;
  // 6~13초: 오른손을 들어 버튼 위에 멈췄다가, 다른 곳으로 옮겨 다시 멈춘다
  const up = smooth(6, 7, t) * (1 - smooth(12.3, 13, t));
  const move = smooth(9.6, 10.2, t);
  p.armR.abd = lerp(p.armR.abd, lerp(80, 125, move), up);
  p.armR.flex = lerp(0, 25, up);
  p.armR.bend = lerp(p.armR.bend, lerp(10, 25, move), up);
  // 자리 바꾸기
  const go1 = smooth(18, 26, t);
  const out = smooth(30, 34, t) * (1 - smooth(38, 42, t));
  const go2 = smooth(42, 50, t);
  p.x = lerp(lerp(-0.55, 0.55, go1), -0.55, go2) + out * 3.0;
  const moving = (t > 18 && t < 26) || (t > 30 && t < 34) || (t > 38 && t < 50) ? 1 : 0;
  if (moving) {
    const wk = walk(t, 1, 1.3);
    p.legL = wk.l;
    p.legR = wk.r;
    p.bob = wk.bob;
  }
  return p;
}

// ---------- 풍선 게임 대본 ----------
// 0~1.5초 차렷 → 1.5~2.5초 양팔을 옆으로 → 7초까지 유지(보정) → 손을 위·옆·앞으로 뻗으며 조금씩 옆걸음 → 38~40초 차렷

function reachPose(t: number, base: BodyPose, seed: number): BodyPose {
  const p = base;
  const up = smooth(1.5, 2.5, t) * (1 - smooth(38, 39.5, t));
  const play = smooth(7, 8, t) * (1 - smooth(37, 38, t));
  const wave = (f: number, ph: number) => Math.sin(t * f + ph + seed);
  // 보정 자세(양팔 옆으로)
  let abdL = lerp(12, 90, up);
  let abdR = lerp(12, 90, up);
  // 놀이: 팔을 위아래·앞뒤로 크게
  abdL = lerp(abdL, 95 + 65 * wave(1.3, 0), play);
  abdR = lerp(abdR, 95 + 65 * wave(1.1, 2), play);
  p.armL = { abd: abdL, flex: 25 * play * (0.5 + 0.5 * wave(0.7, 1)), bend: 10 + 25 * play * (0.5 + 0.5 * wave(1.7, 0)) };
  p.armR = { abd: abdR, flex: 25 * play * (0.5 + 0.5 * wave(0.9, 3)), bend: 10 + 25 * play * (0.5 + 0.5 * wave(1.5, 1)) };
  // 옆걸음
  const step = 0.3 * play * Math.sin(t * 0.45 + seed);
  p.x += step;
  const moving = Math.abs(Math.cos(t * 0.45 + seed)) * play > 0.3 ? 0.6 : 0;
  if (moving) {
    const wk = walk(t, moving, seed);
    p.legL = wk.l;
    p.legR = wk.r;
  }
  return p;
}

function adultBalloon(t: number): BodyPose {
  const base: BodyPose = { x: PEOPLE > 1 ? 0.9 : 0, z: -3.6, bob: 0, armL: rest(), armR: rest(), legL: legRest(), legR: legRest(), headYaw: 0 };
  return reachPose(t, base, 0);
}

function childBalloon(t: number): BodyPose {
  const base: BodyPose = { x: -0.9, z: -2.9, bob: 0, armL: rest(), armR: rest(), legL: legRest(), legR: legRest(), headYaw: 0 };
  return reachPose(t, base, 1.7);
}

// ---------- 화면 ----------
function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let t0 = performance.now();
function frame(): void {
  const t = ((performance.now() - t0) / 1000) % DURATION;
  adult.pose(SCRIPT === 'balloon' ? adultBalloon(t) : adultPose(t));
  child?.pose(SCRIPT === 'balloon' ? childBalloon(t) : childPose(t));
  renderer.render(scene, camera);
  info.textContent = `${PEOPLE}명 · ${t.toFixed(1)}s / ${DURATION}s`;
  requestAnimationFrame(frame);
}
frame();

declare global {
  interface Window {
    __record(seconds: number): Promise<string>;
  }
}

window.__record = async (seconds: number) => {
  info.hidden = true;
  const stream = canvas.captureStream(30);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))!;
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  t0 = performance.now();
  rec.start(500);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  rec.stop();
  await stopped;
  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  info.hidden = false;
  return btoa(bin);
};
