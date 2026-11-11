// 화면들: 메인, 게임 선택, 플레이어 선택, 플레이어 추가, 명예의 전당(틀), 보정, 아바타 확인, 설정.

import { $, App, FLOOR_Y, type Screen } from '../app';
import { GAMES, PLAYER_COLORS, config, gameInfo, type GameId } from '../config';
import { MAX_NAME, addPlayer, autoColor, checkName, colorHex, listPlayers, nameLength, type PlayerRecord } from '../data/db';
import { frameProblem, measure, type FrameProblem } from '../pose/body';
import { LM, dist, mid, type Pt } from '../pose/landmarks';
import { calibTargetX } from '../pose/transform';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// ---------- 메인 ----------

export class MainScreen implements Screen {
  readonly name = 'main' as const;
  readonly el = $('scr-main');
  readonly avatarMode = 'menu' as const;
  readonly backTo = null;
  constructor(private app: App) {
    this.el.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => {
      b.addEventListener('click', () => void this.app.go(b.dataset.go as 'games'));
    });
  }
  enter(): void {
    this.app.sound.music('menu');
  }
}

// ---------- 게임 선택 ----------

export class GamesScreen implements Screen {
  readonly name = 'games' as const;
  readonly el = $('scr-games');
  readonly avatarMode = 'menu' as const;
  readonly backTo = 'main' as const;
  constructor(private app: App) {
    const box = $('gameCards');
    for (const g of GAMES) {
      const b = el('button', 'hov game-card');
      b.dataset.name = `game-${g.id}`;
      b.append(el('span', 'ico', g.icon), el('span', 'name', g.name), el('span', 'sub', g.sub));
      b.style.background = g.id === 'wall' ? 'linear-gradient(160deg,#9b5cff,#5a2fd1)' : g.players === 1 ? 'linear-gradient(160deg,#ff6fc1,#e0368f)' : 'linear-gradient(160deg,#28d2e6,#1a8fd1)';
      b.addEventListener('click', () => void this.app.go('select', g.id));
      box.appendChild(b);
    }
  }
  enter(): void {}
}

// ---------- 플레이어 선택 (FR-PLY-05, 06) ----------

interface Pick {
  key: string;
  player: PlayerRecord | null;
}

export class SelectScreen implements Screen {
  readonly name = 'select' as const;
  readonly el = $('scr-select');
  readonly avatarMode = 'menu' as const;
  readonly backTo = 'games' as const;
  private game: GameId = 'balloon-1p';
  private picks: Pick[] = [];
  private photoUrls: string[] = [];
  constructor(private app: App) {
    $('selectStart').addEventListener('click', () => this.start());
  }

  get need(): number {
    return gameInfo(this.game).players;
  }

  async enter(arg?: string): Promise<void> {
    this.game = (arg as GameId) || this.game;
    this.picks = [];
    const info = gameInfo(this.game);
    $('selectTitle').textContent = `${info.icon} ${info.players === 1 ? '누가 할까요?' : '두 명을 골라요'}`;
    await this.render();
  }

  leave(): void {
    this.photoUrls.forEach((u) => URL.revokeObjectURL(u));
    this.photoUrls = [];
  }

  private async render(): Promise<void> {
    const grid = $('playerGrid');
    grid.innerHTML = '';
    this.leave();
    const players = await listPlayers();
    const cards: Pick[] = players.map((p) => ({ key: p.id, player: p }));
    for (let i = 1; i <= this.need; i++) cards.push({ key: `guest${i}`, player: null });
    for (const c of cards) {
      const b = el('button', 'hov player-card');
      b.dataset.name = c.player ? `player-${c.player.name}` : c.key;
      b.dataset.key = c.key;
      b.style.setProperty('--pc', c.player ? colorHex(c.player.color) : 'rgba(255,255,255,0.5)');
      if (c.player?.photoBlob) {
        const img = el('img');
        const url = URL.createObjectURL(c.player.photoBlob);
        this.photoUrls.push(url);
        img.src = url;
        b.appendChild(img);
      } else b.appendChild(el('div', 'ph', c.player ? '🙂' : '👋'));
      b.appendChild(el('div', 'pname', c.player ? c.player.name : this.need > 1 ? `손님 ${c.key.slice(5)}` : '손님'));
      b.addEventListener('click', () => this.toggle(c));
      grid.appendChild(b);
    }
    if (!players.length) {
      const hint = el('p', 'hint-line', '"플레이어 추가"에서 사진을 찍으면 여기에 나와요');
      hint.style.width = '100%';
      hint.style.textAlign = 'center';
      grid.appendChild(hint);
    }
    this.refresh();
  }

