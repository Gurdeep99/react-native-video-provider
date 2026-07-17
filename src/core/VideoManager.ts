import type { EventSubscription } from 'react-native';
import NativeAuVideo, { type NativeVideoSource } from '../NativeAuVideo';
import {
  createVideoStore,
  initialVideoState,
  type VideoStore,
} from '../state/createVideoStore';
import type { VideoEventMap, VideoEventName } from '../types/events';
import type {
  LiveIconRenderer,
  OrientationLock,
  PlaybackStatus,
  PlayerMode,
  ResizeMode,
  SetSourceOptions,
  VideoProviderConfig,
  VideoSource,
  VideoState,
} from '../types/video';
import { Emitter, type Listener, type Subscription } from '../utils/Emitter';
import type { YouTubeController } from './YouTubeController';

/** Surface id used by the built-in fullscreen host. */
export const FULLSCREEN_SURFACE_ID = '__au_fullscreen__';
/** Surface id used by the built-in floating host. */
export const FLOATING_SURFACE_ID = '__au_floating__';

const RESERVED_SURFACES = new Set([FULLSCREEN_SURFACE_ID, FLOATING_SURFACE_ID]);

const ORIENTATION_LOCKS: readonly OrientationLock[] = [
  'auto',
  'portrait',
  'inverted-portrait',
  'landscape',
  'inverted-landscape',
];

function toNativeSource(source: VideoSource): NativeVideoSource {
  return {
    id: source.id,
    uri: source.uri,
    headers: source.headers,
    title: source.title,
    artist: source.artist,
    artworkUri: source.artworkUri,
    startPosition: source.startPosition,
  };
}

/**
 * The single owner of the native playback engine on the JS side.
 *
 * React components never talk to the native module directly — they issue
 * commands here and subscribe to `store` for state. The manager exists for
 * the whole app lifetime; unmounting React trees never destroys it.
 */
export class VideoManager {
  private static instance: VideoManager | null = null;

  static get shared(): VideoManager {
    if (!VideoManager.instance) {
      VideoManager.instance = new VideoManager();
    }
    return VideoManager.instance;
  }

  readonly store: VideoStore = createVideoStore();

  private events = new Emitter<VideoEventMap>();
  private nativeSubscriptions: EventSubscription[] = [];
  private initialized = false;
  private config: Required<VideoProviderConfig> = {
    fullscreenHost: true,
    floatingHost: true,
    pauseOnDetach: false,
    lockPortrait: false,
  };
  /** Last non-reserved surface, restored after fullscreen/floating exits. */
  private lastInlineSurfaceId: string | null = null;

  /** Per-player default for `enterFullscreen()` (VideoPlayer's prop). */
  private fullscreenOrientationDefault: OrientationLock | null = null;

  /** The mounted YouTube WebView controller (when a youtube source is active). */
  private youtube: YouTubeController | null = null;

  private constructor() {}

  /** True when the current source plays through the YouTube WebView engine. */
  private get isYouTube(): boolean {
    return this.store.getState().currentVideo?.type === 'youtube';
  }

  get providerConfig(): Required<VideoProviderConfig> {
    return this.config;
  }

  /**
   * Idempotent. Called by VideoProvider on mount ("mount silently"):
   * creates the native player once and wires native events.
   */
  init(config?: VideoProviderConfig): void {
    this.config = { ...this.config, ...config };
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    NativeAuVideo.nativeInit();
    this.subscribeNative();
    if (this.config.lockPortrait) {
      // Keep the app portrait inline; fullscreen still rotates to landscape.
      this.setOrientation('portrait');
    }
  }

  // ---------------------------------------------------------------- events

  addListener<K extends VideoEventName>(
    event: K,
    listener: Listener<VideoEventMap[K]>
  ): Subscription {
    return this.events.addListener(event, listener);
  }

  private subscribeNative(): void {
    const subs = this.nativeSubscriptions;

    subs.push(
      NativeAuVideo.onStatusChange((e) => {
        this.applyStatus(e.status as PlaybackStatus);
      })
    );
    subs.push(
      NativeAuVideo.onLoad((e) => {
        this.set({
          duration: e.duration,
          videoWidth: e.width,
          videoHeight: e.height,
          loading: false,
        });
        this.events.emit('onLoad', e);
        this.events.emit('onReady', { videoId: e.videoId });
      })
    );
    subs.push(
      NativeAuVideo.onProgress((e) => {
        this.set({
          position: e.position,
          duration: e.duration,
          buffered: e.buffered,
        });
        this.events.emit('onProgress', e);
      })
    );
    subs.push(
      NativeAuVideo.onSeek((e) => {
        this.set({ position: e.position });
        this.events.emit('onSeek', e);
      })
    );
    subs.push(
      NativeAuVideo.onEnd(() => {
        this.applyStatus('ended');
        this.events.emit('onEnd', undefined);
      })
    );
    subs.push(
      NativeAuVideo.onError((e) => {
        this.set({ error: e, status: 'error', playing: false, loading: false });
        this.events.emit('onError', e);
      })
    );
    subs.push(
      NativeAuVideo.onAttach((e) => {
        this.events.emit('onAttach', e);
      })
    );
    subs.push(
      NativeAuVideo.onDetach((e) => {
        this.events.emit('onDetach', e);
        if (this.config.pauseOnDetach) {
          this.pause();
        }
      })
    );
    subs.push(
      NativeAuVideo.onPipChange((e) => {
        this.set({ pip: e.active });
        this.setMode(e.active ? 'pip' : this.deriveMode({ pip: false }));
        this.events.emit('onPipChanged', e);
      })
    );
  }

