// Electron 메인 프로세스: 창 생성, 출력 모니터 선택, 전체화면, 카메라·화면 캡처 권한, app:// 프로토콜.
// (Wakeline electron/main.cjs 를 Popstar에 맞게 옮김)
const { app, BrowserWindow, ipcMain, screen, session, protocol, net, Menu, desktopCapturer } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const isDev = process.argv.includes('--dev');

// ---------- 테스트용 실행 옵션 (개발용) ----------
//   --test-video=<파일>        시작하면 이 동영상을 카메라 대신 입력으로 쓴다(반복 재생)
//   --test-capture=<제목 일부>  제목에 이 글자가 들어간 창을 자동으로 캡처 입력으로 고른다
//   --open-url=<주소>          테스트 영상 페이지를 보조 창으로 연다
//   --log-metrics             1초마다 인식·추적·화면 상태 요약을 터미널에 찍는다
//   --snapshot-dir=<폴더>      일정 간격으로 앱 화면을 PNG로 저장한다
//   --snapshot-interval=<ms>  스냅샷 간격(기본 5000)
//   --start=<화면>             시작 화면: main | games | hall | add-player | settings | select:<게임> | calib:<게임> | play:<게임>
//                             calib/play 는 손님으로 자동 채운다. 게임: wall | balloon-1p | balloon-coop | balloon-versus
//   --seed-players=<N>        시험용 플레이어 N명을 만든다(이미 있으면 건너뜀)
//   --bot-hands               풍선 게임에서 가장 가까운 풍선으로 움직이는 봇 손을 함께 쓴다(3스테이지 검증용)
//   --wall-poses=stand,star   벽 게임 자세를 이 목록으로 고정한다(검증용)
//   --mirror=0|1              거울 반전을 이번 실행에만 끄거나 켠다(설정은 바꾸지 않음)
//   --quit-after=<초>          그 시간이 지나면 앱을 끝낸다(자동 검증용)
//   --profile-dir=<폴더>       기록·설정을 이 폴더에 따로 저장한다(테스트 기록이 실제 기록과 섞이지 않게)
//   --window-size=1280x720    창 내용 크기
function argValue(name) {
  const prefix = `--${name}=`;
  const a = process.argv.find((x) => x.startsWith(prefix));
  return a ? a.slice(prefix.length) : null;
}
const testOpenUrl = argValue('open-url');
const testCaptureTitle = argValue('test-capture');
const logMetrics = process.argv.includes('--log-metrics');
const startRoute = argValue('start');
const seedPlayers = Number(argValue('seed-players')) || 0;
const botHands = process.argv.includes('--bot-hands');
const wallPoses = argValue('wall-poses');
const mirrorArg = argValue('mirror');
const quitAfter = Number(argValue('quit-after')) || 0;
const profileDir = argValue('profile-dir');
const testVideo = argValue('test-video');
const windowSize = (argValue('window-size') || '').split('x').map(Number);
const snapshotDir = argValue('snapshot-dir');
const snapshotInterval = Number(argValue('snapshot-interval')) || 5000;
if (profileDir) app.setPath('userData', path.resolve(profileDir));
const DEV_URL = 'http://127.0.0.1:5173';
const DIST_DIR = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// ---------- 창 설정 저장 (선택한 모니터, 전체화면 여부) ----------
const settingsPath = () => path.join(app.getPath('userData'), 'window-settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  } catch (err) {
    console.error('설정 저장 실패', err);
  }
}

// ---------- 모니터 ----------
function findDisplay(id) {
  return screen.getAllDisplays().find((d) => d.id === id) ?? null;
}

function displayOfWindow(win) {
  return screen.getDisplayMatching(win.getBounds());
}

function describeDisplays(win) {
  const primaryId = screen.getPrimaryDisplay().id;
  const currentId = win ? displayOfWindow(win).id : null;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `모니터 ${i + 1}`,
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    primary: d.id === primaryId,
    current: d.id === currentId,
  }));
}

function centeredBounds(display, width = 1280, height = 720) {
  const wa = display.workArea;
  const w = Math.min(width, wa.width);
  const h = Math.min(height, wa.height);
  return { x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + (wa.height - h) / 2), width: w, height: h };
}

function waitFor(win, event, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      win.removeListener(event, done);
      resolve();
    }
    win.once(event, done);
  });
}

async function setFullscreen(win, on) {
  if (win.isFullScreen() === on) return;
  const evt = on ? 'enter-full-screen' : 'leave-full-screen';
  const p = waitFor(win, evt);
  win.setFullScreen(on);
  await p;
  saveSettings({ fullscreen: on });
}

async function moveToDisplay(win, displayId, fullscreen) {
  const target = findDisplay(displayId);
  if (!target) return false;
  await setFullscreen(win, false);
  win.setBounds(centeredBounds(target));
  saveSettings({ displayId });
  if (fullscreen) await setFullscreen(win, true);
  return true;
}

// ---------- 창 ----------
let mainWindow = null;

