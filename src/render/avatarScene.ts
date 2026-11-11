// 캡슐 아바타(FR-COM-11): 관절 사이를 둥근 캡슐로 잇고 머리는 원으로 그린다. 플레이어 색으로 구분.
// Three.js 정사영 카메라로 게임 좌표(화면 높이 = 1, 바닥 y = 0)를 그대로 그린다.

import * as THREE from 'three';
import { measure } from '../pose/body';
import { LM, type Pt } from '../pose/landmarks';
import type { NormTransform, Vec2 } from '../pose/transform';

const circleGeo = new THREE.CircleGeometry(1, 40);
const planeGeo = new THREE.PlaneGeometry(1, 1);

/** 원 2개 + 사각형 1개로 된 2D 캡슐 */
class Capsule2D {
  readonly group = new THREE.Group();
  private a: THREE.Mesh;
  private b: THREE.Mesh;
  private body: THREE.Mesh;

  constructor(mat: THREE.Material, z: number) {
    this.a = new THREE.Mesh(circleGeo, mat);
    this.b = new THREE.Mesh(circleGeo, mat);
    this.body = new THREE.Mesh(planeGeo, mat);
    this.group.add(this.a, this.b, this.body);
    this.group.position.z = z;
  }

  set(p: Vec2, q: Vec2, r: number): void {
    this.group.visible = true;
    this.a.position.set(p.x, p.y, 0);
    this.b.position.set(q.x, q.y, 0);
    this.a.scale.setScalar(r);
    this.b.scale.setScalar(r);
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    this.body.position.set((p.x + q.x) / 2, (p.y + q.y) / 2, 0);
    this.body.scale.set(Math.max(1e-4, len), 2 * r, 1);
    this.body.rotation.z = Math.atan2(dy, dx);
  }

  hide(): void {
    this.group.visible = false;
  }
}

type SegKey = 'torso' | 'hips' | 'upperL' | 'upperR' | 'foreL' | 'foreR' | 'thighL' | 'thighR' | 'shinL' | 'shinR' | 'footL' | 'footR' | 'neck';

/** 아바타 크기 비율(아바타 키 대비 반지름) */
const R = {
  arm: 0.034,
  leg: 0.046,
  foot: 0.028,
  hand: 0.042,
  neck: 0.04,
};

export interface AvatarInfo {
  /** 머리 꼭대기(게임 좌표). 이름표를 띄울 때 쓴다 */
  headTop: Vec2;
  /** 화면에 그려진 키(게임 단위) — 2인이 같은 크기로 보이는지 확인용 */
  drawnHeight: number;
  visible: boolean;
}

class Avatar {
  readonly group = new THREE.Group();
  private fillMat: THREE.MeshBasicMaterial;
  private lineMat: THREE.MeshBasicMaterial;
  private fill = new Map<SegKey, Capsule2D>();
  private line = new Map<SegKey, Capsule2D>();
  private head: THREE.Mesh;
  private headLine: THREE.Mesh;
  private hands: THREE.Mesh[] = [];
  private handLines: THREE.Mesh[] = [];
  private eyes: THREE.Mesh[] = [];
  private cheeks: THREE.Mesh[] = [];
  private shadow: THREE.Mesh;
  info: AvatarInfo = { headTop: { x: 0, y: 0 }, drawnHeight: 0, visible: false };

