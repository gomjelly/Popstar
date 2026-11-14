// 낚시 게임: 공통 보정(CalibScreen) → 3초 카운트다운 → 제한 시간 동안 던지고 낚기 → 결과.
// 1인 / 2인 대결(각자 낚싯대·게이지·점수). 그리기는 화면 위 2D 캔버스(호수·찌·줄·게이지·물고기),
// 아바타는 공통 3D 장면이 그린다.

import { $, App, type Screen } from '../app';
import { config, gameInfo } from '../config';
import { savePlay } from '../data/db';
import { measure } from '../pose/body';
import { LM, type Pt } from '../pose/landmarks';
import type { Vec2 } from '../pose/transform';
import { ArmGesture, Rod, TIER_KO, handHeight, type Catch, type GestureEvent, type RodEvent } from '../game/fishing/logic';
import { AutoPause } from './autoPause';
import { registerHall } from './hallResult';
import { pauseKeys } from './screens';

type Phase = 'countdown' | 'play' | 'result';

const COUNTDOWN_SEC = 3;
/** 수면(게임 좌표 y). 이보다 위는 하늘·건너편 숲 */
const HORIZON = 0.62;
const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

interface Angler {
  rod: Rod;
  gesture: ArmGesture;
  /** 찌가 떨어질 자리(게임 좌표) — 던질 때 정한다 */
  target: Vec2;
  /** 던진 순간의 초릿대 끝(날아가는 찌의 출발점) */
  from: Vec2;
  /** 화면에 그린 초릿대 끝 */
  tip: Vec2 | null;
  /** 잡은 것이 날아오르는 연출 */
  fly: { c: Catch; from: Vec2; t: number } | null;
  /** 물결 */
  ripples: { x: number; y: number; t: number; big: boolean }[];
  /** 검증용 봇: 당길 게이지 값, 기다린 시간 */
  botAim: number;
  botWait: number;
  /** 다른 손으로 당겼을 때 안내를 보여 줄 때까지(clock 초) */
  warnUntil: number;
}

export class FishingScreen implements Screen {
  readonly name = 'fishing' as const;
  readonly el = $('scr-fishing');
  readonly avatarMode = 'game' as const;
  readonly backTo = null;
  private phase: Phase = 'countdown';
  private anglers: Angler[] = [];
  private autoPause: AutoPause;
  private clock = 0;
  private phaseAt = 0;
  private lastNow = 0;
  private lastCount = -1;
  private startedAt = '';
  private cv = $<HTMLCanvasElement>('fishCanvas');
  private g = this.cv.getContext('2d')!;
  private hudCache = ['', '', ''];

  /** 검증용(--bot-hands): 몸 동작 대신 봇이 던지고 당긴다 */
  testBot = false;

  constructor(private app: App) {
    this.autoPause = new AutoPause(app);
    $('fPause').addEventListener('click', () => this.app.setPaused(true, '스페이스나 ▶ 버튼으로 계속해요'));
    $('frAgain').addEventListener('click', () => this.start());
    $('frHome').addEventListener('click', () => void this.app.go('main', undefined, { back: true }));
  }

  get cursorsOff(): boolean {
    return this.phase !== 'result';
  }

  enter(): void {
    this.start();
  }

  leave(): void {
    $('bg').classList.remove('fish-bg');
    $('fResult').hidden = true;
    $('fBanner').hidden = true;
    this.g.clearRect(0, 0, this.cv.width, this.cv.height);
  }

  private start(): void {
    const s = this.app.session;
    const n = s?.participants.length ?? 1;
    const p = config.fishing;
    this.anglers = Array.from({ length: n }, () => ({
      rod: new Rod(p),
      gesture: new ArmGesture(p.gesture),
      target: { x: 0, y: 0.4 },
      from: { x: 0, y: 0.5 },
      tip: null,
      fly: null,
      ripples: [],
      botAim: 0.95,
      botWait: 0,
      warnUntil: 0,
    }));
    this.clock = 0;
    this.startedAt = new Date().toISOString();
    this.hudCache = ['', '', ''];
    $('bg').classList.add('fish-bg');
    $('fResult').hidden = true;
    $('fPause').hidden = false;
    this.autoPause.reset();
    this.app.tracker.mode = 'game';
    this.app.sound.music('menu', 0.85);
    this.setPhase('countdown');
    this.app.log(`fishing start players=${n} round=${p.roundSec}s`);
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseAt = this.clock;
    this.lastCount = -1;
  }

