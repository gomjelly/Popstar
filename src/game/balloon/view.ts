// 풍선·터짐 효과·손 판정 원을 Three.js로 그린다(아바타와 같은 장면, 같은 게임 좌표).

import * as THREE from 'three';
import type { Balloon, BalloonKind, Hand } from './logic';

const circle = new THREE.CircleGeometry(1, 40);
const plane = new THREE.PlaneGeometry(1, 1);
const ring = new THREE.RingGeometry(0.88, 1, 48);

export const NORMAL_COLORS = ['#ff4d6d', '#ffb703', '#3a86ff', '#8ac926', '#9b5de5', '#ff7b00'];

function heartGeo(): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -0.9);
  s.bezierCurveTo(-0.15, -0.65, -1.05, -0.2, -1.0, 0.3);
  s.bezierCurveTo(-0.95, 0.85, -0.25, 1.0, 0, 0.55);
  s.bezierCurveTo(0.25, 1.0, 0.95, 0.85, 1.0, 0.3);
  s.bezierCurveTo(1.05, -0.2, 0.15, -0.65, 0, -0.9);
  return new THREE.ShapeGeometry(s, 24);
}

function starGeo(points = 5, inner = 0.45): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 === 0 ? 1 : inner;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  return new THREE.ShapeGeometry(s);
}

const HEART = heartGeo();
const STAR = starGeo();
const knotGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(-0.5, -0.6);
  s.lineTo(0.5, -0.6);
  return new THREE.ShapeGeometry(s);
})();

// 성능: 같은 색·투명도의 재질은 하나를 함께 쓴다(풍선마다 새로 만들지 않음 → 메모리·GC·상태 전환 감소)
const materials = new Map<string, THREE.MeshBasicMaterial>();
const basic = (color: string, opacity = 1): THREE.MeshBasicMaterial => {
  const key = color + '|' + opacity;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    materials.set(key, m);
  }
  return m;
};

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = sx): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, 1);
  return m;
}

/** 풍선 하나(반지름 1 기준으로 만들고 group 크기로 맞춘다) */
function makeBalloon(kind: BalloonKind, hue: number): { group: THREE.Group; spark?: THREE.Mesh } {
  const g = new THREE.Group();
  const line = basic('#ffffff', 0.7);
  const string = mesh(plane, line, 0, -1.75, -0.01, 0.05, 1.3);
  const hi = basic('#ffffff', 0.55);
  switch (kind) {
    case 'bomb': {
      const body = basic('#22222a');
      g.add(mesh(circle, body, 0, 0, 0, 1, 1));
      g.add(mesh(circle, hi, -0.35, 0.38, 0.01, 0.2, 0.28));
      g.add(mesh(plane, basic('#8a6a3a'), 0.25, 1.05, -0.01, 0.12, 0.45));
      const spark = mesh(STAR, basic('#ffb02e'), 0.32, 1.32, 0.02, 0.32);
      g.add(spark);
      // 위험 표시(빨간 띠)
      g.add(mesh(ring, basic('#ff3b4e'), 0, 0, 0.005, 0.72));
      return { group: g, spark };
    }
    case 'gold': {
      g.add(mesh(circle, basic('#ffd23f'), 0, 0, 0, 1, 1.15));
      g.add(mesh(circle, hi, -0.35, 0.45, 0.01, 0.22, 0.32));
      g.add(mesh(STAR, basic('#fff6c8'), 0, 0, 0.02, 0.5));
      g.add(mesh(knotGeo, basic('#e0a800'), 0, -1.12, 0, 0.35, 0.35));
      g.add(string);
      return { group: g };
    }
    case 'heart': {
      g.add(mesh(HEART, basic('#ff4f9a'), 0, 0, 0, 1.1));
      g.add(mesh(circle, hi, -0.45, 0.45, 0.01, 0.18, 0.24));
      g.add(mesh(plane, line, 0, -1.6, -0.01, 0.05, 1.3));
      return { group: g };
    }
    case 'clock': {
      g.add(mesh(circle, basic('#2f80ff'), 0, 0, 0, 1, 1));
      g.add(mesh(circle, basic('#ffffff'), 0, 0, 0.01, 0.82, 0.82));
      const h1 = mesh(plane, basic('#1a1030'), 0, 0.22, 0.02, 0.1, 0.45);
      const h2 = mesh(plane, basic('#ff3b4e'), 0.18, 0, 0.02, 0.36, 0.08);
      g.add(h1, h2, mesh(circle, basic('#1a1030'), 0, 0, 0.03, 0.1));
      g.add(mesh(knotGeo, basic('#2f80ff'), 0, -0.98, 0, 0.35, 0.35));
      g.add(string);
      return { group: g };
    }
    case 'star': {
      g.add(mesh(STAR, basic('#ffe14d'), 0, 0, 0, 1.25));
      g.add(mesh(STAR, basic('#fff7c2'), 0, 0.05, 0.01, 0.55));
      g.add(mesh(plane, line, 0, -1.7, -0.01, 0.05, 1.3));
      return { group: g };
    }
    case 'bubble': {
      g.add(mesh(circle, basic('#bfefff', 0.25), 0, 0, 0, 1));
      g.add(mesh(ring, basic('#e6fbff', 0.8), 0, 0, 0.01, 1));
      g.add(mesh(circle, basic('#ffffff', 0.7), -0.38, 0.4, 0.02, 0.2, 0.14));
      return { group: g };
    }
    default: {
      const c = NORMAL_COLORS[hue % NORMAL_COLORS.length];
      g.add(mesh(circle, basic(c), 0, 0, 0, 1, 1.15));
      g.add(mesh(circle, hi, -0.35, 0.45, 0.01, 0.22, 0.32));
      g.add(mesh(knotGeo, basic(c), 0, -1.12, 0, 0.35, 0.35));
      g.add(string);
      return { group: g };
    }
  }
}

