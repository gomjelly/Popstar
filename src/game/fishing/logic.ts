// 낚시 게임 순수 로직(화면·인식과 분리해 node 단위 테스트로 검증한다).
//
// 동작:
//   던지기 = 한 손을 머리 위로 들었다가 앞(아래)으로 빠르게 휘두른다. 휘두른 속도가 빠를수록 멀리 날아간다.
//   기다리기 = 찌가 물에 뜨면 가만히 기다린다. 가끔 물고기가 톡톡 건드린다(속임수 입질).
//   당기기 = 찌가 쑥 들어갈 때 팔을 접어 손을 어깨 위로 올린다.
// 타이밍 게이지 = 입질 세기. 찌도 게이지만큼 물속으로 들어간다. 꼭대기에서 당길수록 큰 물고기, 너무 빠르면 쓰레기.

export interface FishParams {
  /** 한 판 시간(초) */
  roundSec: number;
  /** 찌가 날아가는 시간 */
  flySec: number;
  /** 찌가 뜬 뒤 진짜 입질까지 기다리는 시간(초, 이 범위에서 무작위) */
  waitSec: { min: number; max: number };
  /** 진짜 입질: 게이지가 차오르는 시간 · 꼭대기에 머무는 시간 · 빠지는 시간 */
  riseSec: number;
  peakSec: number;
  fallSec: number;
  /** 기다리는 동안 속임수 입질 횟수(초당)와 세기(게이지 0~1) */
  nibblePerSec: number;
  nibbleLevel: number;
  /** 등급 경계(당긴 순간 게이지 값) */
  tiers: { big: number; mid: number; small: number };
  /** 잡은 뒤 다음 던지기까지 */
  showSec: number;
  /** 동작 인식(몸통 길이 단위, 어깨 기준 손 높이) */
  gesture: { castHigh: number; castLow: number; castMs: number; pullHigh: number; pullRise: number; pullMs: number };
}

export const DEFAULT_FISH: FishParams = {
  roundSec: 90,
  flySec: 0.7,
  waitSec: { min: 1.5, max: 4.5 },
  riseSec: 1.1,
  peakSec: 0.45,
  fallSec: 0.9,
  nibblePerSec: 0.45,
  nibbleLevel: 0.25,
  tiers: { big: 0.85, mid: 0.6, small: 0.35 },
  showSec: 1.8,
  gesture: { castHigh: 0.45, castLow: 0.15, castMs: 800, pullHigh: 0.3, pullRise: 0.3, pullMs: 900 },
};

// ---------- 잡히는 것 ----------

export type Tier = 'big' | 'mid' | 'small' | 'trash';

export interface Catch {
  tier: Tier;
  icon: string;
  name: string;
  points: number;
  /** 당긴 순간 게이지 값 */
  timing: number;
  /** 던진 거리 0~1 */
  distance: number;
}

interface Kind {
  icon: string;
  name: string;
  points: number;
  weight: number;
}

export const CATCH_TABLE: Record<Tier, Kind[]> = {
  big: [
    { icon: '🐋', name: '고래', points: 500, weight: 1 },
    { icon: '🦈', name: '상어', points: 320, weight: 3 },
    { icon: '🐙', name: '문어', points: 260, weight: 3 },
  ],
  mid: [
    { icon: '🐡', name: '복어', points: 150, weight: 3 },
    { icon: '🦑', name: '오징어', points: 130, weight: 3 },
    { icon: '🐠', name: '열대어', points: 110, weight: 3 },
  ],
  small: [
    { icon: '🐟', name: '작은 물고기', points: 50, weight: 4 },
    { icon: '🦀', name: '꽃게', points: 60, weight: 2 },
    { icon: '🦐', name: '새우', points: 40, weight: 2 },
  ],
  trash: [
    { icon: '👢', name: '헌 장화', points: 0, weight: 3 },
    { icon: '🥫', name: '빈 깡통', points: 0, weight: 3 },
    { icon: '🧦', name: '젖은 양말', points: 0, weight: 2 },
    { icon: '🌿', name: '물풀', points: 5, weight: 2 },
  ],
};

export const TIER_KO: Record<Tier, string> = { big: '대어!', mid: '좋아요!', small: '작아요', trash: '쓰레기…' };

export function tierOf(timing: number, t: FishParams['tiers']): Tier {
  if (timing >= t.big) return 'big';
  if (timing >= t.mid) return 'mid';
  if (timing >= t.small) return 'small';
  return 'trash';
}

