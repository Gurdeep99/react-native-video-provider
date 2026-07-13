import {
  TurboModuleRegistry,
  type TurboModule,
  type CodegenTypes,
} from 'react-native';

export type NativeVideoSource = {
  id: string;
  uri: string;
  /** HTTP headers, string -> string */
  headers?: CodegenTypes.UnsafeObject;
  title?: string;
  artist?: string;
  artworkUri?: string;
  /** Seconds. Applied only when the item is (re)loaded. */
  startPosition?: number;
};

export type NativeStatusEvent = {
  /** idle | loading | ready | playing | paused | buffering | ended | error */
  status: string;
};

export type NativeLoadEvent = {
  videoId: string;
  duration: number;
  width: number;
  height: number;
};

export type NativeProgressEvent = {
  position: number;
  duration: number;
  buffered: number;
};

export type NativeSeekEvent = {
  position: number;
};

export type NativeErrorEvent = {
  code: string;
  message: string;
};

export type NativeSurfaceEvent = {
  surfaceId: string;
};

export type NativePipEvent = {
  active: boolean;
};

export interface Spec extends TurboModule {
  /** Idempotent. Creates the singleton native player if needed. */
  nativeInit(): void;

  /**
   * Load a source into the engine. If the currently loaded source has the
   * same `id`, this is a no-op (same-video handoff) and playback continues.
   */
  setSource(source: NativeVideoSource, autoplay: boolean): void;

  /** Warm a source without rendering or interrupting current playback. */
  preload(source: NativeVideoSource): void;

  play(): void;
  pause(): void;
  stop(): void;
  seekTo(position: number): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setRepeat(repeat: boolean): void;
  /** contain | cover | stretch */
  setResizeMode(mode: string): void;

  /** Re-parent the player view into the surface registered under this id. */
  attach(surfaceId: string): void;
  detach(): void;

  /** Unlock rotation + immersive mode. Does not move the player. */
  enterFullscreen(): void;
  /** Restore the previous orientation lock. */
  exitFullscreen(): void;

  enterPip(): Promise<boolean>;
  exitPip(): void;

  getPosition(): Promise<number>;

  /** Tear down the native player entirely. */
  release(): void;

  readonly onStatusChange: CodegenTypes.EventEmitter<NativeStatusEvent>;
  readonly onLoad: CodegenTypes.EventEmitter<NativeLoadEvent>;
  readonly onProgress: CodegenTypes.EventEmitter<NativeProgressEvent>;
  readonly onSeek: CodegenTypes.EventEmitter<NativeSeekEvent>;
  readonly onEnd: CodegenTypes.EventEmitter<void>;
  readonly onError: CodegenTypes.EventEmitter<NativeErrorEvent>;
  readonly onAttach: CodegenTypes.EventEmitter<NativeSurfaceEvent>;
  readonly onDetach: CodegenTypes.EventEmitter<NativeSurfaceEvent>;
  readonly onPipChange: CodegenTypes.EventEmitter<NativePipEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('AuVideo');
