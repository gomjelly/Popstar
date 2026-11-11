export interface DisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  primary: boolean;
  current: boolean;
}

export interface WindowState {
  fullscreen: boolean;
  displayId: number;
}

export interface CaptureSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string; // data URL
}

export interface TestConfig {
  captureTitle: string | null;
  logMetrics: boolean;
  /** 시작 화면 (main | games | hall | add-player | settings | select:<게임> | calib:<게임> | play:<게임>) */
  startRoute: string | null;
  /** 시험용 플레이어 수 */
  seedPlayers: number;
  /** 풍선 게임에서 봇 손을 함께 쓴다(검증용) */
  botHands: boolean;
  /** 봇 손만 쓴다(영상 속 손은 판정에서 뺌) */
  botOnly: boolean;
  /** 벽 게임 자세를 이 목록으로 고정(쉼표로 구분, 검증용) */
  wallPoses: string | null;
  /** 거울 반전 강제('0' | '1'), 없으면 설정값 */
  mirror: string | null;
  /** 메뉴 손 조작 강제('0' | '1') */
  hand: string | null;
  /** 카메라 보기 강제('0' | '1') */
  preview: string | null;
}

export interface PopstarBridge {
  listCaptureSources(): Promise<CaptureSource[]>;
  selectCaptureSource(id: string): Promise<boolean>;
  getTestConfig(): Promise<TestConfig>;
  /** --test-video로 지정한 동영상(없으면 null) */
  getTestVideo(): Promise<{ name: string; data: Uint8Array } | null>;
  sendMetrics(line: string): void;
  quit(): Promise<void>;
  listDisplays(): Promise<DisplayInfo[]>;
  getWindowState(): Promise<WindowState | null>;
  moveToDisplay(displayId: number, fullscreen: boolean): Promise<boolean>;
  setFullscreen(on: boolean): Promise<WindowState | null>;
  onDisplaysChanged(cb: (displays: DisplayInfo[]) => void): () => void;
  onWindowState(cb: (state: WindowState) => void): () => void;
}

declare global {
  interface Window {
    /** Electron에서 실행할 때만 존재한다. 브라우저 모드에서는 undefined. */
    popstar?: PopstarBridge;
  }
}
