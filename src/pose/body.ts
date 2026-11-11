// 카메라 좌표의 관절로 몸 치수를 잰다: 키, 어깨너비, 몸통 길이, 머리 위치 등.
// 모두 카메라 좌표 단위(영상 높이 = 1). 정규화 변환(FR-COM-10)과 보정이 이 값을 쓴다.

import { LM, dist, mid, type Pt } from './landmarks';

export interface BodyMeasure {
  /** 머리 꼭대기 ~ 발목 (발목이 안 보이면 몸통으로 추정) */
  height: number;
  /** 키를 발목까지 실제로 잰 값인지 */
  fullHeight: boolean;
  shoulderWidth: number;
  torso: number;
  headCenter: { x: number; y: number };
  headRadius: number;
  headTopY: number;
  /** 발 위치(발목 가운데). 발목이 안 보이면 추정 */
  foot: { x: number; y: number };
  hip: Pt;
  shoulder: Pt;
}

/** 몸통 길이 → 키 비율(어른 ≈ 3.45, 아이 ≈ 3.3) */
const TORSO_TO_HEIGHT = 3.4;

export function measure(p: Pt[], minVis = 0.5): BodyMeasure {
  const shoulder = mid(p[LM.leftShoulder], p[LM.rightShoulder]);
  const hip = mid(p[LM.leftHip], p[LM.rightHip]);
  const torso = Math.max(1e-3, dist(shoulder, hip));
  const shoulderWidth = dist(p[LM.leftShoulder], p[LM.rightShoulder]);

  const nose = p[LM.nose];
  const earDist = dist(p[LM.leftEar], p[LM.rightEar]);
  const noseToShoulder = Math.abs(shoulder.y - nose.y);
  // 귀 사이 거리(머리 너비)와 코~어깨 높이 중 큰 쪽으로 머리 크기를 잡는다(고개를 돌려도 안정적).
  const headRadius = Math.max(earDist * 0.62, noseToShoulder * 0.48, torso * 0.17);
  const ear = mid(p[LM.leftEar], p[LM.rightEar]);
  const headCenter = { x: (nose.x + ear.x) / 2, y: Math.min(nose.y, ear.y) - headRadius * 0.15 };
  const headTopY = headCenter.y - headRadius;

  const la = p[LM.leftAnkle];
  const ra = p[LM.rightAnkle];
  const anklesOk = la.v >= minVis && ra.v >= minVis && la.y <= 1.0 && ra.y <= 1.0;
  let foot: { x: number; y: number };
  let height: number;
  if (anklesOk) {
    foot = { x: (la.x + ra.x) / 2, y: Math.max(la.y, ra.y) };
    height = foot.y - headTopY;
  } else {
    height = torso * TORSO_TO_HEIGHT;
    foot = { x: hip.x, y: headTopY + height };
  }
  return { height, fullHeight: anklesOk, shoulderWidth, torso, headCenter, headRadius, headTopY, foot, hip, shoulder };
}

export type FrameProblem = 'none' | 'head' | 'feet' | 'side' | 'far';

/**
 * 보정에 쓸 수 있게 온몸이 보이는지(FR-WALL-02 공통). 문제가 있으면 무엇이 잘렸는지 알려준다.
 * videoAspect: 영상 가로/세로 비(카메라 좌표 가로 범위 = 0..videoAspect)
 */
export function frameProblem(p: Pt[], videoAspect: number, minVis = 0.5): FrameProblem {
  const m = measure(p, minVis);
  if (m.headTopY < 0.0 || p[LM.nose].v < minVis) return 'head';
  const need = [LM.leftAnkle, LM.rightAnkle, LM.leftKnee, LM.rightKnee];
  if (need.some((i) => p[i].v < minVis || p[i].y > 0.995)) return 'feet';
  const xs = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip, LM.leftWrist, LM.rightWrist].map((i) => p[i].x);
  if (Math.min(...xs) < 0.01 || Math.max(...xs) > videoAspect - 0.01) return 'side';
  if (m.height < 0.3) return 'far';
  return 'none';
}

/** 관절 좌표를 부드럽게(지수 이동 평균). 손이 떨려 커서가 흔들리지 않게 한다. */
export class PoseSmoother {
  private prev: Pt[] | null = null;
  constructor(public alpha: number) {}

  reset(): void {
    this.prev = null;
  }

  push(p: Pt[]): Pt[] {
    if (!this.prev || this.alpha <= 0) {
      this.prev = p.map((q) => ({ ...q }));
      return this.prev;
    }
    const a = this.alpha;
    const out = p.map((q, i) => {
      const o = this.prev![i];
      // 크게 움직이면 덜 부드럽게(지연을 줄인다)
      const jump = Math.hypot(q.x - o.x, q.y - o.y);
      const k = jump > 0.08 ? a * 0.3 : a;
      return { x: o.x * k + q.x * (1 - k), y: o.y * k + q.y * (1 - k), v: q.v };
    });
    this.prev = out;
    return out;
  }
}
