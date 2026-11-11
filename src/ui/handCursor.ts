// 손 커서(FR-COM-20).
// 2~3m 떨어진 아이가 팔만 뻗어 화면 끝까지 닿도록, 손을 든 쪽 어깨 옆의 "손 조작 영역"을 화면 전체에 대응시킨다.
// 손을 내리면 커서가 사라진다. 버튼 위에 hoverSelectMs(1.5초) 머무르면 선택되고, 그동안 원형 게이지가 찬다.

import { config } from '../config';
import { measure } from '../pose/body';
import { LM, type Pt } from '../pose/landmarks';

export interface CursorPoint {
  /** 화면 비율 좌표 0~1 */
  u: number;
  v: number;
}

export class HandCursor {
  private active: 'left' | 'right' | null = null;
  private pos: CursorPoint | null = null;

  reset(): void {
    this.active = null;
    this.pos = null;
  }

  /** 손을 들었으면 화면 위치(0~1), 아니면 null */
  update(pts: Pt[] | null): CursorPoint | null {
    if (!pts) {
      this.reset();
      return null;
    }
    const m = measure(pts, config.common.minVisibility);
    const T = m.torso;
    const raised = (wr: number, el: number) => {
      const w = pts[wr];
      // 손목이 골반보다 충분히 위에 있고 잘 보일 때만 "손을 든 것"으로 본다.
      return w.v >= 0.5 && pts[el].v >= 0.3 && w.y < m.hip.y - 0.35 * T;
    };
    const L = raised(LM.leftWrist, LM.leftElbow);
    const R = raised(LM.rightWrist, LM.rightElbow);
    if (!L && !R) {
      this.reset();
      return null;
    }
    let side: 'left' | 'right';
    if (L && R) {
      // 둘 다 들었으면 지금 쓰던 손을 유지하고, 다른 손이 확실히 더 높을 때만 바꾼다.
      const ly = pts[LM.leftWrist].y;
      const ry = pts[LM.rightWrist].y;
      if (this.active === 'left') side = ry < ly - 0.3 * T ? 'right' : 'left';
      else if (this.active === 'right') side = ly < ry - 0.3 * T ? 'left' : 'right';
      else side = ly < ry ? 'left' : 'right';
    } else side = L ? 'left' : 'right';
    if (side !== this.active) this.pos = null;
    this.active = side;

    const z = config.common.cursorZone;
    const sh = pts[side === 'left' ? LM.leftShoulder : LM.rightShoulder];
    const wr = pts[side === 'left' ? LM.leftWrist : LM.rightWrist];
    const idx = pts[side === 'left' ? LM.leftIndex : LM.rightIndex];
    const hand = idx.v >= 0.5 ? { x: (wr.x + idx.x) / 2, y: (wr.y + idx.y) / 2 } : wr;
    const outward = Math.sign(sh.x - m.shoulder.x) || (side === 'left' ? -1 : 1);
    const W = z.width * T;
    const H = z.height * T;
    const cx = sh.x + outward * z.outward * T;
    const cy = sh.y - z.up * T;
    const u = clamp01((hand.x - (cx - W / 2)) / W);
    const v = clamp01((hand.y - (cy - H / 2)) / H);
    // 떨림 줄이기
    const k = this.pos ? 0.45 : 0;
    this.pos = this.pos ? { u: this.pos.u * k + u * (1 - k), v: this.pos.v * k + v * (1 - k) } : { u, v };
    return this.pos;
  }

