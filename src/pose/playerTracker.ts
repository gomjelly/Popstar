// 2인 번호 유지(FR-COM-04).
// MediaPipe는 프레임마다 사람 순서를 바꿔 돌려줄 수 있으므로, 직전 위치와 가장 가까운 사람에게 같은 번호를 이어 붙인다.
// 보정 때 assignLeftToRight()로 왼쪽 사람 = P1, 오른쪽 = P2로 다시 정한다. 그 뒤로는 자리를 바꿔도 번호(색)가 유지된다.

import { appearanceDistance, blendAppearance, type Appearance } from './appearance';
import { measure, PoseSmoother } from './body';
import { LM, dist, mid, type Pt } from './landmarks';

export interface Slot {
  index: number; // 0 = P1, 1 = P2
  /** 이번 프레임에 보였는지 */
  present: boolean;
  /** 부드럽게 한 관절(카메라 좌표). 한 번도 안 보였으면 null */
  pts: Pt[] | null;
  /** 번호를 이어 붙일 때 쓰는 기준 위치(골반 가운데) */
  anchor: { x: number; y: number } | null;
  lastSeen: number;
  /** 언제부터 안 보였는지(보이면 null) */
  lostSince: number | null;
  smoother: PoseSmoother;
  /** 옷 색(상의·하의) — 엇갈려 지나갈 때 사람을 구별한다 */
  look: Appearance | null;
}

export type TrackMode = 'menu' | 'game';

/** 비어 있는 번호에 넣는 비용(가까운 사람을 먼저 잇고, 남는 사람을 빈 번호에 넣기 위함) */
const EMPTY_COST = 1.0;
/** 잠깐 안 보였던 번호에 잇는 벌점(지금 보이는 번호와 먼저 잇는다) */
const LOST_PENALTY = 0.15;
/** 옷 색 차이의 무게(위치 차이와 더한다. 초록 옷 vs 노란 옷 ≈ 0.7) */
const LOOK_WEIGHT = 1.0;
/** 메뉴 화면에서는 이 시간보다 오래 안 보이면 번호를 비운다(새로 온 사람이 왼쪽부터 번호를 받게) */
const MENU_FORGET_MS = 1500;

function anchorOf(p: Pt[]): { x: number; y: number } {
  const hip = mid(p[LM.leftHip], p[LM.rightHip]);
  const sh = mid(p[LM.leftShoulder], p[LM.rightShoulder]);
  return hip.v >= 0.3 ? hip : sh;
}

export class PlayerTracker {
  readonly slots: Slot[];
  mode: TrackMode = 'menu';
  /** 디버그·검증용: 마지막으로 번호를 새로 붙였거나 바꾼 일 */
  lastEvent = '';

  constructor(count: number, smoothing: number) {
    this.slots = Array.from({ length: count }, (_, index) => ({
      index,
      present: false,
      pts: null,
      anchor: null,
      lastSeen: 0,
      lostSince: null,
      smoother: new PoseSmoother(smoothing),
      look: null,
    }));
  }

  setSmoothing(alpha: number): void {
    for (const s of this.slots) s.smoother.alpha = alpha;
  }

  /** 안 보인 시간(ms). 한 번도 안 보였으면 Infinity */
  lostMs(slot: Slot, now: number): number {
    if (slot.present) return 0;
    if (slot.lostSince === null) return slot.pts ? 0 : Infinity;
    return now - slot.lostSince;
  }

  get presentCount(): number {
    return this.slots.filter((s) => s.present).length;
  }

