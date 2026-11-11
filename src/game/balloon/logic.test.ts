// 풍선 게임 규칙 단위 테스트: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BalloonGame, DEFAULT_BALLOON, comboMultiplier, difficulty, type Balloon, type BalloonParams, type Hand, type Rect } from './logic.ts';

const AREA: Rect = { x0: -0.8, x1: 0.8, y0: 0.05, y1: 0.95 };

/** 반복 가능한 난수 */
function seeded(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function params(patch: Partial<BalloonParams> = {}): BalloonParams {
  return { ...structuredClone(DEFAULT_BALLOON), ...patch };
}

/** 일반 풍선만 나오게(특수 풍선·폭탄 없음) */
function plain(): BalloonParams {
  const p = params();
  p.start.bombRatio = 0;
  p.perStage.bombRatioAdd = 0;
  p.specialRatio = { gold: 0, heart: 0, clock: 0, star: 0, bubble: 0 };
  return p;
}

function place(g: BalloonGame, kind: Balloon['kind'], x: number, y: number): Balloon {
  const b: Balloon = { id: 900 + g.balloons.length, kind, x, baseX: x, y, r: 0.04, vy: 0, swayPhase: 0, swayAmp: 0, hue: 0, age: 0 };
  g.balloons.push(b);
  return b;
}

/** 점과 선분 사이 거리 */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
}

/** 가는 길에 폭탄이 없는 풍선 중 가장 낮은 것으로 손을 움직이는 봇(폭탄은 피한다) */
function botHands(g: BalloonGame, hands: Hand[], dt: number, speed: number): Hand[] {
  const hr = g.handRadius();
  const bombs = g.balloons.filter((b) => b.kind === 'bomb');
  return hands.map((h) => {
    const safe = (b: Balloon) => bombs.every((m) => segDist(m.x, m.y, h.x, h.y, b.x, b.y) > m.r + hr * 1.2);
    const target = g.balloons.filter((b) => b.kind !== 'bomb' && b.y < g.area.y1 && safe(b)).sort((a, b) => a.y - b.y)[0];
    // 갈 곳이 없으면 가까운 폭탄에서 멀어진다
    if (!target) {
      const m = bombs.sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0];
      if (!m || Math.hypot(m.x - h.x, m.y - h.y) > m.r + hr * 2) return h;
      const d = Math.hypot(h.x - m.x, h.y - m.y) || 1;
      return { ...h, x: h.x + ((h.x - m.x) / d) * speed * dt, y: h.y + ((h.y - m.y) / d) * speed * dt };
    }
    if (!target) return h;
    const dx = target.x - h.x;
    const dy = target.y - h.y;
    const d = Math.hypot(dx, dy);
    const step = Math.min(d, speed * dt);
    return { ...h, x: h.x + (dx / (d || 1)) * step, y: h.y + (dy / (d || 1)) * step };
  });
}

test('스테이지마다 어려워지고 상·하한을 넘지 않는다', () => {
  const p = params();
  const s1 = difficulty(p, 1);
  const s2 = difficulty(p, 2);
  assert.equal(s1.spawnIntervalMs, 450);
  assert.ok(Math.abs(s2.spawnIntervalMs - 450 * 0.88) < 1e-9);
  assert.ok(Math.abs(s2.fallSpeed - 0.25 * 1.08) < 1e-9);
  assert.ok(Math.abs(s2.bombRatio - 0.07) < 1e-9);
  const s30 = difficulty(p, 30);
  assert.equal(s30.spawnIntervalMs, 180);
  assert.equal(s30.fallSpeed, 0.7);
  assert.equal(s30.bombRatio, 0.2);
  assert.equal(s30.balloonSize, 0.09);
  assert.equal(difficulty(p, 3).wind, 0);
  assert.notEqual(difficulty(p, 4).wind, 0);
});

test('콤보 배율: 5콤보 ×1.5, 10콤보 ×2', () => {
  const p = params();
  assert.equal(comboMultiplier(p, 4), 1);
  assert.equal(comboMultiplier(p, 5), 1.5);
  assert.equal(comboMultiplier(p, 9), 1.5);
  assert.equal(comboMultiplier(p, 10), 2);
});

test('풍선은 영역 위쪽 밖에서 생겨 영역 가로 범위 안에 고르게 퍼진다', () => {
  const g = new BalloonGame({ ...plain(), missesPerLife: 1000 }, AREA, 'coop', seeded(7));
  const xs: number[] = [];
  for (let i = 0; i < 600; i++) {
    for (const e of g.update(0.05, [])) if (e.type === 'spawn') {
      xs.push(e.balloon.x);
      assert.ok(e.balloon.y > AREA.y1, '위쪽 밖에서 생김');
      assert.ok(e.balloon.baseX - e.balloon.r >= AREA.x0 - 1e-9 && e.balloon.baseX + e.balloon.r <= AREA.x1 + 1e-9);
    }
    if (g.phase !== 'playing') break;
  }
  const left = xs.filter((x) => x < 0).length;
  const right = xs.length - left;
  assert.ok(xs.length > 20);
  assert.ok(Math.abs(left - right) <= Math.max(3, xs.length * 0.15), `왼쪽 ${left} 오른쪽 ${right}`);
});

test('손이 닿으면 터지고 점수를 얻는다, 콤보가 쌓이면 배율이 붙는다', () => {
  const g = new BalloonGame(plain(), AREA, '1p', seeded(1));
  for (let i = 0; i < 12; i++) {
    const b = place(g, 'normal', 0, 0.5);
    const ev = g.update(0.001, [{ player: 0, x: b.x, y: b.y }]);
    assert.ok(ev.some((e) => e.type === 'pop'));
  }
  // 10 × 4 + 15 × 5 + 20 × 3 = 40 + 75 + 60
  assert.equal(g.scores[0], 175);
  assert.equal(g.maxCombo, 12);
});

