// 풍선 터뜨리기 게임 규칙(SRS 5장). 화면·인식과 분리된 순수 로직이라 단위 테스트할 수 있다(NFR-08).
// 좌표는 게임 좌표(화면 높이 = 1, y는 위로 증가). 크기·속도는 플레이 영역 높이 기준 비율.
// 이 파일은 값 import 없이 혼자 돈다(node --test 로 바로 실행).

export type BalloonKind = 'normal' | 'bomb' | 'gold' | 'heart' | 'clock' | 'star' | 'bubble';
export type BalloonMode = '1p' | 'coop' | 'versus';

export interface BalloonParams {
  stageSec: number;
  lives: number;
  maxLives: number;
  missesPerLife: number;
  sideStepRatio: number;
  start: { spawnIntervalMs: number; fallSpeed: number; bombRatio: number; balloonSize: number };
  perStage: { spawnInterval: number; fallSpeed: number; bombRatioAdd: number; balloonSize: number };
  limits: { minSpawnIntervalMs: number; maxFallSpeed: number; maxBombRatio: number; minBalloonSize: number };
  specialRatio: { gold: number; heart: number; clock: number; star: number; bubble: number };
  points: { normal: number; gold: number; bubble: number; giant: number; clearPerLife: number };
  combo: { at: number; multiplier: number }[];
  /** 손 판정 반지름(플레이 영역 높이 대비) */
  handRadius: number;
  /** 두 사람 몸 사이가 팔 길이의 이 배수보다 가까우면 "조금 떨어져 서세요"(FR-BAL-06) */
  minGapArms: number;
  /** 이 스테이지부터 바람이 분다(FR-BAL-24) */
  windFromStage: number;
  /** 바람 세기(초당 플레이 영역 높이 대비) */
  windSpeed: number;
  /** 시계 풍선 효과 */
  slowSec: number;
  slowFactor: number;
  /** 플레이 영역 위에 덧붙이는 가상 하늘(화면 높이 대비). 떨어지는 풍선·폭탄을 미리 보고 피할 시간 */
  skyRatio: number;
}

export const DEFAULT_BALLOON: BalloonParams = {
  stageSec: 30,
  lives: 3,
  maxLives: 5,
  missesPerLife: 5,
  sideStepRatio: 0.5,
  start: { spawnIntervalMs: 450, fallSpeed: 0.25, bombRatio: 0.05, balloonSize: 0.14 },
  perStage: { spawnInterval: 0.88, fallSpeed: 1.08, bombRatioAdd: 0.02, balloonSize: 0.95 },
  limits: { minSpawnIntervalMs: 180, maxFallSpeed: 0.7, maxBombRatio: 0.2, minBalloonSize: 0.09 },
  specialRatio: { gold: 0.05, heart: 0.015, clock: 0.02, star: 0.02, bubble: 0.08 },
  points: { normal: 10, gold: 50, bubble: 5, giant: 40, clearPerLife: 100 },
  combo: [
    { at: 5, multiplier: 1.5 },
    { at: 10, multiplier: 2.0 },
  ],
  handRadius: 0.09,
  minGapArms: 1.0,
  windFromStage: 4,
  windSpeed: 0.12,
  slowSec: 3,
  slowFactor: 0.4,
  skyRatio: 0.5,
};

/** 게임 좌표의 사각형(y0 = 아래, y1 = 위) */
export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Balloon {
  id: number;
  kind: BalloonKind;
  x: number;
  y: number;
  /** 반지름 */
  r: number;
  /** 아래로 떨어지는 속도(게임 단위/초) */
  vy: number;
  baseX: number;
  swayPhase: number;
  swayAmp: number;
  /** 일반 풍선 색 번호(그리기용) */
  hue: number;
  /** 몇 초째 떠 있는지 */
  age: number;
}

export interface Hand {
  player: number;
  x: number;
  y: number;
}