  debug(): string {
    const left = this.phase === 'play' ? Math.max(0, config.fishing.roundSec - (this.clock - this.phaseAt)) : 0;
    return (
      `phase=${this.phase} left=${left.toFixed(0)}s ` +
      this.anglers
        .map((a, i) => `F${i + 1}[${a.rod.state} g=${a.rod.gauge.toFixed(2)} score=${a.rod.score} n=${a.rod.catches.length} last=${a.rod.last ? a.rod.last.tier + ':' + a.rod.last.timing.toFixed(2) : '-'}]`)
        .join(' ')
    );
  }

  update(now: number): void {
    const dtWall = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;
    this.resize();
    if (this.phase === 'result') {
      this.draw(now, dtWall);
      return;
    }
    this.autoPause.update(now, this.anglers.length);
    const dt = this.app.paused ? 0 : dtWall;
    this.clock += dt;
    const t = this.clock - this.phaseAt;

    if (this.phase === 'countdown') {
      const left = COUNTDOWN_SEC - Math.floor(t);
      if (left !== this.lastCount) {
        this.lastCount = left;
        if (left > 0) {
          this.banner(`${left}<small>손을 머리 위로 들었다가 앞으로 휘둘러 던져요!</small>`, 'count');
          this.app.sound.play('beep');
        } else {
          this.banner('시작!', 'count', 700);
          this.app.sound.play('go');
          this.setPhase('play');
        }
      }
    } else {
      const left = config.fishing.roundSec - t;
      if (left <= 0) {
        this.showResult();
        return;
      }
      if (left <= 5 && Math.ceil(left) !== this.lastCount) {
        this.lastCount = Math.ceil(left);
        this.app.sound.play('beep');
      }
      if (dt > 0) this.anglers.forEach((a, i) => this.step(a, i, now, dt));
    }
    this.hud();
    this.draw(now, dt);
  }

  /** 한 사람: 손 높이 → 동작 → 낚싯대 상태 */
  private step(a: Angler, i: number, now: number, dt: number): void {
    let gestures: GestureEvent[] = [];
    const slot = this.app.tracker.slots[i];
    if (slot?.present && slot.pts) {
      const p = slot.pts;
      const m = measure(p, config.common.minVisibility);
      // 빠르게 휘두르면 손목이 흐려져 visibility가 낮게 나온다: 낮아도 위치는 쓸 만해서 문턱을 낮게 둔다
      const h = (sh: number, wr: number) => (p[wr].v >= 0.1 ? handHeight(p[sh].y, p[wr].y, m.torso) : null);
      const sample = { left: h(LM.leftShoulder, LM.leftWrist), right: h(LM.rightShoulder, LM.rightWrist) };
      gestures = a.gesture.push(now, sample, a.rod.want);
    }
    if (this.testBot) gestures = this.bot(a, dt);
    const before = a.rod.state;
    for (const ev of a.rod.update(dt, gestures)) this.onEvent(a, i, ev);
    if (before !== a.rod.state && a.rod.state === 'ready') a.gesture.reset();
  }

  /** 봇: 던지고, 진짜 입질의 꼭대기(가끔 일찍·늦게)에 당긴다 */
  private bot(a: Angler, dt: number): GestureEvent[] {
    const r = a.rod;
    a.botWait += dt;
    if (r.state === 'ready' && a.botWait > 0.8) {
      a.botWait = 0;
      return [{ type: 'cast', arm: Math.random() < 0.5 ? 'left' : 'right', power: 0.4 + Math.random() * 0.6 }];
    }
    if (r.state === 'bite' && r.t < 0.05) a.botAim = [1, 1, 0.9, 0.7, 0.45][Math.floor(Math.random() * 5)];
    if (r.state === 'bite' && r.gauge >= a.botAim - 1e-6 && (a.botAim < 1 || r.t > config.fishing.riseSec + 0.1)) {
      a.botWait = 0;
      return [{ type: 'pull', arm: r.arm }];
    }
    if (r.state === 'waiting' && r.gauge > 0.2 && Math.random() < 0.02) return [{ type: 'pull', arm: r.arm }];
    if (r.state !== 'ready') a.botWait = 0;
    return [];
  }

