// 앱의 뼈대: 영상 입력 → 자세 인식 → 번호 유지 → 화면 갱신 → 아바타·커서 그리기.
// 인식(pose/), 보정·변환(pose/transform), 렌더링(render/), 화면(ui/)을 나눠 둔다(NFR-08).

import { SLOT_COLORS, config, gameInfo, type GameId } from './config';
import { Sound } from './audio/sound';
import { colorHex, type PlayerRecord } from './data/db';
import { AppearanceSampler } from './pose/appearance';
import { Camera, type SourceInfo } from './pose/camera';
import { measure } from './pose/body';
import { LM, toCameraSpace, type Pt } from './pose/landmarks';
import { PlayerTracker } from './pose/playerTracker';
import { PoseTracker, type ModelKind } from './pose/poseTracker';
import { NormTransform } from './pose/transform';
import { AvatarScene, type AvatarDraw, type AvatarInfo } from './render/avatarScene';
import { HandCursor, HoverSelector, describe, type CursorPoint } from './ui/handCursor';

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type RouteName = 'main' | 'games' | 'select' | 'add-player' | 'hall' | 'calib' | 'play' | 'settings';

/** 화면마다 아바타를 어떻게 그릴지 */
export type AvatarMode = 'menu' | 'calib' | 'game' | 'none';

export interface Screen {
  readonly name: RouteName;
  readonly el: HTMLElement;
  readonly avatarMode: AvatarMode;
  /** 이 화면에서는 원본 카메라 미리보기를 항상 켠다(보정 화면, FR-COM-13) */
  readonly forcePreview?: boolean;
  /** 뒤로 가기 대상(없으면 뒤로 버튼을 숨긴다) */
  readonly backTo?: RouteName | null;
  enter(arg?: string): void | Promise<void>;
  leave?(): void;
  update?(now: number): void;
  /** 키보드 처리. true를 돌려주면 기본 처리(Esc=뒤로 등)를 하지 않는다 */
  onKey?(e: KeyboardEvent): boolean;
}

/** 이번 판에 참가하는 사람(등록 플레이어 또는 손님) */
export interface Participant {
  player: PlayerRecord | null; // null = 손님
  name: string;
  color: string;
  photoUrl: string | null;
}

export interface Session {
  game: GameId;
  participants: Participant[];
  /** 보정 결과: 슬롯별 키(카메라 단위) */
  calibHeights: number[];
  transforms: NormTransform[];
}

export const FLOOR_Y = 0.07;

class Rate {
  private times: number[] = [];
  tick(now: number): void {
    this.times.push(now);
    while (this.times.length && now - this.times[0] > 1000) this.times.shift();
  }
  rate(now: number): number {
    while (this.times.length && now - this.times[0] > 1000) this.times.shift();
    return this.times.length;
  }
}

export class App {
  readonly video = $<HTMLVideoElement>('video');
  readonly camera = new Camera(this.video);
  readonly pose = new PoseTracker();
  readonly tracker: PlayerTracker;
  private looks = new AppearanceSampler();
  readonly sound: Sound;
  readonly avatars: AvatarScene;
  readonly hover: HoverSelector;
  readonly cursors: HandCursor[];
  /** 메뉴·보정 화면에서 사람을 따라가는 변환(고정 전) */
  readonly liveTransforms: NormTransform[];
  readonly screens = new Map<RouteName, Screen>();
  current: Screen | null = null;
  private history: RouteName[] = [];
  session: Session | null = null;
  source: SourceInfo | null = null;
  sourceLabel = '없음';
  modelKind: ModelKind = (localStorage.getItem('popstar.model') as ModelKind) || 'full';
  previewPref = localStorage.getItem('popstar.preview') === '1';
  mirror: boolean;
  /** 이번 프레임에 그린 아바타 정보(슬롯 순서) */
  avatarInfo: AvatarInfo[] = [];
  paused = false;

