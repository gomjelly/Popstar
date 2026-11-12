// 벽 게임 기하·판정 단위 테스트: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DEFAULT_PROFILE,
  approachSec,
  capsules,
  gradeOf,
  hitWall,
  makeWall,
  pickPoses,
  poppedBubbles,
  poseJoints,
  totalScore,
  wallScore,
  type BodyProfile,
  type WallConfig,
  type WallPose,
} from './geometry.ts';

const POSES: WallPose[] = JSON.parse(readFileSync(new URL('../../../public/config/poses.json', import.meta.url), 'utf8'));
const CFG: WallConfig = { grid: { cols: 24, rows: 26 }, wallSize: { heightRatio: 1.2, widthRatio: 1.25 } };
const H = 0.6;
const FLOOR = 0.07;
const ADULT: BodyProfile = DEFAULT_PROFILE;
/** 아이(약 110cm): 머리가 크고 다리가 짧다 */
const CHILD: BodyProfile = { shoulderW: 0.22, hipW: 0.12, upperArm: 0.15, forearm: 0.13, hand: 0.055, thigh: 0.22, shin: 0.21, torso: 0.3, neck: 0.14, headR: 0.08, legLen: 0.45 };
const pose = (id: string) => POSES.find((p) => p.id === id)!;
const tilt = (p: WallPose, deg: number): WallPose => ({ ...p, shoulderL: p.shoulderL + deg, shoulderR: p.shoulderR - deg });

test('자세 라이브러리: 20개 이상, id가 겹치지 않고 레벨 1~3', () => {
  assert.ok(POSES.length >= 20);
  assert.equal(new Set(POSES.map((p) => p.id)).size, POSES.length);
  for (const p of POSES) assert.ok(p.level >= 1 && p.level <= 3, p.id);
});

test('거품 개수는 모두 같다(24×26 = 624), 키가 크면 거품이 커진다', () => {
  const a = makeWall(pose('star'), ADULT, 0.6, FLOOR, CFG, 1);
  const b = makeWall(pose('star'), ADULT, 0.4, FLOOR, CFG, 1);
  assert.equal(a.bubbles.length, 624);
  assert.equal(b.bubbles.length, 624);
  assert.ok(a.r > b.r);
  assert.ok(Math.abs(a.y1 - a.y0 - 0.6 * 1.2) < 1e-9);
});

test('자세 각도: 별은 손이 어깨보다 높고 발이 벌어진다, 발은 바닥에 닿는다', () => {
  const j = poseJoints(pose('star'), ADULT, H, 0, FLOOR);
  assert.ok(j.wrL!.y > j.shL.y && j.wrR!.y > j.shR.y);
  assert.ok(j.wrL!.x < j.shL.x && j.wrR!.x > j.shR.x, '왼손은 화면 왼쪽');
  assert.ok(j.anR!.x - j.anL!.x > j.hipR.x - j.hipL.x);
  assert.ok(Math.abs(Math.min(j.anL!.y, j.anR!.y) - FLOOR) < 1e-9);
  // 플라밍고: 왼발이 들려 있다
  const f = poseJoints(pose('flamingo'), ADULT, H, 0, FLOOR);
  assert.ok(f.anL!.y > f.anR!.y + 0.1 * H);
});

const G = { perfect: 0, great: 6, good: 18 };
const F = { perfect: 0.75, great: 0.6, good: 0.4 };