export type GameEvent =
  | { type: 'spawn'; balloon: Balloon }
  | { type: 'pop'; balloon: Balloon; player: number; points: number; combo: number; multiplier: number }
  | { type: 'bomb'; balloon: Balloon; player: number }
  | { type: 'miss'; balloon: Balloon; misses: number; player: number }
  | { type: 'life'; delta: number; lives: number; reason: 'bomb' | 'miss' | 'heart'; player: number }
  /** 대결: 목숨이 다 떨어진 사람(탈락). 다른 사람은 계속한다 */
  | { type: 'out'; player: number }
  | { type: 'slow'; until: number }
  | { type: 'starBlast'; player: number; popped: Balloon[]; points: number }
  | { type: 'stageClear'; stage: number; bonus: number; bonuses: number[]; stageScore: number }
  | { type: 'gameOver'; stage: number; score: number };

export interface StageDifficulty {
  spawnIntervalMs: number;
  fallSpeed: number;
  bombRatio: number;
  balloonSize: number;
  /** 바람(+ 오른쪽, 초당 영역 높이 대비). 0이면 없음 */
  wind: number;
}

/** 스테이지마다 생성 간격 ×0.88, 낙하 속도 ×1.08, 폭탄 +3%p, 크기 ×0.95 (상·하한 적용, FR-BAL-23) */
export function difficulty(p: BalloonParams, stage: number): StageDifficulty {
  const k = Math.max(0, stage - 1);
  const windOn = stage >= p.windFromStage;
  return {
    spawnIntervalMs: Math.max(p.limits.minSpawnIntervalMs, p.start.spawnIntervalMs * Math.pow(p.perStage.spawnInterval, k)),
    fallSpeed: Math.min(p.limits.maxFallSpeed, p.start.fallSpeed * Math.pow(p.perStage.fallSpeed, k)),
    bombRatio: Math.min(p.limits.maxBombRatio, p.start.bombRatio + p.perStage.bombRatioAdd * k),
    balloonSize: Math.max(p.limits.minBalloonSize, p.start.balloonSize * Math.pow(p.perStage.balloonSize, k)),
    // 스테이지마다 방향을 바꾼다
    wind: windOn ? (stage % 2 === 0 ? 1 : -1) * p.windSpeed : 0,
  };
}

/** 콤보 배율(5콤보 ×1.5, 10콤보 ×2, FR-BAL-13) */
export function comboMultiplier(p: BalloonParams, combo: number): number {
  let m = 1;
  for (const c of p.combo) if (combo >= c.at) m = Math.max(m, c.multiplier);
  return m;
}

const LANES = 6;

export class BalloonGame {
  phase: 'playing' | 'stageClear' | 'over' = 'playing';
  stage = 1;
  /** 이번 스테이지 경과 시간(초) */
  stageTime = 0;
  /** 게임 전체 경과 시간(초, 멈춘 시간 제외) */
  time = 0;
  /** 목숨: 1인·협동은 [0] 하나를 함께 쓰고, 대결은 사람마다 따로(FR-BAL-20 대결 예외) */
  livesOf: number[];
  /** 목숨을 깎는 놓친 풍선 수(missesPerLife 마다 0으로). 대결은 사람마다 */
  missesOf: number[];
  /** 대결: 목숨이 다 떨어져 탈락했는지 */
  out: boolean[];
  totalMisses = 0;
  /** 대결: 놓친 풍선을 누구 몫으로 셀지 정하려고 기억하는 사람별 손 위치(x) */
  private lastX = [-0.3, 0.3];
  /** 1인·협동은 [0]만, 대결은 플레이어별 */
  scores: number[];
  stageScores: number[] = [];
  /** 1인·협동은 [0]만, 대결은 플레이어별 */
  combos: number[];
  maxCombo = 0;
  slowUntil = 0;
  balloons: Balloon[] = [];
  popped = 0;
  goldPopped = 0;
  private spawnTimer = 0;
  private nextId = 1;
  private laneBag: number[] = [];
  private stageStartScore = 0;
  readonly p: BalloonParams;
  /** 플레이 영역(게임 좌표) */
  readonly area: Rect;
  readonly mode: BalloonMode;
  private rng: () => number;
  /** 풍선이 생기는 높이(하늘 꼭대기). 낙하 속도는 이 높이~영역 바닥 거리 기준 */
  readonly spawnY: number;