test('놓친 일반 풍선 5개마다 목숨 1개를 잃고 콤보가 끊긴다', () => {
  const g = new BalloonGame(plain(), AREA, 'coop', seeded(2));
  g.combos[0] = 7;
  for (let i = 0; i < 5; i++) place(g, 'normal', 0, AREA.y0 - 0.2);
  const ev = g.update(0.001, []);
  assert.equal(ev.filter((e) => e.type === 'miss').length, 5);
  assert.equal(g.lives, 2);
  assert.equal(g.misses, 0);
  assert.equal(g.combos[0], 0);
});

test('폭탄을 터뜨리면 목숨 −1, 목숨이 0이면 게임 오버', () => {
  const g = new BalloonGame(plain(), AREA, '1p', seeded(3));
  for (let i = 0; i < 3; i++) {
    const b = place(g, 'bomb', 0.1, 0.5);
    g.update(0.001, [{ player: 0, x: b.x, y: b.y }]);
  }
  assert.equal(g.lives, 0);
  assert.equal(g.phase, 'over');
});

test('하트는 목숨 +1(최대 5), 시계는 느리게, 별은 일반 풍선을 모두 터뜨린다(폭탄 제외)', () => {
  const g = new BalloonGame(plain(), AREA, '1p', seeded(4));
  let b = place(g, 'heart', 0, 0.5);
  g.update(0.001, [{ player: 0, x: b.x, y: b.y }]);
  assert.equal(g.lives, 4);
  g.lives = 5;
  b = place(g, 'heart', 0, 0.5);
  g.update(0.001, [{ player: 0, x: b.x, y: b.y }]);
  assert.equal(g.lives, 5);

  b = place(g, 'clock', 0, 0.5);
  g.update(0.001, [{ player: 0, x: b.x, y: b.y }]);
  assert.ok(g.slowed);

  g.balloons = [];
  place(g, 'normal', -0.5, 0.7);
  place(g, 'normal', 0.5, 0.7);
  place(g, 'bomb', 0.3, 0.3);
  b = place(g, 'star', 0, 0.5);
  const before = g.scores[0];
  const ev = g.update(0.001, [{ player: 0, x: b.x, y: b.y }]);
  const blast = ev.find((e) => e.type === 'starBlast');
  assert.ok(blast && blast.type === 'starBlast' && blast.popped.length === 2);
  assert.ok(g.scores[0] > before);
  assert.equal(g.balloons.filter((x) => x.kind === 'bomb').length, 1);
});

test('대결: 터뜨린 사람 점수에 더한다', () => {
  const g = new BalloonGame(plain(), AREA, 'versus', seeded(5));
  const a = place(g, 'normal', -0.5, 0.5);
  const b = place(g, 'normal', 0.5, 0.5);
  g.update(0.001, [
    { player: 0, x: a.x, y: a.y },
    { player: 1, x: b.x, y: b.y },
  ]);
  assert.deepEqual(g.scores, [10, 10]);
});

test('30초가 지나면 클리어 보너스(남은 목숨 × 100)를 받고 다음 스테이지로 간다', () => {
  const g = new BalloonGame({ ...plain(), missesPerLife: 1000 }, AREA, 'coop', seeded(6));
  let clear = null;
  for (let t = 0; t < 31 && !clear; t += 0.05) {
    for (const e of g.update(0.05, [])) if (e.type === 'stageClear') clear = e;
  }
  // 놓친 풍선으로 목숨이 깎일 수 있으므로 남은 목숨으로 확인
  assert.ok(clear && clear.type === 'stageClear');
  assert.equal(clear.bonus, g.lives * 100);
  g.nextStage();
  assert.equal(g.stage, 2);
  assert.equal(g.phase, 'playing');
});

test('봇 손으로 1인·2인 모두 3스테이지를 끊김 없이 넘긴다', () => {
  for (const mode of ['1p', 'coop', 'versus'] as const) {
    const g = new BalloonGame(params(), AREA, mode, seeded(11));
    let hands: Hand[] = mode === '1p' ? [{ player: 0, x: 0, y: 0.5 }] : [{ player: 0, x: -0.4, y: 0.5 }, { player: 1, x: 0.4, y: 0.5 }];
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 200 && g.stage <= 3; i++) {
      hands = botHands(g, hands, dt, 3.0);
      g.update(dt, hands);
      if (g.phase === 'stageClear') g.nextStage();
      if (g.phase === 'over') break;
    }
    assert.ok(g.stage >= 4, `${mode}: 스테이지 ${g.stage}, 목숨 ${g.lives}`);
    assert.equal(g.stageScores.length, 3);
  }
});

test('가상 하늘: 풍선은 하늘 꼭대기에서 생겨 손 닿는 범위까지 1.5초 넘게 걸린다', () => {
  const area: Rect = { x0: -0.5, x1: 0.5, y0: 0.03, y1: 0.6 };
  const g = new BalloonGame(plain(), area, '1p', seeded(9), 1);
  let b: Balloon | null = null;
  for (let i = 0; i < 100 && !b; i++) for (const e of g.update(0.02, [])) if (e.type === 'spawn') b = e.balloon;
  assert.ok(b && b.y > 1);
  const target = b!;
  let t = 0;
  while (target.y - target.r > area.y1 && t < 10) {
    g.update(0.02, []);
    t += 0.02;
  }
  assert.ok(t > 1.5, `하늘을 지나는 데 ${t.toFixed(2)}초`);
});
