// 게임이 끝나면 명예의 전당에 자동 등록하고(이름 입력 없음), 3위 안이면 결과 화면에서 축하한다(FR-WALL-41, FR-BAL-31).

import type { App, Participant } from '../app';
import { addHall } from '../data/hall';

export interface FinishedGame {
  game: string;
  participants: Participant[];
  /** 1인·협동: [총점], 대결: [P1, P2] */
  scores: number[];
  stage: number;
  playId: string;
}

/** 결과 화면 안내 요소(el)에 등록 결과를 적는다. 3위 안이면 순위를 돌려준다 */
export async function registerHall(app: App, g: FinishedGame, el: HTMLElement): Promise<number | null> {
  el.className = 'hall-msg';
  el.textContent = '';
  if (g.participants.every((p) => !p.player)) {
    el.textContent = '손님 기록은 명예의 전당에 오르지 않아요 · 플레이어를 추가하고 해 봐요';
    return null;
  }
  // 대결은 사람마다 자기 점수로 따로 오른다(등록 플레이어만). 1인·협동은 한 판에 기록 하나.
  if (g.scores.length > 1) return registerVersus(app, g, el);
  const score = g.scores[0];
  const order = g.participants.map((_, i) => i);
  try {
    const rank = await addHall({
      id: crypto.randomUUID(),
      game: g.game,
      playerIds: order.map((i) => g.participants[i].player?.id ?? null),
      names: order.map((i) => g.participants[i].name),
      colors: order.map((i) => g.participants[i].color),
      score,
      scores: [score],
      stage: g.stage,
      playedAt: new Date().toISOString(),
      playId: g.playId,
    });
    app.log(`hall ${g.game} score=${score} rank=${rank ?? '-'}`);
    if (rank && rank <= 3) {
      el.className = 'hall-msg top';
      el.textContent = `${rank === 1 ? '👑' : '🏆'} 명예의 전당 ${rank}위에 올랐어요!`;
      app.sound.play('cheer');
      return rank;
    }
    el.textContent = '3위 안에 들면 명예의 전당에 올라요';
  } catch (err) {
    console.warn('명예의 전당 저장 실패', err);
  }
  return null;
}

/** 대결: 두 사람 각자의 점수로 따로 등록. 3위 안에 든 사람을 알려 준다 */
async function registerVersus(app: App, g: FinishedGame, el: HTMLElement): Promise<number | null> {
  const msgs: string[] = [];
  let best: number | null = null;
  for (const [i, p] of g.participants.entries()) {
    if (!p.player) continue;
    try {
      const rank = await addHall({
        id: crypto.randomUUID(),
        game: g.game,
        playerIds: [p.player.id],
        names: [p.name],
        colors: [p.color],
        score: g.scores[i],
        scores: [g.scores[i]],
        stage: g.stage,
        playedAt: new Date().toISOString(),
        playId: g.playId,
      });
      app.log(`hall ${g.game} ${p.name} score=${g.scores[i]} rank=${rank ?? '-'}`);
      if (rank && rank <= 3) {
        msgs.push(`${rank === 1 ? '👑' : '🏆'} ${p.name} ${rank}위`);
        best = best === null ? rank : Math.min(best, rank);
      }
    } catch (err) {
      console.warn('명예의 전당 저장 실패', err);
    }
  }
  if (msgs.length) {
    el.className = 'hall-msg top';
    el.textContent = `명예의 전당 ${msgs.join(' · ')}!`;
    app.sound.play('cheer');
  } else el.textContent = '각자 점수로 3위 안에 들면 명예의 전당에 올라요 (손님 제외)';
  return best;
}
