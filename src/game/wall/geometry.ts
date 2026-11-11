// 벽 뚫고 지나가기의 기하(SRS 4.1~4.4). 화면·인식과 분리된 순수 로직(값 import 없음, node --test 로 실행).
//  - 체형 프로필(키 대비 비율) + 자세 각도 → 관절 위치(FR-WALL-13)
//  - 관절 → 캡슐(아바타와 같은 굵기 규칙) → 구멍 뚫린 거품 벽(FR-WALL-10, 11, 14)
//  - 플레이어 캡슐과 겹치는 거품 = 터진 거품(FR-WALL-23), 점수(4.4)
// 좌표는 게임 좌표(화면 높이 = 1, y는 위로 증가).

export interface Vec {
  x: number;
  y: number;
}

/** 체형 프로필: 키를 1로 둔 비율(FR-WALL-03). 보정 화면에서 3초 평균으로 잰다 */
export interface BodyProfile {
  shoulderW: number;
  hipW: number;
  upperArm: number;
  forearm: number;
  /** 손목 → 손끝(검지) */
  hand: number;
  thigh: number;
  shin: number;
  /** 어깨 가운데 → 골반 가운데 */
  torso: number;
  /** 어깨 가운데 → 머리 가운데 */
  neck: number;
  headR: number;
  /** 골반 가운데 → 발목 높이(서 있을 때) — 참고용 */
  legLen: number;
}

/** 어른 평균 비율(테스트·기본값) */
export const DEFAULT_PROFILE: BodyProfile = {
  shoulderW: 0.21,
  hipW: 0.11,
  upperArm: 0.17,
  forearm: 0.15,
  hand: 0.06,
  thigh: 0.25,
  shin: 0.24,
  torso: 0.29,
  neck: 0.13,
  headR: 0.065,
  legLen: 0.49,
};

/** 벽 자세(poses.json, SRS 6장). 각도는 도, 0 = 팔다리를 아래로 곧게 */
export interface WallPose {
  id: string;
  name: string;
  level: number;
  /** 팔을 몸 옆으로 든 각도(0 아래, 90 옆으로, 180 위로). L = 플레이어 왼쪽(거울 화면에서도 왼쪽) */
  shoulderL: number;
  shoulderR: number;
  /** 팔꿈치: + 는 같은 방향(바깥·위)으로 더 꺾기, − 는 안쪽으로 */
  elbowL: number;
  elbowR: number;
  /** 다리를 옆으로 벌린 각도 */
  hipL: number;
  hipR: number;
  /** 무릎: + 바깥, − 안쪽으로 꺾기 */
  kneeL: number;
  kneeR: number;
  /** 상체 기울기(+ 화면 오른쪽으로) */
  torsoLean: number;
  /** 한 발 들기(들린 발이 바닥에 닿지 않게 몸을 받치는 발 기준으로 세운다) */
  liftFoot: 'L' | 'R' | null;
}

/** 관절(게임 좌표). 안 보이는 관절은 null */
export interface Joints {
  /** 아바타 키(게임 단위). 굵기 기준 */
  H: number;
  head: Vec;
  headR: number;
  shL: Vec;
  shR: Vec;
  elL: Vec | null;
  elR: Vec | null;
  wrL: Vec | null;
  wrR: Vec | null;
  handL: Vec | null;
  handR: Vec | null;
  hipL: Vec;
  hipR: Vec;
  knL: Vec | null;
  knR: Vec | null;
  anL: Vec | null;
  anR: Vec | null;
}

export interface Capsule {
  a: Vec;
  b: Vec;
  r: number;
}

// ---------- 자세 → 관절 ----------

const rad = (d: number) => (d * Math.PI) / 180;
const add = (a: Vec, b: Vec, k = 1): Vec => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * 자세 각도에 플레이어의 실제 팔다리 길이를 대입해 관절 위치를 계산한다(FR-WALL-13).
 * H = 화면에서의 키(게임 단위), centerX = 골반 가운데 x, floorY = 바닥 높이.
 */
