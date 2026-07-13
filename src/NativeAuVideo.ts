import { TurboModuleRegistry, type TurboModule } from 'react-native';
// Direct imports (not the `CodegenTypes.` namespace) so the spec parses on
// RN 0.79's codegen as well as 0.80+.
import type {
  EventEmitter,
  UnsafeObject,
} from 'react-native/Libraries/Types/CodegenTypes';

export type NativeVideoSource = {
  id: string;
  uri: string;
  /** HTTP headers, string -> string */
  headers?: UnsafeObject;
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

  /**
   * Force a screen orientation, overriding the app's own lock and the
   * fullscreen sensor unlock until cleared with 'auto'.
   * auto | portrait | inverted-portrait | landscape | inverted-landscape
   */
  setOrientation(orientation: string): void;

  enterPip(): Promise<boolean>;
  exitPip(): void;

  getPosition(): Promise<number>;

  /** Tear down the native player entirely. */
  releasePlayer(): void;

  readonly onStatusChange: EventEmitter<NativeStatusEvent>;
  readonly onLoad: EventEmitter<NativeLoadEvent>;
  readonly onProgress: EventEmitter<NativeProgressEvent>;
  readonly onSeek: EventEmitter<NativeSeekEvent>;
  readonly onEnd: EventEmitter<void>;
  readonly onError: EventEmitter<NativeErrorEvent>;
  readonly onAttach: EventEmitter<NativeSurfaceEvent>;
  readonly onDetach: EventEmitter<NativeSurfaceEvent>;
  readonly onPipChange: EventEmitter<NativePipEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('AuVideo');