  private toggle(c: Pick): void {
    const i = this.picks.findIndex((p) => p.key === c.key);
    if (i >= 0) this.picks.splice(i, 1);
    else {
      if (this.picks.length >= this.need) this.picks.shift();
      this.picks.push(c);
    }
    this.app.sound.play(i >= 0 ? 'back' : 'join');
    this.refresh();
  }

  private refresh(): void {
    $('playerGrid')
      .querySelectorAll<HTMLButtonElement>('.player-card')
      .forEach((b) => {
        const order = this.picks.findIndex((p) => p.key === b.dataset.key);
        b.classList.toggle('selected', order >= 0);
        b.querySelector('.badge')?.remove();
        if (order >= 0) {
          const badge = el('div', `badge p${order + 1}`, this.need > 1 ? `P${order + 1}` : '✔');
          b.appendChild(badge);
        }
      });
    const btn = $<HTMLButtonElement>('selectStart');
    btn.disabled = this.picks.length < this.need;
    btn.textContent = this.picks.length < this.need ? `${this.need - this.picks.length}명 더 골라요` : '시작!';
  }

  /** 테스트·키보드용: 손님으로 채우기 */
  fillGuests(): void {
    for (let i = 1; this.picks.length < this.need; i++) {
      const key = `guest${i}`;
      if (!this.picks.some((p) => p.key === key)) this.picks.push({ key, player: null });
    }
    this.refresh();
  }

  private start(): void {
    if (this.picks.length < this.need) return;
    this.app.startSession(this.game, this.picks.map((p) => p.player));
    this.app.sound.play('go');
    void this.app.go('calib');
  }
}

// ---------- 플레이어 추가 (FR-PLY-01~03) ----------

type AddStep = 'photo' | 'review' | 'name';

export class AddPlayerScreen implements Screen {
  readonly name = 'add-player' as const;
  readonly el = $('scr-add');
  readonly avatarMode = 'none' as const;
  readonly backTo = 'main' as const;
  private step: AddStep = 'photo';
  private cv = $<HTMLCanvasElement>('photoCam');
  private g = this.cv.getContext('2d')!;
  /** 화면에 보여줄 카메라 영역(카메라 좌표) — 부드럽게 따라간다 */
  private view = { cx: 0.89, cy: 0.5, h: 1 };
  private okSince = 0;
  private countStart = 0;
  private lastCount = -1;
  private photo: Blob | null = null;
  private photoUrl: string | null = null;
  private color: string = PLAYER_COLORS[0].id;
  private players: PlayerRecord[] = [];
  private face: { x: number; y: number; r: number; ok: boolean } | null = null;