export function poseJoints(pose: WallPose, prof: BodyProfile, H: number, centerX: number, floorY: number): Joints {
  const L = (v: number) => v * H;
  const lean = rad(pose.torsoLean);
  const up: Vec = { x: Math.sin(lean), y: Math.cos(lean) };
  const right: Vec = { x: Math.cos(lean), y: -Math.sin(lean) };
  const down: Vec = { x: -up.x, y: -up.y };
  /** 아래 방향에서 바깥(side: -1 왼쪽, +1 오른쪽)으로 deg 만큼 돌린 방향 */
  const dir = (deg: number, side: number): Vec => {
    const t = rad(deg);
    return { x: down.x * Math.cos(t) + right.x * side * Math.sin(t), y: down.y * Math.cos(t) + right.y * side * Math.sin(t) };
  };
  const hip: Vec = { x: 0, y: 0 };
  const shoulder = add(hip, up, L(prof.torso));
  const head = add(shoulder, up, L(prof.neck));
  const shL = add(shoulder, right, -L(prof.shoulderW) / 2);
  const shR = add(shoulder, right, L(prof.shoulderW) / 2);
  const hipL = add(hip, right, -L(prof.hipW) / 2);
  const hipR = add(hip, right, L(prof.hipW) / 2);
  const arm = (sh: Vec, a: number, b: number, side: number) => {
    const el = add(sh, dir(a, side), L(prof.upperArm));
    const wr = add(el, dir(a + b, side), L(prof.forearm));
    const hand = add(wr, dir(a + b, side), L(prof.hand));
    return { el, wr, hand };
  };
  const leg = (h: Vec, a: number, k: number, side: number) => {
    const kn = add(h, dir(a, side), L(prof.thigh));
    const an = add(kn, dir(a + k, side), L(prof.shin));
    return { kn, an };
  };
  const aL = arm(shL, pose.shoulderL, pose.elbowL, -1);
  const aR = arm(shR, pose.shoulderR, pose.elbowR, 1);
  const lL = leg(hipL, pose.hipL, pose.kneeL, -1);
  const lR = leg(hipR, pose.hipR, pose.kneeR, 1);

  // 바닥에 닿는 발: 한 발 들기면 받치는 발, 아니면 더 낮은 발
  const support = pose.liftFoot === 'L' ? lR.an : pose.liftFoot === 'R' ? lL.an : lL.an.y < lR.an.y ? lL.an : lR.an;
  // 보정 때 발목(아래쪽 발목) 높이를 바닥에 맞추므로 구멍도 받치는 발목을 바닥에 둔다
  const footClear = 0;
  const dy = floorY + footClear - support.y;
  const dx = centerX;
  const mv = (p: Vec): Vec => ({ x: p.x + dx, y: p.y + dy });
  return {
    H,
    head: mv(head),
    headR: L(prof.headR),
    shL: mv(shL),
    shR: mv(shR),
    elL: mv(aL.el),
    elR: mv(aR.el),
    wrL: mv(aL.wr),
    wrR: mv(aR.wr),
    handL: mv(aL.hand),
    handR: mv(aR.hand),
    hipL: mv(hipL),
    hipR: mv(hipR),
    knL: mv(lL.kn),
    knR: mv(lR.kn),
    anL: mv(lL.an),
    anR: mv(lR.an),
  };
}

// ---------- 관절 → 캡슐(아바타와 같은 굵기 규칙) ----------

/** 굵기(키 대비 반지름). render/avatarScene.ts 와 같은 값 */
export const THICK = { arm: 0.034, fore: 0.031, hand: 0.042, leg: 0.046, shin: 0.039, foot: 0.028, neck: 0.04, hips: 0.06 };