test('모든 자세: 같은 자세 그대로 통과하면 벽 0개 + 금색 풍선 100% = Perfect(쉬움·보통·어려움, 어른·아이)', () => {
  for (const prof of [ADULT, CHILD]) {
    for (const margin of [1.5, 1.0, 0.6]) {
      for (const p of POSES) {
        const wall = makeWall(p, prof, H, FLOOR, CFG, margin);
        const hit = hitWall(wall, capsules(poseJoints(p, prof, H, 0, FLOOR)));
        assert.equal(hit.popped.length, 0, `${p.id} margin=${margin}`);
        assert.equal(hit.fill, 1, `${p.id} margin=${margin} 채움`);
        assert.equal(gradeOf(hit.popped.length, hit.fill, G, F), 'Perfect');
        assert.ok(wall.targetCount >= 20, `${p.id} 금색 풍선 ${wall.targetCount}개`);
        assert.ok(wall.bubbles.some((b) => b.hole && !b.target), `${p.id} 빈 여유 폭이 있음`);
        assert.ok(wall.bubbles.some((b) => !b.hole), `${p.id} 벽 거품이 남음`);
      }
    }
  }
});

test('웅크리기 꼼수 막기: 팔다리를 펴는 자세 벽에 몸을 작게 하면 벽은 안 터져도 점수가 낮다', () => {
  const crouch: WallPose = { id: 'crouch', name: '웅크리기', level: 1, shoulderL: 5, shoulderR: 5, elbowL: -150, elbowR: -150, hipL: 30, hipR: 30, kneeL: -150, kneeR: -150, torsoLean: 0, liftFoot: null };
  for (const id of ['star', 't-pose', 'manse', 'big-x', 'airplane']) {
    const wall = makeWall(pose(id), ADULT, H, FLOOR, CFG, 1);
    const hit = hitWall(wall, capsules(poseJoints(crouch, ADULT, H, 0, FLOOR)));
    assert.ok(hit.fill < 0.6, `${id}: 웅크리면 채움 ${(hit.fill * 100).toFixed(0)}%`);
    assert.notEqual(gradeOf(hit.popped.length, hit.fill, G, F), 'Perfect');
    assert.ok(wallScore(hit.popped.length, hit.fill, 1, 40) < 60);
  }
});

test('크게 벌리기 꼼수 막기: 팔다리를 너무 뻗으면 벽 거품이 터져 감점', () => {
  for (const id of ['stand', 't-pose', 'muscle', 'raise-left']) {
    const wall = makeWall(pose(id), ADULT, H, FLOOR, CFG, 1);
    const hit = hitWall(wall, capsules(poseJoints(pose('big-x'), ADULT, H, 0, FLOOR)));
    assert.ok(hit.popped.length >= 10, `${id}: 크게 벌리면 벽 ${hit.popped.length}개`);
    assert.notEqual(gradeOf(hit.popped.length, hit.fill, G, F), 'Perfect');
  }
});

test('채운 비율 공정성: 같은 자세 ±8° 흔들림이면 어른·아이 채운 비율 차이 10%p 이내', () => {
  for (const id of ['star', 't-pose', 'manse', 'muscle']) {
    for (const off of [4, 8, -8]) {
      const p = pose(id);
      const a = hitWall(makeWall(p, ADULT, H, FLOOR, CFG, 1), capsules(poseJoints(tilt(p, off), ADULT, H, 0, FLOOR))).fill;
      const c = hitWall(makeWall(p, CHILD, H, FLOOR, CFG, 1), capsules(poseJoints(tilt(p, off), CHILD, H, 0, FLOOR))).fill;
      assert.ok(Math.abs(a - c) <= 0.1, `${id} ${off}°: 어른 ${a.toFixed(2)}, 아이 ${c.toFixed(2)}`);
    }
  }
});

test('키가 다른 두 사람: 같은 자세 구멍이 각자 체형에 맞게 나오고, 서로 바꾸면 거품이 터진다', () => {
  const p = pose('t-pose');
  const adultWall = makeWall(p, ADULT, H, FLOOR, CFG, 1);
  const childWall = makeWall(p, CHILD, H, FLOOR, CFG, 1);
  const holes = (w: typeof adultWall) => w.bubbles.map((b) => b.hole);
  assert.notDeepEqual(holes(adultWall), holes(childWall));
  const adultBody = capsules(poseJoints(p, ADULT, H, 0, FLOOR));
  const childBody = capsules(poseJoints(p, CHILD, H, 0, FLOOR));
  assert.equal(poppedBubbles(adultWall, adultBody).length, 0);
  assert.equal(poppedBubbles(childWall, childBody).length, 0);
  // 아이 체형 구멍에 어른 몸(팔이 더 긺)은 맞지 않는다
  assert.ok(poppedBubbles(childWall, adultBody).length > 0);
});