/** 멀리 던질수록 조금 더(최대 1.3배) */
export function pointsOf(base: number, distance: number): number {
  return Math.round(base * (1 + 0.3 * Math.max(0, Math.min(1, distance))));
}

export function pickCatch(tier: Tier, rnd: () => number): Kind {
  const list = CATCH_TABLE[tier];
  const total = list.reduce((a, k) => a + k.weight, 0);
  let r = rnd() * total;
  for (const k of list) {
    r -= k.weight;
    if (r < 0) return k;
  }
  return list[list.length - 1];
}

// ---------- 입질 게이지 ----------

/** 진짜 입질 시작 뒤 s초의 게이지 값(0~1). 차오름 → 꼭대기 → 빠짐. 끝나면 -1 */
export function biteGauge(s: number, p: Pick<FishParams, 'riseSec' | 'peakSec' | 'fallSec'>): number {
  if (s < 0) return 0;
  if (s < p.riseSec) {
    const x = s / p.riseSec;
    return x * x * (3 - 2 * x);
  }
  s -= p.riseSec;
  if (s < p.peakSec) return 1;
  s -= p.peakSec;
  if (s < p.fallSec) return 1 - s / p.fallSec;
  return -1;
}

// ---------- 동작 인식 ----------

export interface ArmSample {
  /** 어깨 기준 손 높이(몸통 길이 단위, 위가 +). 손이 안 보이면 null */
  left: number | null;
  right: number | null;
}

export type Arm = 'left' | 'right';

export type GestureEvent = { type: 'cast'; arm: Arm; power: number } | { type: 'pull'; arm: Arm };

/** 한 사람의 손 높이 기록으로 던지기·당기기를 찾는다 */
export class ArmGesture {
  private hist: { t: number; left: number | null; right: number | null }[] = [];
  private g: FishParams['gesture'];

  constructor(g: FishParams['gesture']) {
    this.g = g;
  }

  reset(): void {
    this.hist = [];
  }

  /** want = 지금 찾을 동작(던질 때 cast, 기다릴 때 pull, 그 밖에는 기록만) */
  push(t: number, s: ArmSample, want: GestureEvent['type'] | null): GestureEvent[] {
    const g = this.g;
    this.hist.push({ t, ...s });
    const keep = Math.max(g.castMs, g.pullMs) + 200;
    while (this.hist.length && t - this.hist[0].t > keep) this.hist.shift();
    const out: GestureEvent[] = [];
    for (const arm of ['right', 'left'] as Arm[]) {
      const now = s[arm];
      if (now === null || !want) continue;
      // 던지기: castMs 안에 castHigh 위에 있었고 지금 castLow 아래
      if (want === 'cast' && now <= g.castLow) {
        let peak: { t: number; h: number } | null = null;
        for (const q of this.hist) {
          const h = q[arm];
          if (h === null || t - q.t > g.castMs) continue;
          if (h >= g.castHigh && (!peak || h > peak.h)) peak = { t: q.t, h };
        }
        if (peak) {
          const sec = Math.max(0.05, (t - peak.t) / 1000);
          const speed = (peak.h - now) / sec; // 몸통 길이/초
          out.push({ type: 'cast', arm, power: Math.max(0, Math.min(1, (speed - 1) / 6)) });
          this.clear(arm);
          continue;
        }
      }
      // 당기기: pullMs 안에서 가장 낮던 때보다 pullRise 넘게 올라 pullHigh 위
      if (want === 'pull' && now >= g.pullHigh) {
        let low = Infinity;
        for (const q of this.hist) {
          const h = q[arm];
          if (h !== null && t - q.t <= g.pullMs) low = Math.min(low, h);
        }
        if (now - low >= g.pullRise) {
          out.push({ type: 'pull', arm });
          this.clear(arm);
        }
      }
    }
    return out;
  }

  /** 한 번 쓴 동작은 기록에서 지워 같은 동작으로 두 번 잡히지 않게 */
  private clear(arm: Arm): void {
    for (const q of this.hist) q[arm] = null;
  }
}

// ---------- 한 사람의 낚시 ----------

export type RodState = 'ready' | 'flying' | 'waiting' | 'bite' | 'show';

export type RodEvent =
  | { type: 'cast'; distance: number; arm: Arm }
  | { type: 'land' }
  | { type: 'nibble' }
  | { type: 'bite' }
  | { type: 'escape' }
  | { type: 'catch'; catch: Catch; early: boolean };