export function capsules(j: Joints): Capsule[] {
  const H = j.H;
  const out: Capsule[] = [];
  const seg = (a: Vec | null, b: Vec | null, r: number) => {
    if (a && b) out.push({ a, b, r });
  };
  const sh = mid(j.shL, j.shR);
  const hp = mid(j.hipL, j.hipR);
  const shW = Math.hypot(j.shL.x - j.shR.x, j.shL.y - j.shR.y);
  const torsoR = Math.min(Math.max(shW * 0.5, H * 0.075), H * 0.13);
  seg({ x: sh.x + (hp.x - sh.x) * 0.18, y: sh.y + (hp.y - sh.y) * 0.18 }, hp, torsoR);
  seg(j.hipL, j.hipR, H * THICK.hips);
  seg(sh, mid(sh, j.head), H * THICK.neck);
  const headR = Math.min(Math.max(j.headR, H * 0.085), H * 0.13);
  out.push({ a: j.head, b: j.head, r: headR });
  seg(j.shL, j.elL, H * THICK.arm);
  seg(j.shR, j.elR, H * THICK.arm);
  seg(j.elL, j.wrL, H * THICK.fore);
  seg(j.elR, j.wrR, H * THICK.fore);
  for (const [w, h] of [
    [j.wrL, j.handL],
    [j.wrR, j.handR],
  ] as const) {
    if (w) {
      const c = h ? mid(w, h) : w;
      out.push({ a: c, b: c, r: H * THICK.hand });
    }
  }
  seg(j.hipL, j.knL, H * THICK.leg);
  seg(j.hipR, j.knR, H * THICK.leg);
  seg(j.knL, j.anL, H * THICK.shin);
  seg(j.knR, j.anR, H * THICK.shin);
  return out;
}

/** 점과 선분 사이 거리 */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

// ---------- 거품 벽 ----------

export interface WallConfig {
  grid: { cols: number; rows: number };
  wallSize: { heightRatio: number; widthRatio: number };
}

export interface Bubble {
  x: number;
  y: number;
  /** 구멍(처음부터 비어 있음) */
  hole: boolean;
}

export interface Wall {
  pose: WallPose;
  bubbles: Bubble[];
  /** 거품 반지름 */
  r: number;
  /** 거품 간격(지름 기준) */
  d: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** 구멍 여유 폭(게임 단위) */
  margin: number;
  joints: Joints;
}

/**
 * 벽 만들기(FR-WALL-10, 11, 13, 14): 벽 크기는 키에 비례(높이 = 키×1.2, 너비 = 키×1.25), 거품 개수는 누구나 같다.
 * 자세 관절을 캡슐로 잇고 여유 폭(거품 marginBubbles 개)을 더한 영역의 거품을 비운다.
 */
export function makeWall(pose: WallPose, prof: BodyProfile, H: number, floorY: number, cfg: WallConfig, marginBubbles: number): Wall {
  const W = H * cfg.wallSize.widthRatio;
  const WH = H * cfg.wallSize.heightRatio;
  const { cols, rows } = cfg.grid;
  const dx = W / cols;
  const dy = WH / rows;
  const d = (dx + dy) / 2;
  const r = d / 2;
  const x0 = -W / 2;
  const y0 = floorY;
  const joints = poseJoints(pose, prof, H, 0, floorY);
  const caps = capsules(joints);
  const margin = marginBubbles * d;
  const bubbles: Bubble[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = { x: x0 + (i + 0.5) * dx, y: y0 + (j + 0.5) * dy };
      const hole = caps.some((c) => distToSegment(p, c.a, c.b) < c.r + margin);
      bubbles.push({ ...p, hole });
    }
  }
  return { pose, bubbles, r, d, x0, x1: x0 + W, y0, y1: y0 + WH, margin, joints };
}