  get hand(): 'left' | 'right' | null {
    return this.active;
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// ---------- 머무르면 선택 ----------

/** 커서로 고를 수 있는 범위(지금 화면 등) */
export interface HoverScope {
  contains(node: Node): boolean;
}

interface Dwell {
  target: HTMLElement | null;
  since: number;
  /** 선택한 뒤에는 버튼에서 벗어날 때까지 다시 고르지 않는다 */
  done: boolean;
}

export interface HoverEvents {
  onEnter?: (el: HTMLElement) => void;
  onSelect?: (el: HTMLElement, slot: number) => void;
}

/** 커서 DOM(점 + 원형 게이지)과 머무름 판정을 함께 관리한다. */
export class HoverSelector {
  private dwell: Dwell[] = [];
  /** 화면이 바뀐 직후: 지금 커서 아래 버튼은 고르지 않는다(벗어났다 다시 와야 함) */
  private suppressed: boolean[] = [];
  private els: { root: HTMLDivElement; ring: SVGCircleElement }[] = [];
  /** 가장 최근에 그린 커서 위치(px) — 검증 로그용 */
  last: ({ x: number; y: number; target: string; progress: number } | null)[] = [];

  constructor(private layer: HTMLElement, count: number, private ev: HoverEvents) {
    for (let i = 0; i < count; i++) {
      const root = document.createElement('div');
      root.className = `hand-cursor p${i + 1}`;
      root.innerHTML =
        `<svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="42"/>` +
        `<circle class="ring" cx="50" cy="50" r="42" pathLength="100"/></svg><div class="dot">✋</div>`;
      root.hidden = true;
      layer.appendChild(root);
      this.els.push({ root, ring: root.querySelector('.ring') as SVGCircleElement });
      this.dwell.push({ target: null, since: 0, done: false });
      this.last.push(null);
      this.suppressed.push(false);
    }
  }

  setColor(i: number, color: string): void {
    this.els[i]?.root.style.setProperty('--c', color);
  }

  /** points[i] = i번 플레이어 커서(0~1) 또는 null */
  update(points: (CursorPoint | null)[], now: number, scope: HoverScope | null): void {
    const W = this.layer.clientWidth;
    const H = this.layer.clientHeight;
    points.forEach((p, i) => {
      const el = this.els[i];
      const d = this.dwell[i];
      if (!el) return;
      if (!p || !scope) {
        el.root.hidden = true;
        this.setTarget(i, null, now);
        this.last[i] = null;
        return;
      }
      const x = p.u * W;
      const y = p.v * H;
      el.root.hidden = false;
      el.root.style.transform = `translate(${x}px, ${y}px)`;
      const target = hoverTargetAt(x, y, scope);
      this.setTarget(i, target, now);
      let progress = 0;
      if (d.target && !d.done) {
        progress = Math.min(1, (now - d.since) / config.common.hoverSelectMs);
        if (progress >= 1) {
          d.done = true;
          const t = d.target;
          this.ev.onSelect?.(t, i);
          t.click();
        }
      }
      el.ring.style.strokeDashoffset = String(100 - progress * 100);
      el.root.classList.toggle('on-target', Boolean(d.target) && !d.done);
      this.last[i] = { x, y, target: d.target ? describe(d.target) : '-', progress };
    });
    // 커서가 올라간 버튼 표시
    const hovered = new Set(this.dwell.map((d) => d.target).filter(Boolean));
    document.querySelectorAll('.hov.hand-hover').forEach((e) => {
      if (!hovered.has(e as HTMLElement)) e.classList.remove('hand-hover');
    });
    hovered.forEach((e) => e!.classList.add('hand-hover'));
  }

  private setTarget(i: number, target: HTMLElement | null, now: number): void {
    const d = this.dwell[i];
    if (d.target === target) return;
    d.target = target;
    d.since = now;
    d.done = this.suppressed[i];
    this.suppressed[i] = false;
    if (target && !d.done) this.ev.onEnter?.(target);
  }

  /** 화면이 바뀔 때 부른다. 선택 직후 같은 자리의 새 버튼이 연달아 골라지지 않게 한다. */
  suppress(): void {
    this.suppressed = this.suppressed.map(() => true);
    // 다음 프레임의 대상이 무엇이든(빈 곳 포함) 바뀐 것으로 보이게 임시 요소를 넣어 둔다.
    const dummy = document.createElement('div');
    this.dwell.forEach((d) => (d.target = dummy));
  }

  hideAll(): void {
    this.update(this.els.map(() => null), 0, null);
  }
}

/** 화면 좌표 아래에 있는 고를 수 있는 요소(.hov) */
export function hoverTargetAt(x: number, y: number, scope: HoverScope): HTMLElement | null {
  for (const e of document.elementsFromPoint(x, y)) {
    const t = (e as HTMLElement).closest?.('.hov') as HTMLElement | null;
    if (t && scope.contains(t) && !(t as HTMLButtonElement).disabled && !t.closest('[hidden]')) return t;
  }
  return null;
}

export function describe(el: HTMLElement): string {
  return (el.dataset.name || el.id || el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 16) || '?').replace(/\s+/g, '_');
}