  constructor(private app: App) {
    $('photoNow').addEventListener('click', () => this.capture());
    $('photoRetake').addEventListener('click', () => this.setStep('photo'));
    $('photoOk').addEventListener('click', () => this.setStep('name'));
    $('nameSave').addEventListener('click', () => void this.save());
    const input = $<HTMLInputElement>('nameInput');
    input.addEventListener('input', () => this.validate());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.save();
      e.stopPropagation();
      if (e.key === 'Escape') this.app.back();
    });
    const row = $('colorRow');
    for (const c of PLAYER_COLORS) {
      const b = el('button', 'hov swatch');
      b.dataset.name = `color-${c.id}`;
      b.dataset.color = c.id;
      b.title = c.name;
      b.style.setProperty('--sc', c.hex);
      b.addEventListener('click', () => this.setColor(c.id));
      row.appendChild(b);
    }
  }

  /** 검증용(--start=add-player:demo): 사진을 찍으면 이름 단계로 넘어가 예시 이름을 채운다 */
  private demo = false;

  async enter(arg?: string): Promise<void> {
    this.demo = arg === 'demo';
    this.players = await listPlayers();
    this.photo = null;
    $<HTMLInputElement>('nameInput').value = '';
    this.setColor(autoColor(this.players));
    this.setStep('photo');
  }

  leave(): void {
    if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
    this.photoUrl = null;
  }

  private setStep(s: AddStep): void {
    this.step = s;
    $('addPhotoStep').hidden = s !== 'photo';
    $('addReviewStep').hidden = s !== 'review';
    $('addNameStep').hidden = s !== 'name';
    $('addTitle').textContent = s === 'photo' ? '📸 사진 찍기' : s === 'review' ? '이 사진 괜찮아요?' : '이름과 색을 골라요';
    this.okSince = 0;
    this.countStart = 0;
    $('photoCount').hidden = true;
    if (s === 'name') {
      const input = $<HTMLInputElement>('nameInput');
      setTimeout(() => input.focus(), 50);
      this.validate();
    } else if (s === 'review') $('photoOk').focus({ preventScroll: true });
  }

  private setColor(id: string): void {
    this.color = id;
    $('colorRow')
      .querySelectorAll<HTMLElement>('.swatch')
      .forEach((b) => b.classList.toggle('selected', b.dataset.color === id));
    $('namePhoto').style.setProperty('--pc', colorHex(id));
  }

  private validate(): boolean {
    const input = $<HTMLInputElement>('nameInput');
    const v = input.value;
    const p = checkName(v, this.players);
    const msg: Record<string, string> = {
      empty: '이름을 키보드로 써요',
      long: `${MAX_NAME}자까지 쓸 수 있어요 (지금 ${nameLength(v)}자)`,
      taken: '이미 있는 이름이에요. 다른 이름을 써요',
    };
    $('nameError').textContent = p ? msg[p] : '';
    $<HTMLButtonElement>('nameSave').disabled = Boolean(p);
    return !p;
  }

  private async save(): Promise<void> {
    if (!this.validate() || !this.photo) return;
    const name = $<HTMLInputElement>('nameInput').value;
    try {
      const rec = await addPlayer({ name, photoBlob: this.photo, color: this.color });
      this.app.sound.play('cheer');
      toast(`${rec.name} 등록 완료!`);
      this.app.log(`player added ${rec.name}`);
      void this.app.go('main', undefined, { back: true });
    } catch (err) {
      this.app.sound.play('error');
      $('nameError').textContent = String((err as Error).message) === 'taken' ? '이미 있는 이름이에요' : '저장하지 못했어요';
    }
  }

  /** 사진 찍을 사람: 얼굴이 화면 가운데에 가장 가까운 사람 */
  private target(): Pt[] | null {
    const A = this.app.videoAspect;
    let best: Pt[] | null = null;
    let bd = Infinity;
    for (const s of this.app.tracker.slots) {
      if (!s.present || !s.pts) continue;
      const d = Math.abs(s.pts[LM.nose].x - A / 2);
      if (d < bd) {
        bd = d;
        best = s.pts;
      }
    }
    return best;
  }

  update(now: number): void {
    if (this.step !== 'photo') return;
    const v = this.app.video;
    if (v.readyState < 2) return;
    const W = this.cv.clientWidth || 640;
    const H = this.cv.clientHeight || 480;
    if (this.cv.width !== W || this.cv.height !== H) {
      this.cv.width = W;
      this.cv.height = H;
    }
    const A = this.app.videoAspect;
    const pts = this.target();
    const c = config.common;

    // 얼굴 찾기와 정면 여부
    this.face = null;
    if (pts) {
      const m = measure(pts, c.minVisibility);
      const eyesOk = pts[LM.leftEye].v > 0.6 && pts[LM.rightEye].v > 0.6 && pts[LM.nose].v > 0.6;
      const ear = mid(pts[LM.leftEar], pts[LM.rightEar]);
      const earD = dist(pts[LM.leftEar], pts[LM.rightEar]);
      const frontal = Math.abs(pts[LM.nose].x - ear.x) < 0.35 * Math.max(earD, 1e-3);
      this.face = { x: m.headCenter.x, y: m.headCenter.y, r: m.headRadius, ok: eyesOk && frontal };
    }

    // 보여줄 영역: 얼굴이 있으면 윗몸 쪽으로 확대, 없으면 전체
    const aspect = W / H;
    const want = this.face
      ? { cx: this.face.x, cy: this.face.y + this.face.r * 1.6, h: Math.min(1, Math.max(0.3, this.face.r * 9)) }
      : { cx: A / 2, cy: 0.5, h: 1 };
    const k = 0.12;
    this.view.cx += (want.cx - this.view.cx) * k;
    this.view.cy += (want.cy - this.view.cy) * k;
    this.view.h += (want.h - this.view.h) * k;
    const vh = Math.min(this.view.h, 1, A / aspect);
    const vw = vh * aspect;
    const left = Math.max(0, Math.min(A - vw, this.view.cx - vw / 2));
    const top = Math.max(0, Math.min(1 - vh, this.view.cy - vh / 2));

    // 카메라 그림(거울 반전)
    const px = v.videoHeight; // 카메라 단위 → 영상 픽셀
    const g = this.g;
    g.save();
    if (this.app.mirror) {
      g.translate(W, 0);
      g.scale(-1, 1);
      g.drawImage(v, (A - left - vw) * px, top * px, vw * px, vh * px, 0, 0, W, H);
    } else g.drawImage(v, left * px, top * px, vw * px, vh * px, 0, 0, W, H);
    g.restore();

    // 얼굴 가이드 원
    const guide = $('photoGuide');
    if (!this.face) {
      guide.textContent = '카메라 앞에 서요';
      this.okSince = 0;
      this.countStart = 0;
    } else {
      const s = W / vw;
      const fx = (this.face.x - left) * s;
      const fy = (this.face.y - top) * s;
      const fr = this.face.r * 1.45 * s;
      g.lineWidth = Math.max(4, H * 0.012);
      g.setLineDash(this.face.ok ? [] : [14, 10]);
      g.strokeStyle = this.face.ok ? '#2fcf6b' : '#ffffff';
      g.beginPath();
      g.arc(fx, fy, fr, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      guide.textContent = this.face.ok ? (this.countStart ? '움직이지 마요!' : '좋아요, 그대로!') : '카메라를 똑바로 봐요';
      if (this.face.ok) {
        if (!this.okSince) this.okSince = now;
        if (!this.countStart && now - this.okSince > 600) {
          this.countStart = now;
          this.lastCount = -1;
        }
      } else {
        this.okSince = 0;
        if (this.countStart) {
          this.countStart = 0;
          this.app.sound.play('error');
        }
      }
    }

    // 3초 카운트다운
    const cnt = $('photoCount');
    if (this.countStart) {
      const left = c.photoCountdownSec - Math.floor((now - this.countStart) / 1000);
      cnt.hidden = false;
      cnt.textContent = String(Math.max(1, left));
      if (left !== this.lastCount && left > 0) {
        this.lastCount = left;
        this.app.sound.play('beep');
      }
      if (left <= 0) this.capture();
    } else cnt.hidden = true;
  }

  /** 얼굴 관절(코·눈·귀) 기준 정사각형으로 잘라 저장(FR-PLY-01) */
  private capture(): void {
    const v = this.app.video;
    if (v.readyState < 2) return;
    const A = this.app.videoAspect;
    const px = v.videoHeight;
    const face = this.face ?? { x: A / 2, y: 0.35, r: 0.12, ok: false };
    const side = Math.min(1, face.r * 3.2); // 머리 + 약간의 여백
    const cx = Math.max(side / 2, Math.min(A - side / 2, face.x));
    const cy = Math.max(side / 2, Math.min(1 - side / 2, face.y + face.r * 0.15));
    const out = document.createElement('canvas');
    out.width = out.height = 256;
    const g = out.getContext('2d')!;
    const sx = (this.app.mirror ? A - cx - side / 2 : cx - side / 2) * px;
    const sy = (cy - side / 2) * px;
    g.imageSmoothingQuality = 'high';
    if (this.app.mirror) {
      g.translate(256, 0);
      g.scale(-1, 1);
    }
    g.drawImage(v, sx, sy, side * px, side * px, 0, 0, 256, 256);
    this.countStart = 0;
    this.app.sound.play('shutter');
    const flash = $('photoFlash');
    flash.classList.remove('on');
    void flash.offsetWidth;
    flash.classList.add('on');
    out.toBlob(
      (b) => {
        if (!b) return;
        this.photo = b;
        if (this.photoUrl) URL.revokeObjectURL(this.photoUrl);
        this.photoUrl = URL.createObjectURL(b);
        $<HTMLImageElement>('photoResult').src = this.photoUrl;
        $<HTMLImageElement>('namePhoto').src = this.photoUrl;
        this.app.log(`photo taken ${Math.round(side * px)}px face=${face.ok}`);
        this.setStep('review');
        if (this.demo) {
          setTimeout(() => {
            this.setStep('name');
            const input = $<HTMLInputElement>('nameInput');
            input.value = '하늘';
            this.validate();
          }, 2500);
        }
      },
      'image/jpeg',
      0.9,
    );
  }
}