  private onEvent(a: Angler, i: number, ev: RodEvent): void {
    const snd = this.app.sound;
    switch (ev.type) {
      case 'cast': {
        a.from = a.tip ?? this.bodyCenter(i) ?? { x: 0, y: 0.5 };
        a.target = this.landing(i, ev.distance, ev.arm);
        snd.play('cast');
        this.app.log(`F${i + 1} cast d=${ev.distance.toFixed(2)} arm=${ev.arm}`);
        break;
      }
      case 'land':
        snd.play('splash');
        a.ripples.push({ ...a.target, t: 0, big: false });
        break;
      case 'nibble':
        snd.play('nibble');
        a.ripples.push({ ...a.target, t: 0, big: false });
        break;
      case 'bite':
        snd.play('bite');
        break;
      case 'wrongArm':
        a.warnUntil = this.clock + 1.5;
        snd.play('error');
        this.app.log(`F${i + 1} wrong arm`);
        break;
      case 'escape':
        snd.play('miss');
        this.app.log(`F${i + 1} escaped`);
        break;
      case 'catch': {
        const c = ev.catch;
        a.fly = { c, from: { ...a.target }, t: 0 };
        a.ripples.push({ ...a.target, t: 0, big: true });
        snd.play('splash');
        snd.play(c.tier === 'big' ? 'cheer' : c.tier === 'mid' ? 'gold' : c.tier === 'small' ? 'heart' : 'miss');
        this.app.log(`F${i + 1} catch ${c.tier} ${c.name} +${c.points} timing=${c.timing.toFixed(2)}${ev.early ? ' early' : ''}`);
        break;
      }
    }
  }

  /** 찌가 떨어질 자리: 던진 팔 쪽으로, 멀리 던질수록 수평선 가까이. 2인은 자기 쪽 절반 안 */
  private landing(i: number, d: number, arm: 'left' | 'right'): Vec2 {
    const A = this.app.avatars.aspect;
    const center = this.bodyCenter(i) ?? { x: 0, y: 0.4 };
    const slot = this.app.tracker.slots[i];
    const tf = this.app.session?.transforms[i];
    let side = i === 0 && this.anglers.length > 1 ? -1 : 1;
    if (slot?.pts && tf) {
      const sh = tf.apply(slot.pts[arm === 'left' ? LM.leftShoulder : LM.rightShoulder]);
      side = Math.sign(sh.x - center.x) || side;
    }
    let x = center.x + side * (0.26 + 0.14 * d);
    let lo = -A / 2 + 0.1;
    let hi = A / 2 - 0.1;
    if (this.anglers.length > 1) {
      if (i === 0) hi = -0.08;
      else lo = 0.08;
    }
    // 자기 쪽 안에 못 들어가면 반대쪽으로
    if (x < lo || x > hi) x = center.x - side * (0.26 + 0.14 * d);
    x = Math.max(lo, Math.min(hi, x));
    return { x, y: 0.3 + 0.24 * d };
  }

  /** 몸 가운데(골반)의 게임 좌표 */
  private bodyCenter(i: number): Vec2 | null {
    const slot = this.app.tracker.slots[i];
    const tf = this.app.session?.transforms[i];
    if (!slot?.pts || !tf) return null;
    const p = slot.pts;
    return tf.apply({ x: (p[LM.leftHip].x + p[LM.rightHip].x) / 2, y: (p[LM.leftHip].y + p[LM.rightHip].y) / 2 });
  }

  /** 낚싯대: 던진(또는 들고 있는) 손에서 위·바깥으로 뻗은 막대. 끝 좌표를 돌려준다 */
  private rodTip(i: number, a: Angler): { hand: Vec2; tip: Vec2 } | null {
    const slot = this.app.tracker.slots[i];
    const tf = this.app.session?.transforms[i];
    if (!slot?.pts || !tf) return null;
    const p: Pt[] = slot.pts;
    const arm = a.rod.arm;
    const wr = p[arm === 'left' ? LM.leftWrist : LM.rightWrist];
    const el = p[arm === 'left' ? LM.leftElbow : LM.rightElbow];
    const sh = p[arm === 'left' ? LM.leftShoulder : LM.rightShoulder];
    const hand = tf.apply(wr.v >= 0.3 ? wr : sh);
    const e = tf.apply(el.v >= 0.3 ? el : sh);
    const center = this.bodyCenter(i) ?? hand;
    // 팔뚝 방향 + 위쪽 + 찌 쪽으로 기울인다
    const toward = a.rod.state === 'ready' ? Math.sign(hand.x - center.x) || 1 : Math.sign(a.target.x - hand.x) || 1;
    let dx = (hand.x - e.x) * 0.6 + toward * 0.35;
    let dy = (hand.y - e.y) * 0.6 + 0.8;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    const len = 0.3;
    return { hand, tip: { x: hand.x + dx * len, y: hand.y + dy * len } };
  }

