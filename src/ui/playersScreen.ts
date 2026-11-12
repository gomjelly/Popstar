// 플레이어 관리(FR-PLY-04): 이름·색 바꾸기, 사진 다시 찍기, 삭제(명예의 전당 기록도 함께 지울지 묻는다).
// 명예의 전당은 플레이어 id로 지금 이름·색·사진을 찾아 보여 주므로 편집이 바로 반영된다.

import { $, App, type RouteName, type Screen } from '../app';
import { PLAYER_COLORS } from '../config';
import { MAX_NAME, checkName, colorHex, deletePlayer, listPlayers, nameLength, updatePlayer, type PlayerRecord } from '../data/db';
import { countHallByPlayer, deleteHallByPlayer } from '../data/hall';
import { toast } from './screens';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class PlayersScreen implements Screen {
  readonly name = 'players' as const;
  readonly el = $('scr-players');
  readonly avatarMode = 'menu' as const;
  private players: PlayerRecord[] = [];
  private current: PlayerRecord | null = null;
  private color = '';
  private urls: string[] = [];
  private from: RouteName = 'main';

  constructor(private app: App) {
    const row = $('pmColors');
    for (const c of PLAYER_COLORS) {
      const b = el('button', 'hov swatch');
      b.dataset.name = `pm-color-${c.id}`;
      b.dataset.color = c.id;
      b.title = c.name;
      b.style.setProperty('--sc', c.hex);
      b.addEventListener('click', () => this.setColor(c.id));
      row.appendChild(b);
    }
    const input = $<HTMLInputElement>('pmName');
    input.addEventListener('input', () => this.validate());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void this.save();
      if (e.key === 'Escape') this.app.back();
    });
    $('pmSave').addEventListener('click', () => void this.save());
    $('pmRetake').addEventListener('click', () => {
      if (this.current) void this.app.go('add-player', `retake:${this.current.id}`);
    });
    $('pmDelete').addEventListener('click', () => void this.askDelete());
    $('pmDelAll').addEventListener('click', () => void this.remove(true));
    $('pmDelKeep').addEventListener('click', () => void this.remove(false));
    $('pmDelCancel').addEventListener('click', () => ($('pmConfirm').hidden = true));
  }

  get backTo(): RouteName {
    return this.from;
  }

  /** arg = 처음 고를 플레이어 id(사진 다시 찍고 돌아올 때) */
  async enter(arg?: string): Promise<void> {
    const prev = this.app.previousRoute();
    if (prev !== 'add-player' && prev !== 'players') this.from = prev;
    $('pmConfirm').hidden = true;
    // 검증용(--start=players:first): 첫 플레이어를 골라 편집 화면을 연다
    await this.render(arg === 'first' ? (await listPlayers())[0]?.id : arg);
  }

  leave(): void {
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
  }

  private async render(selectId?: string): Promise<void> {
    this.leave();
    this.players = await listPlayers();
    const grid = $('pmGrid');
    grid.innerHTML = '';
    for (const p of this.players) {
      const b = el('button', 'hov player-card');
      b.dataset.name = `pm-${p.name}`;
      b.dataset.id = p.id;
      b.style.setProperty('--pc', colorHex(p.color));
      if (p.photoBlob) {
        const img = el('img');
        const u = URL.createObjectURL(p.photoBlob);
        this.urls.push(u);
        img.src = u;
        b.appendChild(img);
      } else b.appendChild(el('div', 'ph', '🙂'));
      b.appendChild(el('div', 'pname', p.name));
      b.addEventListener('click', () => this.select(p.id));
      grid.appendChild(b);
    }
    const add = el('button', 'hov player-card');
    add.dataset.name = 'pm-add';
    add.append(el('div', 'ph', '➕'), el('div', 'pname', '추가'));
    add.addEventListener('click', () => void this.app.go('add-player'));
    grid.appendChild(add);
    $('pmHint').textContent = this.players.length ? '고칠 플레이어를 골라요' : '아직 플레이어가 없어요. ➕로 추가해요';
    this.select(selectId && this.players.some((p) => p.id === selectId) ? selectId : null);
  }

  private select(id: string | null): void {
    this.current = this.players.find((p) => p.id === id) ?? null;
    $('pmGrid')
      .querySelectorAll<HTMLElement>('.player-card')
      .forEach((c) => c.classList.toggle('selected', Boolean(id) && c.dataset.id === id));
    $('pmEdit').hidden = !this.current;
    $('pmHint').hidden = Boolean(this.current);
    if (!this.current) return;
    const p = this.current;
    const photo = $<HTMLImageElement>('pmPhoto');
    if (p.photoBlob) {
      const u = URL.createObjectURL(p.photoBlob);
      this.urls.push(u);
      photo.src = u;
    } else photo.removeAttribute('src');
    $<HTMLInputElement>('pmName').value = p.name;
    this.setColor(p.color);
    this.validate();
  }

  private setColor(id: string): void {
    this.color = id;
    $('pmColors')
      .querySelectorAll<HTMLElement>('.swatch')
      .forEach((b) => b.classList.toggle('selected', b.dataset.color === id));
    $('pmPhoto').style.setProperty('--pc', colorHex(id));
  }

  private validate(): boolean {
    const v = $<HTMLInputElement>('pmName').value;
    const problem = checkName(v, this.players, this.current?.id);
    const msg: Record<string, string> = {
      empty: '이름을 키보드로 써요',
      long: `${MAX_NAME}자까지 쓸 수 있어요 (지금 ${nameLength(v)}자)`,
      taken: '이미 있는 이름이에요',
    };
    $('pmError').textContent = problem ? msg[problem] : '';
    $<HTMLButtonElement>('pmSave').disabled = Boolean(problem);
    return !problem;
  }

  private async save(): Promise<void> {
    if (!this.current || !this.validate()) return;
    const name = $<HTMLInputElement>('pmName').value.trim().normalize('NFC');
    await updatePlayer(this.current.id, { name, color: this.color });
    this.app.sound.play('select');
    toast(`${name} 저장했어요`);
    this.app.log(`player edited ${name}`);
    await this.render(this.current.id);
  }

  private async askDelete(): Promise<void> {
    if (!this.current) return;
    const n = await countHallByPlayer(this.current.id);
    $('pmConfirmTitle').textContent = `${this.current.name}을(를) 지울까요?`;
    $('pmConfirmText').textContent = n ? `명예의 전당 기록이 ${n}개 있어요. 함께 지울까요?` : '명예의 전당 기록은 없어요.';
    $('pmDelKeep').hidden = n === 0;
    $('pmDelAll').textContent = n ? '기록도 함께 지우기' : '지우기';
    $('pmConfirm').hidden = false;
    this.app.hover.suppress();
    $('pmDelCancel').focus({ preventScroll: true });
  }

  /** withRecords = 명예의 전당 기록도 지울지(남기면 기록 당시 이름으로 사진 없이 남는다) */
  private async remove(withRecords: boolean): Promise<void> {
    if (!this.current) return;
    const p = this.current;
    const removed = withRecords ? await deleteHallByPlayer(p.id) : 0;
    await deletePlayer(p.id);
    $('pmConfirm').hidden = true;
    this.app.sound.play('back');
    toast(withRecords && removed ? `${p.name}과 기록 ${removed}개를 지웠어요` : `${p.name}을(를) 지웠어요`);
    this.app.log(`player deleted ${p.name} records=${removed}`);
    await this.render();
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && !$('pmConfirm').hidden) {
      $('pmConfirm').hidden = true;
      return true;
    }
    return false;
  }
}
