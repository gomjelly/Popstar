// 카메라 관절 → 체형 프로필(FR-WALL-03), 카메라 관절 → 게임 좌표 관절(판정용).

import { measure } from '../../pose/body';
import { LM, dist, mid, type Pt } from '../../pose/landmarks';
import type { NormTransform } from '../../pose/transform';
import type { BodyProfile, Joints, Vec } from './geometry';

/** 한 프레임의 체형(키 대비 비율) + 카메라 단위 키 */
export function measureProfile(p: Pt[], minVis: number): { profile: BodyProfile; heightCam: number } {
  const m = measure(p, minVis);
  const h = Math.max(1e-3, m.height);
  const r = (v: number) => v / h;
  const avg2 = (a: number, b: number) => (a + b) / 2;
  const sh = mid(p[LM.leftShoulder], p[LM.rightShoulder]);
  const hip = mid(p[LM.leftHip], p[LM.rightHip]);
  const ankle = mid(p[LM.leftAnkle], p[LM.rightAnkle]);
  return {
    heightCam: m.height,
    profile: {
      shoulderW: r(m.shoulderWidth),
      hipW: r(dist(p[LM.leftHip], p[LM.rightHip])),
      upperArm: r(avg2(dist(p[LM.leftShoulder], p[LM.leftElbow]), dist(p[LM.rightShoulder], p[LM.rightElbow]))),
      forearm: r(avg2(dist(p[LM.leftElbow], p[LM.leftWrist]), dist(p[LM.rightElbow], p[LM.rightWrist]))),
      hand: r(avg2(dist(p[LM.leftWrist], p[LM.leftIndex]), dist(p[LM.rightWrist], p[LM.rightIndex]))),
      thigh: r(avg2(dist(p[LM.leftHip], p[LM.leftKnee]), dist(p[LM.rightHip], p[LM.rightKnee]))),
      shin: r(avg2(dist(p[LM.leftKnee], p[LM.leftAnkle]), dist(p[LM.rightKnee], p[LM.rightAnkle]))),
      torso: r(dist(sh, hip)),
      neck: r(dist(sh, m.headCenter)),
      headR: r(m.headRadius),
      legLen: r(Math.abs(ankle.y - hip.y)),
    },
  };
}

export function averageProfile(xs: BodyProfile[]): BodyProfile {
  const keys = Object.keys(xs[0]) as (keyof BodyProfile)[];
  const out = {} as BodyProfile;
  for (const k of keys) out[k] = xs.reduce((a, x) => a + x[k], 0) / xs.length;
  return out;
}

/** 실제 플레이어 관절을 게임 좌표로(판정·스냅샷용). H = 화면에서의 키 */
export function liveJoints(p: Pt[], tf: NormTransform, H: number, minVis: number): Joints {
  const m = measure(p, minVis);
  const g = (i: number): Vec => tf.apply(p[i]);
  const opt = (i: number): Vec | null => (p[i].v >= 0.3 ? g(i) : null);
  return {
    H,
    head: tf.apply(m.headCenter),
    headR: tf.len(m.headRadius),
    shL: g(LM.leftShoulder),
    shR: g(LM.rightShoulder),
    elL: opt(LM.leftElbow),
    elR: opt(LM.rightElbow),
    wrL: opt(LM.leftWrist),
    wrR: opt(LM.rightWrist),
    handL: opt(LM.leftIndex),
    handR: opt(LM.rightIndex),
    hipL: g(LM.leftHip),
    hipR: g(LM.rightHip),
    knL: opt(LM.leftKnee),
    knR: opt(LM.rightKnee),
    anL: opt(LM.leftAnkle),
    anR: opt(LM.rightAnkle),
  };
}
