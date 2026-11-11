// 벽 뚫고 지나가기(SRS 4.2~4.4, 4.6): 3초 카운트다운 → 벽 7~10개가 차례로 다가옴 → 통과 순간 판정 → 결과.
// 보정(체형 측정)은 CalibScreen 에서 끝내고 온다.

import { $, App, FLOOR_Y, type Screen } from '../app';
import { config } from '../config';
import { savePlay } from '../data/db';
import {
  DEFAULT_PROFILE,
  approachSec,
  capsules,
  gradeOf,
  makeWall,
  pickPoses,
  poppedBubbles,
  totalScore,
  wallScore,
  type Grade,
  type Wall,
  type WallPose,
} from '../game/wall/geometry';
import { liveJoints } from '../game/wall/profile';
import { WallView } from '../game/wall/view';
import { AutoPause } from './autoPause';
import { registerHall } from './hallResult';
import { pauseKeys } from './screens';

type Phase = 'countdown' | 'approach' | 'result';

interface WallResult {
  pose: WallPose;
  popped: number;
  grade: Grade;
  score: number;
}

const COUNTDOWN_SEC = 3;
/** 판정 뒤 벽이 지나가는 시간 */
const PASS_SEC = 0.9;
const GRADE_KO: Record<Grade, string> = { Perfect: '완벽해요!', Great: '잘했어요!', Good: '좋아요!', Oops: '앗!' };

let posesCache: WallPose[] | null = null;
async function loadPoses(): Promise<WallPose[]> {
  if (posesCache) return posesCache;
  try {
    const res = await fetch(new URL('config/poses.json', document.baseURI), { cache: 'no-store' });
    posesCache = (await res.json()) as WallPose[];
  } catch (err) {
    console.warn('자세 목록을 읽지 못했습니다', err);
    posesCache = [];
  }
  return posesCache;
}

export class WallScreen implements Screen {
  readonly name = 'wall' as const;
  readonly el = $('scr-wall');
  readonly avatarMode = 'game' as const;
  readonly backTo = null;
  private phase: Phase = 'countdown';
  private view: WallView;
  private autoPause: AutoPause;
  private walls: Wall[] = [];
  private results: WallResult[] = [];
  private index = 0;
  private clock = 0;
  private phaseAt = 0;
  private lastNow = 0;
  private lastCount = -1;
  private beeps = 0;
  /** 판정 창 안에서 가장 잘 맞은 프레임(터진 거품이 가장 적은) */
  private best: number[] | null = null;
  private judged = false;
  private startedAt = '';

  /** 검증용(--wall-poses=stand,star): 이 자세만 차례로 */
  testPoses: string[] | null = null;

  constructor(private app: App) {
    this.view = new WallView(app.avatars.scene);
    this.autoPause = new AutoPause(app);
    $('wPause').addEventListener('click', () => this.app.setPaused(true, '스페이스나 ▶ 버튼으로 계속해요'));
    $('wrAgain').addEventListener('click', () => void this.start());
    $('wrHome').addEventListener('click', () => void this.app.go('main', undefined, { back: true }));
  }

  get cursorsOff(): boolean {
    return this.phase !== 'result';
  }

  async enter(): Promise<void> {
    await this.start();
  }

  leave(): void {
    this.view.clear();
    $('bg').classList.remove('wall-bg');
    $('wResult').hidden = true;
    $('wBanner').hidden = true;
    $('wGrade').hidden = true;
  }

  /** 새 판: 벽 수·자세를 고르고 체형에 맞춰 구멍을 만든다(FR-WALL-13, 20) */
  private async start(): Promise<void> {
    const w = config.wall;
    const s = this.app.session;
    const prof = s?.profile ?? DEFAULT_PROFILE;
    const library = await loadPoses();
    const n = w.fixedWallCount || w.wallCount.min + Math.floor(Math.random() * (w.wallCount.max - w.wallCount.min + 1));
    let poses: WallPose[];
    if (this.testPoses?.length) {
      const list = this.testPoses.map((id) => library.find((p) => p.id === id)).filter((p): p is WallPose => Boolean(p));
      poses = Array.from({ length: n }, (_, i) => list[i % list.length]);
    } else poses = pickPoses(library, n);
    const margin = w.holeMarginBubbles[w.difficulty];
    this.walls = poses.map((p) => makeWall(p, prof, w.playerScreenHeight, FLOOR_Y, w, margin));
    this.results = [];
    this.index = 0;
    this.clock = 0;
    this.lastCount = -1;
    this.startedAt = new Date().toISOString();
    this.view.clear();
    // 소실점: 플레이어 가슴 높이쯤
    this.view.vanish = { x: 0, y: FLOOR_Y + w.playerScreenHeight * 0.62 };
    $('bg').classList.add('wall-bg');
    $('wResult').hidden = true;
    $('wGrade').hidden = true;
    $('wPause').hidden = false;
    $('wPreviewBox').hidden = true;
    this.autoPause.reset();
    this.app.tracker.mode = 'game';
    this.app.sound.music('menu', 1.15);
    this.setPhase('countdown');
    this.app.log(`wall start n=${n} difficulty=${w.difficulty} poses=${poses.map((p) => p.id).join(',')}`);
    this.hud();
  }