  private applyStatus(status: PlaybackStatus): void {
    const prev = this.store.getState();
    this.set({
      status,
      playing: status === 'playing',
      paused: status === 'paused',
      buffering: status === 'buffering',
      loading: status === 'loading',
      error: status === 'error' ? prev.error : null,
    });
    if (status === 'playing' && prev.status !== 'playing') {
      this.events.emit('onPlay', undefined);
    }
    if (status === 'paused' && prev.status !== 'paused') {
      this.events.emit('onPause', undefined);
    }
    if ((status === 'buffering') !== (prev.status === 'buffering')) {
      this.events.emit('onBuffer', { buffering: status === 'buffering' });
    }
  }

  // -------------------------------------------------------------- commands

  /**
   * Load a video. Same-video handoff: if `source.id` equals the current
   * video's id the engine is untouched — position, buffer and play state
   * survive. Pass `surfaceId` to attach in the same call.
   */
  setSource(source: VideoSource, options?: SetSourceOptions): void {
    const autoplay = options?.autoplay ?? true;
    const current = this.store.getState().currentVideo;
    const sameVideo = current?.id === source.id;

    if (!sameVideo) {
      this.set({
        currentVideo: source,
        status: 'loading',
        loading: true,
        position: source.startPosition ?? 0,
        duration: 0,
        buffered: 0,
        error: null,
      });
      if (source.type === 'youtube') {
        // The mounted YouTubeView loads it and re-registers; the previous
        // controller (a different video) is no longer ours.
        this.youtube = null;
      } else {
        NativeAuVideo.setSource(toNativeSource(source), autoplay);
      }
      this.events.emit('onVideoChanged', { video: source });
    } else if (autoplay && !this.store.getState().playing) {
      this.play();
    }

    // Surfaces are a native-engine concept; youtube renders its own WebView.
    if (options?.surfaceId && source.type !== 'youtube') {
      this.attach(options.surfaceId);
    }
  }

  /** Warm a source without rendering or touching current playback. */
  preload(source: VideoSource): void {
    if (source.type === 'youtube') {
      return; // No-op for youtube.
    }
    NativeAuVideo.preload(toNativeSource(source));
  }

  play(): void {
    if (this.isYouTube) {
      this.youtube?.play();
    } else {
      NativeAuVideo.play();
    }
  }

  pause(): void {
    if (this.isYouTube) {
      this.youtube?.pause();
    } else {
      NativeAuVideo.pause();
    }
  }

  resume(): void {
    this.play();
  }

  toggle(): void {
    if (this.store.getState().playing) {
      this.pause();
    } else {
      this.play();
    }
  }

  stop(): void {
    if (this.isYouTube) {
      this.youtube?.stop();
    } else {
      NativeAuVideo.stop();
    }
    this.set({ position: 0, playing: false, status: 'idle' });
  }

  /** @param position seconds */
  seek(position: number): void {
    const duration = this.store.getState().duration;
    const clamped = Math.max(
      0,
      duration > 0 ? Math.min(position, duration) : position
    );
    this.set({ position: clamped });
    if (this.isYouTube) {
      this.youtube?.seekTo(clamped);
    } else {
      NativeAuVideo.seekTo(clamped);
    }
  }

  seekBy(offset: number): void {
    this.seek(this.store.getState().position + offset);
  }