// ---------- 명예의 전당(틀만, 5단계에서 기록 연결) ----------

export class HallScreen implements Screen {
  readonly name = 'hall' as const;
  readonly el = $('scr-hall');
  readonly avatarMode = 'menu' as const;
  readonly backTo = 'main' as const;
  constructor(app: App) {
    const tabs = $('hallTabs');
    const labels: Record<GameId, string> = { wall: '벽 뚫기', 'balloon-1p': '풍선 1인', 'balloon-coop': '풍선 2인 협동', 'balloon-versus': '풍선 2인 대결' };
    for (const g of GAMES) {
      const b = el('button', 'hov tab', labels[g.id]);
      b.dataset.name = `tab-${g.id}`;
      b.addEventListener('click', () => {
        tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('selected', t === b));
        app.sound.play('select');
      });
      tabs.appendChild(b);
    }
    tabs.firstElementChild?.classList.add('selected');
  }
  enter(): void {}
}

// ---------- 보정(공통) ----------

/** 보정 기준 자세 윤곽(다리 어깨너비, 팔은 내린 채 똑바로). 보정 후 아바타가 설 자리에 그린다. */
function silhouetteSvg(n: number): string {
  const figure = (cx: number) =>
    `<g transform="translate(${cx} 0)" fill="none" stroke="white" stroke-width="7" stroke-dasharray="16 12" stroke-linecap="round" stroke-linejoin="round">` +
    '<circle cx="0" cy="62" r="46"/>' +
    '<path d="M -30 118 L -62 128 L -78 300 L -60 304 L -42 170 L -40 300 L -52 560 L -20 562 L 0 330 L 20 562 L 52 560 L 40 300 L 42 170 L 60 304 L 78 300 L 62 128 L 30 118 Z"/>' +
    '</g>';
  // 화면 높이 600 = 아바타 키(화면의 60%)에 맞춘 좌표. 2인은 양쪽에 나눠 서도록 안내한다.
  const unit = 600;
  const xs = n === 1 ? [0] : [-0.22 * (16 / 9) * unit, 0.22 * (16 / 9) * unit].map((x) => x / 0.6);
  return `<svg viewBox="-889 0 1778 600" preserveAspectRatio="xMidYMax meet">${xs.map(figure).join('')}</svg>`;
}

