// Popstar 시작점: 설정을 읽고, 화면을 등록하고, 영상 입력·자세 인식을 켜고, 매 프레임 갱신한다.

import './style.css';
import { $, App, type RouteName } from './app';
import { GAMES, PLAYER_COLORS, config, loadConfig, type GameId } from './config';
import { addPlayer, listPlayers } from './data/db';
import { savedCameraId, listCameras } from './pose/camera';
import { AddPlayerScreen, CalibScreen, GamesScreen, HallScreen, MainScreen, PlayScreen, SelectScreen } from './ui/screens';
import { SettingsScreen } from './ui/settings';
import { BalloonScreen } from './ui/balloonScreen';
import { WallScreen } from './ui/wallScreen';
import { PlayersScreen } from './ui/playersScreen';
import { FishingScreen } from './ui/fishingScreen';

/** 검증용: 시험 플레이어를 만들었으면 손님 대신 그 플레이어로 시작한다 */
let seeded = false;

async function boot(): Promise<void> {
  await loadConfig();
  const app = new App();
  await app.sound.init();

  const select = new SelectScreen(app);
  const settings = new SettingsScreen(app);
  app.register(new MainScreen(app));
  app.register(new GamesScreen(app));
  app.register(select);
  app.register(new AddPlayerScreen(app));
  app.register(new HallScreen(app));
  app.register(new CalibScreen(app));
  app.register(new PlayScreen(app));
  app.register(new BalloonScreen(app));
  app.register(new PlayersScreen(app));
  const wall = new WallScreen(app);
  app.register(wall);
  const fishing = new FishingScreen(app);
  app.register(fishing);
  app.register(settings);

  $('backBtn').addEventListener('click', () => app.back());
  $('gearBtn').addEventListener('click', () => void app.go('settings'));
  $('selectManage').addEventListener('click', () => void app.go('players'));
  $('settingsPlayers').addEventListener('click', () => void app.go('players'));
  $('camViewBtn').addEventListener('click', () => app.setPreview(!app.previewVisible));
  $('handBtn').addEventListener('click', () => app.setHandCursor(!app.handCursorOn));
  app.refreshTools();
  // 일시정지 창(모든 게임 화면 공통)
  $('resumeBtn').addEventListener('click', () => {
    app.setPaused(false);
    app.sound.play('select');
  });
  $('quitBtn').addEventListener('click', () => {
    app.setPaused(false);
    void app.go('main', undefined, { back: true });
  });
  setupKeyboard(app);

  // 매 프레임
  const loop = (now: number) => {
    app.frame(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const api = window.popstar;
  const test = api ? await api.getTestConfig() : null;
  if (test?.seedPlayers) await seedPlayers(test.seedPlayers);
  seeded = Boolean(test?.seedPlayers);

  await app.go('main');
  // 개발 모드(npm run dev / web)에서는 콘솔에서 앱을 살펴볼 수 있게 한다.
  if (import.meta.env.DEV) Object.assign(window, { __popstar: { app, settings, select } });

  // 영상 입력: --test-video 가 있으면 그 동영상, 아니면 지난번 카메라(FR-COM-01)
  const modelReady = settings.initModel();
  const tv = api ? await api.getTestVideo() : null;
  if (tv) {
    const ext = tv.name.split('.').pop()?.toLowerCase();
    const type = ext === 'mp4' || ext === 'm4v' ? 'video/mp4' : ext === 'mov' ? 'video/quicktime' : 'video/webm';
    await settings.openFile(new File([new Uint8Array(tv.data)], tv.name, { type }));
    api!.sendMetrics(`test video: ${tv.name} (${(tv.data.byteLength / 1e6).toFixed(1)} MB) ${app.video.videoWidth}x${app.video.videoHeight}`);
  } else {
    let cams: Awaited<ReturnType<typeof listCameras>> = [];
    try {
      cams = await listCameras();
    } catch {
      /* 무시 */
    }
    if (cams.length) await settings.startCamera(savedCameraId());
    else settings.status('카메라가 없어요 · ⚙️ 설정에서 동영상 파일을 고를 수 있어요');
  }
  await modelReady;
  await settings.refreshCameraList();

  if (test?.botHands) app.testBot = true;
  if (test?.botOnly) app.testBotOnly = true;
  if (test?.botHands) fishing.testBot = true;
  if (test?.wallPoses) wall.testPoses = test.wallPoses.split(',').map((x) => x.trim()).filter(Boolean);
  // 자동 실행(--start)에서는 확인 버튼(보정 결과 등)을 잠시 뒤 자동으로 누른다
  if (test?.startRoute) app.testAuto = true;
  if (test?.mirror === '0' || test?.mirror === '1') app.mirror = test.mirror === '1';
  if (test?.preview === '0' || test?.preview === '1') app.previewPref = test.preview === '1';
  if (test?.hand === '0' || test?.hand === '1') {
    app.handCursorOn = test.hand === '1';
    app.refreshTools();
  }
  if (api && test?.record) void recordWindow(api, test.record);
  if (api && test) await setupTestHooks(app, settings, select, test.captureTitle, test.logMetrics, test.startRoute);
}

// ---------- 키보드 (FR-COM-21) ----------
// 화살표: 가까운 버튼으로 이동, Enter/Space: 누르기(브라우저 기본), Esc: 뒤로, V: 미리보기, M: 소리 끄기

function setupKeyboard(app: App): void {
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    const typing = tag === 'INPUT' && (e.target as HTMLInputElement).type === 'text';
    if (typing) return;
    if (app.current?.onKey?.(e)) return;
    if (e.key === 'Escape') {
      if (!$('capturePicker').hidden) return;
      app.back();
      e.preventDefault();
    } else if (e.key.startsWith('Arrow')) {
      if (tag === 'SELECT' || (tag === 'INPUT' && (e.target as HTMLInputElement).type === 'range')) return;
      moveFocus(app, e.key);
      e.preventDefault();
    } else if (e.key === 'v' || e.key === 'V') {
      app.setPreview(!app.previewVisible);
    } else if (e.key === 'h' || e.key === 'H') {
      app.setHandCursor(!app.handCursorOn);
    } else if (e.key === 'm' || e.key === 'M') {
      app.sound.setMuted(!app.sound.muted);
    }
  });
}