  debug(): string {
    const w = this.walls[this.index];
    const t = this.clock - this.phaseAt;
    return (
      `phase=${this.phase} wall=${this.index + 1}/${this.walls.length} pose=${w?.pose.id ?? '-'} t=${t.toFixed(1)}/${this.dur().toFixed(1)} ` +
      `results=[${this.results.map((r) => `${r.pose.id}:${r.popped}:${r.grade}`).join(',')}] best=${this.best?.length ?? '-'}`
    );
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseAt = this.clock;
    this.lastCount = -1;
    this.beeps = 0;
  }

  private dur(): number {
    const w = config.wall;
    return approachSec(this.index, this.walls.length, w.approachSec.first, w.approachSec.last);
  }

  update(now: number): void {
    const dtWall = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;
    this.view.update(dtWall);
    if (this.phase === 'result') return;
    this.autoPause.update(now, 1);
    const dt = this.app.paused ? 0 : dtWall;
    this.clock += dt;
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
          this.beginWall();
        }
      }
      return;
    }

    // ---- 벽이 다가오는 중 ----
    const wall = this.walls[this.index];
    const dur = this.dur();
    const u = t / dur;
    const win = config.wall.judgeWindowMs / 1000;
    const passing = t > dur + win;
    // 벽은 아바타 앞에 반투명하게 그린다: 구멍 사이로 내 아바타가 보여 맞추기 쉽다(FR-WALL-22).
    // 지나가면 흐려지며 사라진다.
    const fade = passing ? Math.max(0, 1 - (t - dur - win) / PASS_SEC) : 1;
    this.view.setProgress(u, (0.32 + 0.28 * Math.min(1, u)) * fade, true);

    // 도착 1초 전부터 3, 2, 1 박자음
    const beatAt = [dur - 1, dur - 2 / 3, dur - 1 / 3];
    while (this.beeps < 3 && t >= beatAt[this.beeps]) {
      this.app.sound.play('beep');
      this.banner(String(3 - this.beeps), 'beat', 300);
      this.beeps++;
    }

    // 판정 창(통과 순간 ±0.15초): 가장 잘 맞는 프레임으로 판정(FR-WALL-23)
    if (!this.judged && t >= dur - win) {
      const pop = this.livePopped(wall);
      if (pop && (!this.best || pop.length < this.best.length)) this.best = pop;
      if (t >= dur + win) this.judge(wall);
    }

    if (t >= dur + win + PASS_SEC) {
      this.index++;
      if (this.index >= this.walls.length) this.showResult();
      else this.beginWall();
    }
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.phase === 'result') {
      if (e.key === 'Escape') {
        $('wrHome').click();
        return true;
      }
      return false;
    }
    return pauseKeys(this.app, e, () => $('wPause').click());
  }

  private beginWall(): void {
    this.setPhase('approach');
    this.best = null;
    this.judged = false;
    const wall = this.walls[this.index];
    this.view.setWall(wall);
    this.view.setProgress(0, 0.32, true);
    $('wGrade').hidden = true;
    drawPreview($<HTMLCanvasElement>('wPreview'), wall);
    $('wPreviewBox').hidden = false;
    this.hud();
    this.app.log(`wall ${this.index + 1} ${wall.pose.id} holes=${wall.bubbles.filter((b) => b.hole).length} dur=${this.dur().toFixed(2)}s`);
  }

  /** 지금 아바타와 겹치는 거품 */
  private livePopped(wall: Wall): number[] | null {
    const s = this.app.session;
    const slot = this.app.tracker.slots[0];
    if (!s || !slot.present || !slot.pts) return null;
    const j = liveJoints(slot.pts, s.transforms[0], config.wall.playerScreenHeight, config.common.minVisibility);
    return poppedBubbles(wall, capsules(j));
  }

  private judge(wall: Wall): void {
    this.judged = true;
    const w = config.wall;
    // 판정 창에서 한 번도 못 봤으면(카메라 밖) 전부 터진 것으로
    const popped = this.best ?? wall.bubbles.map((_, i) => i).filter((i) => !wall.bubbles[i].hole);
    const n = popped.length;
    const grade = gradeOf(n, w.grades);
    const score = wallScore(n, this.walls.length, w.zeroScoreBubbles);
    this.results.push({ pose: wall.pose, popped: n, grade, score });
    this.view.pop(popped);
    // 터지는 소리(너무 많으면 몇 번만)
    for (let k = 0; k < Math.min(n, 6); k++) setTimeout(() => this.app.sound.play('bubble'), k * 45);
    this.app.sound.play(grade === 'Perfect' ? 'cheer' : grade === 'Great' ? 'gold' : grade === 'Good' ? 'heart' : 'miss');
    const g = $('wGrade');
    g.className = `w-grade ${grade}`;
    g.innerHTML = `${grade}<small>${GRADE_KO[grade]}${n ? ` · 거품 ${n}개` : ''}</small>`;
    g.hidden = false;
    g.style.animation = 'none';
    void g.offsetWidth;
    g.style.animation = '';
    const where = popped.slice(0, 6).map((i) => `(${wall.bubbles[i].x.toFixed(2)},${wall.bubbles[i].y.toFixed(2)})`).join('');
    this.app.log(`judge ${wall.pose.id} popped=${n} grade=${grade} ${where}`);
    this.hud();
  }

  private hud(): void {
    const w = this.walls[this.index];
    $('whWall').textContent = `벽 ${Math.min(this.index + 1, this.walls.length)}/${this.walls.length}`;
    $('whLevel').textContent = `난이도 ${{ easy: '쉬움', normal: '보통', hard: '어려움' }[config.wall.difficulty]}`;
    $('whPose').textContent = w ? w.pose.name : '';
    $('whScore').textContent = String(Math.round(this.results.reduce((a, r) => a + r.score, 0)));
  }

  private showResult(): void {
    this.phase = 'result';
    this.view.clear();
    $('wPause').hidden = true;
    $('wGrade').hidden = true;
    $('wBanner').hidden = true;
    $('wPreviewBox').hidden = true;
    const w = config.wall;
    const total = totalScore(
      this.results.map((r) => r.popped),
      w.zeroScoreBubbles,
    );
    const perfect = this.results.filter((r) => r.grade === 'Perfect').length;
    $('wrTitle').textContent = perfect === this.results.length ? '모두 Perfect!' : '통과 완료!';
    $('wrScore').textContent = `${total}점`;
    $('wrInfo').textContent = `벽 ${this.results.length}개 · Perfect ${perfect}개`;
    $('wrList').innerHTML = this.results
      .map((r, i) => `<span>${i + 1}. ${r.pose.name}</span><span class="${r.grade}">${r.grade} · 거품 ${r.popped}개 · ${r.score.toFixed(1)}점</span>`)
      .join('');
    $('wResult').hidden = false;
    this.app.sound.play(perfect === this.results.length ? 'stageClear' : 'cheer');
    this.app.sound.music(null);
    this.app.hover.suppress();
    $('wrAgain').focus({ preventScroll: true });
    this.app.log(`wall result total=${total} perfect=${perfect}/${this.results.length}`);
    const s = this.app.session;
    if (s) {
      const playId = crypto.randomUUID();
      void registerHall(this.app, { game: s.game, participants: s.participants, scores: [total], stage: perfect, playId }, $('wrHall'));
      void savePlay({
        id: playId,
        game: s.game,
        startedAt: this.startedAt,
        endedAt: new Date().toISOString(),
        score: total,
        scores: [total],
        playerIds: s.participants.map((p) => p.player?.id ?? null),
        playerNames: s.participants.map((p) => p.name),
        stage: this.results.length,
        stageScores: this.results.map((r) => r.popped),
        maxCombo: perfect,
      }).catch((err) => console.warn('기록 저장 실패', err));
    }
  }

  private banner(html: string, cls = '', ms = 0): void {
    const b = $('wBanner');
    if (cls === 'count' || cls === 'beat') $('wPreviewBox').classList.toggle('hot', cls === 'beat');
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

/** 이번 벽의 구멍 모양을 화면 구석에 작게 미리 보여 준다(SRS 8.1 미리 따라하기) */
function drawPreview(cv: HTMLCanvasElement, wall: Wall): void {
  const W = cv.width;
  const H = cv.height;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  const sx = W / (wall.x1 - wall.x0);
  const sy = H / (wall.y1 - wall.y0);
  const k = Math.min(sx, sy);
  const ox = (W - (wall.x1 - wall.x0) * k) / 2;
  const oy = (H - (wall.y1 - wall.y0) * k) / 2;
  g.fillStyle = '#9ee3ff';
  for (const b of wall.bubbles) {
    if (b.hole) continue;
    g.beginPath();
    g.arc(ox + (b.x - wall.x0) * k, H - oy - (b.y - wall.y0) * k, wall.r * k * 0.95, 0, Math.PI * 2);
    g.fill();
  }
}
