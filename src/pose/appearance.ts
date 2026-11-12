// 겉모습(옷 색) 특징. 두 사람이 엇갈려 지나가며 한 명이 잠깐 가려질 때,
// 위치만으로 번호를 이으면 남은 사람이 엉뚱한 번호를 넘겨받을 수 있다.
// 상의(어깨~골반 사이)와 하의(허벅지) 평균 색을 함께 비교해 같은 사람에게 같은 번호를 붙인다(FR-COM-04 보강).

import { LM, type Landmark } from './landmarks';

/** [상의 r,g,b, 하의 r,g,b] (0~1). 하의가 안 보이면 하의 값은 NaN */
export type Appearance = number[];

const W = 192;
const H = 108;

export class AppearanceSampler {
  // 화면(document)과 인식 작업 스레드(Worker, OffscreenCanvas) 양쪽에서 쓴다
  private cv: HTMLCanvasElement | OffscreenCanvas =
    typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: W, height: H }) : new OffscreenCanvas(W, H);
  private g = this.cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private data: Uint8ClampedArray | null = null;

  /** 이번 프레임 영상을 작게 줄여 읽어 둔다 */
  capture(video: CanvasImageSource): void {
    this.g.drawImage(video, 0, 0, W, H);
    this.data = this.g.getImageData(0, 0, W, H).data;
  }

  /** 영상 좌표(0~1) 관절로 옷 색을 잰다 */
  measure(lms: Landmark[]): Appearance | null {
    if (!this.data) return null;
    const pts = (a: Landmark, b: Landmark, c: Landmark, d: Landmark): [number, number][] => {
      const out: [number, number][] = [];
      for (const u of [0.25, 0.5, 0.75]) {
        for (const v of [0.2, 0.45, 0.7]) {
          const top = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
          const bot = { x: c.x + (d.x - c.x) * u, y: c.y + (d.y - c.y) * u };
          out.push([top.x + (bot.x - top.x) * v, top.y + (bot.y - top.y) * v]);
        }
      }
      return out;
    };
    const l = lms;
    const torso = this.mean(pts(l[LM.leftShoulder], l[LM.rightShoulder], l[LM.leftHip], l[LM.rightHip]));
    if (!torso) return null;
    const legsVisible = (l[LM.leftKnee].visibility ?? 1) > 0.5 && (l[LM.rightKnee].visibility ?? 1) > 0.5;
    const legs = legsVisible ? this.mean(pts(l[LM.leftHip], l[LM.rightHip], l[LM.leftKnee], l[LM.rightKnee])) : null;
    return [...torso, ...(legs ?? [NaN, NaN, NaN])];
  }

  private mean(points: [number, number][]): number[] | null {
    const d = this.data!;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const [x, y] of points) {
      const px = Math.round(x * W);
      const py = Math.round(y * H);
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const i = (py * W + px) * 4;
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    }
    if (n < 3) return null;
    return [r / n / 255, g / n / 255, b / n / 255];
  }
}

/** 두 겉모습의 차이(0 = 같음, 대략 0~1.7). 한쪽이라도 없으면 null */
export function appearanceDistance(a: Appearance | null, b: Appearance | null): number | null {
  if (!a || !b) return null;
  const part = (o: number) => {
    if ([a[o], b[o]].some(Number.isNaN)) return null;
    return Math.hypot(a[o] - b[o], a[o + 1] - b[o + 1], a[o + 2] - b[o + 2]);
  };
  const t = part(0);
  const l = part(3);
  if (t === null) return l;
  if (l === null) return t;
  return (t + l) / 2;
}

/** 지수 이동 평균으로 겉모습을 갱신한다 */
export function blendAppearance(prev: Appearance | null, next: Appearance, k: number): Appearance {
  if (!prev) return next.slice();
  return prev.map((p, i) => {
    const n = next[i];
    if (Number.isNaN(n)) return p;
    if (Number.isNaN(p)) return n;
    return p * (1 - k) + n * k;
  });
}