  // (node 타입 제거 실행을 위해 생성자 매개변수 속성 문법은 쓰지 않는다)
  constructor(p: BalloonParams, area: Rect, mode: BalloonMode, rng: () => number = Math.random, spawnY = area.y1) {
    this.p = p;
    this.area = area;
    this.spawnY = Math.max(spawnY, area.y1);
    this.mode = mode;
    this.rng = rng;
    const n = mode === 'versus' ? 2 : 1;
    this.livesOf = new Array<number>(n).fill(p.lives);
    this.missesOf = new Array<number>(n).fill(0);
    this.out = new Array<boolean>(n).fill(false);
    this.scores = new Array<number>(n).fill(0);
    this.combos = new Array<number>(n).fill(0);
  }

  /** 1인·협동: 함께 쓰는 목숨. 대결: 가장 많이 남은 사람의 목숨 */
  get lives(): number {
    return this.mode === 'versus' ? Math.max(...this.livesOf) : this.livesOf[0];
  }
  set lives(v: number) {
    this.livesOf[0] = v;
  }
  get misses(): number {
    return this.missesOf[0];
  }
  set misses(v: number) {
    this.missesOf[0] = v;
  }

  /** 대결: 놓친 풍선은 그 풍선에 가장 가까이 있던(탈락하지 않은) 사람 몫 */
  private ownerOf(x: number): number {
    if (this.mode !== 'versus') return 0;
    const alive = [0, 1].filter((i) => !this.out[i]);
    if (!alive.length) return 0;
    return alive.sort((a, b) => Math.abs(this.lastX[a] - x) - Math.abs(this.lastX[b] - x))[0];
  }

  get areaH(): number {
    return this.area.y1 - this.area.y0;
  }

  get diff(): StageDifficulty {
    return difficulty(this.p, this.stage);
  }

  get totalScore(): number {
    return this.scores.reduce((a, b) => a + b, 0);
  }

  get timeLeft(): number {
    return Math.max(0, this.p.stageSec - this.stageTime);
  }

  get slowed(): boolean {
    return this.time < this.slowUntil;
  }

  /** 점수를 받을 사람 번호(대결만 플레이어별) */
  private who(player: number): number {
    return this.mode === 'versus' ? Math.max(0, Math.min(1, player)) : 0;
  }

  handRadius(): number {
    return this.p.handRadius * this.areaH;
  }

