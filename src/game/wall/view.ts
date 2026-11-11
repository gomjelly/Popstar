// 거품 벽 그리기: 624개 거품을 InstancedMesh 하나로 그린다.
// 원근 효과: 벽은 소실점(화면 가운데쯤)에서 작게 나타나 커지며 다가오고(FR-WALL-21),
// 도착하면 실제 크기(플레이어와 같은 좌표)가 되고, 지나간 뒤에는 더 커지며 사라진다(FR-WALL-24).

import * as THREE from 'three';
import type { Wall } from './geometry';

const circle = new THREE.CircleGeometry(1, 20);
const dummy = new THREE.Object3D();
const BUBBLE_COLORS = ['#7fdcff', '#a6e8ff', '#8fd0ff', '#b9f0ff', '#9ad8ff'].map((c) => new THREE.Color(c));
/** 구멍 안 금색 풍선(몸으로 채우면 점수) */
const TARGET_COLORS = ['#ffd23f', '#ffc61a', '#ffdf6b', '#ffcc33'].map((c) => new THREE.Color(c));

const particleMats = new Map<string, THREE.MeshBasicMaterial>();
const particleMat = (color: string) => {
  let m = particleMats.get(color);
  if (!m) particleMats.set(color, (m = new THREE.MeshBasicMaterial({ color, depthWrite: false })));
  return m;
};

interface Particle {
  size: number;
  m: THREE.Mesh;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

export class WallView {
  readonly root = new THREE.Group();
  private fill: THREE.InstancedMesh;
  private shine: THREE.InstancedMesh;
  private fillMat: THREE.MeshBasicMaterial;
  private shineMat: THREE.MeshBasicMaterial;
  private wall: Wall | null = null;
  private particles: Particle[] = [];
  private hidden = new Set<number>();
  /** 소실점(게임 좌표) */
  vanish = { x: 0, y: 0.5 };

  constructor(scene: THREE.Scene, max = 1200) {
    this.fillMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false });
    this.shineMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false });
    this.fill = new THREE.InstancedMesh(circle, this.fillMat, max);
    this.shine = new THREE.InstancedMesh(circle, this.shineMat, max);
    this.shine.position.z = 0.001;
    this.fill.count = 0;
    this.shine.count = 0;
    this.root.add(this.fill, this.shine);
    this.root.visible = false;
    scene.add(this.root);
  }

  setWall(w: Wall): void {
    this.wall = w;
    this.hidden.clear();
    this.fill.count = w.bubbles.length;
    this.shine.count = w.bubbles.length;
    w.bubbles.forEach((b, i) => this.place(i, !b.hole || b.target));
    this.fill.instanceMatrix.needsUpdate = true;
    this.shine.instanceMatrix.needsUpdate = true;
    if (this.fill.instanceColor) this.fill.instanceColor.needsUpdate = true;
    this.root.visible = true;
  }

  private place(i: number, show: boolean): void {
    const w = this.wall!;
    const b = w.bubbles[i];
    const r = show ? w.r * 1.04 : 0;
    dummy.position.set(b.x, b.y, 0);
    dummy.scale.set(r, r, 1);
    dummy.updateMatrix();
    this.fill.setMatrixAt(i, dummy.matrix);
    const palette = b.target ? TARGET_COLORS : BUBBLE_COLORS;
    this.fill.setColorAt(i, palette[(i * 7 + Math.floor(i / 24)) % palette.length]);
    dummy.position.set(b.x - w.r * 0.35, b.y + w.r * 0.35, 0);
    dummy.scale.set(r * 0.28, r * 0.28, 1);
    dummy.updateMatrix();
    this.shine.setMatrixAt(i, dummy.matrix);
  }

  /**
   * 다가오는 정도: u = 0(멀리) ~ 1(도착) ~ 1 넘으면 지나감.
   * 원근 배율 s = 1 / (1 + Z(1 − u)). front = 플레이어 앞에 그릴지(지나갈 때).
   */
  setProgress(u: number, opacity: number, front: boolean): number {
    const Z = 6;
    const s = 1 / Math.max(0.05, 1 + Z * (1 - u));
    this.root.scale.set(s, s, 1);
    this.root.position.set(this.vanish.x * (1 - s), this.vanish.y * (1 - s), front ? 0.5 : -0.3);
    this.fillMat.opacity = opacity;
    this.shineMat.opacity = Math.min(1, opacity + 0.15);
    return s;
  }

  /** 몸으로 채운 금색 풍선: 금빛 조각으로 반짝이며 터진다 */
  collect(indices: number[]): void {
    this.burst(indices, '#ffe066', 3);
  }

  /** 터진 벽 거품: 숨기고 조각을 흩뿌린다 */
  pop(indices: number[]): void {
    this.burst(indices, '#ff9aa8', 4);
  }

  private burst(indices: number[], color: string, pieces: number): void {
    const w = this.wall;
    if (!w) return;
    for (const i of indices) {
      if (this.hidden.has(i)) continue;
      this.hidden.add(i);
      this.place(i, false);
      const b = w.bubbles[i];
      for (let k = 0; k < pieces; k++) {
        const a = Math.random() * Math.PI * 2;
        const sp = w.r * (6 + Math.random() * 8);
        const m = new THREE.Mesh(circle, particleMat(color));
        const size = w.r * (0.25 + Math.random() * 0.2);
        m.position.set(b.x, b.y, 0.01);
        m.scale.setScalar(size);
        this.root.add(m);
        this.particles.push({ m, size, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.4 + Math.random() * 0.3 });
      }
    }
    this.fill.instanceMatrix.needsUpdate = true;
    this.shine.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    for (const p of [...this.particles]) {
      p.life += dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.scale.setScalar(p.size * Math.max(0, 1 - p.life / p.max));
      if (p.life >= p.max) {
        this.root.remove(p.m);
        this.particles.splice(this.particles.indexOf(p), 1);
      }
    }
  }

  clear(): void {
    for (const p of this.particles) this.root.remove(p.m);
    this.particles = [];
    this.root.visible = false;
    this.wall = null;
  }
}
