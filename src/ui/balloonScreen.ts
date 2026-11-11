// 풍선 터뜨리기 화면(SRS 5장): 플레이 영역 보정 → 3초 카운트다운 → 30초 스테이지 반복 → 결과.

import { $, App, type AvatarMode, type RouteName, type Screen } from '../app';
import { config } from '../config';
import { savePlay } from '../data/db';
import { BalloonGame, type BalloonMode, type GameEvent, type Hand } from '../game/balloon/logic';
import { armsOutProblem, averageReach, measureReach, playAreaTransform, reachRect, tooClose, type ArmsProblem, type ReachMeasure } from '../game/balloon/playArea';
import { BalloonView, balloonColor } from '../game/balloon/view';
import { measure } from '../pose/body';
import { LM, dist } from '../pose/landmarks';
import { AutoPause } from './autoPause';
import { pauseKeys } from './screens';

type Phase = 'calib' | 'countdown' | 'playing' | 'clear' | 'result';

const PROBLEM: Record<ArmsProblem, string> = {
  none: '',
  head: '한 걸음 뒤로 가요 (머리가 잘려요)',
  knees: '한 걸음 뒤로 가요 (무릎이 안 보여요)',
  side: '화면 가운데로 와요 (손이 잘려요)',
  arms: '양팔을 옆으로 쭉 펴세요',
};
const SKIES = ['sky-morning', 'sky-sunset', 'sky-night'];
const COUNTDOWN_SEC = 3;
const CLEAR_SEC = 2.8;
/** 보정 중 이 시간보다 짧은 인식 깜빡임은 봐준다 */
const GRACE_MS = 400;

export class BalloonScreen implements Screen {
  readonly name = 'balloon' as const;
  readonly el = $('scr-balloon');
  private phase: Phase = 'calib';
  private game: BalloonGame | null = null;
  private view: BalloonView;
  private autoPause: AutoPause;
  /** 멈춘 시간을 뺀 화면 시계(초) */
  private clock = 0;
  private lastNow = 0;
  private phaseAt = 0;
  private lastCount = -1;
  // 보정
  private holdStart = 0;
  private badSince = 0;
  private samples: ReachMeasure[][] = [];
  private startAnchor: ({ x: number; y: number } | null)[] = [];
  // 검증용 봇 손
  private bot: Hand[] = [];
  private startedAt = '';
  private comboTimer = 0;

  constructor(private app: App) {
    this.view = new BalloonView(app.avatars.scene);
    this.autoPause = new AutoPause(app);
    $('bPause').addEventListener('click', () => this.app.setPaused(true, '스페이스나 ▶ 버튼으로 계속해요'));
    $('brAgain').addEventListener('click', () => this.restart());
    $('brHome').addEventListener('click', () => void this.app.go('main', undefined, { back: true }));
  }

  get avatarMode(): AvatarMode {
    return this.phase === 'calib' ? 'calib' : 'game';
  }
  get forcePreview(): boolean {
    return this.phase === 'calib';
  }
  get backTo(): RouteName | null {
    return this.phase === 'calib' ? 'select' : null;
  }
  get cursorsOff(): boolean {
    return this.phase === 'countdown' || this.phase === 'playing' || this.phase === 'clear';
  }

  private get need(): number {
    return this.app.session?.participants.length ?? 1;
  }

  private get mode(): BalloonMode {
    const g = this.app.session?.game;
    return g === 'balloon-versus' ? 'versus' : g === 'balloon-coop' ? 'coop' : '1p';
  }

  enter(): void {
    this.restart();
  }

  leave(): void {
    this.view.clear();
    this.game = null;
    this.setSky(null);
    $('bBanner').hidden = true;
    $('bResult').hidden = true;
    $('fx').innerHTML = '';
    $('tags').classList.remove('faint');
  }

  private restart(): void {
    this.leave();
    this.phase = 'calib';
    this.holdStart = 0;
    this.badSince = 0;
    this.app.tracker.mode = 'menu';
    this.autoPause.reset();
    const two = this.need > 1;
    $('bCalib').hidden = false;
    $('bHud').hidden = true;
    $('bPause').hidden = true;
    $('bhCombo').hidden = true;
    $('bhSlow').hidden = true;
    $('bCalibTitle').textContent = two ? '둘이 떨어져서 양팔 쭉!' : '양팔을 옆으로 쭉 펴세요';
    $('bCalibBar').style.width = '0%';
    $('bSilhouette').innerHTML = tPoseSvg(this.need);
    this.app.sound.music('menu');
  }