interface Particle {
  m: THREE.Mesh;
  vx: number;
  vy: number;
  life: number;
  max: number;
  /** 처음 크기(시간이 지나며 작아지며 사라진다 — 재질을 공유하므로 투명도 대신 크기로) */
  size: number;
}

export function balloonColor(b: Balloon): string {
  switch (b.kind) {
    case 'bomb':
      return '#ff8a2a';
    case 'gold':
      return '#ffd23f';
    case 'heart':
      return '#ff4f9a';
    case 'clock':
      return '#2f80ff';
    case 'star':
      return '#ffe14d';
    case 'bubble':
      return '#bfefff';
    default:
      return NORMAL_COLORS[b.hue % NORMAL_COLORS.length];
  }
}

export class BalloonView {
  readonly root = new THREE.Group();
  private items = new Map<number, ReturnType<typeof makeBalloon>>();
  private particles: Particle[] = [];
  /** 다 쓴 조각(다시 쓴다) */
  private spare: THREE.Mesh[] = [];
  private rings: THREE.Mesh[] = [];
  private t = 0;

  constructor(scene: THREE.Scene) {
    // 아바타보다 뒤(손이 풍선 앞에 보이게)
    this.root.position.z = -0.3;
    scene.add(this.root);
  }

  sync(balloons: Balloon[]): void {
    const alive = new Set(balloons.map((b) => b.id));
    for (const [id, it] of this.items) {
      if (!alive.has(id)) {
        this.drop(it.group);
        this.items.delete(id);
      }
    }
    for (const b of balloons) {
      let it = this.items.get(b.id);
      if (!it) {
        it = makeBalloon(b.kind, b.hue);
        this.items.set(b.id, it);
        this.root.add(it.group);
      }
      it.group.position.set(b.x, b.y, (b.id % 50) * 0.001);
      it.group.scale.setScalar(b.r);
      it.group.rotation.z = Math.sin(b.age * 2.2 + b.swayPhase) * 0.12;
      if (it.spark) it.spark.scale.setScalar(0.25 + 0.12 * Math.abs(Math.sin(this.t * 18 + b.id)));
    }
  }

  /** 터지는 조각 */
  burst(x: number, y: number, r: number, color: string, count = 12): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const sp = r * (3 + Math.random() * 3);
      const size = r * (0.12 + Math.random() * 0.12);
      const m = this.spare.pop() ?? mesh(circle, basic(color));
      m.material = basic(color);
      m.position.set(x, y, 0.05);
      m.scale.setScalar(size);
      m.visible = true;
      if (!m.parent) this.root.add(m);
      this.particles.push({ m, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.45 + Math.random() * 0.25, size });
    }
  }

  /** 손 판정 원 */
  setHands(hands: Hand[], radius: number, colors: string[]): void {
    while (this.rings.length < hands.length) {
      // 손 원은 사람마다 색을 바꾸므로 재질을 따로 둔다
      const m = mesh(ring, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false }), 0, 0, 0.6);
      this.root.add(m);
      this.rings.push(m);
    }
    this.rings.forEach((m, i) => {
      const h = hands[i];
      m.visible = Boolean(h);
      if (!h) return;
      m.position.set(h.x, h.y, 0.6);
      m.scale.setScalar(radius);
      (m.material as THREE.MeshBasicMaterial).color.set(colors[h.player] ?? '#ffffff');
    });
  }

  update(dt: number): void {
    this.t += dt;
    let w = 0;
    for (const p of this.particles) {
      p.life += dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.vy -= 1.2 * dt;
      const k = 1 - p.life / p.max;
      if (k <= 0) {
        p.m.visible = false;
        this.spare.push(p.m);
        continue;
      }
      p.m.scale.setScalar(p.size * (0.4 + 0.6 * k));
      this.particles[w++] = p;
    }
    this.particles.length = w;
  }

  /** 풍선 그룹을 뺀다(기하·재질은 함께 쓰므로 그대로 둔다) */
  private drop(g: THREE.Object3D): void {
    this.root.remove(g);
  }

  clear(): void {
    for (const it of this.items.values()) this.drop(it.group);
    this.items.clear();
    for (const p of this.particles) {
      p.m.visible = false;
      this.spare.push(p.m);
    }
    this.particles = [];
    this.setHands([], 0, []);
  }

  dispose(): void {
    this.clear();
    this.root.parent?.remove(this.root);
  }
}