  constructor(color: string) {
    this.fillMat = new THREE.MeshBasicMaterial({ color });
    this.lineMat = new THREE.MeshBasicMaterial({ color });
    this.setColor(color);
    const keys: SegKey[] = ['torso', 'hips', 'neck', 'upperL', 'upperR', 'foreL', 'foreR', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR'];
    for (const k of keys) {
      const f = new Capsule2D(this.fillMat, 0.02);
      const l = new Capsule2D(this.lineMat, 0.0);
      this.fill.set(k, f);
      this.line.set(k, l);
      this.group.add(f.group, l.group);
    }
    this.head = new THREE.Mesh(circleGeo, this.fillMat);
    this.head.position.z = 0.03;
    this.headLine = new THREE.Mesh(circleGeo, this.lineMat);
    this.headLine.position.z = 0.025;
    this.group.add(this.head, this.headLine);
    for (let i = 0; i < 2; i++) {
      const h = new THREE.Mesh(circleGeo, this.fillMat);
      h.position.z = 0.03;
      const hl = new THREE.Mesh(circleGeo, this.lineMat);
      hl.position.z = 0.0;
      this.hands.push(h);
      this.handLines.push(hl);
      this.group.add(h, hl);
      const eye = new THREE.Mesh(circleGeo, new THREE.MeshBasicMaterial({ color: '#1a1030' }));
      eye.position.z = 0.04;
      this.eyes.push(eye);
      const cheek = new THREE.Mesh(circleGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 }));
      cheek.position.z = 0.035;
      this.cheeks.push(cheek);
      this.group.add(eye, cheek);
    }
    this.shadow = new THREE.Mesh(circleGeo, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25 }));
    this.shadow.position.z = -0.01;
    this.group.add(this.shadow);
  }

  setColor(color: string): void {
    const c = new THREE.Color(color);
    this.fillMat.color.copy(c);
    this.lineMat.color.copy(c.clone().multiplyScalar(0.55));
  }

  update(pts: Pt[] | null, tf: NormTransform, refHeightCam: number | null, minVis: number): void {
    if (!pts) {
      this.group.visible = false;
      this.info.visible = false;
      return;
    }
    this.group.visible = true;
    const m = measure(pts, minVis);
    const g = (i: number) => tf.apply(pts[i]);
    const ok = (...ids: number[]) => ids.every((i) => pts[i].v >= 0.3);
    const H = tf.len(refHeightCam ?? m.height); // 아바타 굵기 기준 키(게임 단위)
    const outline = H * 0.012;

    const seg = (k: SegKey, a: Vec2 | null, b: Vec2 | null, r: number) => {
      const f = this.fill.get(k)!;
      const l = this.line.get(k)!;
      if (!a || !b) {
        f.hide();
        l.hide();
        return;
      }
      f.set(a, b, r);
      l.set(a, b, r + outline);
    };
    const P = (i: number) => (pts[i].v >= 0.3 ? g(i) : null);

    const shL = g(LM.leftShoulder);
    const shR = g(LM.rightShoulder);
    const hipL = g(LM.leftHip);
    const hipR = g(LM.rightHip);
    const shMid = { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 };
    const hipMid = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
    const shW = Math.hypot(shL.x - shR.x, shL.y - shR.y);
    const torsoR = Math.min(Math.max(shW * 0.5, H * 0.075), H * 0.13);
    // 몸통: 어깨 가운데보다 조금 아래 ~ 골반 가운데. 어깨·골반 너비 쪽으로는 짧은 캡슐을 하나 더.
    const down = { x: hipMid.x - shMid.x, y: hipMid.y - shMid.y };
    const torsoTop = { x: shMid.x + down.x * 0.18, y: shMid.y + down.y * 0.18 };
    seg('torso', torsoTop, hipMid, torsoR);
    seg('hips', hipL, hipR, H * 0.06);
    const ns = tf.apply(m.headCenter);
    seg('neck', shMid, { x: (shMid.x + ns.x) / 2, y: (shMid.y + ns.y) / 2 }, H * R.neck);

    const sides = [
      { s: 'L', sh: LM.leftShoulder, el: LM.leftElbow, wr: LM.leftWrist, idx: LM.leftIndex, hip: LM.leftHip, kn: LM.leftKnee, an: LM.leftAnkle, ft: LM.leftFootIndex },
      { s: 'R', sh: LM.rightShoulder, el: LM.rightElbow, wr: LM.rightWrist, idx: LM.rightIndex, hip: LM.rightHip, kn: LM.rightKnee, an: LM.rightAnkle, ft: LM.rightFootIndex },
    ] as const;
    sides.forEach((d, i) => {
      seg(`upper${d.s}`, P(d.sh), P(d.el), H * R.arm);
      seg(`fore${d.s}`, P(d.el), P(d.wr), H * R.arm * 0.9);
      seg(`thigh${d.s}`, P(d.hip), P(d.kn), H * R.leg);
      seg(`shin${d.s}`, P(d.kn), P(d.an), H * R.leg * 0.85);
      seg(`foot${d.s}`, ok(d.an, d.ft) ? g(d.an) : null, ok(d.an, d.ft) ? g(d.ft) : null, H * R.foot);
      // 손: 손목과 검지 사이
      const hand = this.hands[i];
      const hl = this.handLines[i];
      if (ok(d.wr)) {
        const w = g(d.wr);
        const t = ok(d.idx) ? g(d.idx) : w;
        const c = { x: w.x * 0.5 + t.x * 0.5, y: w.y * 0.5 + t.y * 0.5 };
        hand.visible = hl.visible = true;
        hand.position.set(c.x, c.y, 0.03);
        hand.scale.setScalar(H * R.hand);
        hl.position.set(c.x, c.y, 0);
        hl.scale.setScalar(H * R.hand + outline);
      } else hand.visible = hl.visible = false;
    });

    // 머리 + 얼굴(눈은 코 방향으로 살짝 움직여 고개 돌림을 보여준다)
    const hr = Math.min(Math.max(tf.len(m.headRadius), H * 0.085), H * 0.13);
    this.head.position.set(ns.x, ns.y, 0.03);
    this.head.scale.setScalar(hr);
    this.headLine.position.set(ns.x, ns.y, 0.025);
    this.headLine.scale.setScalar(hr + outline);
    const nose = g(LM.nose);
    const look = Math.max(-1, Math.min(1, (nose.x - ns.x) / hr));
    this.eyes.forEach((e, i) => {
      const side = i === 0 ? -1 : 1;
      e.position.set(ns.x + (side * 0.36 + look * 0.35) * hr, ns.y + 0.08 * hr, 0.04);
      e.scale.set(0.12 * hr, 0.16 * hr, 1);
    });
    this.cheeks.forEach((c, i) => {
      const side = i === 0 ? -1 : 1;
      c.position.set(ns.x + (side * 0.55 + look * 0.3) * hr, ns.y - 0.25 * hr, 0.035);
      c.scale.setScalar(0.13 * hr);
    });

    // 바닥 그림자
    const foot = tf.apply(m.foot);
    this.shadow.position.set(foot.x, Math.min(foot.y, hipMid.y) - H * 0.01, -0.01);
    this.shadow.scale.set(H * 0.2, H * 0.035, 1);

    const top = { x: ns.x, y: ns.y + hr };
    this.info = { headTop: top, drawnHeight: top.y - foot.y, visible: true };
  }
}