function moveFocus(app: App, key: string): void {
  const scope = $('pauseOverlay').hidden ? app.current?.el : $('pauseOverlay');
  if (!scope) return;
  const items = [...scope.querySelectorAll<HTMLElement>('.hov:not([disabled])'), $('backBtn'), $('gearBtn')].filter(
    (e) => !e.hidden && !e.closest('[hidden]') && e.offsetParent !== null,
  );
  if (!items.length) return;
  const cur = document.activeElement as HTMLElement;
  if (!items.includes(cur)) {
    items[0].focus();
    return;
  }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key] ?? [0, 0];
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const it of items) {
    if (it === cur) continue;
    const b = it.getBoundingClientRect();
    const dx = b.left + b.width / 2 - cx;
    const dy = b.top + b.height / 2 - cy;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 1) continue;
    const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = it;
    }
  }
  best?.focus();
}

// ---------- 시험용 플레이어 ----------

async function seedPlayers(n: number): Promise<void> {
  const names = ['하늘', '바다', '별이', '구름', '도토리', '콩이', '단비', '보라'];
  const faces = ['😀', '😎', '🤩', '😺', '🐻', '🐰', '🦊', '🐼'];
  const existing = await listPlayers();
  for (let i = 0; i < Math.min(n, names.length); i++) {
    if (existing.some((p) => p.name === names[i])) continue;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = PLAYER_COLORS[i % 8].hex;
    g.fillRect(0, 0, 256, 256);
    g.font = '170px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(faces[i], 128, 140);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
    await addPlayer({ name: names[i], photoBlob: blob, color: PLAYER_COLORS[i % 8].id });
  }
}

// ---------- 테스트 지원 (Electron 실행 옵션으로만 켜짐) ----------