  update(dt: number, hands: Hand[]): GameEvent[] {
    const ev: GameEvent[] = [];
    if (this.phase !== 'playing') return ev;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.stageTime += dt;
    const d = this.diff;
    const slow = this.slowed ? this.p.slowFactor : 1;

    // 생성
    this.spawnTimer -= dt * 1000 * slow;
    while (this.spawnTimer <= 0) {
      this.spawnTimer += d.spawnIntervalMs;
      const b = this.spawn(d);
      ev.push({ type: 'spawn', balloon: b });
    }

    // 이동
    const H = this.areaH;
    for (const b of this.balloons) {
      b.age += dt * slow;
      b.y -= b.vy * dt * slow;
      b.baseX += d.wind * H * dt * slow;
      b.x = b.baseX + Math.sin(b.age * 2.2 + b.swayPhase) * b.swayAmp;
      // 바람이 불면 영역 안쪽으로 되돌린다
      const lim = { lo: this.area.x0 + b.r, hi: this.area.x1 - b.r };
      if (b.baseX < lim.lo) b.baseX = lim.lo;
      if (b.baseX > lim.hi) b.baseX = lim.hi;
    }

    // 손 판정(대결에서 탈락한 사람의 손은 빼고)
    const hr = this.handRadius();
    if (this.mode === 'versus') {
      for (const p of [0, 1]) {
        const mine = hands.filter((h) => h.player === p);
        if (mine.length) this.lastX[p] = mine.reduce((a, h) => a + h.x, 0) / mine.length;
      }
      hands = hands.filter((h) => !this.out[this.who(h.player)]);
    }
    for (const h of hands) {
      for (const b of [...this.balloons]) {
        if (!this.balloons.includes(b)) continue;
        const reach = b.r + hr * (b.kind === 'bubble' ? 1.5 : 1);
        if ((h.x - b.x) ** 2 + (h.y - b.y) ** 2 > reach * reach) continue;
        this.hit(b, h.player, ev);
        if (this.phase !== 'playing') return ev;
      }
    }

    // 바닥에 닿은 풍선
    for (const b of [...this.balloons]) {
      if (b.y + b.r >= this.area.y0) continue;
      this.remove(b);
      if (b.kind === 'normal' || b.kind === 'gold') {
        const w = this.ownerOf(b.x);
        this.missesOf[w]++;
        this.totalMisses++;
        if (this.mode === 'versus') this.combos[w] = 0;
        else this.combos.fill(0);
        ev.push({ type: 'miss', balloon: b, misses: this.missesOf[w], player: w });
        if (this.missesOf[w] >= this.p.missesPerLife) {
          this.missesOf[w] = 0;
          this.loseLife(w, 'miss', ev);
          if (this.phase !== 'playing') return ev;
        }
      }
    }

    // 스테이지 끝
    if (this.stageTime >= this.p.stageSec) {
      // 남은 목숨 × 100 보너스(대결은 각자 자기 목숨만큼)
      const bonuses = this.livesOf.map((l, i) => (this.out[i] ? 0 : l * this.p.points.clearPerLife));
      bonuses.forEach((b, i) => (this.scores[i] += b));
      const stageScore = this.totalScore - this.stageStartScore;
      this.stageScores.push(stageScore);
      this.balloons = [];
      this.phase = 'stageClear';
      ev.push({ type: 'stageClear', stage: this.stage, bonus: Math.max(...bonuses), bonuses, stageScore });
    }
    return ev;
  }

  /** 스테이지 클리어 화면 뒤에 부른다 */
  nextStage(): void {
    if (this.phase !== 'stageClear') return;
    this.stage++;
    this.stageTime = 0;
    this.spawnTimer = 600;
    this.stageStartScore = this.totalScore;
    this.phase = 'playing';
  }

  private hit(b: Balloon, player: number, ev: GameEvent[]): void {
    this.remove(b);
    const w = this.who(player);
    if (b.kind === 'bomb') {
      this.combos[w] = 0;
      ev.push({ type: 'bomb', balloon: b, player });
      this.loseLife(w, 'bomb', ev);
      return;
    }
    this.popped++;
    this.combos[w]++;
    this.maxCombo = Math.max(this.maxCombo, this.combos[w]);
    const mult = comboMultiplier(this.p, this.combos[w]);
    const base = b.kind === 'gold' ? this.p.points.gold : b.kind === 'bubble' ? this.p.points.bubble : b.kind === 'normal' ? this.p.points.normal : 0;
    const points = Math.round(base * mult);
    this.scores[w] += points;
    if (b.kind === 'gold') this.goldPopped++;
    ev.push({ type: 'pop', balloon: b, player, points, combo: this.combos[w], multiplier: mult });
    if (b.kind === 'heart' && this.livesOf[w] < this.p.maxLives) {
      this.livesOf[w]++;
      ev.push({ type: 'life', delta: 1, lives: this.livesOf[w], reason: 'heart', player: w });
    } else if (b.kind === 'clock') {
      this.slowUntil = this.time + this.p.slowSec;
      ev.push({ type: 'slow', until: this.slowUntil });
    } else if (b.kind === 'star') {
      // 화면의 일반 풍선을 모두 터뜨린다(폭탄 제외)
      const blast = this.balloons.filter((x) => x.kind === 'normal');
      let pts = 0;
      for (const x of blast) {
        this.remove(x);
        this.popped++;
        pts += Math.round(this.p.points.normal * mult);
      }
      this.scores[w] += pts;
      ev.push({ type: 'starBlast', player, popped: blast, points: pts });
    }
  }