  // 측정
  readonly camRate = new Rate();
  readonly poseRate = new Rate();
  readonly renderRate = new Rate();
  inferMs = 0;
  private lastVideoTime = -1;
  private detections = 0;
  /** 검증 로그용 이벤트 모음 */
  events: string[] = [];

  private previewCanvas = $<HTMLCanvasElement>('previewCanvas');
  private previewCtx = this.previewCanvas.getContext('2d')!;
  private tagsEl = $('tags');
  private tagEls: HTMLDivElement[] = [];

  constructor() {
    const c = config.common;
    this.mirror = localStorage.getItem('popstar.mirror') === null ? c.mirror : localStorage.getItem('popstar.mirror') === '1';
    this.tracker = new PlayerTracker(c.maxPlayers, c.smoothing);
    this.sound = new Sound(c.volume);
    this.avatars = new AvatarScene($<HTMLCanvasElement>('avatars'), c.maxPlayers);
    this.liveTransforms = Array.from({ length: c.maxPlayers }, () => new NormTransform());
    this.cursors = Array.from({ length: c.maxPlayers }, () => new HandCursor());
    this.hover = new HoverSelector($('cursorLayer'), c.maxPlayers, {
      onEnter: () => this.sound.play('hover'),
      onSelect: (el, slot) => {
        this.sound.play('select');
        this.log(`hand-select ${describe(el)} by P${slot + 1}`);
      },
    });
    for (let i = 0; i < c.maxPlayers; i++) {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.hidden = true;
      this.tagsEl.appendChild(tag);
      this.tagEls.push(tag);
    }
    window.addEventListener('resize', () => this.avatars.resize());
  }

  log(e: string): void {
    this.events.push(e);
    if (this.events.length > 50) this.events.shift();
  }

  get videoAspect(): number {
    const w = this.video.videoWidth || 16;
    const h = this.video.videoHeight || 9;
    return w / h;
  }

  register(s: Screen): void {
    this.screens.set(s.name, s);
  }

  async go(name: RouteName, arg?: string, opts: { back?: boolean } = {}): Promise<void> {
    const next = this.screens.get(name);
    if (!next) return;
    if (this.current && !opts.back && this.current.name !== name) this.history.push(this.current.name);
    this.current?.leave?.();
    this.current?.el.setAttribute('hidden', '');
    this.current = next;
    next.el.removeAttribute('hidden');
    this.setPaused(false);
    this.tracker.mode = name === 'play' ? 'game' : 'menu';
    $('backBtn').hidden = !next.backTo;
    $('gearBtn').hidden = name !== 'main';
    this.hover.hideAll();
    this.hover.suppress();
    this.log(`screen ${name}${arg ? `:${arg}` : ''}`);
    await next.enter(arg);
    // 키보드 조작이 바로 되도록 첫 버튼에 포커스(입력칸이 있으면 그쪽이 먼저 가져간다)
    if (!next.el.contains(document.activeElement)) {
      const first = next.el.querySelector<HTMLElement>('.hov:not([disabled])');
      first?.focus({ preventScroll: true });
    }
  }

  back(): void {
    const target = this.current?.backTo;
    if (!target) return;
    this.sound.play('back');
    void this.go(target, undefined, { back: true });
  }

  /** 설정 화면은 어디서 열었든 그 화면으로 돌아간다 */
  previousRoute(): RouteName {
    return this.history.at(-1) ?? 'main';
  }

  // ---------- 세션 ----------

  startSession(game: GameId, picks: (PlayerRecord | null)[]): void {
    const info = gameInfo(game);
    const two = info.players === 2;
    let guestNo = 0;
    const participants = picks.slice(0, info.players).map((p, i): Participant => {
      const slotColor = SLOT_COLORS[i] ?? SLOT_COLORS[0];
      const color = two && config.common.twoPlayerColors === 'pN' ? slotColor : p ? colorHex(p.color) : slotColor;
      if (!p) guestNo++;
      return {
        player: p,
        name: p ? p.name : two ? `손님 ${guestNo}` : '손님',
        color,
        photoUrl: p?.photoBlob ? URL.createObjectURL(p.photoBlob) : null,
      };
    });
    if (this.session) for (const p of this.session.participants) if (p.photoUrl) URL.revokeObjectURL(p.photoUrl);
    this.session = {
      game,
      participants,
      calibHeights: [],
      transforms: participants.map(() => new NormTransform()),
    };
  }

