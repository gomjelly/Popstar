// 벽 게임 기하·판정 단위 테스트: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DEFAULT_PROFILE,
  approachSec,
  capsules,
  gradeOf,
  makeWall,
  pickPoses,
  poppedBubbles,
  poseJoints,
  totalScore,
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

test('모든 자세: 같은 자세 그대로 통과하면 Perfect(난이도 쉬움·보통·어려움, 어른·아이)', () => {
  for (const prof of [ADULT, CHILD]) {
    for (const margin of [1.5, 1.0, 0.6]) {
      for (const p of POSES) {
        const wall = makeWall(p, prof, H, FLOOR, CFG, margin);
        const body = capsules(poseJoints(p, prof, H, 0, FLOOR));
        assert.equal(poppedBubbles(wall, body).length, 0, `${p.id} margin=${margin}`);
        assert.ok(wall.bubbles.some((b) => b.hole), `${p.id} 구멍이 있음`);
        assert.ok(wall.bubbles.some((b) => !b.hole), `${p.id} 거품이 남음`);
      }
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

test('판정 문구와 점수(100점 만점)', () => {
  const g = { perfect: 0, great: 5, good: 15 };
  assert.equal(gradeOf(0, g), 'Perfect');
  assert.equal(gradeOf(5, g), 'Great');
  assert.equal(gradeOf(15, g), 'Good');
  assert.equal(gradeOf(16, g), 'Oops');
  assert.equal(totalScore([0, 0, 0, 0, 0, 0, 0], 40), 100);
  assert.equal(totalScore([40, 40, 40, 40], 40), 0);
  assert.equal(totalScore([0, 20], 40), 75);
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
