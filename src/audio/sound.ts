// 효과음과 배경음악(FR-COM-30, 32).
// 1차는 파일 없이 Web Audio로 합성한다(오프라인 동작, 저작권 걱정 없음).
// 나중에 CC0 음원을 public/audio/ 에 넣고 public/audio/audio.json 에 등록하면 합성 대신 그 파일을 쓴다.
//   예) { "music": { "menu": "music/menu.mp3" }, "sfx": { "select": "sfx/select.ogg" }, "credits": ["..."] }

const PREF = { music: 'popstar.volume.music', sfx: 'popstar.volume.sfx', muted: 'popstar.muted' };

function readNum(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : Number(v);
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 무시 */
  }
}

export type SfxName =
  | 'hover' | 'select' | 'back' | 'beep' | 'go' | 'shutter' | 'cheer' | 'error' | 'pause' | 'join'
  // 풍선 게임
  | 'pop' | 'bomb' | 'gold' | 'heart' | 'clock' | 'star' | 'bubble' | 'miss' | 'lifeLost' | 'stageClear' | 'gameOver';
export type MusicName = 'menu' | 'balloon';

interface AudioManifest {
  music?: Partial<Record<MusicName, string>>;
  sfx?: Partial<Record<SfxName, string>>;
  credits?: string[];
}

export class Sound {
  private ctx: AudioContext | null = null;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private manifest: AudioManifest = {};
  private buffers = new Map<string, AudioBuffer>();
  private musicKey: string | null = null;
  private musicTimer = 0;
  private musicEl: HTMLAudioElement | null = null;
  private _music: number;
  private _sfx: number;
  private _muted = readNum(PREF.muted, 0) === 1;
  /** 검증용: 소리를 낼 때마다 이름을 알려준다 */
  onEvent?: (name: string) => void;

  constructor(defaults: { music: number; sfx: number }) {
    this._music = readNum(PREF.music, defaults.music);
    this._sfx = readNum(PREF.sfx, defaults.sfx);
  }

  get musicVolume(): number {
    return this._music;
  }
  get sfxVolume(): number {
    return this._sfx;
  }
  get muted(): boolean {
    return this._muted;
  }
  get credits(): string[] {
    return this.manifest.credits ?? [];
  }

  setMusicVolume(v: number): void {
    this._music = clamp01(v);
    write(PREF.music, String(this._music));
    this.apply();
  }
  setSfxVolume(v: number): void {
    this._sfx = clamp01(v);
    write(PREF.sfx, String(this._sfx));
    this.apply();
  }
  setMuted(m: boolean): void {
    this._muted = m;
    write(PREF.muted, m ? '1' : '0');
    this.apply();
  }