  // ---------- 일시정지 ----------

  setPaused(on: boolean, reason = ''): void {
    if (this.paused === on && !on) {
      $('pauseOverlay').hidden = true;
      return;
    }
    this.paused = on;
    $('pauseOverlay').hidden = !on;
    $('pauseReason').textContent = reason;
    if (on) {
      this.sound.play('pause');
      this.log(`paused ${reason}`);
      $('resumeBtn').focus({ preventScroll: true });
    }
  }

  // ---------- 매 프레임 ----------

  frame(now: number): void {
    this.renderRate.tick(now);
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      this.camRate.tick(now);
      if (this.pose.ready) {
        const r = this.pose.detect(v);
        this.inferMs = this.inferMs * 0.9 + r.inferenceMs * 0.1;
        this.poseRate.tick(now);
        this.detections++;
        const cam = r.poses.map((p) => toCameraSpace(p, this.videoAspect, this.mirror));
        let looks: ReturnType<AppearanceSampler['measure']>[] = [];
        if (r.poses.length) {
          this.looks.capture(v);
          looks = r.poses.map((p) => this.looks.measure(p));
        }
        const before = this.tracker.lastEvent;
        this.tracker.update(cam, now, this.videoAspect, looks);
        if (this.tracker.lastEvent !== before) this.log(this.tracker.lastEvent);
      }
    }

