// 카메라 좌표 → 게임 좌표 정규화 변환(FR-COM-10).
// 게임 좌표: 화면 높이 = 1, 가로는 -aspect/2 ~ +aspect/2, y는 바닥(0)에서 위로 증가.
// 보정 때 한 번 정하고 고정(frozen)하면, 플레이어가 실제로 움직인 만큼 화면에서도 움직인다.

import type { BodyMeasure } from './body';

export interface Vec2 {
  x: number;
  y: number;
}

export class NormTransform {
  /** 배율(게임 단위 / 카메라 단위) */
  scale = 1;
  /** 카메라 좌표의 기준점 → 게임 좌표의 기준점 */
  from: Vec2 = { x: 0, y: 0 };
  to: Vec2 = { x: 0, y: 0 };
  frozen = false;

  apply(p: { x: number; y: number }): Vec2 {
    return {
      x: this.to.x + (p.x - this.from.x) * this.scale,
      y: this.to.y - (p.y - this.from.y) * this.scale,
    };
  }

  /** 카메라 길이 → 게임 길이 */
  len(l: number): number {
    return l * this.scale;
  }

  /**
   * 보정: 키(heightCam)가 화면 높이의 screenHeight로 보이고, 발 위치(footCam)가 게임 좌표 (targetX, floorY)에 오도록.
   */
  calibrate(heightCam: number, footCam: Vec2, screenHeight: number, targetX: number, floorY: number): void {
    this.scale = screenHeight / Math.max(1e-3, heightCam);
    this.from = { ...footCam };
    this.to = { x: targetX, y: floorY };
    this.frozen = true;
  }

  /**
   * 메뉴 화면용 실시간 맞춤: 사람이 서 있는 가로 위치를 화면 비율대로 따라가되 크기는 일정하게.
   * 고정 전에만 쓴다. 갑자기 튀지 않게 조금씩 따라간다.
   */
  follow(m: BodyMeasure, videoAspect: number, screenAspect: number, screenHeight: number, floorY: number, k = 0.15): void {
    if (this.frozen) return;
    const scale = screenHeight / Math.max(1e-3, m.height);
    const tx = (m.foot.x / Math.max(1e-3, videoAspect) - 0.5) * screenAspect * 0.9;
    const first = this.scale === 1 && this.from.x === 0 && this.to.x === 0;
    const lerp = (a: number, b: number) => (first ? b : a + (b - a) * k);
    this.scale = lerp(this.scale, scale);
    this.from = { x: m.foot.x, y: m.foot.y };
    this.to = { x: lerp(this.to.x, tx), y: floorY };
  }

  reset(): void {
    this.scale = 1;
    this.from = { x: 0, y: 0 };
    this.to = { x: 0, y: 0 };
    this.frozen = false;
  }
}

/**
 * 보정 후 서는 자리(화면 가로 위치). 1인은 가운데.
 * 2인은 두 사람의 가운데를 화면 가운데에 두고, 실제 간격을 각자 배율대로 옮긴다.
 * 그래야 서로 자리를 바꾸면 화면에서도 정확히 자리가 바뀐다.
 */
export function calibTargetX(footX: number, allFootX: number[], scale: number): number {
  if (allFootX.length <= 1) return 0;
  const midX = allFootX.reduce((a, b) => a + b, 0) / allFootX.length;
  return (footX - midX) * scale;
}