  private apply(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this._muted ? 0 : this._sfx, t, 0.03);
    this.musicGain.gain.setTargetAtTime(this._muted ? 0 : this._music * 0.35, t, 0.1);
    if (this.musicEl) this.musicEl.volume = this._muted ? 0 : this._music;
  }

  async init(): Promise<void> {
    try {
      const res = await fetch(new URL('audio/audio.json', document.baseURI), { cache: 'no-store' });
      if (res.ok) this.manifest = (await res.json()) as AudioManifest;
    } catch {
      /* 음원 목록이 없으면 합성음만 쓴다 */
    }
    this.ensure();
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain.connect(this.ctx.destination);
      this.musicGain.connect(this.ctx.destination);
      this.apply();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private async fileBuffer(rel: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(rel)) return this.buffers.get(rel)!;
    try {
      const res = await fetch(new URL(`audio/${rel}`, document.baseURI));
      if (!res.ok) return null;
      const buf = await this.ensure().decodeAudioData(await res.arrayBuffer());
      this.buffers.set(rel, buf);
      return buf;
    } catch {
      return null;
    }
  }

  // ---------- 효과음 ----------

  play(name: SfxName): void {
    const ctx = this.ensure();
    this.onEvent?.(name);
    const file = this.manifest.sfx?.[name];
    if (file) {
      void this.fileBuffer(file).then((b) => {
        if (!b) return this.synth(name, ctx);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(this.sfxGain);
        s.start();
      });
      return;
    }
    this.synth(name, ctx);
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, slideTo?: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.sfxGain);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  private noiseBurst(start: number, dur: number, gain: number, hp = 1500): void {
    const ctx = this.ctx!;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(f).connect(g).connect(this.sfxGain);
    s.start(start);
  }

  private synth(name: SfxName, ctx: AudioContext): void {
    const t = ctx.currentTime + 0.005;
    switch (name) {
      case 'hover':
        this.tone(880, t, 0.06, 'triangle', 0.12);
        break;
      case 'select':
        this.tone(660, t, 0.1, 'triangle', 0.25);
        this.tone(990, t + 0.08, 0.16, 'triangle', 0.25);
        break;
      case 'back':
        this.tone(660, t, 0.1, 'triangle', 0.2);
        this.tone(440, t + 0.08, 0.14, 'triangle', 0.2);
        break;
      case 'beep':
        this.tone(784, t, 0.18, 'square', 0.12);
        break;
      case 'go':
        this.tone(1175, t, 0.4, 'square', 0.12);
        this.tone(1568, t, 0.4, 'triangle', 0.15);
        break;
      case 'shutter':
        this.noiseBurst(t, 0.05, 0.5, 2500);
        this.noiseBurst(t + 0.07, 0.08, 0.4, 1800);
        break;
      case 'cheer':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.09, 0.3, 'triangle', 0.22));
        this.tone(1319, t + 0.4, 0.6, 'sine', 0.18);
        break;
      case 'error':
        this.tone(220, t, 0.25, 'sawtooth', 0.12, 180);
        break;
      case 'pause':
        this.tone(523, t, 0.15, 'sine', 0.25);
        this.tone(392, t + 0.13, 0.25, 'sine', 0.25);
        break;
      case 'join':
        this.tone(523, t, 0.12, 'sine', 0.2, 1047);
        break;
      case 'pop': {
        // 높이를 조금씩 바꿔 연달아 터져도 덜 지루하게
        const f = 520 + Math.random() * 260;
        this.noiseBurst(t, 0.06, 0.55, 1200);
        this.tone(f, t, 0.09, 'triangle', 0.22, f * 2.2);
        break;
      }
      case 'bubble':
        this.tone(900, t, 0.08, 'sine', 0.2, 1700);
        break;
      case 'gold':
        [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, t + i * 0.05, 0.18, 'triangle', 0.18));
        break;
      case 'heart':
        this.tone(659, t, 0.15, 'sine', 0.25);
        this.tone(988, t + 0.12, 0.3, 'sine', 0.25);
        break;
      case 'clock':
        this.tone(1200, t, 0.5, 'sine', 0.2, 300);
        break;
      case 'star':
        [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone(f, t + i * 0.04, 0.25, 'square', 0.08));
        this.noiseBurst(t, 0.3, 0.3, 3000);
        break;
      case 'bomb':
        this.noiseBurst(t, 0.5, 0.9, 80);
        this.tone(110, t, 0.5, 'sawtooth', 0.25, 40);
        break;
      case 'miss':
        this.tone(330, t, 0.18, 'triangle', 0.15, 220);
        break;
      case 'lifeLost':
        this.tone(440, t, 0.18, 'square', 0.12, 330);
        this.tone(330, t + 0.18, 0.3, 'square', 0.12, 220);
        break;
      case 'stageClear':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.1, 0.25, 'triangle', 0.22));
        break;
      case 'gameOver':
        [523, 466, 415, 349].forEach((f, i) => this.tone(f, t + i * 0.22, 0.35, 'triangle', 0.22));
        break;
    }
  }

  // ---------- 배경음악 ----------

  /** 같은 곡·같은 빠르기면 그대로 둔다. null이면 끈다. tempo는 1 = 원래 빠르기(풍선 게임은 스테이지마다 올린다) */
  music(name: MusicName | null, tempo = 1): void {
    const key = name ? `${name}@${tempo.toFixed(2)}` : null;
    if (this.musicKey === key) return;
    this.stopMusic();
    this.musicKey = key;
    if (!name) return;
    const file = this.manifest.music?.[name];
    if (file) {
      const el = new Audio(new URL(`audio/${file}`, document.baseURI).href);
      el.loop = true;
      el.playbackRate = tempo;
      el.volume = this._muted ? 0 : this._music;
      el.play().catch(() => this.startSynthMusic(name, tempo));
      this.musicEl = el;
      return;
    }
    this.startSynthMusic(name, tempo);
  }

  private stopMusic(): void {
    clearInterval(this.musicTimer);
    this.musicTimer = 0;
    this.musicEl?.pause();
    this.musicEl = null;
  }

  /** 밝은 5음 음계의 짧은 동요풍 반복(4마디). 박자마다 미리 예약한다. */
  private startSynthMusic(name: MusicName, tempo: number): void {
    const ctx = this.ensure();
    const bpm = (name === 'balloon' ? 132 : 112) * tempo;
    const beat = 60 / bpm / 2; // 8분음표
    // C 장조 5음 음계 멜로디(0 = 쉼)
    const melody =
      name === 'balloon'
        ? [72, 0, 76, 79, 76, 0, 72, 74, 76, 74, 72, 0, 69, 72, 74, 0, 72, 0, 76, 79, 81, 79, 76, 0, 74, 76, 74, 72, 69, 67, 72, 0]
        : [67, 69, 72, 0, 69, 67, 64, 0, 67, 69, 72, 74, 76, 0, 74, 72, 69, 72, 74, 0, 72, 69, 67, 0, 64, 67, 69, 67, 64, 62, 60, 0];
    const bass = name === 'balloon' ? [48, 48, 53, 53, 45, 45, 55, 55] : [48, 48, 45, 45, 53, 53, 55, 55];
    const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
    let step = 0;
    let next = ctx.currentTime + 0.1;
    const note = (freq: number, at: number, dur: number, type: OscillatorType, gain: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(gain, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g).connect(this.musicGain);
      o.start(at);
      o.stop(at + dur + 0.05);
    };
    const schedule = () => {
      while (next < ctx.currentTime + 0.4) {
        const m = melody[step % melody.length];
        if (m) note(midi(m), next, beat * 0.9, 'triangle', 0.22);
        if (step % 4 === 0) note(midi(bass[(step / 4) % bass.length]), next, beat * 3.5, 'sine', 0.3);
        if (step % 2 === 1) note(midi(84), next, 0.03, 'square', 0.025);
        step++;
        next += beat;
      }
    };
    schedule();
    this.musicTimer = window.setInterval(schedule, 100);
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}