/** 플레이어 캡슐과 겹치는(터지는) 거품 번호(FR-WALL-23) */
export function poppedBubbles(wall: Wall, body: Capsule[]): number[] {
  const out: number[] = [];
  wall.bubbles.forEach((b, i) => {
    if (b.hole) return;
    if (body.some((c) => distToSegment(b, c.a, c.b) < c.r + wall.r)) out.push(i);
  });
  return out;
}

// ---------- 점수(4.4) ----------

export interface Grades {
  perfect: number;
  great: number;
  good: number;
}

export type Grade = 'Perfect' | 'Great' | 'Good' | 'Oops';

/** Perfect(0개), Great(5개 이하), Good(15개 이하), Oops(그 이상) — FR-WALL-25 */
export function gradeOf(popped: number, g: Grades): Grade {
  if (popped <= g.perfect) return 'Perfect';
  if (popped <= g.great) return 'Great';
  if (popped <= g.good) return 'Good';
  return 'Oops';
}

/** 벽 하나 점수 = 100/N × max(0, 1 − p/P0) */
export function wallScore(popped: number, walls: number, zeroScoreBubbles: number): number {
  return (100 / walls) * Math.max(0, 1 - popped / zeroScoreBubbles);
}

export function totalScore(popped: number[], zeroScoreBubbles: number): number {
  return Math.round(popped.reduce((a, p) => a + wallScore(p, popped.length, zeroScoreBubbles), 0));
}

// ---------- 게임 진행 ----------

/** 같은 자세 반복 없이 N개를 고르고, 뒤로 갈수록 어려운 자세가 나오게 한다(FR-WALL-14, 15) */
export function pickPoses(library: WallPose[], n: number, rng: () => number = Math.random): WallPose[] {
  const pool = library.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1));
    [pool[i], pool[k]] = [pool[k], pool[i]];
  }
  const chosen = pool.slice(0, Math.min(n, pool.length));
  // 레벨이 같으면 섞인 순서를 유지한다
  return chosen.map((p, i) => ({ p, i })).sort((a, b) => a.p.level - b.p.level || a.i - b.i).map((x) => x.p);
}

/** i번째 벽이 도착하는 데 걸리는 시간: 첫 벽 first초 → 마지막 벽 last초(FR-WALL-21) */
export function approachSec(i: number, n: number, first: number, last: number): number {
  if (n <= 1) return first;
  return first + ((last - first) * i) / (n - 1);
}

// ---------- 설정(SRS 6장 wall) ----------

export type WallDifficulty = 'easy' | 'normal' | 'hard';

export interface WallParams extends WallConfig {
  wallCount: { min: number; max: number };
  /** 플레이어 키가 화면 높이의 이 비율로 보인다(FR-WALL-04) */
  playerScreenHeight: number;
  approachSec: { first: number; last: number };
  judgeWindowMs: number;
  holeMarginBubbles: Record<WallDifficulty, number>;
  zeroScoreBubbles: number;
  grades: Grades;
  snapshotMode: 'photo' | 'avatar';
  /** 기본 난이도 */
  difficulty: WallDifficulty;
  /** 기준 자세 유지 시간(FR-WALL-03: 3초) */
  calibHoldMs: number;
  /** 벽 수를 고정(0이면 min~max 랜덤, FR-WALL-20) */
  fixedWallCount: number;
}

export const DEFAULT_WALL: WallParams = {
  wallCount: { min: 7, max: 10 },
  grid: { cols: 24, rows: 26 },
  wallSize: { heightRatio: 1.2, widthRatio: 1.25 },
  playerScreenHeight: 0.6,
  approachSec: { first: 5.5, last: 3 },
  judgeWindowMs: 150,
  holeMarginBubbles: { easy: 1.5, normal: 1.0, hard: 0.6 },
  zeroScoreBubbles: 40,
  grades: { perfect: 0, great: 5, good: 15 },
  snapshotMode: 'photo',
  difficulty: 'normal',
  calibHoldMs: 3000,
  fixedWallCount: 0,
};