/** 보정 중 이 시간보다 짧게 생긴 문제(인식 깜빡임)는 게이지를 되돌리지 않는다 */
const BAD_GRACE_MS = 400;

const PROBLEM_TEXT: Record<FrameProblem, string> = {
  none: '',
  head: '한 걸음 뒤로 가요 (머리가 잘려요)',
  feet: '한 걸음 뒤로 가요 (발이 안 보여요)',
  side: '화면 가운데로 와요',
  far: '한 걸음 앞으로 와요',
};

export class CalibScreen implements Screen {
  readonly name = 'calib' as const;
  readonly el = $('scr-calib');
  readonly avatarMode = 'calib' as const;
  readonly forcePreview = true;
  readonly backTo = 'select' as const;
  private holdStart = 0;
  private samples: { height: number; foot: { x: number; y: number } }[][] = [];
  private lastAnchor: ({ x: number; y: number } | null)[] = [];
  /** 문제가 보이기 시작한 때(짧은 깜빡임은 봐준다) */
  private badSince = 0;
  private lastError = 0;

  constructor(private app: App) {}

  enter(): void {
    this.holdStart = 0;
    const s = this.app.session;
    const n = s?.participants.length ?? 1;
    $('calibTitle').textContent = n === 1 ? '준비 자세 · 똑바로 서요' : '준비 자세 · 둘이 나란히 서요';
    $('calibSilhouette').innerHTML = silhouetteSvg(n);
    $('calibBar').style.width = '0%';
  }

