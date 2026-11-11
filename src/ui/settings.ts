// 설정 화면: 카메라 선택(FR-COM-01), 출력 모니터·전체화면, 미리보기, 거울 반전, 볼륨(FR-COM-32), 크레딧(FR-COM-31).
// 카메라가 없을 때를 위해 동영상 파일·화면 캡처 입력도 고를 수 있다(테스트용).

import { $, App, type Screen } from '../app';
import { listCameras, savedCameraId } from '../pose/camera';
import type { ModelKind } from '../pose/poseTracker';
import type { CaptureSource, DisplayInfo } from '../types/popstar';
import { toast } from './screens';

const FILE = '__file';
const CAPTURE = '__capture';

export class SettingsScreen implements Screen {
  readonly name = 'settings' as const;
  readonly el = $('scr-settings');
  readonly avatarMode = 'menu' as const;
  readonly backTo = 'main' as const;
  private camSelect = $<HTMLSelectElement>('camSelect');
  private resSelect = $<HTMLSelectElement>('resSelect');
  private fileInput = $<HTMLInputElement>('fileInput');
  private captureId: string | null = null;

  constructor(private app: App) {
    this.resSelect.value = localStorage.getItem('popstar.res') ?? '1280x720';
    this.camSelect.addEventListener('change', () => void this.onSourceChange());
    this.resSelect.addEventListener('change', () => {
      localStorage.setItem('popstar.res', this.resSelect.value);
      if (app.camera.kind === 'camera') void this.startCamera(this.camSelect.value);
    });
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      if (f) void this.openFile(f);
      this.fileInput.value = '';
    });

    const model = $<HTMLSelectElement>('modelSelect');
    model.value = app.modelKind;
    model.addEventListener('change', () => {
      app.modelKind = model.value as ModelKind;
      localStorage.setItem('popstar.model', app.modelKind);
      void this.initModel();
    });

    const prev = $<HTMLInputElement>('previewToggle');
    prev.checked = app.previewPref;
    prev.addEventListener('change', () => app.setPreview(prev.checked));
    const mirror = $<HTMLInputElement>('mirrorToggle');
    mirror.checked = app.mirror;
    mirror.addEventListener('change', () => {
      app.mirror = mirror.checked;
      localStorage.setItem('popstar.mirror', mirror.checked ? '1' : '0');
    });

    const music = $<HTMLInputElement>('musicVol');
    const sfx = $<HTMLInputElement>('sfxVol');
    music.value = String(Math.round(app.sound.musicVolume * 100));
    sfx.value = String(Math.round(app.sound.sfxVolume * 100));
    music.addEventListener('input', () => app.sound.setMusicVolume(Number(music.value) / 100));
    sfx.addEventListener('input', () => app.sound.setSfxVolume(Number(sfx.value) / 100));
    sfx.addEventListener('change', () => app.sound.play('select'));

    // 동영상 파일 재생 조절
    const play = $<HTMLButtonElement>('filePlay');
    const seek = $<HTMLInputElement>('fileSeek');
    play.addEventListener('click', () => {
      const v = app.video;
      if (v.paused) void v.play();
      else v.pause();
      play.textContent = v.paused ? '▶' : '⏸';
    });
    seek.addEventListener('input', () => {
      const v = app.video;
      if (v.duration) v.currentTime = (Number(seek.value) / 1000) * v.duration;
    });
    app.video.addEventListener('timeupdate', () => {
      const v = app.video;
      if (v.duration && document.activeElement !== seek) seek.value = String(Math.round((v.currentTime / v.duration) * 1000));
    });

    // 동영상은 창에 끌어다 놓아도 열린다.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f && (f.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(f.name))) void this.openFile(f);
    });

    this.setupDisplays();
    const credits = app.sound.credits;
    if (credits.length) $('creditList').textContent = credits.join(' · ');
  }

  async enter(): Promise<void> {
    await this.refreshCameraList();
    await this.refreshDisplays();
  }

  // ---------- 영상 입력 ----------

  async refreshCameraList(): Promise<void> {
    let cams: { deviceId: string; label: string }[] = [];
    try {
      cams = await listCameras();
    } catch {
      /* 카메라 목록을 못 읽으면 파일·캡처만 */
    }
    const sel = this.camSelect;
    sel.innerHTML = '';
    for (const c of cams) sel.add(new Option(`📷 ${c.label}`, c.deviceId));
    sel.add(new Option('🎞 동영상 파일…', FILE));
    if (window.popstar) sel.add(new Option('🖥 화면/창 캡처…', CAPTURE));
    const k = this.app.camera.kind;
    sel.value = k === 'file' ? FILE : k === 'capture' ? CAPTURE : (savedCameraId() ?? cams[0]?.deviceId ?? FILE);
    $('fileControls').hidden = k !== 'file';
  }

  private async onSourceChange(): Promise<void> {
    const v = this.camSelect.value;
    if (v === FILE) this.fileInput.click();
    else if (v === CAPTURE) await this.pickCapture();
    else await this.startCamera(v);
  }

  async startCamera(deviceId: string | null): Promise<boolean> {
    const [w, h] = (localStorage.getItem('popstar.res') ?? '1280x720').split('x').map(Number);
    try {
      this.app.source = await this.app.camera.start(deviceId, w, h);
      this.app.sourceLabel = this.app.source.label || '카메라';
      this.status(`카메라: ${this.app.sourceLabel} (${this.app.source.width}×${this.app.source.height})`);
      $('fileControls').hidden = true;
      return true;
    } catch (err) {
      console.warn('카메라를 열지 못했습니다', err);
      this.status('카메라를 열지 못했어요. 설정에서 다른 카메라나 동영상 파일을 고르세요.');
      return false;
    }
  }

  async openFile(f: File): Promise<void> {
    try {
      this.app.source = await this.app.camera.startFile(f);
      this.app.sourceLabel = f.name;
      this.app.tracker.slots.forEach((s) => this.app.tracker.clear(s));
      this.status(`동영상: ${f.name} (${this.app.source.width}×${this.app.source.height})`);
      $('fileControls').hidden = false;
      await this.refreshCameraList();
    } catch (err) {
      this.status(String((err as Error).message));
    }
  }

  private async pickCapture(): Promise<void> {
    const api = window.popstar;
    if (!api) return;
    const src = await showCapturePicker(await api.listCaptureSources());
    if (!src) {
      await this.refreshCameraList();
      return;
    }
    await this.startCapture(src);
  }

  async startCapture(src: CaptureSource): Promise<void> {
    const api = window.popstar!;
    this.captureId = src.id;
    await api.selectCaptureSource(src.id);
    try {
      this.app.source = await this.app.camera.startDisplay(() => this.status('캡처가 끝났어요'));
      this.app.sourceLabel = src.name;
      this.status(`캡처: ${src.name}`);
    } catch (err) {
      this.status(`캡처 실패: ${(err as Error).message}`);
    }
    await this.refreshCameraList();
  }

  get captureSourceId(): string | null {
    return this.captureId;
  }

  async initModel(): Promise<void> {
    this.status('인식 모델 준비 중…');
    try {
      const used = await this.app.pose.init(this.app.modelKind, 'GPU', 2);
      this.status(`인식 모델: ${this.app.modelKind} (${used})`);
    } catch (err) {
      console.error(err);
      this.status('인식 모델을 불러오지 못했어요. npm run setup:assets 를 실행해 보세요.');
    }
  }

  status(text: string): void {
    $('settingsStatus').textContent = text;
    $('status').textContent = text;
  }

  // ---------- 출력 모니터 ----------

  private setupDisplays(): void {
    const api = window.popstar;
    if (!api) {
      $('displaySelect').closest('label')!.hidden = true;
      $('moveBtn').parentElement!.hidden = true;
      return;
    }
    $('moveBtn').addEventListener('click', async () => {
      const id = Number($<HTMLSelectElement>('displaySelect').value);
      const st = await api.getWindowState();
      await api.moveToDisplay(id, st?.fullscreen ?? true);
      toast('모니터를 옮겼어요');
    });
    $('fsBtn').addEventListener('click', async () => {
      const st = await api.getWindowState();
      await api.setFullscreen(!st?.fullscreen);
    });
    api.onDisplaysChanged((d) => this.fillDisplays(d));
    api.onWindowState(() => void this.refreshDisplays());
  }

  private async refreshDisplays(): Promise<void> {
    const api = window.popstar;
    if (api) this.fillDisplays(await api.listDisplays());
  }

  private fillDisplays(list: DisplayInfo[]): void {
    const sel = $<HTMLSelectElement>('displaySelect');
    sel.innerHTML = '';
    list.forEach((d, i) => {
      const o = new Option(`${i + 1}. ${d.label} (${d.width}×${d.height})${d.primary ? ' · 주 모니터' : ''}${d.current ? ' · 지금' : ''}`, String(d.id));
      sel.add(o);
      if (d.current) sel.value = String(d.id);
    });
  }
}

/** 캡처할 화면/창 선택 창. 고르면 그 소스를, 취소하면 null을 돌려준다. */
function showCapturePicker(sources: CaptureSource[]): Promise<CaptureSource | null> {
  const modal = $('capturePicker');
  const list = $('captureList');
  const cancel = $<HTMLButtonElement>('captureCancel');
  list.innerHTML = '';
  return new Promise((resolve) => {
    const done = (v: CaptureSource | null) => {
      modal.hidden = true;
      cancel.onclick = null;
      resolve(v);
    };
    if (!sources.length) list.textContent = '캡처할 수 있는 화면이나 창이 없습니다.';
    for (const src of sources) {
      const b = document.createElement('button');
      b.className = 'capture-item';
      const img = document.createElement('img');
      img.src = src.thumbnail;
      img.alt = '';
      const label = document.createElement('span');
      label.textContent = `${src.kind === 'screen' ? '🖥' : '🗔'} ${src.name}`;
      b.append(img, label);
      b.onclick = () => done(src);
      list.appendChild(b);
    }
    cancel.onclick = () => done(null);
    modal.hidden = false;
  });
}
