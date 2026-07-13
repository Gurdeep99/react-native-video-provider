import type { EventSubscription } from 'react-native';
import NativeAuVideo, { type NativeVideoSource } from '../NativeAuVideo';
import {
  createVideoStore,
  initialVideoState,
  type VideoStore,
} from '../state/createVideoStore';
import type { VideoEventMap, VideoEventName } from '../types/events';
import type {
  PlaybackStatus,
  PlayerMode,
  ResizeMode,
  SetSourceOptions,
  VideoProviderConfig,
  VideoSource,
  VideoState,
} from '../types/video';
import { Emitter, type Listener, type Subscription } from '../utils/Emitter';

/** Surface id used by the built-in fullscreen host. */
export const FULLSCREEN_SURFACE_ID = '__au_fullscreen__';
/** Surface id used by the built-in floating host. */
export const FLOATING_SURFACE_ID = '__au_floating__';

const RESERVED_SURFACES = new Set([FULLSCREEN_SURFACE_ID, FLOATING_SURFACE_ID]);

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
  };
  /** Last non-reserved surface, restored after fullscreen/floating exits. */
  private lastInlineSurfaceId: string | null = null;

  private constructor() {}

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
      NativeAuVideo.setSource(toNativeSource(source), autoplay);
      this.events.emit('onVideoChanged', { video: source });
    } else if (autoplay && !this.store.getState().playing) {
      this.play();
    }

    if (options?.surfaceId) {
      this.attach(options.surfaceId);
    }
  }

  /** Warm a source without rendering or touching current playback. */
  preload(source: VideoSource): void {
    NativeAuVideo.preload(toNativeSource(source));
  }

  play(): void {
    NativeAuVideo.play();
  }

  pause(): void {
    NativeAuVideo.pause();
  }

  resume(): void {
    NativeAuVideo.play();
  }

  toggle(): void {
    if (this.store.getState().playing) {
      this.pause();
    } else {
      this.play();
    }
  }

  stop(): void {
    NativeAuVideo.stop();
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
    NativeAuVideo.seekTo(clamped);
  }

  seekBy(offset: number): void {
    this.seek(this.store.getState().position + offset);
  }

  setRate(rate: number): void {
    this.set({ rate });
    NativeAuVideo.setRate(rate);
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(volume, 1));
    this.set({ volume: clamped });
    NativeAuVideo.setVolume(clamped);
  }

  mute(): void {
    this.set({ muted: true });
    NativeAuVideo.setMuted(true);
  }

  unmute(): void {
    this.set({ muted: false });
    NativeAuVideo.setMuted(false);
  }

  setRepeat(repeat: boolean): void {
    this.set({ repeat });
    NativeAuVideo.setRepeat(repeat);
  }

  setResizeMode(mode: ResizeMode): void {
    this.set({ resizeMode: mode });
    NativeAuVideo.setResizeMode(mode);
  }

  async getPosition(): Promise<number> {
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
   * Show the built-in fullscreen host and unlock device rotation.
   * The host mounts a surface and attaches automatically.
   */
  enterFullscreen(): void {
    if (this.store.getState().fullscreen) {
      return;
    }
    this.set({ fullscreen: true, floating: false });
    this.setMode('fullscreen');
    NativeAuVideo.enterFullscreen();
    this.events.emit('onEnterFullscreen', undefined);
  }

  /** Restore the previous orientation lock and re-attach the previous surface. */
  exitFullscreen(): void {
    if (!this.store.getState().fullscreen) {
      return;
    }
    NativeAuVideo.exitFullscreen();
    this.set({ fullscreen: false });
    this.events.emit('onExitFullscreen', undefined);
    this.restoreInlineSurface();
  }

  toggleFullscreen(): void {
    if (this.store.getState().fullscreen) {
      this.exitFullscreen();
    } else {
      this.enterFullscreen();
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
    NativeAuVideo.releasePlayer();
    this.store.setState({ ...initialVideoState }, true);
  }

  private set(partial: Partial<VideoState>): void {
    this.store.setState(partial);
  }
}
