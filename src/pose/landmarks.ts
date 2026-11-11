// MediaPipe Pose 33개 관절 번호와 좌표 도우미.

export interface Landmark {
  x: number; // 0~1, 영상 너비 기준
  y: number; // 0~1, 영상 높이 기준
  z: number;
  visibility?: number;
}

/** 카메라 좌표: 거울 반전을 적용하고, 가로·세로 모두 영상 높이 단위(y는 아래로 증가). */
export interface Pt {
  x: number;
  y: number;
  v: number; // visibility 0~1
}

export const LM = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

/** 얼굴 관절(코·눈·귀·입) */
export const FACE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * 영상 좌표 → 카메라 좌표. mirror가 켜져 있으면 좌우를 뒤집어
 * "내가 오른손을 들면 화면 오른쪽 손이 올라가게" 한다(FR-COM-03).
 */
export function toCameraSpace(lms: Landmark[], videoAspect: number, mirror: boolean): Pt[] {
  return lms.map((l) => ({
    x: (mirror ? 1 - l.x : l.x) * videoAspect,
    y: l.y,
    v: l.visibility ?? 1,
  }));
}

export function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) };
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