  update(detections: Pt[][], now: number, videoAspect: number, appearances: (Appearance | null)[] = []): void {
    const keep = dedupe(detections).slice(0, this.slots.length);
    const dets = keep.map((i) => detections[i]);
    const looks = keep.map((i) => appearances[i] ?? null);
    const anchors = dets.map(anchorOf);

    // 메뉴 화면: 오래 안 보인 번호는 비운다.
    if (this.mode === 'menu') {
      for (const s of this.slots) {
        if (!s.present && s.lostSince !== null && now - s.lostSince > MENU_FORGET_MS) this.clear(s);
      }
    }

    const cost = (di: number, s: Slot): number => {
      if (!s.anchor) {
        // 빈 번호: 왼쪽 사람일수록 앞 번호를 받게 아주 작은 차이를 둔다.
        const x = anchors[di].x / Math.max(1e-3, videoAspect);
        return EMPTY_COST + 0.01 * (s.index === 0 ? x : 1 - x) + 0.001 * s.index;
      }
      const look = appearanceDistance(looks[di], s.look);
      return dist(anchors[di], s.anchor) + (s.present ? 0 : LOST_PENALTY) + (look === null ? 0 : LOOK_WEIGHT * look);
    };

    // 사람 ≤ 2, 번호 ≤ 2 이므로 가능한 짝을 모두 따져 비용이 가장 작은 것을 고른다.
    let best: number[] = [];
    let bestCost = Infinity;
    const n = this.slots.length;
    const assign: number[] = [];
    const used = new Array<boolean>(n).fill(false);
    const search = (di: number, acc: number) => {
      if (acc >= bestCost) return;
      if (di === dets.length) {
        bestCost = acc;
        best = assign.slice();
        return;
      }
      for (let si = 0; si < n; si++) {
        if (used[si]) continue;
        used[si] = true;
        assign[di] = si;
        search(di + 1, acc + cost(di, this.slots[si]));
        used[si] = false;
      }
    };
    search(0, 0);

    const seen = new Set<number>();
    best.forEach((si, di) => {
      const s = this.slots[si];
      if (!s.anchor) this.lastEvent = `P${si + 1} joined`;
      else if (!s.present) this.lastEvent = `P${si + 1} back`;
      if (!s.present && s.lostSince !== null && now - s.lostSince > 400) s.smoother.reset();
      s.pts = s.smoother.push(dets[di]);
      s.anchor = anchors[di];
      // 옷 색은 메뉴에서는 빨리, 게임 중에는 아주 천천히(비슷할 때만) 따라간다.
      const look = looks[di];
      if (look) {
        const d = appearanceDistance(look, s.look);
        if (this.mode === 'menu' || !s.look) s.look = blendAppearance(s.look, look, s.look ? 0.1 : 1);
        else if (d !== null && d < 0.25) s.look = blendAppearance(s.look, look, 0.02);
      }
      s.present = true;
      s.lastSeen = now;
      s.lostSince = null;
      seen.add(si);
    });
    for (const s of this.slots) {
      if (seen.has(s.index)) continue;
      if (s.present) {
        s.present = false;
        s.lostSince = now;
        this.lastEvent = `P${s.index + 1} lost`;
      }
    }
  }

  /** 보정: 지금 보이는 사람을 왼쪽부터 P1, P2로 다시 붙인다. */
  assignLeftToRight(): void {
    const present = this.slots.filter((s) => s.present && s.pts && s.anchor);
    present.sort((a, b) => a.anchor!.x - b.anchor!.x);
    const snapshot = present.map((s) => ({ pts: s.pts, anchor: s.anchor, lastSeen: s.lastSeen, smoother: s.smoother, look: s.look }));
    for (const s of this.slots) this.clear(s);
    snapshot.forEach((d, i) => {
      const s = this.slots[i];
      s.pts = d.pts;
      s.anchor = d.anchor;
      s.lastSeen = d.lastSeen;
      s.present = true;
      s.lostSince = null;
      s.smoother = d.smoother;
      s.look = d.look;
    });
    this.lastEvent = `assigned left-to-right (${snapshot.length})`;
  }

  clear(s: Slot): void {
    s.present = false;
    s.pts = null;
    s.anchor = null;
    s.lostSince = null;
    s.look = null;
    s.smoother = new PoseSmoother(s.smoother.alpha);
  }
}

/** 같은 사람을 두 번 잡은 경우(어깨·골반이 거의 겹침) 하나만 남긴다. 남길 사람의 번호(index)를 돌려준다. */
function dedupe(dets: Pt[][]): number[] {
  const out: number[] = [];
  for (const [i, d] of dets.entries()) {
    const m = measure(d);
    const dup = out.some((j) => {
      const mo = measure(dets[j]);
      const tol = 0.25 * Math.min(m.torso, mo.torso);
      return dist(m.shoulder, mo.shoulder) < tol && dist(m.hip, mo.hip) < tol;
    });
    if (!dup) out.push(i);
  }
  return out;
}