  private loseLife(w: number, reason: 'bomb' | 'miss', ev: GameEvent[]): void {
    this.livesOf[w] = Math.max(0, this.livesOf[w] - 1);
    ev.push({ type: 'life', delta: -1, lives: this.livesOf[w], reason, player: w });
    if (this.livesOf[w] > 0) return;
    if (this.mode === 'versus') {
      this.out[w] = true;
      ev.push({ type: 'out', player: w });
    }
    // 1인·협동은 바로, 대결은 둘 다 탈락하면 끝
    if (this.out.every(Boolean) || this.mode !== 'versus') {
      this.stageScores.push(this.totalScore - this.stageStartScore);
      this.phase = 'over';
      this.balloons = [];
      ev.push({ type: 'gameOver', stage: this.stage, score: this.totalScore });
    }
  }

  private remove(b: Balloon): void {
    const i = this.balloons.indexOf(b);
    if (i >= 0) this.balloons.splice(i, 1);
  }

  /** 가로 위치는 영역을 칸으로 나눠 섞은 순서대로 뽑아 고르게 퍼뜨린다(FR-BAL-10) */
  private nextLane(): number {
    if (!this.laneBag.length) {
      this.laneBag = Array.from({ length: LANES }, (_, i) => i);
      for (let i = LANES - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.laneBag[i], this.laneBag[j]] = [this.laneBag[j], this.laneBag[i]];
      }
    }
    return this.laneBag.pop()!;
  }

  private pickKind(d: StageDifficulty): BalloonKind {
    const s = this.p.specialRatio;
    let x = this.rng();
    if ((x -= d.bombRatio) < 0) return 'bomb';
    if ((x -= s.gold) < 0) return 'gold';
    if ((x -= s.heart) < 0) return this.lives < this.p.maxLives ? 'heart' : 'normal';
    if ((x -= s.clock) < 0) return 'clock';
    if ((x -= s.star) < 0) return 'star';
    if ((x -= s.bubble) < 0) return 'bubble';
    return 'normal';
  }

  private spawn(d: StageDifficulty): Balloon {
    const H = this.areaH;
    const kind = this.pickKind(d);
    const sizeK = kind === 'bubble' ? 0.75 : 1;
    const speedK = kind === 'gold' ? 1.6 : kind === 'bubble' ? 0.5 : 1;
    const r = (d.balloonSize * H * sizeK) / 2;
    const W = this.area.x1 - this.area.x0;
    const lane = this.nextLane();
    const laneW = W / LANES;
    const x = Math.max(this.area.x0 + r, Math.min(this.area.x1 - r, this.area.x0 + laneW * (lane + 0.15 + this.rng() * 0.7)));
    const b: Balloon = {
      id: this.nextId++,
      kind,
      x,
      baseX: x,
      y: this.spawnY + r,
      r,
      // fallSpeed = 초당 '하늘 꼭대기~영역 바닥' 거리 비율(0.25 = 4초에 화면 통과)
      vy: d.fallSpeed * (this.spawnY - this.area.y0) * speedK * (0.9 + this.rng() * 0.2),
      swayPhase: this.rng() * Math.PI * 2,
      swayAmp: r * (kind === 'bubble' ? 0.9 : 0.35),
      hue: Math.floor(this.rng() * 6),
      age: 0,
    };
    this.balloons.push(b);
    return b;
  }
}
