// MediaPipe Pose Landmarker 래퍼. 여러 사람 동시 인식(FR-COM-02).
// 기본은 작업 스레드(Web Worker)에서 인식한다: 메인 스레드는 화면만 그려서 끊기지 않는다.
// Worker를 못 쓰는 환경(개발 서버 등)에서는 예전처럼 메인 스레드에서 인식한다.
// (Wakeline src/pose/poseTracker.ts 를 여러 사람용·작업 스레드용으로 고침)

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from './landmarks';
import type { WorkerRequest, WorkerResponse } from './poseWorker';

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export type ModelKind = 'lite' | 'full' | 'heavy';
export type Delegate = 'GPU' | 'CPU';

export interface DetectResult {
  /** 사람마다 33개 관절(영상 좌표 0~1). 순서는 프레임마다 바뀔 수 있으니 PlayerTracker로 번호를 붙인다. */
  poses: Landmark[][];
  inferenceMs: number;
  /** 작업 스레드에서 함께 잰 옷 색(없으면 빈 배열) */
  looks: (number[] | null)[];
}

let filesetPromise: Promise<WasmFileset> | null = null;

function fileset(): Promise<WasmFileset> {
  filesetPromise ??= FilesetResolver.forVisionTasks(new URL('mediapipe/wasm', document.baseURI).href);
  return filesetPromise;
}

export class PoseTracker {
  private landmarker: PoseLandmarker | null = null;
  private worker: Worker | null = null;
  private workerReady = false;
  private lastTs = 0;
  /** 작업 스레드가 지금 프레임을 처리 중인지(한 번에 한 장만 보낸다) */
  busy = false;
  model: ModelKind = 'full';
  delegate: Delegate = 'GPU';
  /** 작업 스레드 결과를 받을 곳 */
  onResult: ((r: DetectResult) => void) | null = null;

  get ready(): boolean {
    return this.landmarker !== null || this.workerReady;
  }

  /** 작업 스레드에서 인식 중인지 */
  get threaded(): boolean {
    return this.workerReady;
  }

  /** 실제로 적용된 delegate를 돌려준다(GPU 실패 시 CPU로 내려감). */
  async init(model: ModelKind, delegate: Delegate, numPoses: number, useWorker = true): Promise<Delegate> {
    this.close();
    const modelAssetPath = new URL(`models/pose_landmarker_${model}.task`, document.baseURI).href;
    this.model = model;
    if (useWorker && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && !import.meta.env.DEV) {
      try {
        const used = await this.initWorker(modelAssetPath, delegate, numPoses);
        this.delegate = used;
        return used;
      } catch (err) {
        console.warn('작업 스레드 인식을 쓸 수 없어 메인 스레드에서 인식합니다.', err);
        this.close();
      }
    }
    const fs = await fileset();
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
    this.delegate = used;
    return used;
  }

  private initWorker(model: string, delegate: Delegate, numPoses: number): Promise<Delegate> {
    const w = new Worker(new URL('./poseWorker.ts', import.meta.url));
    this.worker = w;
    return new Promise<Delegate>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('작업 스레드 준비 시간 초과')), 20000);
      w.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(e.message || '작업 스레드 오류'));
      };
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(timer);
          this.workerReady = true;
          resolve(m.delegate);
        } else if (m.type === 'error') {
          clearTimeout(timer);
          reject(new Error(m.message));
        } else if (m.type === 'result') {
          this.busy = false;
          this.onResult?.({ poses: m.poses, inferenceMs: m.inferenceMs, looks: m.looks });
        }
      };
      const msg: WorkerRequest = { type: 'init', wasm: new URL('mediapipe/wasm', document.baseURI).href, model, delegate, numPoses };
      w.postMessage(msg);
    });
  }

  private nextTs(): number {
    // VIDEO 모드는 타임스탬프가 단조 증가해야 한다.
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    return ts;
  }

  /**
   * 작업 스레드에 이번 영상 프레임을 보낸다(처리 중이면 건너뜀). 결과는 onResult 로 온다.
   * looks = 옷 색도 잴지(사람이 둘 이상일 때만 필요)
   */
  submit(video: HTMLVideoElement, looks: boolean): boolean {
    if (!this.worker || !this.workerReady || this.busy) return false;
    this.busy = true;
    const ts = this.nextTs();
    createImageBitmap(video)
      .then((bitmap) => {
        const msg: WorkerRequest = { type: 'frame', bitmap, ts, looks };
        this.worker?.postMessage(msg, [bitmap]);
      })
      .catch(() => {
        this.busy = false;
      });
    return true;
  }

  /** 메인 스레드에서 바로 인식(작업 스레드를 못 쓸 때) */
  detect(video: HTMLVideoElement): DetectResult {
    if (!this.landmarker) return { poses: [], inferenceMs: 0, looks: [] };
    const ts = this.nextTs();
    const t0 = performance.now();
    const result = this.landmarker.detectForVideo(video, ts);
    const inferenceMs = performance.now() - t0;
    const poses = result.landmarks.filter((p) => p && p.length >= 33) as Landmark[][];
    return { poses, inferenceMs, looks: [] };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.workerReady = false;
    this.busy = false;
  }
}