export interface AvatarDraw {
  pts: Pt[] | null;
  transform: NormTransform;
  color: string;
  /** 굵기 기준으로 쓸 고정 키(카메라 단위). 보정 후에는 보정 키를 넘긴다 */
  refHeightCam: number | null;
}

export class AvatarScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-0.89, 0.89, 1, 0, -10, 10);
  private avatars: Avatar[] = [];
  private floor: THREE.Mesh;
  aspect = 16 / 9;

  constructor(readonly canvas: HTMLCanvasElement, count: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    for (let i = 0; i < count; i++) {
      const a = new Avatar('#ffffff');
      a.group.position.z = i * 0.1;
      this.avatars.push(a);
      this.scene.add(a.group);
    }
    this.floor = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12 }));
    this.floor.position.z = -0.5;
    this.scene.add(this.floor);
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.aspect = w / Math.max(1, h);
    this.camera.left = -this.aspect / 2;
    this.camera.right = this.aspect / 2;
    this.camera.top = 1;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
  }

  /** 바닥 띠(높이 floorY까지) */
  setFloor(floorY: number, visible: boolean): void {
    this.floor.visible = visible;
    this.floor.position.set(0, floorY / 2, -0.5);
    this.floor.scale.set(this.aspect + 0.1, floorY, 1);
  }

  draw(list: AvatarDraw[], minVis: number): AvatarInfo[] {
    const out: AvatarInfo[] = [];
    this.avatars.forEach((a, i) => {
      const d = list[i];
      if (!d) {
        a.update(null, null as unknown as NormTransform, null, minVis);
      } else {
        a.setColor(d.color);
        a.update(d.pts, d.transform, d.refHeightCam, minVis);
      }
      out.push(a.info);
    });
    this.renderer.render(this.scene, this.camera);
    return out;
  }

  /** 게임 좌표 → 화면 픽셀(이름표·커서 위치용) */
  toScreen(p: Vec2): { x: number; y: number } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return { x: (p.x / this.aspect + 0.5) * w, y: (1 - p.y) * h };
  }
}
