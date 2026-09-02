import { TurboModuleRegistry, type TurboModule } from 'react-native';
// Direct imports (not the `CodegenTypes.` namespace) so the spec parses on
// RN 0.79's codegen as well as 0.80+.
import type {
  EventEmitter,
  UnsafeObject,
} from 'react-native/Libraries/Types/CodegenTypes';

export type NativeVideoSource = {
  id: string;
  /** Stream/file URL for `url`; the YouTube video id for `youtube`. */
  uri: string;
  /** 'url' (native ExoPlayer/AVPlayer) or 'youtube' (native WebView engine). */
  type?: string;
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

export type NativeLiveEvent = {
  live: boolean;
};

export interface Spec extends TurboModule {
  /** Idempotent. Creates the singleton native player if needed. */
  nativeInit(): void;

  /**
   * Android only (no-op on iOS): back the player view with a TextureView
   * (default) or a SurfaceView. The view is created lazily on the first real
   * attach (not by `nativeInit()`), so this only has an effect when called
   * before that first attach happens anywhere in the app — later calls are
   * ignored until the app restarts. TextureView re-parents cleanly across
   * surfaces (floating window, feed cells) at a small performance cost;
   * SurfaceView is cheaper but can't be animated/transformed and misbehaves
   * when re-parented.
   */
  setUseTextureView(useTextureView: boolean): void;

  /**
   * Load a source into the engine. If the currently loaded source has the
   * same `id`, this is a no-op (same-video handoff) and playback continues.
   */
  setSource(source: NativeVideoSource, autoplay: boolean): void;

  /** Warm a source without rendering or interrupting current playback. */
  preload(source: NativeVideoSource): void;

  /**
   * Rebuild the current source from scratch — a new player item / a fresh
   * YouTube page — bypassing the same-id handoff that `setSource` applies.
   * Needed because a failed item or a dead WebView page cannot be revived by
   * play() alone.
   */
  reload(): void;

  /**
   * Like `reload()` but seeks to `position` (seconds) after the item is ready,
   * so the viewer resumes from where they were rather than restarting from 0.
   * Ignored for YouTube sources (no reliable mid-stream seek on a fresh page)
   * and clamped to [0, duration] on the native side.
   */
  reloadFromPosition(position: number): void;

  /**
   * Force the engine's video output back onto its current surface.
   *
   * For engines like ExoPlayer's TextureView, an interruption can leave the
   * render surface stale even though the player itself recovers cleanly —
   * playback resumes (audio included) but nothing is drawn. That recovery can
   * happen inside the engine with no error and no idle transition for native
   * code to react to, so this exists as an explicit, state-independent command:
   * the JS side calls it whenever it has other evidence of an interruption
   * (a connectivity drop, regaining focus) rather than waiting on a native
   * signal that may never come. Cheap and safe to call when nothing was
   * actually wrong — it's a no-op re-parent in that case.
   */
  reassertVideoOutput(): void;

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

  /**
   * Enter fullscreen (immersive mode). `orientation` is applied in the same
   * native call — no intermediate unlocked frame before a lock takes effect.
   * auto | portrait | inverted-portrait | landscape | inverted-landscape
   */
  enterFullscreen(orientation: string): void;
  /** Exit fullscreen, restoring `orientation` (same value semantics) atomically. */
  exitFullscreen(orientation: string): void;

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
  /**
   * The engine determined the source is (or is no longer) a live stream —
   * ExoPlayer's live window, an indefinite AVPlayerItem duration, or
   * YouTube's `getVideoData().isLive`. Fires only on change.
   */
  readonly onLiveChange: EventEmitter<NativeLiveEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Video');
