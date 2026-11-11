import { DEFAULT_BALLOON, type BalloonParams } from './game/balloon/logic';
import { DEFAULT_WALL, type WallParams } from './game/wall/geometry';

// public/config/game.config.json 을 읽는다(SRS 6장). 값을 바꾸고 새로고침하면 반영된다.
// 1단계(공통 기반)는 common 항목만 쓰고, wall/balloon 은 그대로 보관해 다음 단계에서 쓴다.

export interface CursorZoneConfig {
  /** 손 커서 영역 너비(몸통 길이 배수) */
  width: number;
  /** 손 커서 영역 높이(몸통 길이 배수) */
  height: number;
  /** 영역 가운데를 어깨에서 바깥쪽으로 옮기는 정도(몸통 길이 배수) */
  outward: number;
  /** 영역 가운데를 어깨에서 위로 옮기는 정도(몸통 길이 배수) */
  up: number;
}

export interface CommonConfig {
  maxPlayers: number;
  mirror: boolean;
  hoverSelectMs: number;
  lostPlayerPauseMs: number;
  avatarStyle: 'capsule' | 'silhouette';
  volume: { music: number; sfx: number };
  /** 보정 후 아바타 키(화면 높이 대비) */
  avatarScreenHeight: number;
  /** 메뉴 화면에 비치는 아바타 키(화면 높이 대비) */
  menuAvatarScreenHeight: number;
  /** 보정 자세 유지 시간 */
  calibHoldMs: number;
  /** 2인일 때 아바타 색: pN = P1 파랑·P2 빨강(FR-COM-04), player = 플레이어가 고른 색 */
  twoPlayerColors: 'pN' | 'player';
  /** 관절 좌표 부드럽게(0 = 그대로, 1에 가까울수록 많이) */
  smoothing: number;
  minVisibility: number;
  cursorZone: CursorZoneConfig;
  photoCountdownSec: number;
}

export interface GameConfig {
  common: CommonConfig;
  wall: WallParams;
  balloon: BalloonParams;
}

const DEFAULTS: GameConfig = {
  common: {
    maxPlayers: 2,
    mirror: true,
    hoverSelectMs: 1500,
    lostPlayerPauseMs: 2000,
    avatarStyle: 'capsule',
    volume: { music: 0.6, sfx: 0.9 },
    avatarScreenHeight: 0.6,
    menuAvatarScreenHeight: 0.42,
    calibHoldMs: 2000,
    twoPlayerColors: 'pN',
    smoothing: 0.5,
    minVisibility: 0.5,
    cursorZone: { width: 1.7, height: 1.25, outward: 0.35, up: 0.25 },
    photoCountdownSec: 3,
  },
  wall: DEFAULT_WALL,
  balloon: DEFAULT_BALLOON,
};

export let config: GameConfig = structuredClone(DEFAULTS);

export async function loadConfig(): Promise<GameConfig> {
  try {
    const res = await fetch(new URL('config/game.config.json', document.baseURI), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as Partial<GameConfig>;
    config = {
      common: {
        ...DEFAULTS.common,
        ...json.common,
        volume: { ...DEFAULTS.common.volume, ...json.common?.volume },
        cursorZone: { ...DEFAULTS.common.cursorZone, ...json.common?.cursorZone },
      },
      wall: mergeWall(json.wall),
      balloon: mergeBalloon(json.balloon),
    };
  } catch (err) {
    console.warn('설정 파일을 읽지 못해 기본값을 씁니다.', err);
    config = structuredClone(DEFAULTS);
  }
  return config;
}

/** 풍선 설정은 한 단계 안쪽 객체까지 기본값과 합친다(일부만 적어도 되게) */
function mergeBalloon(b: Partial<BalloonParams> | undefined): BalloonParams {
  const d = structuredClone(DEFAULT_BALLOON);
  if (!b) return d;
  return {
    ...d,
    ...b,
    start: { ...d.start, ...b.start },
    perStage: { ...d.perStage, ...b.perStage },
    limits: { ...d.limits, ...b.limits },
    specialRatio: { ...d.specialRatio, ...b.specialRatio },
    points: { ...d.points, ...b.points },
    combo: b.combo ?? d.combo,
  };
}

function mergeWall(w: Partial<WallParams> | undefined): WallParams {
  const d = structuredClone(DEFAULT_WALL);
  if (!w) return d;
  return {
    ...d,
    ...w,
    wallCount: { ...d.wallCount, ...w.wallCount },
    grid: { ...d.grid, ...w.grid },
    wallSize: { ...d.wallSize, ...w.wallSize },
    approachSec: { ...d.approachSec, ...w.approachSec },
    holeMarginBubbles: { ...d.holeMarginBubbles, ...w.holeMarginBubbles },
    grades: { ...d.grades, ...w.grades },
    fillGrades: { ...d.fillGrades, ...w.fillGrades },
  };
}

// ---------- 게임 종류 ----------

export type GameId = 'wall' | 'balloon-1p' | 'balloon-coop' | 'balloon-versus';

export interface GameInfo {
  id: GameId;
  name: string;
  sub: string;
  icon: string;
  players: 1 | 2;
}

export const GAMES: GameInfo[] = [
  { id: 'wall', name: '벽 뚫고 지나가기', sub: '1인', icon: '🧱', players: 1 },
  { id: 'balloon-1p', name: '풍선 터뜨리기', sub: '1인', icon: '🎈', players: 1 },
  { id: 'balloon-coop', name: '풍선 터뜨리기', sub: '2인 협동', icon: '🤝', players: 2 },
  { id: 'balloon-versus', name: '풍선 터뜨리기', sub: '2인 대결', icon: '⚔️', players: 2 },
];

export function gameInfo(id: GameId): GameInfo {
  return GAMES.find((g) => g.id === id) ?? GAMES[0];
}

// ---------- 색 ----------

/** P1 파랑, P2 빨강 (FR-COM-04) */
export const SLOT_COLORS = ['#2f80ff', '#ff3b4e'] as const;

/** 플레이어가 고를 수 있는 아바타 색 8가지 (FR-PLY-03) */
export const PLAYER_COLORS = [
  { id: 'blue', hex: '#2f80ff', name: '파랑' },
  { id: 'red', hex: '#ff3b4e', name: '빨강' },
  { id: 'yellow', hex: '#ffc928', name: '노랑' },
  { id: 'green', hex: '#2fcf6b', name: '초록' },
  { id: 'purple', hex: '#9b5cff', name: '보라' },
  { id: 'orange', hex: '#ff8a2a', name: '주황' },
  { id: 'pink', hex: '#ff6fc1', name: '분홍' },
  { id: 'sky', hex: '#28d2e6', name: '하늘' },
] as const;
