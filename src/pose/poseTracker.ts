// MediaPipe Pose Landmarker 래퍼. 최대 2인 동시 인식(FR-COM-02, numPoses: 2).
// (Wakeline src/pose/poseTracker.ts 를 여러 사람용으로 고침)

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from './landmarks';

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export type ModelKind = 'lite' | 'full' | 'heavy';
export type Delegate = 'GPU' | 'CPU';

export interface DetectResult {
  /** 사람마다 33개 관절(영상 좌표 0~1). 순서는 프레임마다 바뀔 수 있으니 PlayerTracker로 번호를 붙인다. */
  poses: Landmark[][];
  inferenceMs: number;
}

let filesetPromise: Promise<WasmFileset> | null = null;

function fileset(): Promise<WasmFileset> {
  filesetPromise ??= FilesetResolver.forVisionTasks(new URL('mediapipe/wasm', document.baseURI).href);
  return filesetPromise;
}

export class PoseTracker {
  private landmarker: PoseLandmarker | null = null;
  private lastTs = 0;
  model: ModelKind = 'full';
  delegate: Delegate = 'GPU';

  get ready(): boolean {
    return this.landmarker !== null;
  }

  /** 실제로 적용된 delegate를 돌려준다(GPU 실패 시 CPU로 내려감). */
  async init(model: ModelKind, delegate: Delegate, numPoses: number): Promise<Delegate> {
    this.close();
    const fs = await fileset();
    const modelAssetPath = new URL(`models/pose_landmarker_${model}.task`, document.baseURI).href;
    const create = (d: Delegate) =>
      PoseLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath, delegate: d },
        runningMode: 'VIDEO',
        numPoses,
        minPoseDetectionConfidence: 0.4,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

    let used = delegate;
    try {
      this.landmarker = await create(delegate);
    } catch (err) {
      if (delegate !== 'GPU') throw err;
      console.warn('GPU 초기화 실패, CPU로 전환합니다.', err);
      used = 'CPU';
      this.landmarker = await create('CPU');
    }
    this.model = model;
    this.delegate = used;
    return used;
  }

  detect(video: HTMLVideoElement): DetectResult {
    if (!this.landmarker) return { poses: [], inferenceMs: 0 };
    // VIDEO 모드는 타임스탬프가 단조 증가해야 한다.
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    const t0 = performance.now();
    const result = this.landmarker.detectForVideo(video, ts);
    const inferenceMs = performance.now() - t0;
    const poses = result.landmarks.filter((p) => p && p.length >= 33) as Landmark[][];
    return { poses, inferenceMs };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
