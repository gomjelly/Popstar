// 명예의 전당(FR-MAIN-02, FR-WALL-41·42, FR-BAL-30·31).
// 게임 종류별로 점수 높은 순 상위 10개만 남긴다(SRS 7장). 손님끼리만 한 판은 오르지 않는다(FR-PLY-06).

import { done, openDb, req } from './db';

export interface HallRecord {
  id: string;
  game: string;
  /** 참가자 플레이어 id(손님은 null). 2인 대결은 이긴 사람이 먼저 */
  playerIds: (string | null)[];
  /** 그때의 이름(나중에 이름이 바뀌어도 기록은 그대로) */
  names: string[];
  colors: string[];
  /** 순위를 매기는 점수(1인·협동 = 총점, 대결 = 이긴 사람 점수) */
  score: number;
  /** 대결: 각자 점수(이긴 사람 먼저) */
  scores: number[];
  /** 풍선 = 도달 스테이지, 벽 = Perfect 수 */
  stage: number;
  playedAt: string;
  playId: string;
}

export const HALL_KEEP = 10;

function byRank(a: HallRecord, b: HallRecord): number {
  // 점수가 같으면 먼저 세운 기록이 앞
  return b.score - a.score || a.playedAt.localeCompare(b.playedAt);
}

export async function listHall(game: string): Promise<HallRecord[]> {
  const db = await openDb();
  const idx = db.transaction('halloffame').objectStore('halloffame').index('game');
  const rows = await req(idx.getAll(game) as IDBRequest<HallRecord[]>);
  return rows.sort(byRank);
}

/** 기록을 넣고 순위(1부터)를 돌려준다. 10위 밖이면 저장하지 않고 null */
export async function addHall(rec: HallRecord): Promise<number | null> {
  const rows = [...(await listHall(rec.game)), rec].sort(byRank);
  const rank = rows.indexOf(rec) + 1;
  if (rank > HALL_KEEP) return null;
  const db = await openDb();
  const tx = db.transaction('halloffame', 'readwrite');
  const store = tx.objectStore('halloffame');
  store.put(rec);
  for (const old of rows.slice(HALL_KEEP)) store.delete(old.id);
  await done(tx);
  return rank;
}