export class Rod {
  state: RodState = 'ready';
  /** 지금 상태가 된 뒤 지난 시간(초) */
  t = 0;
  /** 0~1 */
  gauge = 0;
  distance = 0;
  arm: Arm = 'right';
  last: Catch | null = null;
  catches: Catch[] = [];
  score = 0;
  private waitFor = 0;
  private nibbleAt = -1;
  private p: FishParams;
  private rnd: () => number;

  constructor(p: FishParams, rnd: () => number = Math.random) {
    this.p = p;
    this.rnd = rnd;
  }

  private set(s: RodState): void {
    this.state = s;
    this.t = 0;
  }

  /** 지금 찾아야 할 동작 */
  get want(): GestureEvent['type'] | null {
    return this.state === 'ready' ? 'cast' : this.state === 'waiting' || this.state === 'bite' ? 'pull' : null;
  }

  /** dt초 흐르기. gestures = 이번 프레임에 찾은 동작 */
  update(dt: number, gestures: GestureEvent[]): RodEvent[] {
    const p = this.p;
    const ev: RodEvent[] = [];
    this.t += dt;
    const cast = gestures.find((g): g is Extract<GestureEvent, { type: 'cast' }> => g.type === 'cast');
    const pull = gestures.some((g) => g.type === 'pull');

    switch (this.state) {
      case 'ready':
        this.gauge = 0;
        if (cast) {
          this.distance = 0.25 + 0.75 * cast.power;
          this.arm = cast.arm;
          this.set('flying');
          ev.push({ type: 'cast', distance: this.distance, arm: cast.arm });
        }
        break;
      case 'flying':
        if (this.t >= p.flySec) {
          this.beginWait();
          ev.push({ type: 'land' });
        }
        break;
      case 'waiting': {
        // 속임수 입질: 짧게 톡 건드린다
        if (this.nibbleAt < 0 && this.t < this.waitFor - 0.6 && this.rnd() < p.nibblePerSec * dt) {
          this.nibbleAt = this.t;
          ev.push({ type: 'nibble' });
        }
        const ns = this.nibbleAt >= 0 ? this.t - this.nibbleAt : -1;
        this.gauge = ns >= 0 && ns < 0.35 ? p.nibbleLevel * Math.sin((ns / 0.35) * Math.PI) : 0;
        if (ns >= 0.35) this.nibbleAt = -1;
        if (pull) {
          ev.push(this.land(this.gauge, true));
          break;
        }
        if (this.t >= this.waitFor) {
          this.set('bite');
          ev.push({ type: 'bite' });
        }
        break;
      }
      case 'bite': {
        const g = biteGauge(this.t, p);
        if (g < 0) {
          // 놓쳤다: 다시 기다린다(찌는 물에 그대로)
          this.beginWait();
          ev.push({ type: 'escape' });
          break;
        }
        this.gauge = g;
        if (pull) ev.push(this.land(g, false));
        break;
      }
      case 'show':
        this.gauge = 0;
        if (this.t >= p.showSec) this.set('ready');
        break;
    }
    return ev;
  }

  private beginWait(): void {
    const w = this.p.waitSec;
    this.waitFor = w.min + this.rnd() * (w.max - w.min);
    this.nibbleAt = -1;
    this.gauge = 0;
    this.set('waiting');
  }

  /** 당겼다: 게이지 값으로 무엇이 잡혔는지 정한다 */
  private land(timing: number, early: boolean): RodEvent {
    const tier = early ? 'trash' : tierOf(timing, this.p.tiers);
    const k = pickCatch(tier, this.rnd);
    const c: Catch = { tier, icon: k.icon, name: k.name, points: pointsOf(k.points, this.distance), timing, distance: this.distance };
    this.last = c;
    this.catches.push(c);
    this.score += c.points;
    this.gauge = 0;
    this.set('show');
    return { type: 'catch', catch: c, early };
  }

  /** 가장 큰 것(점수 기준) */
  best(): Catch | null {
    return this.catches.reduce<Catch | null>((a, c) => (!a || c.points > a.points ? c : a), null);
  }
}

/** 몸통 길이 단위의 손 높이(어깨 위가 +). 카메라 좌표는 y가 아래로 커진다 */
export function handHeight(shoulderY: number, wristY: number, torso: number): number {
  return (shoulderY - wristY) / Math.max(1e-3, torso);
}