  update(now: number): void {
    const s = this.app.session;
    if (!s) return;
    const need = s.participants.length;
    const present = this.app.tracker.slots.filter((x) => x.present && x.pts);
    const c = config.common;
    let msg = '';
    if (present.length < need) msg = need === 1 ? '카메라 앞에 서요' : `두 명이 카메라 앞에 서요 (${present.length}/2)`;
    else if (present.length > need) msg = '한 명만 카메라 앞에 서요';
    else {
      for (const slot of present) {
        const p = frameProblem(slot.pts!, this.app.videoAspect, c.minVisibility);
        if (p !== 'none') {
          const who = need > 1 ? `${slot.anchor!.x < this.app.videoAspect / 2 ? '왼쪽' : '오른쪽'} 친구: ` : '';
          msg = who + PROBLEM_TEXT[p];
          break;
        }
      }
    }
    // 크게 움직이면 처음부터
    if (!msg && this.holdStart) {
      present.forEach((slot) => {
        const a = this.lastAnchor[slot.index];
        const m = measure(slot.pts!, c.minVisibility);
        if (a && dist(a, slot.anchor!) > m.torso * 0.25) msg = '가만히 서 있어요';
      });
    }

    const guide = $('calibGuide');
    if (msg) {
      // 발목·머리 인식이 화면 끝에서 한두 프레임 깜빡이는 것은 무시한다(실제 웹캠에서 자주 생김).
      if (!this.badSince) this.badSince = now;
      if (this.holdStart && now - this.badSince < BAD_GRACE_MS) return;
      guide.textContent = msg;
      if (this.holdStart && now - this.holdStart > 500 && now - this.lastError > 1500) {
        this.app.sound.play('error');
        this.lastError = now;
      }
      this.holdStart = 0;
      $('calibBar').style.width = '0%';
      return;
    }
    this.badSince = 0;
    if (!this.holdStart) {
      // 자세를 잡기 시작할 때 왼쪽 사람 = P1, 오른쪽 = P2로 번호를 붙인다(FR-COM-04).
      this.app.tracker.assignLeftToRight();
      this.holdStart = now;
      this.samples = this.app.tracker.slots.map(() => []);
      this.lastAnchor = this.app.tracker.slots.map((x) => (x.anchor ? { ...x.anchor } : null));
      this.app.sound.play('beep');
    }
    guide.textContent = '그대로 가만히 서 있어요!';
    this.app.tracker.slots.forEach((slot, i) => {
      if (i >= need || !slot.pts) return;
      const m = measure(slot.pts, c.minVisibility);
      // 발목까지 실제로 잰 프레임만 평균에 넣는다(몸통으로 추정한 키는 빼기)
      if (m.fullHeight) this.samples[i].push({ height: m.height, foot: m.foot });
    });
    const prog = Math.min(1, (now - this.holdStart) / c.calibHoldMs);
    $('calibBar').style.width = `${(prog * 100).toFixed(0)}%`;
    if (prog >= 1) {
      if (this.samples.slice(0, need).every((xs) => xs.length >= 5)) this.finish();
      else this.holdStart = 0; // 발목까지 잰 프레임이 모자라면 다시
    }
  }