  // ---------- 그리기 ----------

  private resize(): void {
    const w = Math.round(this.cv.clientWidth * Math.min(2, devicePixelRatio));
    const h = Math.round(this.cv.clientHeight * Math.min(2, devicePixelRatio));
    if (w && h && (this.cv.width !== w || this.cv.height !== h)) {
      this.cv.width = w;
      this.cv.height = h;
    }
  }

  /** 게임 좌표 → 캔버스 픽셀 */
  private px(p: Vec2): { x: number; y: number } {
    const A = this.app.avatars.aspect;
    return { x: (p.x / A + 0.5) * this.cv.width, y: (1 - p.y) * this.cv.height };
  }

  private draw(now: number, dt: number): void {
    const g = this.g;
    const H = this.cv.height;
    g.clearRect(0, 0, this.cv.width, H);
    if (this.phase === 'result') return;
    this.anglers.forEach((a, i) => {
      const r = a.rod;
      const rt = this.rodTip(i, a);
      a.tip = rt?.tip ?? a.tip;
      // 물결
      a.ripples = a.ripples.filter((q) => (q.t += dt) < (q.big ? 1.4 : 1));
      for (const q of a.ripples) {
        const c = this.px(q);
        const k = q.t / (q.big ? 1.4 : 1);
        const scale = 1 - q.y * 0.6;
        g.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
        g.lineWidth = H * 0.004;
        g.beginPath();
        g.ellipse(c.x, c.y, H * (q.big ? 0.12 : 0.07) * k * scale + 2, H * (q.big ? 0.03 : 0.018) * k * scale + 1, 0, 0, Math.PI * 2);
        g.stroke();
      }
      // 찌 위치
      let bob: Vec2 | null = null;
      let under = 0;
      if (r.state === 'flying') {
        const u = Math.min(1, r.t / config.fishing.flySec);
        bob = { x: a.from.x + (a.target.x - a.from.x) * u, y: a.from.y + (a.target.y - a.from.y) * u + 0.22 * Math.sin(u * Math.PI) };
      } else if (r.state === 'waiting' || r.state === 'bite') {
        bob = { ...a.target };
        under = r.gauge;
      } else if (a.tip) bob = { x: a.tip.x, y: a.tip.y - 0.12 };
      // 낚싯대
      if (rt) {
        const h = this.px(rt.hand);
        const t = this.px(rt.tip);
        g.strokeStyle = '#5b3a1e';
        g.lineCap = 'round';
        g.lineWidth = H * 0.012;
        g.beginPath();
        g.moveTo(h.x, h.y);
        g.lineTo(t.x, t.y);
        g.stroke();
        g.strokeStyle = '#d9b27a';
        g.lineWidth = H * 0.005;
        g.stroke();
      }
      // 낚싯줄
      if (a.tip && bob) {
        const t = this.px(a.tip);
        const b = this.px(bob);
        const tight = r.state === 'bite' ? r.gauge : 0;
        const sag = (r.state === 'waiting' || r.state === 'bite' ? 0.12 : 0.02) * (1 - tight) * H;
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = Math.max(1, H * 0.0022);
        g.beginPath();
        g.moveTo(t.x, t.y);
        g.quadraticCurveTo((t.x + b.x) / 2, Math.max(t.y, b.y) + sag, b.x, b.y);
        g.stroke();
      }
      if (bob) this.drawBobber(bob, under, r.state === 'waiting' || r.state === 'bite', now);
      // 게이지
      if (r.state === 'waiting' || r.state === 'bite') this.drawGauge(i, a, now);
      // 잡은 것이 날아오른다
      if (a.fly) {
        a.fly.t += dt;
        // 머리 옆(찌 쪽)으로 날아와 대롱대롱. 위쪽 HUD와 겹치지 않게 높이를 제한한다
        const head = this.headTop(i) ?? { x: a.fly.from.x, y: 0.7 };
        const side = Math.sign(a.fly.from.x - head.x) || 1;
        const dest = { x: head.x + side * 0.2, y: Math.min(head.y - 0.04, 0.68) };
        const u = Math.min(1, a.fly.t / 0.8);
        const pos = { x: a.fly.from.x + (dest.x - a.fly.from.x) * u, y: a.fly.from.y + (dest.y - a.fly.from.y) * u + 0.15 * Math.sin(u * Math.PI) };
        const c = this.px(pos);
        const big = a.fly.c.tier === 'big' ? 0.2 : a.fly.c.tier === 'mid' ? 0.15 : 0.11;
        g.save();
        g.translate(c.x, c.y);
        g.rotate(Math.sin(a.fly.t * 14) * 0.25 * (1 - u * 0.5));
        g.font = `${Math.round(H * big)}px ${EMOJI}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(a.fly.c.icon, 0, 0);
        g.restore();
        if (u >= 1) this.drawLabel(c, a.fly.c, this.app.session?.participants[i]?.color ?? '#fff');
        if (r.state !== 'show') a.fly = null;
      }
      // 당길 때 알림
      if (r.state === 'bite' && r.gauge >= config.fishing.tiers.big && bob) {
        const c = this.px(bob);
        g.font = `bold ${Math.round(H * 0.06)}px sans-serif`;
        g.textAlign = 'center';
        g.fillStyle = '#ffd23f';
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = H * 0.008;
        const y = c.y - H * 0.08 - Math.abs(Math.sin(now / 90)) * H * 0.01;
        g.strokeText('지금 당겨요!', c.x, y);
        g.fillText('지금 당겨요!', c.x, y);
      }
    });
  }

  private headTop(i: number): Vec2 | null {
    const slot = this.app.tracker.slots[i];
    const tf = this.app.session?.transforms[i];
    if (!slot?.pts || !tf) return null;
    const m = measure(slot.pts, config.common.minVisibility);
    return tf.apply({ x: m.headCenter.x, y: m.headTopY });
  }

  /** 찌: 빨강·하양 공. under(0~1)만큼 물에 잠긴다 */
  private drawBobber(p: Vec2, under: number, inWater: boolean, now: number): void {
    const g = this.g;
    const H = this.cv.height;
    const scale = inWater ? 1 - p.y * 0.7 : 1;
    const r = H * 0.022 * scale;
    const c = this.px(p);
    const wob = inWater ? Math.sin(now / 260) * r * 0.12 : 0;
    const sink = Math.min(1, under) * r * 2.2;
    const cx = c.x;
    const cy = c.y + sink + wob;
    g.save();
    if (inWater) {
      // 수면 아래는 그리지 않는다(수면선 = 찌 자리)
      g.beginPath();
      g.rect(cx - r * 3, 0, r * 6, c.y + r * 0.15);
      g.clip();
    }
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ff3b4e';
    g.beginPath();
    g.arc(cx, cy, r, Math.PI, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ff3b4e';
    g.fillRect(cx - r * 0.12, cy - r * 1.9, r * 0.24, r * 0.95);
    g.restore();
    if (inWater) {
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = Math.max(1, H * 0.003);
      g.beginPath();
      g.ellipse(c.x, c.y + r * 0.15, r * (1.6 + under), r * 0.4, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }

  /** 타이밍 게이지: 아래부터 쓰레기 · 작은 · 좋은 · 대어 칸. 지금 입질 세기를 물고기 표시로 */
  private drawGauge(i: number, a: Angler, now: number): void {
    const g = this.g;
    const H = this.cv.height;
    const W = this.cv.width;
    const tiers = config.fishing.tiers;
    const two = this.anglers.length > 1;
    let x: number;
    if (two) x = i === 0 ? W * 0.045 : W * 0.955;
    else {
      const c = this.bodyCenter(i);
      const side = Math.sign(a.target.x - (c?.x ?? 0)) || 1;
      x = this.px({ x: (c?.x ?? 0) - side * 0.33, y: 0 }).x;
    }
    const top = H * 0.22;
    const bottom = H * 0.72;
    const w = H * 0.05;
    const yOf = (v: number) => bottom - (bottom - top) * v;
    const zones: [number, number, string][] = [
      [0, tiers.small, 'rgba(140,140,140,0.85)'],
      [tiers.small, tiers.mid, 'rgba(110,200,255,0.9)'],
      [tiers.mid, tiers.big, 'rgba(60,210,110,0.92)'],
      [tiers.big, 1, 'rgba(255,205,40,0.95)'],
    ];
    g.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(g, x - w / 2 - H * 0.008, top - H * 0.01, w + H * 0.016, bottom - top + H * 0.02, H * 0.015);
    g.fill();
    for (const [lo, hi, col] of zones) {
      g.fillStyle = col;
      g.fillRect(x - w / 2, yOf(hi), w, yOf(lo) - yOf(hi));
    }
    // 칸 그림
    g.font = `${Math.round(H * 0.03)}px ${EMOJI}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const icons: [number, number, string][] = [
      [0, tiers.small, '👢'],
      [tiers.small, tiers.mid, '🐟'],
      [tiers.mid, tiers.big, '🐡'],
      [tiers.big, 1, '🦈'],
    ];
    g.globalAlpha = 0.75;
    for (const [lo, hi, ic] of icons) g.fillText(ic, x, (yOf(lo) + yOf(hi)) / 2);
    g.globalAlpha = 1;
    // 지금 값
    const v = a.rod.gauge;
    const y = yOf(v);
    const hot = a.rod.state === 'bite' && v >= tiers.big;
    g.fillStyle = hot ? '#fff' : '#ffffff';
    g.strokeStyle = hot ? '#ff3b4e' : '#1a2a44';
    g.lineWidth = H * 0.006;
    g.beginPath();
    g.moveTo(x - w / 2 - H * 0.03, y - H * 0.018);
    g.lineTo(x - w / 2 - H * 0.002, y);
    g.lineTo(x - w / 2 - H * 0.03, y + H * 0.018);
    g.closePath();
    g.stroke();
    g.fill();
    g.fillRect(x - w / 2, y - H * 0.004, w, H * 0.008);
    if (hot) {
      g.strokeStyle = `rgba(255,255,255,${0.5 + 0.5 * Math.sin(now / 70)})`;
      g.lineWidth = H * 0.006;
      roundRect(g, x - w / 2 - H * 0.008, top - H * 0.01, w + H * 0.016, bottom - top + H * 0.02, H * 0.015);
      g.stroke();
    }
  }

  private drawLabel(c: { x: number; y: number }, k: Catch, color: string): void {
    const g = this.g;
    const H = this.cv.height;
    const text = `${k.name} ${k.points ? `+${k.points}` : ''}`;
    g.font = `bold ${Math.round(H * 0.045)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const y = c.y - H * 0.11;
    g.lineWidth = H * 0.008;
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.strokeText(text, c.x, y);
    g.fillStyle = k.tier === 'big' ? '#ffd23f' : k.tier === 'trash' ? '#cfd6df' : color === '#fff' ? '#fff' : '#ffffff';
    g.fillText(text, c.x, y);
    g.font = `bold ${Math.round(H * 0.032)}px sans-serif`;
    g.strokeText(TIER_KO[k.tier], c.x, y - H * 0.05);
    g.fillText(TIER_KO[k.tier], c.x, y - H * 0.05);
  }

  // ---------- HUD·결과 ----------

  private hint(a: Angler): string {
    const r = a.rod;
    const hand = r.arm === 'left' ? '왼손' : '오른손';
    if (this.clock < a.warnUntil && (r.state === 'waiting' || r.state === 'bite')) return `✋ 던진 ${hand}으로 당겨요!`;
    switch (r.state) {
      case 'ready':
        return '🙌 손을 머리 위로 → 앞으로 휘둘러 던져요';
      case 'flying':
        return '휙~';
      case 'waiting':
        return r.gauge > 0 ? '톡톡… 아직이에요!' : `가만히 기다려요… (${hand}으로 당겨요)`;
      case 'bite':
        return r.gauge >= config.fishing.tiers.big ? `💪 지금! ${hand}을 접어 당겨요!` : '찌가 들어가요… 꼭대기에서 당겨요';
      case 'show':
        return r.last ? `${r.last.icon} ${r.last.name}${r.last.points ? ` +${r.last.points}` : ''}` : '';
    }
  }

  private hud(): void {
    const s = this.app.session;
    const parts = s?.participants ?? [];
    const html = this.anglers.map((a, i) => {
      const p = parts[i];
      const name = p ? `${parts.length > 1 ? `<b style="color:${p.color}">P${i + 1}</b> ` : ''}${escapeHtml(p.name)}` : '';
      return `<div class="fh-name">${name} <span class="fh-score">${a.rod.score}점</span></div><div class="fh-hint">${this.hint(a)}</div>`;
    });
    const set = (k: number, el: HTMLElement, v: string) => {
      if (this.hudCache[k] !== v) {
        this.hudCache[k] = v;
        el.innerHTML = v;
      }
    };
    set(0, $('fhP1'), html[0] ?? '');
    // 1인은 오른쪽 칸을 비운다
    set(1, $('fhP2'), html[1] ?? '');
    $('fhP2').hidden = this.anglers.length < 2;
    const left = this.phase === 'play' ? Math.max(0, config.fishing.roundSec - (this.clock - this.phaseAt)) : config.fishing.roundSec;
    const tEl = $('fhTime');
    set(2, tEl, `⏱ ${Math.ceil(left)}`);
    tEl.classList.toggle('hurry', this.phase === 'play' && left <= 10);
  }

  private showResult(): void {
    this.phase = 'result';
    $('fPause').hidden = true;
    $('fBanner').hidden = true;
    const s = this.app.session;
    const parts = s?.participants ?? [];
    const versus = s ? gameInfo(s.game).versus : false;
    const fishCount = (r: Rod) => r.catches.filter((c) => c.tier !== 'trash').length;
    const scores = this.anglers.map((a) => a.rod.score);
    if (this.anglers.length > 1) {
      const [a, b] = scores;
      $('frTitle').textContent = a === b ? '비겼어요!' : `${parts[a > b ? 0 : 1]?.name ?? ''} 승리!`;
      $('frScore').innerHTML = `<span style="color:${parts[0]?.color}">${a}</span> <span class="vs">:</span> <span style="color:${parts[1]?.color}">${b}</span>`;
    } else {
      $('frTitle').textContent = '낚시 끝!';
      $('frScore').textContent = `${scores[0]}점`;
    }
    $('frInfo').textContent = this.anglers
      .map((a, i) => {
        const best = a.rod.best();
        const who = this.anglers.length > 1 ? `${parts[i]?.name ?? `P${i + 1}`}: ` : '';
        return `${who}물고기 ${fishCount(a.rod)}마리 · 쓰레기 ${a.rod.catches.length - fishCount(a.rod)}개${best && best.points ? ` · 최고 ${best.icon} ${best.name}` : ''}`;
      })
      .join('  /  ');
    $('frList').innerHTML = this.anglers
      .map((a, i) => {
        const who = this.anglers.length > 1 ? `<b style="color:${parts[i]?.color}">P${i + 1}</b> ` : '';
        const icons = a.rod.catches.map((c) => `<span class="f-${c.tier}" title="${c.name}">${c.icon}</span>`).join('') || '<span>-</span>';
        return `<div>${who}${icons}</div>`;
      })
      .join('');
    $('fResult').hidden = false;
    this.app.sound.play('stageClear');
    this.app.sound.music(null);
    this.app.hover.suppress();
    $('frAgain').focus({ preventScroll: true });
    this.app.log(`fishing result scores=${scores.join(':')} catches=${this.anglers.map((a) => a.rod.catches.map((c) => c.tier[0]).join('')).join('|')}`);
    if (s) {
      const playId = crypto.randomUUID();
      const total = scores.reduce((x, y) => x + y, 0);
      const fish = this.anglers.reduce((x, a) => x + fishCount(a.rod), 0);
      void registerHall(this.app, { game: s.game, participants: s.participants, scores: versus ? scores : [total], stage: fish, stages: this.anglers.map((a) => fishCount(a.rod)), playId }, $('frHall'));
      void savePlay({
        id: playId,
        game: s.game,
        startedAt: this.startedAt,
        endedAt: new Date().toISOString(),
        score: total,
        scores,
        playerIds: s.participants.map((p) => p.player?.id ?? null),
        playerNames: s.participants.map((p) => p.name),
        stage: fish,
        stageScores: scores,
        maxCombo: 0,
      }).catch((err) => console.warn('기록 저장 실패', err));
    }
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.phase === 'result') {
      if (e.key === 'Escape') {
        $('frHome').click();
        return true;
      }
      return false;
    }
    return pauseKeys(this.app, e, () => $('fPause').click());
  }

  private banner(html: string, cls = '', ms = 0): void {
    const b = $('fBanner');
    b.className = `banner ${cls}`;
    b.innerHTML = html;
    b.hidden = false;
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(Number(b.dataset.timer));
    if (ms) b.dataset.timer = String(setTimeout(() => (b.hidden = true), ms));
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export { HORIZON };