test('판정 공정성(NFR-03): 같은 자세로 통과하면(사람이 내는 작은 흔들림 ±8° 포함) 어른·아이 터진 거품 수 차이가 3개 이내', () => {
  for (const id of ['star', 't-pose', 'manse', 'muscle', 'big-x']) {
    for (const off of [0, 4, 8, -8]) {
      const p = pose(id);
      const wrong = tilt(p, off);
      const a = poppedBubbles(makeWall(p, ADULT, H, FLOOR, CFG, 1), capsules(poseJoints(wrong, ADULT, H, 0, FLOOR))).length;
      const c = poppedBubbles(makeWall(p, CHILD, H, FLOOR, CFG, 1), capsules(poseJoints(wrong, CHILD, H, 0, FLOOR))).length;
      assert.ok(Math.abs(a - c) <= 3, `${id} +${off}°: 어른 ${a}, 아이 ${c}`);
    }
  }
});

test('판정 문구와 점수(100점 만점, 채운 비율 × 벽 감점)', () => {
  assert.equal(gradeOf(0, 0.8, G, F), 'Perfect');
  assert.equal(gradeOf(0, 0.7, G, F), 'Great');
  assert.equal(gradeOf(6, 0.95, G, F), 'Great');
  assert.equal(gradeOf(18, 0.5, G, F), 'Good');
  assert.equal(gradeOf(0, 0.3, G, F), 'Oops');
  assert.equal(gradeOf(19, 1, G, F), 'Oops');
  const all = (popped: number, fill: number, n: number) => Array.from({ length: n }, () => ({ popped, fill }));
  assert.equal(totalScore(all(0, 1, 7), 40), 100);
  assert.equal(totalScore(all(40, 1, 4), 40), 0);
  assert.equal(totalScore(all(0, 0.75, 4), 40), 100);
  assert.equal(totalScore(all(0, 0.2, 4), 40), 0);
  assert.equal(totalScore(all(0, 0.475, 4), 40), 50);
  assert.equal(totalScore([{ popped: 0, fill: 1 }, { popped: 20, fill: 1 }], 40), 75);
});

test('자세 고르기: 반복 없이, 뒤로 갈수록 레벨이 오른다 / 다가오는 시간 8초 → 5초', () => {
  let s = 3;
  const rng = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const picked = pickPoses(POSES, 10, rng);
  assert.equal(picked.length, 10);
  assert.equal(new Set(picked.map((p) => p.id)).size, 10);
  for (let i = 1; i < picked.length; i++) assert.ok(picked[i].level >= picked[i - 1].level);
  assert.equal(approachSec(0, 8, 8, 5), 8);
  assert.equal(approachSec(7, 8, 8, 5), 5);
});

test('쉬워진 판정: 보통 난이도에서 팔이 12° 정도 어긋나도 Great 이상, 20°면 Good 이상', () => {
  for (const id of ['star', 't-pose', 'manse', 'v-pose', 'muscle']) {
    const p = pose(id);
    const wall = makeWall(p, ADULT, H, FLOOR, CFG, 1.4);
    for (const [off, ok] of [[12, ['Perfect', 'Great']], [-12, ['Perfect', 'Great']], [20, ['Perfect', 'Great', 'Good']]] as const) {
      const hit = hitWall(wall, capsules(poseJoints(tilt(p, off), ADULT, H, 0, FLOOR)));
      const g = gradeOf(hit.popped.length, hit.fill, G, F);
      assert.ok((ok as readonly string[]).includes(g), `${id} ${off}°: ${g} (벽 ${hit.popped.length}개, 채움 ${(hit.fill * 100).toFixed(0)}%)`);
    }
  }
});