  /** 프레임 평균으로 키와 발 위치를 정하고 정규화 변환을 고정한다(FR-COM-10) */
  private finish(): void {
    const s = this.app.session!;
    const c = config.common;
    s.calibHeights = [];
    const measured = s.participants.map((_, i) => {
      const xs = this.samples[i];
      const avg = (f: (q: (typeof xs)[number]) => number) => xs.reduce((a, q) => a + f(q), 0) / Math.max(1, xs.length);
      return { height: avg((q) => q.height), foot: { x: avg((q) => q.foot.x), y: avg((q) => q.foot.y) } };
    });
    const feetX = measured.map((m) => m.foot.x);
    measured.forEach(({ height, foot }, i) => {
      const scale = c.avatarScreenHeight / Math.max(1e-3, height);
      s.calibHeights[i] = height;
      s.transforms[i].calibrate(height, foot, c.avatarScreenHeight, calibTargetX(foot.x, feetX, scale), FLOOR_Y);
      this.app.log(`calibrated P${i + 1} height=${height.toFixed(3)} scale=${scale.toFixed(3)} x=${s.transforms[i].to.x.toFixed(2)}`);
    });
    this.app.sound.play('cheer');
    void this.app.go('play');
  }
}

// ---------- 아바타 확인(1단계 놀이터) + 자동 일시정지(FR-COM-05) ----------

export class PlayScreen implements Screen {
  readonly name = 'play' as const;
  readonly el = $('scr-play');
  readonly avatarMode = 'game' as const;
  readonly backTo = null;
  private autoPaused = false;
  private backSince = 0;

  constructor(private app: App) {
    $('playPause').addEventListener('click', () => this.app.setPaused(true, '스페이스나 ▶ 버튼으로 계속해요'));
    $('resumeBtn').addEventListener('click', () => {
      this.autoPaused = false;
      this.app.setPaused(false);
      this.app.sound.play('select');
    });
    $('quitBtn').addEventListener('click', () => {
      this.app.setPaused(false);
      void this.app.go('main', undefined, { back: true });
    });
  }

  enter(): void {
    const s = this.app.session;
    const info = s ? gameInfo(s.game) : null;
    $('playTitle').textContent = info ? `${info.icon} ${info.name} ${info.sub} · 아바타 확인` : '아바타 확인';
    this.autoPaused = false;
    this.backSince = 0;
  }

  update(now: number): void {
    const s = this.app.session;
    if (!s) return;
    const t = this.app.tracker;
    const lost = s.participants.some((_, i) => t.lostMs(t.slots[i], now) > config.common.lostPlayerPauseMs);
    if (lost && !this.app.paused) {
      this.autoPaused = true;
      this.app.setPaused(true, '카메라 앞으로 돌아와요');
      $('pauseTitle').textContent = '어디 갔어요?';
    }
    // 자동으로 멈춘 경우: 모두 돌아와 1초 지나면 이어서 한다.
    if (this.autoPaused && this.app.paused) {
      const allBack = s.participants.every((_, i) => t.slots[i].present);
      if (!allBack) this.backSince = 0;
      else if (!this.backSince) this.backSince = now;
      else if (now - this.backSince > 1000) {
        this.autoPaused = false;
        this.backSince = 0;
        this.app.setPaused(false);
        this.app.sound.play('join');
        this.app.log('auto-resumed');
      }
    }
    if (!this.app.paused) $('pauseTitle').textContent = '잠깐 멈췄어요';
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === ' ') {
      e.preventDefault();
      if (this.app.paused) $('resumeBtn').click();
      else $('playPause').click();
      return true;
    }
    if (e.key === 'Escape') {
      if (this.app.paused) $('quitBtn').click();
      else $('playPause').click();
      return true;
    }
    return false;
  }
}

export function toast(text: string, ms = 2200): void {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(Number(t.dataset.timer));
  t.dataset.timer = String(setTimeout(() => (t.hidden = true), ms));
}
