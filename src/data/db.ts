// IndexedDB 저장소(SRS 7장): halloffame, plays, snapshots, players.
// 사진은 기기 안(Electron 사용자 폴더)에만 저장하고 밖으로 보내지 않는다(NFR-04).
// 1단계는 players 를 쓰고, 나머지 저장소는 다음 단계를 위해 미리 만들어 둔다.

import { PLAYER_COLORS } from '../config';

export interface PlayerRecord {
  id: string;
  name: string;
  /** 정사각 JPEG */
  photoBlob: Blob | null;
  /** PLAYER_COLORS 의 id */
  color: string;
  createdAt: string;
  /** 최근 체형 프로필과 보정 날짜(벽 게임, FR-PLY-07) */
  bodyProfile?: Record<string, number>;
  calibratedAt?: string;
}

const DB_NAME = 'popstar';
const DB_VERSION = 1;

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('players')) {
        const s = db.createObjectStore('players', { keyPath: 'id' });
        s.createIndex('name', 'name', { unique: true });
      }
      if (!db.objectStoreNames.contains('halloffame')) {
        const s = db.createObjectStore('halloffame', { keyPath: 'id' });
        s.createIndex('game', 'game');
      }
      if (!db.objectStoreNames.contains('plays')) {
        const s = db.createObjectStore('plays', { keyPath: 'id' });
        s.createIndex('game', 'game');
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        const s = db.createObjectStore('snapshots', { keyPath: ['playId', 'index'] });
        s.createIndex('playId', 'playId');
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

// ---------- 플레이어 ----------

export async function listPlayers(): Promise<PlayerRecord[]> {
  const db = await openDb();
  const all = await req(db.transaction('players').objectStore('players').getAll() as IDBRequest<PlayerRecord[]>);
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 이름 비교: 앞뒤 공백을 없애고 대소문자를 무시한다 */
export function nameKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

/** 글자 수(한글 한 글자 = 1). 최대 8자(FR-PLY-02) */
export function nameLength(name: string): number {
  return [...name.trim().normalize('NFC')].length;
}

export const MAX_NAME = 8;

export type NameProblem = 'empty' | 'long' | 'taken' | null;

export function checkName(name: string, players: PlayerRecord[], ignoreId?: string): NameProblem {
  const n = name.trim();
  if (!n) return 'empty';
  if (nameLength(n) > MAX_NAME) return 'long';
  if (players.some((p) => p.id !== ignoreId && nameKey(p.name) === nameKey(n))) return 'taken';
  return null;
}

export async function addPlayer(p: Omit<PlayerRecord, 'id' | 'createdAt'>): Promise<PlayerRecord> {
  const players = await listPlayers();
  const problem = checkName(p.name, players);
  if (problem) throw new Error(problem);
  const rec: PlayerRecord = {
    ...p,
    name: p.name.trim().normalize('NFC'),
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const db = await openDb();
  const tx = db.transaction('players', 'readwrite');
  tx.objectStore('players').add(rec);
  await done(tx);
  return rec;
}

export async function deletePlayer(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('players', 'readwrite');
  tx.objectStore('players').delete(id);
  await done(tx);
}

/** 이미 쓰는 색을 피해 자동으로 고른다(FR-PLY-03 기본값) */
export function autoColor(players: PlayerRecord[]): string {
  const used = new Map<string, number>();
  for (const p of players) used.set(p.color, (used.get(p.color) ?? 0) + 1);
  let best: string = PLAYER_COLORS[0].id;
  let bestN = Infinity;
  for (const c of PLAYER_COLORS) {
    const n = used.get(c.id) ?? 0;
    if (n < bestN) {
      best = c.id;
      bestN = n;
    }
  }
  return best;
}

export function colorHex(id: string): string {
  return PLAYER_COLORS.find((c) => c.id === id)?.hex ?? PLAYER_COLORS[0].hex;
}

// ---------- 판 기록(plays) ----------

export interface PlayRecord {
  id: string;
  game: string;
  startedAt: string;
  endedAt: string;
  /** 총점(대결은 합계) */
  score: number;
  /** 대결: 플레이어별 점수 */
  scores: number[];
  playerIds: (string | null)[];
  playerNames: string[];
  /** 도달한 스테이지 */
  stage: number;
  stageScores: number[];
  maxCombo: number;
}

export async function savePlay(rec: PlayRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('plays', 'readwrite');
  tx.objectStore('plays').put(rec);
  await done(tx);
}
