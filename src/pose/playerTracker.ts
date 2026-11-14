// 2인 번호 유지(FR-COM-04).
// MediaPipe는 프레임마다 사람 순서를 바꿔 돌려줄 수 있으므로, 직전 위치와 가장 가까운 사람에게 같은 번호를 이어 붙인다.
// 보정 때 assignLeftToRight()로 왼쪽 사람 = P1, 오른쪽 = P2로 다시 정한다. 그 뒤로는 자리를 바꿔도 번호(색)가 유지된다.
//
// 카메라에 사람이 더 보일 때(구경꾼 등): 필요한 인원(limit)만 추적한다.
//  - 번호가 이미 붙은 사람은 위치 + 옷 색으로 계속 따라간다. 너무 멀거나 옷 색이 다른 후보로는 넘어가지 않는다.
//  - 빈 번호는 우선순위(가운데에 가까움 × 잘 보임 × 카메라에 가까움)가 높은 사람으로 채운다.

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

/** 잠깐 안 보였던 번호에 잇는 벌점(지금 보이는 번호와 먼저 잇는다) */
const LOST_PENALTY = 0.15;
/** 옷 색 차이의 무게(위치 차이와 더한다. 초록 옷 vs 노란 옷 ≈ 0.7) */
const LOOK_WEIGHT = 1.0;
/** 메뉴 화면에서는 이 시간보다 오래 안 보이면 번호를 비운다(새로 온 사람이 왼쪽부터 번호를 받게) */
const MENU_FORGET_MS = 1500;
/** 이 비용보다 큰 짝은 같은 사람으로 보지 않는다(안 보인 시간이 길수록 조금씩 넓어진다) */
const GATE = 0.8;
/** 번호가 있는 사람을 이번 프레임에 못 이었을 때의 비용 */
const UNMATCHED_COST = 1.2;
/** 게임 중 옷 색이 이만큼 넘게 다르면 다른 사람으로 본다 */
const LOOK_REJECT = 0.35;
/** 게임 전(메뉴·보정): 우선순위가 이만큼 더 높은 사람이 이 시간 넘게 계속 보이면 번호를 넘겨준다 */
const SWAP_MARGIN = 0.08;
/** 게임 중 잠깐 놓친 번호를 옷 색으로 확인할 수 없을 때는 이 거리 안의 사람만 같은 사람으로 본다 */
const NO_LOOK_GATE = 0.3;
/** 게임 중 직전 프레임에 보이던 번호가 한 프레임 사이 움직일 수 있는 거리(카메라 좌표, 영상 높이 = 1) */
const PRESENT_GATE = 0.4;
/** 게임 중 놓친 번호를 다시 잇는 후보의 최소 우선순위(화면 끝에 살짝 걸친 사람은 제외) */
const REACQUIRE_PRIO = 0.15;
const SWAP_MS = 700;

/** 추적 우선순위: 가운데에 가까울수록, 관절이 잘 보일수록, 카메라에 가까울수록(크게 보일수록) 높다 */
export function priorityOf(p: Pt[], videoAspect: number): number {
  const keys: number[] = [LM.nose, LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip];
  const vis = keys.reduce((a, i) => a + p[i].v, 0) / keys.length;
  const a = anchorOf(p);
  const center = 1 - Math.min(1, Math.abs(a.x / Math.max(1e-3, videoAspect) - 0.5) * 2);
  const torso = dist(mid(p[LM.leftShoulder], p[LM.rightShoulder]), mid(p[LM.leftHip], p[LM.rightHip]));
  const size = Math.min(1, torso / 0.2);
  return vis * (0.4 + 0.6 * center) * (0.5 + 0.5 * size);
}

function anchorOf(p: Pt[]): { x: number; y: number } {
  const hip = mid(p[LM.leftHip], p[LM.rightHip]);
  const sh = mid(p[LM.leftShoulder], p[LM.rightShoulder]);
  return hip.v >= 0.3 ? hip : sh;
}

export class PlayerTracker {
  readonly slots: Slot[];
  mode: TrackMode = 'menu';
  /** 지금 추적할 인원(1인 게임 = 1, 2인 = 2, 메뉴 = 최대). 나머지 사람은 무시한다 */
  limit: number;
  /** 디버그·검증용: 마지막으로 번호를 새로 붙였거나 바꾼 일 */
  lastEvent = '';
  /** 번호별로 "더 나은 후보"가 처음 보인 때(게임 전에만 쓴다) */
  private betterSince: number[] = [];