  debug(): string {
    const g = this.game;
    if (!g) return `phase=${this.phase}`;
    return (
      `phase=${this.phase} stage=${g.stage} left=${g.timeLeft.toFixed(0)}s lives=${g.lives} miss=${g.misses}/${g.p.missesPerLife} ` +
      `score=${g.scores.join('/')} balloons=${g.balloons.length} popped=${g.popped} gold=${g.goldPopped} combo=${g.combos.join('/')} max=${g.maxCombo}` +
      ` area=[${g.area.x0.toFixed(2)},${g.area.x1.toFixed(2)}]x[${g.area.y0.toFixed(2)},${g.area.y1.toFixed(2)}]`
    );
  }

  update(now: number): void {
    const dtWall = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;
    if (this.phase === 'calib') {
      this.updateCalib(now);
      return;
    }
    if (this.phase === 'result') return;
    this.autoPause.update(now, this.need);
    const dt = this.app.paused ? 0 : dtWall;
    this.clock += dt;
    const game = this.game!;
    const t = this.clock - this.phaseAt;

    if (this.phase === 'countdown') {
      const left = COUNTDOWN_SEC - Math.floor(t);
      if (left !== this.lastCount) {
        this.lastCount = left;
        if (left > 0) {
          this.banner(String(left), 'count');
          this.app.sound.play('beep');
        } else {
          this.banner('시작!', 'count', 700);
          this.app.sound.play('go');
          this.setPhase('playing');
          this.app.sound.music('balloon', this.tempo());
        }
      }
    } else if (this.phase === 'clear' && t >= CLEAR_SEC) {
      game.nextStage();
      this.setSky(game.stage);
      this.app.sound.music('balloon', this.tempo());
      const wind = game.diff.wind;
      this.banner(`스테이지 ${game.stage}` + (wind ? `<small>바람이 불어요 ${wind > 0 ? '→' : '←'}</small>` : ''), '', 1500);
      this.setPhase('playing');
    }

    // 이름표가 떨어지는 풍선·폭탄을 가리지 않게 플레이 중에는 흐리게
    $('tags').classList.toggle('faint', this.phase === 'playing');
    const hands = this.hands(dt);
    if (this.phase === 'playing' && dt > 0) this.handle(game.update(dt, hands));
    this.view.sync(game.balloons);
    this.view.setHands(this.phase === 'playing' ? hands : [], game.handRadius(), this.colors());
    this.view.update(dt);
    this.hud();
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.phase === 'result') {
      if (e.key === 'Escape') {
        $('brHome').click();
        return true;
      }
      return false;
    }
    if (this.phase === 'calib') return false;
    return pauseKeys(this.app, e, () => $('bPause').click());
  }

  // ---------- 보정 ----------

  private updateCalib(now: number): void {
    const app = this.app;
    const c = config.common;
    const need = this.need;
    const present = app.tracker.slots.filter((s) => s.present && s.pts);
    let msg = '';
    if (present.length < need) msg = need === 1 ? '카메라 앞에 서요' : `두 명이 카메라 앞에 서요 (${present.length}/2)`;
    else if (present.length > need) msg = '한 명만 카메라 앞에 서요';
    else {
      for (const s of present) {
        const p = armsOutProblem(s.pts!, app.videoAspect, c.minVisibility);
        if (p !== 'none') {
          const who = need > 1 ? `${s.anchor!.x < app.videoAspect / 2 ? '왼쪽' : '오른쪽'} 친구: ` : '';
          msg = who + PROBLEM[p];
          break;
        }
      }
      if (!msg && need === 2) {
        const [a, b] = present.map((s) => measureReach(s.pts!, c.minVisibility));
        if (tooClose(a, b, config.balloon.minGapArms)) msg = '조금 떨어져 서세요';
      }
    }
    if (!msg && this.holdStart) {
      for (const s of present) {
        const a = this.startAnchor[s.index];
        if (a && dist(a, s.anchor!) > measure(s.pts!, c.minVisibility).torso * 0.3) msg = '가만히 서 있어요';
      }
    }
    if (msg) {
      if (!this.badSince) this.badSince = now;
      if (this.holdStart && now - this.badSince < GRACE_MS) return;
      $('bCalibGuide').textContent = msg;
      if (this.holdStart && now - this.holdStart > 500) app.sound.play('error');
      this.holdStart = 0;
      $('bCalibBar').style.width = '0%';
      return;
    }
    this.badSince = 0;
    if (!this.holdStart) {
      // 자세를 잡기 시작할 때 왼쪽 사람 = P1, 오른쪽 = P2 (FR-COM-04)
      app.tracker.assignLeftToRight();
      this.holdStart = now;
      this.samples = app.tracker.slots.map(() => []);
      this.startAnchor = app.tracker.slots.map((s) => (s.anchor ? { ...s.anchor } : null));
      app.sound.play('beep');
    }
    $('bCalibGuide').textContent = '그대로 2초만 버텨요!';
    app.tracker.slots.forEach((s, i) => {
      if (i < need && s.pts) this.samples[i].push(measureReach(s.pts, c.minVisibility));
    });
    const prog = Math.min(1, (now - this.holdStart) / c.calibHoldMs);
    $('bCalibBar').style.width = `${(prog * 100).toFixed(0)}%`;
    if (prog >= 1) this.finishCalib();
  }

  /** 손이 닿는 범위를 합쳐 플레이 영역과 변환을 정하고 고정한다(FR-BAL-03~05) */
  private finishCalib(): void {
    const app = this.app;
    const s = app.session!;
    const reach = s.participants.map((_, i) => averageReach(this.samples[i]));
    const rects = reach.map((r) => reachRect(r, config.balloon.sideStepRatio));
    const { transform, area } = playAreaTransform(rects, app.avatars.aspect, config.balloon.skyRatio);
    s.participants.forEach((_, i) => {
      s.transforms[i].copyFrom(transform);
      s.calibHeights[i] = reach[i].height;
    });
    app.tracker.mode = 'game';
    app.log(
      `balloon calib area=[${area.x0.toFixed(2)},${area.x1.toFixed(2)}]x[${area.y0.toFixed(2)},${area.y1.toFixed(2)}] scale=${transform.scale.toFixed(3)} ` +
        reach.map((r, i) => `P${i + 1}(arm=${r.arm.toFixed(3)} sw=${r.shoulderW.toFixed(3)})`).join(' '),
    );
    // 풍선은 화면 꼭대기(하늘 위)에서 생겨 하늘을 지나 손이 닿는 범위로 내려온다
    this.game = new BalloonGame(config.balloon, area, this.mode, Math.random, 1);
    this.bot = s.participants.map((_, i) => ({ player: i, x: s.participants.length > 1 ? (i === 0 ? -0.3 : 0.3) : 0, y: 0.5 }));
    this.startedAt = new Date().toISOString();
    this.clock = 0;
    this.lastCount = -1;
    $('bCalib').hidden = true;
    $('bHud').hidden = false;
    $('bPause').hidden = false;
    this.setSky(1);
    app.sound.play('cheer');
    this.setPhase('countdown');
  }

  // ---------- 게임 ----------

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseAt = this.clock;
    this.app.log(`balloon phase ${p}`);
  }

  private tempo(): number {
    return Math.min(1.35, 1 + 0.05 * ((this.game?.stage ?? 1) - 1));
  }

  private colors(): string[] {
    return this.app.session?.participants.map((p) => p.color) ?? [];
  }

  /** 손 위치(손목과 검지 사이) → 게임 좌표. 검증용 봇 손도 더한다. */
  private hands(dt: number): Hand[] {
    const s = this.app.session;
    if (!s) return [];
    const out: Hand[] = [];
    this.app.tracker.slots.forEach((slot, i) => {
      if (i >= s.participants.length || !slot.present || !slot.pts) return;
      const p = slot.pts;
      for (const [wr, idx] of [
        [LM.leftWrist, LM.leftIndex],
        [LM.rightWrist, LM.rightIndex],
      ] as const) {
        if (p[wr].v < 0.5) continue;
        const q = p[idx].v >= 0.5 ? { x: (p[wr].x + p[idx].x) / 2, y: (p[wr].y + p[idx].y) / 2 } : p[wr];
        const g = s.transforms[i].apply(q);
        out.push({ player: i, x: g.x, y: g.y });
      }
    });
    if (this.app.testBot && this.game) {
      const g = this.game;
      const split = s.participants.length > 1;
      this.bot = this.bot.map((h) => {
        const mine = g.balloons.filter((b) => b.kind !== 'bomb' && (!split || (h.player === 0 ? b.x < 0.05 : b.x > -0.05)) && b.y < g.area.y1);
        const target = mine.sort((a, b) => a.y - b.y)[0];
        if (!target) return h;
        const dx = target.x - h.x;
        const dy = target.y - h.y;
        const d = Math.hypot(dx, dy) || 1;
        const step = Math.min(d, 1.6 * dt);
        return { ...h, x: h.x + (dx / d) * step, y: h.y + (dy / d) * step };
      });
      out.push(...this.bot);
    }
    return out;
  }

  private handle(events: GameEvent[]): void {
    const g = this.game!;
    const snd = this.app.sound;
    const colors = this.colors();
    for (const e of events) {
      switch (e.type) {
        case 'pop': {
          const b = e.balloon;
          snd.play(b.kind === 'normal' ? 'pop' : b.kind === 'bomb' ? 'bomb' : b.kind);
          this.view.burst(b.x, b.y, b.r, balloonColor(b), b.kind === 'gold' ? 20 : 12);
          const label = b.kind === 'heart' ? '❤️ +1' : b.kind === 'clock' ? '⏰' : e.points ? `+${e.points}` : '';
          if (label) this.float(b.x, b.y, label, g.mode === 'versus' ? colors[e.player] : undefined);
          if (e.combo >= 3) this.combo(e.combo, e.multiplier);
          break;
        }
        case 'bomb':
          snd.play('bomb');
          this.view.burst(e.balloon.x, e.balloon.y, e.balloon.r * 1.6, '#ff8a2a', 22);
          this.float(e.balloon.x, e.balloon.y, '💥 목숨 -1', undefined, true);
          break;
        case 'miss':
          snd.play('miss');
          break;
        case 'life':
          if (e.delta < 0) snd.play('lifeLost');
          break;
        case 'starBlast':
          for (const b of e.popped) this.view.burst(b.x, b.y, b.r, balloonColor(b));
          if (e.points) this.float(0, (g.area.y0 + g.area.y1) / 2, `⭐ +${e.points}`, g.mode === 'versus' ? colors[e.player] : undefined);
          break;
        case 'stageClear':
          snd.play('stageClear');
          this.banner(`스테이지 ${e.stage} 클리어!<small>남은 목숨 보너스 +${e.bonus}</small>`, '', CLEAR_SEC * 1000);
          this.setPhase('clear');
          break;
        case 'gameOver':
          snd.play('gameOver');
          this.showResult();
          break;
        default:
          break;
      }
    }
  }

  private hud(): void {
    const g = this.game!;
    const p = g.p;
    $('bhLives').textContent = '❤️'.repeat(g.lives) + '🤍'.repeat(Math.max(0, p.lives - g.lives));
    $('bhMiss').textContent = `놓친 풍선 ${g.misses}/${p.missesPerLife}`;
    $('bhStage').textContent = `스테이지 ${g.stage}`;
    const left = Math.ceil(g.timeLeft);
    const time = $('bhTime');
    time.textContent = `0:${String(left).padStart(2, '0')}`;
    time.classList.toggle('hurry', left <= 5 && this.phase === 'playing');
    const score = $('bhScore');
    if (g.mode === 'versus') {
      const cs = this.colors();
      const key = g.scores.join('/');
      if (score.dataset.key !== key) {
        score.dataset.key = key;
        score.innerHTML = g.scores.map((s, i) => `<span class="vs" style="background:${cs[i]}">${s}</span>`).join('');
      }
    } else score.textContent = String(g.totalScore);
    $('bhSlow').hidden = !g.slowed;
  }

  private showResult(): void {
    const g = this.game!;
    const s = this.app.session!;
    this.setPhase('result');
    this.app.sound.music(null);
    $('bHud').hidden = true;
    $('bPause').hidden = true;
    $('bhCombo').hidden = true;
    $('bBanner').hidden = true;
    const names = s.participants.map((p) => p.name);
    if (g.mode === 'versus') {
      const [a, b] = g.scores;
      $('brTitle').textContent = a === b ? '비겼어요!' : `${names[a > b ? 0 : 1]} 승리!`;
      $('brScore').innerHTML = g.scores.map((v, i) => `<span class="vs" style="background:${s.participants[i].color}">${v}</span>`).join('');
    } else {
      $('brTitle').textContent = '게임 끝!';
      $('brScore').textContent = String(g.totalScore);
    }
    $('brInfo').textContent = `스테이지 ${g.stage}까지 · 터뜨린 풍선 ${g.popped}개 · 최고 콤보 ${g.maxCombo}`;
    $('brStages').textContent = g.stageScores.map((v, i) => `${i + 1}스테이지 ${v}점`).join(' · ');
    $('bResult').hidden = false;
    this.app.hover.suppress();
    $('brAgain').focus({ preventScroll: true });
    this.app.log(`balloon result score=${g.scores.join('/')} stage=${g.stage} stages=${g.stageScores.join(',')}`);
    void savePlay({
      id: crypto.randomUUID(),
      game: s.game,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      score: g.totalScore,
      scores: g.scores.slice(),
      playerIds: s.participants.map((p) => p.player?.id ?? null),
      playerNames: names,
      stage: g.stage,
      stageScores: g.stageScores.slice(),
      maxCombo: g.maxCombo,
    }).catch((err) => console.warn('기록 저장 실패', err));
  }

  // ---------- 연출 ----------

  private setSky(stage: number | null): void {
    const bg = $('bg');
    bg.classList.remove(...SKIES);
    if (stage) bg.classList.add(SKIES[(stage - 1) % SKIES.length]);
  }

  private banner(html: string, cls = '', ms = 0): void {
    const b = $('bBanner');
    b.className = `banner ${cls}`;
    b.innerHTML = html;
    b.hidden = false;
    // 같은 문구라도 애니메이션을 다시 보이게
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(Number(b.dataset.timer));
    if (ms) b.dataset.timer = String(setTimeout(() => (b.hidden = true), ms));
  }

  private float(x: number, y: number, text: string, color?: string, bad = false): void {
    const p = this.app.avatars.toScreen({ x, y });
    const d = document.createElement('div');
    d.className = `float-pt${bad ? ' bad' : ''}`;
    d.textContent = text;
    if (color) d.style.color = color;
    d.style.left = `${p.x}px`;
    d.style.top = `${p.y}px`;
    $('fx').appendChild(d);
    setTimeout(() => d.remove(), 950);
  }

  private combo(n: number, mult: number): void {
    const c = $('bhCombo');
    c.textContent = `${n} 콤보!${mult > 1 ? ` ×${mult}` : ''}`;
    c.hidden = false;
    clearTimeout(this.comboTimer);
    this.comboTimer = window.setTimeout(() => (c.hidden = true), 1200);
  }
}

/** 양팔을 옆으로 편 자세 윤곽(보정 안내) */
function tPoseSvg(n: number): string {
  const figure = (cx: number) =>
    `<g transform="translate(${cx} 0)" fill="none" stroke="white" stroke-width="7" stroke-dasharray="16 12" stroke-linecap="round" stroke-linejoin="round">` +
    '<circle cx="0" cy="62" r="46"/>' +
    '<path d="M -30 118 L -230 122 L -230 150 L -42 160 L -40 300 L -52 560 L -20 562 L 0 330 L 20 562 L 52 560 L 40 300 L 42 160 L 230 150 L 230 122 L 30 118 Z"/>' +
    '</g>';
  const xs = n === 1 ? [0] : [-420, 420];
  return `<svg viewBox="-889 0 1778 600" preserveAspectRatio="xMidYMax meet">${xs.map(figure).join('')}</svg>`;
}
