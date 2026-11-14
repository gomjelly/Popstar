// 정면 테스트 영상 만들기 (Electron으로 실행). 카메라가 없는 PC에서 2인 인식·번호 유지·손 커서를 검증할 때 쓴다.
//   npm run make:video
//   npx electron scripts/make-people-video.cjs --people=1 --seconds=50 --out=test-videos/one-person.webm
//   npx electron scripts/make-people-video.cjs --script=balloon            (풍선 게임: 양팔 펴기 보정 후 손 뻗기, 40초)
//   npx electron scripts/make-people-video.cjs --script=balloon --people=1
//   ... --bystander=1   화면 가장자리에 서성이는 구경꾼을 더한다(추적 확인용)
//   npx electron scripts/make-people-video.cjs --script=fish --people=1   (낚시: 휘둘러 던지고 팔 접어 당기기, 60초)
//   npx electron scripts/make-people-video.cjs --script=wall --people=1 --hold=star   (벽 게임: 기준 자세로 보정 후 별 자세로 버팀, 120초)
// dist/tools/people-video/ 페이지를 띄워 3D 장면을 녹화하고 webm 파일로 저장한다.

const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const arg = (name, fallback) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : fallback;
};
const people = Number(arg('people', '2'));
const script = arg('script', 'basic');
const hold = arg('hold', 'stand');
const bystander = arg('bystander', '0') === '1';
const seconds = Number(arg('seconds', script === 'balloon' ? '40' : script === 'wall' ? '120' : script === 'fish' ? '60' : '50'));
const root = path.join(__dirname, '..');
const out = path.resolve(
  root,
  arg(
    'out',
    (script === 'wall' ? `test-videos/wall-${hold}` : `test-videos/${script === 'balloon' ? 'balloon-' : script === 'fish' ? 'fish-' : ''}${people === 1 ? 'one-person' : 'two-people'}`) +
      (bystander ? '-bystander' : '') +
      '.webm',
  ),
);
const DIST = path.join(root, 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

app.whenReady().then(async () => {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(DIST, rel.endsWith('/') ? `${rel}index.html` : rel));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  if (!fs.existsSync(path.join(DIST, 'tools', 'people-video', 'index.html'))) {
    console.error('dist/tools/people-video 가 없습니다. 먼저 npm run build 를 실행하세요.');
    app.exit(1);
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    useContentSize: true,
    title: 'Popstar 테스트 영상 녹화 중…',
    autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadURL(`app://local/tools/people-video/index.html?people=${people}&script=${script}&hold=${hold}&bystander=${bystander ? 1 : 0}`);
  await new Promise((r) => setTimeout(r, 800));

  console.log(`녹화 중: ${people}명, ${seconds}초 …`);
  const b64 = await win.webContents.executeJavaScript(`window.__record(${seconds})`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(out, buf);
  console.log(`저장: ${out} (${(buf.length / 1e6).toFixed(1)} MB)`);
  app.quit();
});
