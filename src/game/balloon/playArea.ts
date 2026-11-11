// 풍선 게임 플레이 영역 보정(FR-BAL-02~06).
// "제자리에서 양팔을 옆으로 쭉 펴세요" 자세로 손이 닿는 범위를 재고,
// 모든 플레이어의 범위를 합친 사각형이 화면을 채우도록 정규화 변환을 정한다. 변환은 게임이 끝날 때까지 고정.

import { measure } from '../../pose/body';
import { LM, dist, type Pt } from '../../pose/landmarks';
import { NormTransform } from '../../pose/transform';
import type { Rect } from './logic';

export interface ReachMeasure {
  /** 어깨 가운데 x(카메라 좌표) */
  cx: number;
  shoulderW: number;
  /** 팔 길이(위팔 + 아래팔, 양쪽 평균) */
  arm: number;
  headTopY: number;
  kneeY: number;
  /** 아바타 굵기 기준 키 */
  height: number;
}

export type ArmsProblem = 'none' | 'head' | 'knees' | 'side' | 'arms';

/** 양팔을 옆으로 편 자세인지, 머리~무릎이 다 보이는지 */
export function armsOutProblem(p: Pt[], videoAspect: number, minVis: number): ArmsProblem {
  const m = measure(p, minVis);
  if (p[LM.nose].v < minVis || m.headTopY < 0) return 'head';
  if ([LM.leftKnee, LM.rightKnee].some((i) => p[i].v < minVis || p[i].y > 0.99)) return 'knees';
  const arms = [LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist];
  if (arms.some((i) => p[i].v < minVis * 0.8)) return 'arms';
  const xs = [LM.leftWrist, LM.rightWrist].map((i) => p[i].x);
  if (Math.min(...xs) < 0.005 || Math.max(...xs) > videoAspect - 0.005) return 'side';
  // 손목이 어깨 높이 근처이고, 양 손목 사이가 충분히 벌어져 있어야 한다
  const T = m.torso;
  const level = [LM.leftWrist, LM.rightWrist].every((i) => Math.abs(p[i].y - m.shoulder.y) < 0.45 * T);
  const span = Math.abs(p[LM.leftWrist].x - p[LM.rightWrist].x);
  if (!level || span < m.shoulderWidth + 1.3 * T) return 'arms';
  return 'none';
}

export function measureReach(p: Pt[], minVis: number): ReachMeasure {
  const m = measure(p, minVis);
  const arm = (s: 'left' | 'right') =>
    s === 'left'
      ? dist(p[LM.leftShoulder], p[LM.leftElbow]) + dist(p[LM.leftElbow], p[LM.leftWrist])
      : dist(p[LM.rightShoulder], p[LM.rightElbow]) + dist(p[LM.rightElbow], p[LM.rightWrist]);
  return {
    cx: m.shoulder.x,
    shoulderW: m.shoulderWidth,
    arm: (arm('left') + arm('right')) / 2,
    headTopY: m.headTopY,
    kneeY: (p[LM.leftKnee].y + p[LM.rightKnee].y) / 2,
    height: m.fullHeight ? m.height : (p[LM.leftKnee].y + p[LM.rightKnee].y) / 2 - m.headTopY + m.torso * 1.05,
  };
}

export function averageReach(xs: ReachMeasure[]): ReachMeasure {
  const avg = (f: (r: ReachMeasure) => number) => xs.reduce((a, r) => a + f(r), 0) / Math.max(1, xs.length);
  return {
    cx: avg((r) => r.cx),
    shoulderW: avg((r) => r.shoulderW),
    arm: avg((r) => r.arm),
    headTopY: avg((r) => r.headTopY),
    kneeY: avg((r) => r.kneeY),
    height: avg((r) => r.height),
  };
}

/** 카메라 좌표 사각형(y는 아래로 증가) */
export interface CamRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * 손이 닿는 범위(FR-BAL-03): 좌우 = 어깨 중심 ± (어깨너비/2 + 팔 길이 + 옆걸음 여유),
 * 위 = 머리 위로 팔 길이만큼, 아래 = 무릎 높이
 */
export function reachRect(r: ReachMeasure, sideStepRatio: number): CamRect {
  const half = r.shoulderW / 2 + r.arm + sideStepRatio * r.arm;
  return { left: r.cx - half, right: r.cx + half, top: r.headTopY - r.arm, bottom: r.kneeY };
}

/** 두 사람 몸 사이 간격이 팔 길이의 minGapArms배보다 좁은지(FR-BAL-06) */
export function tooClose(a: ReachMeasure, b: ReachMeasure, minGapArms: number): boolean {
  const gap = Math.abs(a.cx - b.cx) - a.shoulderW / 2 - b.shoulderW / 2;
  return gap < minGapArms * ((a.arm + b.arm) / 2);
}

/**
 * 플레이 영역(FR-BAL-04): 모든 범위를 합친 사각형이 화면을 채우도록 변환을 정한다.
 * 모양이 찌그러지지 않게 가로·세로 같은 배율을 쓰고, 가로는 가운데 맞춤, 세로는 바닥에 붙이고 위는 가상 하늘.
 */
export function playAreaTransform(rects: CamRect[], screenAspect: number, skyRatio = 0): { transform: NormTransform; area: Rect; cam: CamRect } {
  const u: CamRect = {
    left: Math.min(...rects.map((r) => r.left)),
    right: Math.max(...rects.map((r) => r.right)),
    top: Math.min(...rects.map((r) => r.top)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
  const w = Math.max(1e-3, u.right - u.left);
  const h = Math.max(1e-3, u.bottom - u.top);
  const margin = 0.03;
  // 위쪽 skyRatio 만큼은 가상 하늘로 비워 두고, 손이 닿는 범위는 그 아래(바닥에 붙여) 채운다.
  const sky = Math.max(0, Math.min(0.7, skyRatio));
  const scale = Math.min((screenAspect * (1 - margin)) / w, (1 - sky - margin) / h);
  const tf = new NormTransform();
  tf.set(scale, { x: (u.left + u.right) / 2, y: (u.top + u.bottom) / 2 }, { x: 0, y: margin + (h * scale) / 2 });
  const a = tf.apply({ x: u.left, y: u.bottom });
  const b = tf.apply({ x: u.right, y: u.top });
  return { transform: tf, area: { x0: a.x, x1: b.x, y0: a.y, y1: b.y }, cam: u };
}