function createWindow() {
  const settings = loadSettings();
  const display = findDisplay(settings.displayId) ?? screen.getPrimaryDisplay();

  mainWindow = new BrowserWindow({
    ...centeredBounds(display, windowSize[0] || 1280, windowSize[1] || 720),
    useContentSize: Boolean(windowSize[0]),
    title: 'Popstar',
    backgroundColor: '#1b1446',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      // 효과음·배경음악이 사용자 클릭 없이도(손 커서 조작, 자동 시작) 나도록
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // 자동 검증 중에는 전체화면을 건너뛴다(스냅샷 크기를 일정하게).
    if (settings.fullscreen && !snapshotDir) setFullscreen(mainWindow, true);
  });

  // F11: 전체화면 전환, F12: 개발자 도구
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault();
      setFullscreen(mainWindow, !mainWindow.isFullScreen()).then(notifyState);
    } else if (input.key === 'F12') {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('moved', notifyState);
  mainWindow.on('enter-full-screen', notifyState);
  mainWindow.on('leave-full-screen', notifyState);

  if (logMetrics) {
    mainWindow.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') console.log(`[renderer:${e.level}] ${e.message}`);
    });
  }

  if (isDev) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadURL('app://local/index.html');
}

function windowState() {
  if (!mainWindow) return null;
  return { fullscreen: mainWindow.isFullScreen(), displayId: displayOfWindow(mainWindow).id };
}

function notifyState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:state', windowState());
}

function notifyDisplays() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('displays:changed', describeDisplays(mainWindow));
}

// ---------- 화면/창 캡처 ----------
// 렌더러가 고른 소스를 기억해 두었다가 getDisplayMedia 요청이 오면 그 소스로 응답한다.
let selectedCaptureId = null;

async function captureSources(withThumbs) {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: withThumbs ? { width: 320, height: 200 } : { width: 0, height: 0 },
  });
  const selfId = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getMediaSourceId() : null;
  return sources.filter((s) => s.id !== selfId);
}

ipcMain.handle('capture:listSources', async () =>
  (await captureSources(true)).map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen') ? 'screen' : 'window',
    thumbnail: s.thumbnail.toDataURL(),
  })),
);
ipcMain.handle('capture:select', (_e, id) => {
  selectedCaptureId = id;
  return true;
});

// ---------- 테스트 지원 ----------
ipcMain.handle('test:config', () => ({
  captureTitle: testCaptureTitle,
  logMetrics,
  startRoute,
  seedPlayers,
  botHands,
  wallPoses,
  mirror: mirrorArg,
}));
ipcMain.handle('test:video', () => {
  if (!testVideo) return null;
  const file = path.resolve(testVideo);
  return { name: path.basename(file), data: fs.readFileSync(file) };
});
ipcMain.on('test:metrics', (_e, line) => {
  if (logMetrics) console.log(`[metrics] ${line}`);
});

function openTestSourceWindow() {
  if (!testOpenUrl) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    x: wa.x + 20,
    y: wa.y + 20,
    width: 960,
    height: 560,
    title: 'Popstar Test Source',
    autoHideMenuBar: true,
    webPreferences: { autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
  });
  // 페이지 제목이 바뀌지 않게 해서 --test-capture="Popstar Test Source" 로 찾을 수 있게 한다.
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.setAudioMuted(true);
  win.loadURL(testOpenUrl);
}

function startSnapshots() {
  if (!snapshotDir) return;
  fs.mkdirSync(snapshotDir, { recursive: true });
  let n = 0;
  setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const img = await mainWindow.webContents.capturePage();
    const file = path.join(snapshotDir, `snap-${String(++n).padStart(3, '0')}.png`);
    fs.writeFileSync(file, img.toPNG());
    console.log(`[snapshot] ${file}`);
  }, snapshotInterval);
}

// ---------- IPC ----------
ipcMain.handle('displays:list', () => describeDisplays(mainWindow));
ipcMain.handle('window:state', () => windowState());
ipcMain.handle('window:moveToDisplay', async (_e, displayId, fullscreen) => {
  const ok = await moveToDisplay(mainWindow, displayId, fullscreen);
  notifyState();
  return ok;
});
ipcMain.handle('window:setFullscreen', async (_e, on) => {
  await setFullscreen(mainWindow, Boolean(on));
  notifyState();
  return windowState();
});
ipcMain.handle('app:quit', () => app.quit());

// ---------- 시작 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);

    // 빌드된 파일을 app://local/... 로 제공 (fetch, WASM, 카메라 모두 secure context에서 동작)
    protocol.handle('app', (request) => {
      const { pathname } = new URL(request.url);
      const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
      const filePath = path.normalize(path.join(DIST_DIR, rel));
      if (!filePath.startsWith(DIST_DIR)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(filePath).toString());
    });

    // 카메라(media)와 화면 캡처(display-capture)만 허용한다. 영상은 저장·전송하지 않는다.
    const allowed = new Set(['media', 'display-capture']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(allowed.has(permission));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      const src = (await captureSources(false)).find((s) => s.id === selectedCaptureId);
      if (src) callback({ video: src });
      else callback({});
    });

    screen.on('display-added', notifyDisplays);
    screen.on('display-removed', notifyDisplays);
    screen.on('display-metrics-changed', notifyDisplays);

    createWindow();
    openTestSourceWindow();
    startSnapshots();
    if (quitAfter) setTimeout(() => app.quit(), quitAfter * 1000);
  });

  app.on('window-all-closed', () => app.quit());
}