  constructor(count: number, smoothing: number) {
    this.limit = count;
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
    const keep = dedupe(detections);
    const dets = keep.map((i) => detections[i]);
    const looks = keep.map((i) => appearances[i] ?? null);
    const anchors = dets.map(anchorOf);
    const prio = dets.map((d) => priorityOf(d, videoAspect));
    const limit = Math.max(1, Math.min(this.limit, this.slots.length));

    // 추적 인원 밖의 번호는 비운다.
    for (const s of this.slots) if (s.index >= limit && s.anchor) this.clear(s);
    // 메뉴 화면: 오래 안 보인 번호는 비운다.
    if (this.mode === 'menu') {
      for (const s of this.slots) {
        if (!s.present && s.lostSince !== null && now - s.lostSince > MENU_FORGET_MS) this.clear(s);
      }
    }
    const active = this.slots.slice(0, limit);

    /** 번호가 있는 사람 ↔ 후보 비용. 같은 사람이 아니면 Infinity */
    const cost = (di: number, s: Slot): number => {
      const look = appearanceDistance(looks[di], s.look);
      const d = dist(anchors[di], s.anchor!);
      if (this.mode === 'game') {
        // 게임 중: 옷 색이 다르면 다른 사람. 놓쳤던 번호는 더 엄격하게(옆에 걸친 구경꾼에게 넘어가지 않게)
        if (look !== null && look > LOOK_REJECT) return Infinity;
        if (!s.present && prio[di] < REACQUIRE_PRIO) return Infinity;
        if (look === null && d > NO_LOOK_GATE) return Infinity;
        // 직전 프레임까지 보이던 사람은 한 프레임에 멀리 가지 못한다(인식이 한 번 끊긴 사이 옆 사람에게 넘어가지 않게)
        if (s.present && d > PRESENT_GATE) return Infinity;
        // 놓친 번호는 다시 잡는 거리를 천천히만 넓힌다(1초에 0.1). 잠깐 끊긴 사이 근처 구경꾼에게 넘어가지 않게
        if (!s.present) {
          const lost = s.lostSince === null ? 0 : (now - s.lostSince) / 1000;
          if (d > PRESENT_GATE + 0.1 * Math.min(4, lost)) return Infinity;
        }
      }
      const c = d + (s.present ? 0 : LOST_PENALTY) + (look === null ? 0 : LOOK_WEIGHT * look);
      const lostSec = s.present || s.lostSince === null ? 0 : (now - s.lostSince) / 1000;
      return c <= GATE + 0.4 * Math.min(3, lostSec) ? c : Infinity;
    };

    // 1) 번호가 있는 사람(최대 2명)을 후보와 잇는다: 모든 짝을 따져 비용이 가장 작은 것.
    const tracked = active.filter((s) => s.anchor);
    let best: number[] = tracked.map(() => -1);
    let bestCost = Infinity;
    const pick: number[] = [];
    const used = new Set<number>();
    const search = (k: number, acc: number) => {
      if (acc >= bestCost) return;
      if (k === tracked.length) {
        bestCost = acc;
        best = pick.slice();
        return;
      }
      pick[k] = -1;
      search(k + 1, acc + UNMATCHED_COST);
      for (let di = 0; di < dets.length; di++) {
        if (used.has(di)) continue;
        const c = cost(di, tracked[k]);
        if (!Number.isFinite(c)) continue;
        used.add(di);
        pick[k] = di;
        search(k + 1, acc + c);
        used.delete(di);
      }
    };
    search(0, 0);
    const pairs: [Slot, number][] = [];
    tracked.forEach((s, k) => {
      if (best[k] >= 0) pairs.push([s, best[k]]);
    });

    // 1-2) 게임 전에는, 번호를 가진 사람보다 우선순위가 확실히 높은 후보가 꾸준히 보이면 번호를 넘긴다.
    //      (늦게 인식된 참가자가 먼저 잡힌 구경꾼에게 밀리지 않게. 게임 중에는 바꾸지 않는다)
    if (this.mode === 'menu') {
      const taken = new Set(pairs.map(([, di]) => di));
      const free = dets.map((_, di) => di).filter((di) => !taken.has(di));
      // 가장 우선순위가 낮은 번호부터 비교
      const ranked = pairs.map((p, k) => ({ p, k })).sort((a, b) => prio[a.p[1]] - prio[b.p[1]]);
      for (const { p } of ranked) {
        const [slot, di] = p;
        const better = free.filter((u) => prio[u] > prio[di] + SWAP_MARGIN).sort((a, b) => prio[b] - prio[a])[0];
        if (better === undefined) {
          this.betterSince[slot.index] = 0;
          continue;
        }
        if (!this.betterSince[slot.index]) this.betterSince[slot.index] = now;
        if (now - this.betterSince[slot.index] < SWAP_MS) continue;
        this.betterSince[slot.index] = 0;
        this.clear(slot);
        p[1] = better;
        free.splice(free.indexOf(better), 1);
        this.lastEvent = `P${slot.index + 1} swapped to higher-priority person`;
      }
    } else this.betterSince = [];

    // 2) 빈 번호는 남은 후보 중 우선순위가 높은 사람으로 채운다(같이 들어오면 왼쪽 사람이 앞 번호).
    const empty = active.filter((s) => !s.anchor);
    if (empty.length) {
      const taken = new Set(pairs.map(([, di]) => di));
      const chosen = dets
        .map((_, di) => di)
        .filter((di) => !taken.has(di) && prio[di] > 0.15)
        .sort((a, b) => prio[b] - prio[a])
        .slice(0, empty.length)
        .sort((a, b) => anchors[a].x - anchors[b].x);
      chosen.forEach((di, k) => pairs.push([empty[k], di]));
    }

    const seen = new Set<number>();
    pairs.forEach(([s, di]) => {
      const si = s.index;
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
