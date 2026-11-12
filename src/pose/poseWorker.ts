// 자세 인식 작업 스레드(Web Worker).
// MediaPipe 인식은 한 번에 십수~수십 ms가 걸려, 화면을 그리는 메인 스레드에서 돌리면 그동안 화면이 멈춘다(풍선 게임 끊김).
// 여기서 따로 돌리고 결과(관절 + 옷 색)만 돌려보낸다. 메인 스레드는 그동안 계속 화면을 그린다.
// MediaPipe 로더가 importScripts 를 쓰므로 classic worker 로 빌드한다(vite 기본 iife).

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { AppearanceSampler } from './appearance';
import type { Landmark } from './landmarks';

export type WorkerRequest =
  | { type: 'init'; wasm: string; model: string; delegate: 'GPU' | 'CPU'; numPoses: number }
  | { type: 'frame'; bitmap: ImageBitmap; ts: number; looks: boolean }
  | { type: 'close' };

export type WorkerResponse =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'error'; message: string }
  | { type: 'result'; poses: Landmark[][]; looks: (number[] | null)[]; inferenceMs: number };

let landmarker: PoseLandmarker | null = null;
const sampler = new AppearanceSampler();
const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      landmarker?.close();
      const fs = await FilesetResolver.forVisionTasks(m.wasm);
      const create = (d: 'GPU' | 'CPU') =>
        PoseLandmarker.createFromOptions(fs, {
          baseOptions: { modelAssetPath: m.model, delegate: d },
          // 작업 스레드에는 화면 캔버스가 없으므로 GPU용 OffscreenCanvas 를 넘긴다
          canvas: new OffscreenCanvas(1, 1),
          runningMode: 'VIDEO',
          numPoses: m.numPoses,
          minPoseDetectionConfidence: 0.4,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      let used = m.delegate;
      try {
        landmarker = await create(m.delegate);
      } catch (err) {
        if (m.delegate !== 'GPU') throw err;
        used = 'CPU';
        landmarker = await create('CPU');
      }
      post({ type: 'ready', delegate: used });
    } catch (err) {
      post({ type: 'error', message: String((err as Error)?.message ?? err) });
    }
  } else if (m.type === 'frame') {
    if (!landmarker) {
      m.bitmap.close();
      post({ type: 'result', poses: [], looks: [], inferenceMs: 0 });
      return;
    }
    const t0 = performance.now();
    const r = landmarker.detectForVideo(m.bitmap, m.ts);
    const inferenceMs = performance.now() - t0;
    const poses = r.landmarks.filter((p) => p && p.length >= 33) as Landmark[][];
    let looks: (number[] | null)[] = [];
    if (m.looks && poses.length) {
      sampler.capture(m.bitmap);
      looks = poses.map((p) => sampler.measure(p));
    }
    m.bitmap.close();
    // 관절은 일반 객체로 보낸다(구조적 복제)
    post({ type: 'result', poses: poses.map((p) => p.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility }))), looks, inferenceMs });
  } else if (m.type === 'close') {
    landmarker?.close();
    landmarker = null;
  }
};