    this.current?.update?.(now);
    this.drawAvatars();
    this.updateCursors(now);
    this.drawPreview();
  }

  /** 지금 화면 규칙에 맞는 아바타 그리기 */
  private drawAvatars(): void {
    const mode = this.current?.avatarMode ?? 'none';
    const canvas = this.avatars.canvas;
    canvas.classList.toggle('dim', mode === 'menu');
    canvas.style.visibility = mode === 'none' ? 'hidden' : 'visible';
    const c = config.common;
    const list: AvatarDraw[] = [];
    this.tracker.slots.forEach((s, i) => {
      if (mode === 'game' && this.session) {
        const part = this.session.participants[i];
        if (!part) return;
        list[i] = {
          pts: s.pts && this.tracker.lostMs(s, performance.now()) < 400 ? s.pts : null,
          transform: this.session.transforms[i],
          color: part.color,
          refHeightCam: this.session.calibHeights[i] ?? null,
        };
        return;
      }
      if (!s.present || !s.pts || mode === 'none') return;
      const tf = this.liveTransforms[i];
      const m = measure(s.pts, c.minVisibility);
      const h = mode === 'calib' ? c.avatarScreenHeight : c.menuAvatarScreenHeight;
      tf.follow(m, this.videoAspect, this.avatars.aspect, h, FLOOR_Y);
      const color = this.current?.name === 'calib' && this.session ? (this.session.participants[i]?.color ?? SLOT_COLORS[i]) : SLOT_COLORS[i];
      list[i] = { pts: s.pts, transform: tf, color, refHeightCam: null };
    });
    for (const [i, tf] of this.liveTransforms.entries()) if (!this.tracker.slots[i].present) tf.reset();
    this.avatars.setFloor(FLOOR_Y, mode === 'game' || mode === 'calib');
    this.avatarInfo = this.avatars.draw(list, c.minVisibility);
    this.drawTags(mode);
  }

  private drawTags(mode: AvatarMode): void {
    this.tagEls.forEach((tag, i) => {
      const info = this.avatarInfo[i];
      const part = this.session?.participants[i];
      if (mode !== 'game' || !part || !info?.visible) {
        tag.hidden = true;
        return;
      }
      const key = `${part.name}|${part.color}|${i}`;
      if (tag.dataset.key !== key) {
        tag.dataset.key = key;
        tag.style.setProperty('--tc', part.color);
        tag.innerHTML = '';
        if (part.photoUrl) {
          const img = document.createElement('img');
          img.src = part.photoUrl;
          tag.appendChild(img);
        } else {
          const ph = document.createElement('span');
          ph.className = 'ph';
          ph.textContent = '🙂';
          tag.appendChild(ph);
        }
        const b = document.createElement('b');
        b.textContent = `P${i + 1}`;
        tag.append(b, document.createTextNode(part.name));
      }
      const p = this.avatars.toScreen({ x: info.headTop.x, y: info.headTop.y + 0.02 });
      tag.hidden = false;
      tag.style.left = `${p.x}px`;
      tag.style.top = `${p.y}px`;
    });
  }

  private updateCursors(now: number): void {
    const overlayOpen = !$('pauseOverlay').hidden;
    const scope = overlayOpen ? $('pauseOverlay') : (this.current?.el ?? null);
    const pts: (CursorPoint | null)[] = this.tracker.slots.map((s, i) => {
      if (!s.present || !s.pts) return this.cursors[i].update(null);
      // 놀이터(게임 중)에서는 멈춤 버튼·일시정지 창에만 커서를 쓴다.
      return this.cursors[i].update(s.pts);
    });
    this.tracker.slots.forEach((_, i) => {
      const color = this.current?.avatarMode === 'game' && this.session?.participants[i] ? this.session.participants[i].color : SLOT_COLORS[i];
      this.hover.setColor(i, color);
    });
    // 뒤로·설정 버튼은 화면 밖에 있으므로 함께 범위에 넣는다.
    this.hover.update(pts, now, scope ? new ScopeUnion(scope, overlayOpen) : null);
  }

  // ---------- 원본 카메라 미리보기 (FR-COM-13) ----------

  get previewVisible(): boolean {
    return this.previewPref || Boolean(this.current?.forcePreview);
  }

  setPreview(on: boolean): void {
    this.previewPref = on;
    localStorage.setItem('popstar.preview', on ? '1' : '0');
    ($('previewToggle') as HTMLInputElement).checked = on;
  }

  private drawPreview(): void {
    const box = $('preview');
    const show = this.previewVisible && this.video.readyState >= 2;
    box.hidden = !show;
    if (!show) return;
    const cv = this.previewCanvas;
    const w = 320;
    const h = Math.round(w / this.videoAspect);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const g = this.previewCtx;
    g.save();
    if (this.mirror) {
      g.translate(w, 0);
      g.scale(-1, 1);
    }
    g.drawImage(this.video, 0, 0, w, h);
    g.restore();
    // 관절 점(카메라 좌표 → 미리보기 픽셀)
    const k = h; // 카메라 단위 1 = 영상 높이
    this.tracker.slots.forEach((s, i) => {
      if (!s.present || !s.pts) return;
      g.fillStyle = SLOT_COLORS[i];
      for (const idx of [LM.nose, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
        const p: Pt = s.pts[idx];
        if (p.v < 0.3) continue;
        g.beginPath();
        g.arc(p.x * k, p.y * k, 3, 0, Math.PI * 2);
        g.fill();
      }
      const a = s.pts[LM.nose];
      g.font = 'bold 16px sans-serif';
      g.fillText(`P${i + 1}`, a.x * k + 6, a.y * k - 6);
    });
    $('previewInfo').textContent = `${this.sourceLabel} · ${this.poseRate.rate(performance.now())}fps`;
  }
}

/** 지금 화면 + 공통 모서리 버튼(뒤로·설정)을 하나의 범위처럼 다룬다 */
class ScopeUnion {
  constructor(private scope: HTMLElement, private overlayOnly: boolean) {}
  contains(el: Node): boolean {
    if (this.scope.contains(el)) return true;
    if (this.overlayOnly) return false;
    const id = (el as HTMLElement).id;
    return id === 'backBtn' || id === 'gearBtn';
  }
}
