import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArmGesture, DEFAULT_FISH, Rod, biteGauge, pointsOf, tierOf, type GestureEvent } from './logic.ts';

const P = structuredClone(DEFAULT_FISH);

/** 손 높이 궤적(ms → 높이)을 30fps로 흘려 동작을 모은다 */
function run(g: ArmGesture, ms: number, h: (t: number) => number, want: GestureEvent['type']): GestureEvent[] {
  const out: GestureEvent[] = [];
  for (let t = 0; t <= ms; t += 33) out.push(...g.push(t, { left: null, right: h(t) }, want));
  return out;
}

test('머리 위로 들었다가 빠르게 내리면 던지기', () => {
  const g = new ArmGesture(P.gesture);
  // 0~400ms 들어 올려 0.9, 400~650ms 빠르게 -0.1까지
  const ev = run(g, 900, (t) => (t < 400 ? -0.6 + 1.5 * (t / 400) : t < 650 ? 0.9 - 1.0 * ((t - 400) / 250) : -0.1), 'cast');
  const casts = ev.filter((e) => e.type === 'cast');
  assert.equal(casts.length, 1);
  assert.ok(casts[0].type === 'cast' && casts[0].power > 0.4, '빠르게 휘두르면 힘이 세다');
});

test('천천히 내리면 약하게, 손을 들기만 하면 던지지 않음', () => {
  const g = new ArmGesture(P.gesture);
  const slow = run(g, 1200, (t) => (t < 300 ? 0.9 * (t / 300) : 0.9 - 0.9 * Math.min(1, (t - 300) / 450)), 'cast');
  const c = slow.find((e) => e.type === 'cast');
  assert.ok(c && c.type === 'cast' && c.power < 0.5);
  const g2 = new ArmGesture(P.gesture);
  assert.equal(run(g2, 1500, () => 0.9, 'cast').length, 0);
});

test('손을 어깨 위로 올리면 당기기 (기다릴 때만)', () => {
  const up = (t: number) => (t < 300 ? -0.2 : Math.min(0.6, -0.2 + 0.8 * ((t - 300) / 250)));
  assert.equal(run(new ArmGesture(P.gesture), 800, up, 'pull').filter((e) => e.type === 'pull').length, 1);
  // 던질 차례에는 당기기를 찾지 않는다
  assert.equal(run(new ArmGesture(P.gesture), 800, up, 'cast').length, 0);
});

test('게이지: 차오름 → 꼭대기 → 빠짐 → 끝', () => {
  assert.equal(biteGauge(0, P), 0);
  assert.ok(biteGauge(P.riseSec / 2, P) > 0.3 && biteGauge(P.riseSec / 2, P) < 0.7);
  assert.equal(biteGauge(P.riseSec + 0.1, P), 1);
  assert.ok(biteGauge(P.riseSec + P.peakSec + P.fallSec / 2, P) < 0.6);
  assert.equal(biteGauge(P.riseSec + P.peakSec + P.fallSec + 0.01, P), -1);
});

test('등급과 거리 보너스', () => {
  assert.equal(tierOf(0.95, P.tiers), 'big');
  assert.equal(tierOf(0.7, P.tiers), 'mid');
  assert.equal(tierOf(0.4, P.tiers), 'small');
  assert.equal(tierOf(0.1, P.tiers), 'trash');
  assert.equal(pointsOf(100, 0), 100);
  assert.equal(pointsOf(100, 1), 130);
});

/** 결정적인 난수 */
function seq(...xs: number[]): () => number {
  let i = 0;
  return () => xs[i++ % xs.length];
}

function step(rod: Rod, sec: number, g: GestureEvent[] = []) {
  const ev = rod.update(sec, g);
  return ev;
}

test('꼭대기에서 당기면 대어', () => {
  const rod = new Rod(P, seq(0.5, 0.99, 0.5));
  step(rod, 0.016, [{ type: 'cast', arm: 'right', power: 1 }]);
  assert.equal(rod.state, 'flying');
  step(rod, P.flySec + 0.01);
  assert.equal(rod.state, 'waiting');
  for (let i = 0; i < 400 && rod.state === 'waiting'; i++) step(rod, 0.016);
  assert.equal(rod.state, 'bite');
  step(rod, P.riseSec + 0.1);
  const ev = step(rod, 0.016, [{ type: 'pull', arm: 'right' }]);
  const c = ev.find((e) => e.type === 'catch');
  assert.ok(c && c.type === 'catch' && c.catch.tier === 'big');
  assert.ok(rod.score >= 260);
  assert.equal(rod.state, 'show');
  step(rod, P.showSec + 0.01);
  assert.equal(rod.state, 'ready');
});

test('던진 손으로만 당길 수 있음', () => {
  const rod = new Rod(P, seq(0.99));
  step(rod, 0.016, [{ type: 'cast', arm: 'left', power: 0.5 }]);
  step(rod, P.flySec + 0.01);
  for (let i = 0; i < 400 && rod.state === 'waiting'; i++) step(rod, 0.016);
  step(rod, P.riseSec + 0.05);
  const wrong = step(rod, 0.016, [{ type: 'pull', arm: 'right' }]);
  assert.ok(wrong.some((e) => e.type === 'wrongArm'));
  assert.equal(rod.state, 'bite', '다른 손은 무시');
  const ok = step(rod, 0.016, [{ type: 'pull', arm: 'left' }]);
  const c = ok.find((e) => e.type === 'catch');
  assert.ok(c && c.type === 'catch' && c.catch.tier === 'big');
});

test('팔을 끝까지 안 내려도 빠르게 휘두르면 던지기', () => {
  const g = new ArmGesture(P.gesture);
  // 머리 위(1.2)에서 어깨 조금 위(0.5)까지만 0.2초에 휘두름
  const ev = run(g, 900, (t) => (t < 400 ? 1.2 * (t / 400) : t < 600 ? 1.2 - 0.7 * ((t - 400) / 200) : 0.5), 'cast');
  assert.equal(ev.filter((e) => e.type === 'cast').length, 1);
  // 같은 높이를 2초에 걸쳐 천천히 내리면 던지지 않음
  const g2 = new ArmGesture(P.gesture);
  const slow = run(g2, 3000, (t) => (t < 400 ? 1.2 * (t / 400) : 1.2 - 0.7 * Math.min(1, (t - 400) / 2000)), 'cast');
  assert.equal(slow.filter((e) => e.type === 'cast').length, 0);
});

test('너무 빨리 당기면 쓰레기, 늦으면 도망가고 다시 기다림', () => {
  const rod = new Rod(P, seq(0.99));
  step(rod, 0.016, [{ type: 'cast', arm: 'left', power: 0 }]);
  step(rod, P.flySec + 0.01);
  const ev = step(rod, 0.1, [{ type: 'pull', arm: 'left' }]);
  const c = ev.find((e) => e.type === 'catch');
  assert.ok(c && c.type === 'catch' && c.catch.tier === 'trash' && c.early);

  const rod2 = new Rod(P, seq(0.99));
  step(rod2, 0.016, [{ type: 'cast', arm: 'right', power: 0.5 }]);
  step(rod2, P.flySec + 0.01);
  for (let i = 0; i < 400 && rod2.state === 'waiting'; i++) step(rod2, 0.016);
  const out: string[] = [];
  for (let i = 0; i < 300 && rod2.state === 'bite'; i++) out.push(...step(rod2, 0.016).map((e) => e.type));
  assert.ok(out.includes('escape'));
  assert.equal(rod2.state, 'waiting');
});