async function setupTestHooks(
  app: App,
  settings: SettingsScreen,
  select: SelectScreen,
  captureTitle: string | null,
  logMetrics: boolean,
  startRoute: string | null,
): Promise<void> {
  const api = window.popstar!;

  if (logMetrics) {
    const sounds: string[] = [];
    app.sound.onEvent = (n) => sounds.push(n);
    setInterval(() => {
      const now = performance.now();
      const t = app.tracker;
      const slots = t.slots
        .map((s, i) => {
          if (!s.pts) return `P${i + 1}[-]`;
          const info = app.avatarInfo[i];
          const lost = t.lostMs(s, now);
          return (
            `P${i + 1}[${s.present ? 'on' : `lost ${Math.round(lost)}ms`} x=${s.anchor!.x.toFixed(2)}` +
            (info?.visible ? ` drawnH=${info.drawnHeight.toFixed(3)} headX=${info.headTop.x.toFixed(2)}` : '') +
            (s.look ? ` look=${hex(s.look.slice(0, 3))}/${hex(s.look.slice(3))}` : '') +
            `]`
          );
        })
        .join(' ');
      const cursors = app.hover.last
        .map((c, i) => (c ? `C${i + 1}(${Math.round(c.x)},${Math.round(c.y)})->${c.target}@${c.progress.toFixed(2)}` : `C${i + 1}-`))
        .join(' ');
      api.sendMetrics(
        [
          `screen=${app.current?.name}`,
          `t=${app.video.currentTime.toFixed(1)}`,
          `cam=${app.camRate.rate(now)}fps`,
          `pose=${app.poseRate.rate(now)}fps`,
          `infer=${app.inferMs.toFixed(1)}ms`,
          `frame=${app.frameMs.toFixed(1)}ms`,
          app.detectGapMs ? `detectGap=${app.detectGapMs.toFixed(0)}ms` : '',
          (() => {
            const p = app.prof;
            const s = `prof[detect=${p.detect.toFixed(0)} look=${p.look.toFixed(0)} update=${p.update.toFixed(0)} draw=${p.draw.toFixed(0)} ui=${p.ui.toFixed(0)}ms/s frames=${p.frames} maxGap=${p.maxGap.toFixed(0)}ms]`;
            app.prof = { detect: 0, look: 0, update: 0, draw: 0, ui: 0, frames: 0, maxGap: 0 };
            return s;
          })(),
          `render=${app.renderRate.rate(now)}fps`,
          `people=${t.presentCount}`,
          `cands=[${app.lastCandidates}]`,
          slots,
          cursors,
          app.paused ? 'PAUSED' : '',
          app.current?.debug?.() ?? '',
          sounds.length ? `sfx=${sounds.splice(0).join(',')}` : '',
          app.events.length ? `events=[${app.events.splice(0).join('; ')}]` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    }, 1000);
  }

  if (captureTitle) {
    const wanted = captureTitle.toLowerCase();
    for (let i = 0; i < 30; i++) {
      const src = (await api.listCaptureSources()).find((x) => x.name.toLowerCase().includes(wanted));
      if (src) {
        await settings.startCapture(src);
        api.sendMetrics(`capture source selected: ${src.name}`);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
      if (i === 29) api.sendMetrics(`capture source not found: ${captureTitle}`);
    }
  }

  if (startRoute) {
    const [route, arg] = startRoute.split(':');
    const game = (GAMES.some((g) => g.id === arg) ? arg : 'balloon-coop') as GameId;
    if (route === 'select') await app.go('select', game);
    else if (route === 'calib' || route === 'play' || route === 'balloon' || route === 'fishing') {
      await app.go('games', GAMES.find((g) => g.id === game)?.family);
      await app.go('select', game);
      if (seeded) await select.fillPlayers();
      else select.fillGuests();
      $('selectStart').click();
    } else await app.go(route as RouteName, arg);
    api.sendMetrics(`start route: ${startRoute} (config hover=${config.common.hoverSelectMs}ms)`);
  }
}

/** README용: 앱 창 자신을 녹화해 파일로 저장한다(--record) */
async function recordWindow(api: NonNullable<Window['popstar']>, opt: { delay: number; sec: number; mp4: boolean }): Promise<void> {
  await new Promise((r) => setTimeout(r, opt.delay * 1000));
  await api.selectCaptureSource('self');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
  const types = opt.mp4 ? ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9'] : ['video/webm;codecs=vp9', 'video/webm'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(500);
  api.sendMetrics(`record start ${mimeType}`);
  await new Promise((r) => setTimeout(r, opt.sec * 1000));
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  await api.saveRecording(new Uint8Array(await new Blob(chunks).arrayBuffer()));
}

function hex(rgb: number[]): string {
  if (rgb.some(Number.isNaN)) return '-';
  return '#' + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

void boot();