  setRate(rate: number): void {
    this.set({ rate });
    if (this.isYouTube) {
      this.youtube?.setRate(rate);
    } else {
      NativeAuVideo.setRate(rate);
    }
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(volume, 1));
    this.set({ volume: clamped });
    if (this.isYouTube) {
      this.youtube?.setVolume(clamped);
    } else {
      NativeAuVideo.setVolume(clamped);
    }
  }

  mute(): void {
    this.set({ muted: true });
    if (this.isYouTube) {
      this.youtube?.setMuted(true);
    } else {
      NativeAuVideo.setMuted(true);
    }
  }

  unmute(): void {
    this.set({ muted: false });
    if (this.isYouTube) {
      this.youtube?.setMuted(false);
    } else {
      NativeAuVideo.setMuted(false);
    }
  }

  setRepeat(repeat: boolean): void {
    this.set({ repeat });
    if (this.isYouTube) {
      this.youtube?.setRepeat(repeat);
    } else {
      NativeAuVideo.setRepeat(repeat);
    }
  }

  setResizeMode(mode: ResizeMode): void {
    this.set({ resizeMode: mode });
    if (!this.isYouTube) {
      NativeAuVideo.setResizeMode(mode);
    }
  }

  /**
   * Mark the active video live (hides the seek bar) and register the badge
   * renderer, so both inline and the built-in fullscreen host show them.
   */
  setLive(live: boolean, liveIcon: LiveIconRenderer | null = null): void {
    this.set({ live, liveIcon: live ? liveIcon : null });
  }

  // ------------------------------------------------------- youtube bridge

  /** Called by the mounted YouTubeView to receive playback commands. */
  registerYouTube(controller: YouTubeController): void {
    this.youtube = controller;
    // Sync the desired state onto the freshly mounted player.
    const s = this.store.getState();
    controller.setMuted(s.muted);
    controller.setRepeat(s.repeat);
    if (s.rate !== 1) {
      controller.setRate(s.rate);
    }
  }

  /** Called by YouTubeView on unmount. */
  unregisterYouTube(controller: YouTubeController): void {
    if (this.youtube === controller) {
      this.youtube = null;
    }
  }

  /** @internal YouTubeView → metadata ready. */
  ytLoad(duration: number, width = 0, height = 0): void {
    this.set({
      duration,
      videoWidth: width,
      videoHeight: height,
      loading: false,
    });
    const id = this.store.getState().currentVideo?.id ?? '';
    this.events.emit('onLoad', { videoId: id, duration, width, height });
    this.events.emit('onReady', { videoId: id });
  }

  /** @internal YouTubeView → status change. */
  ytStatus(status: PlaybackStatus): void {
    this.applyStatus(status);
  }

  /** @internal YouTubeView → progress tick. */
  ytProgress(position: number, duration: number): void {
    this.set({ position, duration, buffered: duration });
    this.events.emit('onProgress', { position, duration, buffered: duration });
  }

  /** @internal YouTubeView → playback ended. */
  ytEnded(): void {
    this.applyStatus('ended');
    this.events.emit('onEnd', undefined);
  }

  /** @internal YouTubeView → error. */
  ytError(code: string, message: string): void {
    this.set({
      error: { code, message },
      status: 'error',
      playing: false,
      loading: false,
    });
    this.events.emit('onError', { code, message });
  }

  /**
   * Force a screen orientation (`'landscape'`, `'inverted-portrait'`, …),
   * overriding the app's own lock until cleared with `'auto'`.
   */
  setOrientation(lock: OrientationLock): void {
    this.set({ orientationLock: lock });
    NativeAuVideo.setOrientation(lock);
  }

  /**
   * Register the orientation `enterFullscreen()` uses when called without an
   * argument (the built-in controls call it that way). Scoped: applied when
   * fullscreen opens, restored when it closes — the rest of the app is
   * unaffected. Pass null to unregister. Set by VideoPlayer's
   * `fullscreenOrientation` prop.
   */
  setFullscreenOrientation(lock: OrientationLock | null): void {
    this.fullscreenOrientationDefault = lock;
  }

  async getPosition(): Promise<number> {
    if (this.isYouTube) {
      return this.store.getState().position;
    }
    return NativeAuVideo.getPosition();
  }

  // -------------------------------------------------------------- surfaces

  /** Re-parent the player into the surface registered under `surfaceId`. */
  attach(surfaceId: string): void {
    if (!RESERVED_SURFACES.has(surfaceId)) {
      this.lastInlineSurfaceId = surfaceId;
    }
    this.set({ surfaceId });
    this.setMode(this.deriveMode({}));
    NativeAuVideo.attach(surfaceId);
  }

  /** Detach from any surface. Playback continues (audio) unless configured otherwise. */
  detach(): void {
    this.set({ surfaceId: null });
    this.setMode('hidden');
    NativeAuVideo.detach();
  }

  /**
   * Called by VideoSurface on unmount. Only clears JS state when the
   * unmounting surface is the active one; the native registry has already
   * dropped its weak reference.
   */
  handleSurfaceUnmount(surfaceId: string): void {
    const state = this.store.getState();
    if (state.surfaceId === surfaceId) {
      this.set({ surfaceId: null });
      if (this.config.pauseOnDetach) {
        this.pause();
      }
    }
    if (this.lastInlineSurfaceId === surfaceId) {
      this.lastInlineSurfaceId = null;
    }
  }

  // ------------------------------------------------------------ modes

  /**
   * Show the built-in fullscreen host.
   *
   * Fullscreen LOCKS orientation rather than following the device sensor:
   * tapping fullscreen rotates to landscape and it stays there regardless of
   * how the phone is held (no accidental sensor rotation). Priority:
   *   1. explicit `orientation` arg (a real value; a press event is ignored)
   *   2. VideoPlayer's `fullscreenOrientation` prop
   *   3. default `'landscape'`
   * Note it does NOT inherit a standing `setOrientation()` lock — so an app
   * kept portrait inline (e.g. `lockPortrait`) still rotates to landscape in
   * fullscreen. Pass `'auto'` explicitly (as `autoFullscreenOnRotate` does)
   * to follow the sensor instead. The lock is applied in the SAME native call
   * as entering, and the standing lock is restored on exit.
   */
  enterFullscreen(orientation?: OrientationLock): void {
    if (this.store.getState().fullscreen) {
      return;
    }
    // `enter` is often passed straight to onPress, so the argument may be a
    // press event — only honor real orientation values.
    const explicit = ORIENTATION_LOCKS.includes(orientation as OrientationLock)
      ? (orientation as OrientationLock)
      : undefined;
    // Explicit arg (incl. 'auto' for sensor-follow) > prop > locked landscape.
    const lock = explicit ?? this.fullscreenOrientationDefault ?? 'landscape';
    // CRITICAL: set `fullscreen` and `fullscreenLock` in ONE update so the iOS
    // fullscreen Modal mounts with the right `supportedOrientations` from the
    // first render. If the Modal mounted with the default first and the lock
    // arrived a render later, iOS would present it portrait and never
    // re-rotate an already-presented modal.
    this.set({ fullscreen: true, floating: false, fullscreenLock: lock });
    this.setMode('fullscreen');
    NativeAuVideo.enterFullscreen(lock);
    this.events.emit('onEnterFullscreen', undefined);
  }

  /** Restore the standing orientation lock (if any) and re-attach the previous surface. */
  exitFullscreen(): void {
    if (!this.store.getState().fullscreen) {
      return;
    }
    // Always restore the standing lock (or 'auto' if none) — a
    // fullscreen-scoped override was never written to state, so this
    // naturally drops it without needing to track whether one was applied.
    NativeAuVideo.exitFullscreen(this.store.getState().orientationLock);
    this.set({ fullscreen: false, fullscreenLock: 'auto' });
    this.events.emit('onExitFullscreen', undefined);
    this.restoreInlineSurface();
  }

  toggleFullscreen(orientation?: OrientationLock): void {
    if (this.store.getState().fullscreen) {
      this.exitFullscreen();
    } else {
      this.enterFullscreen(orientation);
    }
  }

  showFloating(): void {
    if (this.store.getState().floating) {
      return;
    }
    this.set({ floating: true, fullscreen: false });
    this.setMode('floating');
  }

  hideFloating(): void {
    if (!this.store.getState().floating) {
      return;
    }
    this.set({ floating: false });
    this.restoreInlineSurface();
  }

  async enterPiP(): Promise<boolean> {
    return NativeAuVideo.enterPip();
  }

  exitPiP(): void {
    NativeAuVideo.exitPip();
  }

  private restoreInlineSurface(): void {
    if (this.lastInlineSurfaceId) {
      this.attach(this.lastInlineSurfaceId);
    } else {
      this.set({ surfaceId: null });
      this.setMode('hidden');
    }
  }

  private deriveMode(override: Partial<Pick<VideoState, 'pip'>>): PlayerMode {
    const s = { ...this.store.getState(), ...override };
    if (s.pip) return 'pip';
    if (s.fullscreen) return 'fullscreen';
    if (s.floating) return 'floating';
    if (s.surfaceId) return 'inline';
    return 'hidden';
  }

  private setMode(mode: PlayerMode): void {
    if (this.store.getState().mode !== mode) {
      this.set({ mode });
      this.events.emit('onModeChanged', { mode });
    }
  }

  // ------------------------------------------------------------ lifecycle

  /** Tear the native player down entirely. Rarely needed. */
  destroy(): void {
    for (const sub of this.nativeSubscriptions) {
      sub.remove();
    }
    this.nativeSubscriptions = [];
    this.events.removeAll();
    this.initialized = false;
    this.lastInlineSurfaceId = null;
    this.fullscreenOrientationDefault = null;
    NativeAuVideo.setOrientation('auto');
    NativeAuVideo.releasePlayer();
    this.store.setState({ ...initialVideoState }, true);
  }

  private set(partial: Partial<VideoState>): void {
    this.store.setState(partial);
  }
}
