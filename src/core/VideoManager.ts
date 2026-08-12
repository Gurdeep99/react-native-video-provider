import type { EventSubscription } from 'react-native';
import NativeVideo, { type NativeVideoSource } from '../NativeVideo';
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
  VideoError,
  VideoProviderConfig,
  VideoSource,
  VideoState,
} from '../types/video';
import { Emitter, type Listener, type Subscription } from '../utils/Emitter';

// Optional: connectivity gating for live retry. If not installed, retries
// assume the network is up (they'll just fail fast and back off).
let NetInfo: {
  addEventListener: (
    cb: (s: { isConnected?: boolean; isInternetReachable?: boolean }) => void
  ) => () => void;
} | null = null;
try {
  NetInfo = require('@react-native-community/netinfo').default;
} catch {
  NetInfo = null;
}

/**
 * AppState, resolved lazily. This module deliberately has no runtime import of
 * `react-native` — that keeps the core engine-agnostic and loadable in a plain
 * Node test environment — so reach for it only when the listener is wired.
 */
function getAppState(): {
  addEventListener: (
    type: 'change',
    cb: (state: string) => void
  ) => { remove: () => void };
} | null {
  try {
    return require('react-native').AppState ?? null;
  } catch {
    return null;
  }
}

const LIVE_RETRY_MAX_DELAY_MS = 15000;

/**
 * Grace period before deciding a resume failed and the source needs rebuilding.
 *
 * Sized to cover a real reconnect: a player that genuinely recovers has to
 * re-establish its connection and refill its buffer, which can take a few
 * seconds. Short enough that a viewer isn't left on a black screen, long
 * enough that we don't tear down a player that was about to come back.
 */
const RESUME_VERIFY_MS = 4000;

/**
 * How long a player may sit in `buffering` before the stall watchdog treats it
 * as dead. Generous — real buffering on a poor connection is normal — but
 * bounded, because a native engine whose link dropped mid-stream will buffer
 * forever without ever raising an error.
 */
const BUFFER_STALL_MS = 12000;

/** Shorter: an errored player has already failed, no point waiting long. */
const ERROR_STALL_MS = 3000;

/** Stall rebuilds allowed before giving up and leaving the failure visible. */
const MAX_STALL_RECOVERIES = 3;

/**
 * YouTube IFrame error codes that no amount of retrying fixes: the video is
 * private/removed (100) or its owner disallows embedding (101/150). The
 * transient ones (2, 5) are already retried in-page by the WebView engine.
 */
const YOUTUBE_FATAL_CODES = new Set(['100', '101', '150']);

/**
 * True for errors where the source is permanently unavailable, so live retry
 * would spin forever against a stream that is never coming back.
 */
function isFatalError(error: VideoError): boolean {
  if (error.code === 'youtube') {
    // The YouTube engine reports its numeric code in `message`.
    return YOUTUBE_FATAL_CODES.has(String(error.message).trim());
  }
  return false;
}

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
    type: source.type ?? 'url',
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
    liveAutoRetry: true,
    resumeOnFocus: true,
    debug: false,
  };
  /** Last non-reserved surface, restored after fullscreen/floating exits. */
  private lastInlineSurfaceId: string | null = null;

  /** Per-player default for `enterFullscreen()` (VideoPlayer's prop). */
  private fullscreenOrientationDefault: OrientationLock | null = null;

  // --- live retry / connectivity ---
  private online = true;
  private netUnsub: (() => void) | null = null;
  private liveRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private liveRetryAttempt = 0;
  /** A live retry deferred because the device is offline. */
  private pendingLiveRetry = false;
  /**
   * Source ids the app pinned live-ness for via `setLive()` (the `live` prop),
   * and the value it pinned.
   *
   * Keyed by source id rather than a single global flag on purpose. A global
   * flag had two failure modes, because one engine is shared by every mounted
   * player:
   *
   *  - It latched forever. Once any player called `setLive()`, native detection
   *    was suppressed for every later source too, so a VOD that followed a live
   *    stream could never correct itself.
   *  - `setSource` cleared `live` for a new source but nothing restored it. A
   *    player's `setLive()` runs once when it mounts; when the engine later
   *    handed that same video back (scrolling a feed/carousel), `live` stayed
   *    false and the badge and seek-bar styling were wrong with no way back.
   *
   * Per-source means the pin travels with the video it was declared for.
   */
  private explicitLive = new Map<string, boolean>();
  /**
   * Live badge renderers of all currently mounted players, oldest first.
   *
   * `state.liveIcon` is a single slot but any number of players can be mounted
   * at once (carousels, feeds). Keeping the registrations in a stack means the
   * newest one shows and, when it unmounts, a surviving sibling's badge is
   * restored instead of the slot being left empty — which is what happened when
   * every player cleared the slot unconditionally on unmount.
   */
  private liveIconStack: LiveIconRenderer[] = [];

  // --- focus resume ---
  /** The current source was set with autoplay, so focus may resume it. */
  private autoplayIntent = true;
  /**
   * The viewer paused on purpose. Focus must not undo that — without this,
   * scrolling a paused video out of view and back would restart it.
   */
  private userPaused = false;
  /**
   * The viewer toggled audio themselves, so a component's `muted` prop must
   * stop overriding it. Deliberately never reset per source: mute is a
   * preference about the engine, and a viewer who unmuted expects it to stay
   * unmuted across surfaces and across videos.
   */
  private mutedUserSet = false;
  private appStateSub: { remove: () => void } | null = null;
  /** Pending check that a focus-resume actually restarted playback. */
  private resumeVerifyTimer: ReturnType<typeof setTimeout> | null = null;
  /** Armed while the player is stuck buffering or errored. */
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  /** Stall rebuilds since playback last actually ran. */
  private stallRecoveries = 0;

  private constructor() {}

  get providerConfig(): Required<VideoProviderConfig> {
    return this.config;
  }

  /** Trace a recovery decision when `debug` is on. See VideoProviderConfig. */
  private log(message: string, detail?: Record<string, unknown>): void {
    if (!this.config.debug) {
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[video] ${message}`, detail ?? '');
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
    NativeVideo.nativeInit();
    this.subscribeNative();
    this.setupNetInfo();
    this.setupAppState();
    if (this.config.lockPortrait) {
      // Keep the app portrait inline; fullscreen still rotates to landscape.
      this.setOrientation('portrait');
    }
  }

  /**
   * Returning to the foreground is the other way a player regains focus.
   * Both platforms suspend WebView playback while backgrounded and don't
   * restart it, so YouTube in particular needs the nudge.
   */
  private setupAppState(): void {
    const appState = getAppState();
    if (!appState) {
      return;
    }
    this.appStateSub = appState.addEventListener('change', (state) => {
      if (state === 'active') {
        this.resumeOnFocus();
      }
    });
  }

  private setupNetInfo(): void {
    if (!NetInfo) {
      this.online = true;
      return;
    }
    try {
      this.netUnsub = NetInfo.addEventListener(
        (state: { isConnected?: boolean; isInternetReachable?: boolean }) => {
          const online =
            state?.isConnected !== false &&
            state?.isInternetReachable !== false;
          const cameOnline = online && !this.online;
          this.online = online;
          this.set({ online });
          this.log('netinfo', { online, cameOnline });
          if (cameOnline) {
            // Reconnected — run any live retry we deferred while offline.
            if (this.pendingLiveRetry) {
              this.pendingLiveRetry = false;
              this.scheduleLiveRetry();
            } else {
              this.recoverAfterReconnect();
            }
          }
        }
      );
    } catch {
      this.online = true;
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
      NativeVideo.onStatusChange((e) => {
        this.applyStatus(e.status as PlaybackStatus);
      })
    );
    subs.push(
      NativeVideo.onLoad((e) => {
        this.set({
          duration: e.duration,
          videoWidth: e.width,
          videoHeight: e.height,
          loading: false,
        });
        // Feed came back — reset the retry backoff.
        this.liveRetryAttempt = 0;
        this.events.emit('onLoad', e);
        this.events.emit('onReady', { videoId: e.videoId });
      })
    );
    subs.push(
      NativeVideo.onProgress((e) => {
        // Drop ticks that arrive while a new source is still loading: they
        // describe the outgoing video. Both engines gate this natively too,
        // but this keeps a stale position off the seekbar whichever path
        // (native player or WebView) emitted it.
        if (this.store.getState().loading) {
          return;
        }
        this.set({
          position: e.position,
          duration: e.duration,
          buffered: e.buffered,
        });
        this.events.emit('onProgress', e);
      })
    );
    subs.push(
      NativeVideo.onSeek((e) => {
        this.set({ position: e.position });
        this.events.emit('onSeek', e);
      })
    );
    subs.push(
      NativeVideo.onEnd(() => {
        this.applyStatus('ended');
        this.events.emit('onEnd', undefined);
        // A live stream shouldn't "end" — the feed dropped; try again.
        if (this.store.getState().live) {
          this.maybeRetryLive();
        }
      })
    );
    subs.push(
      NativeVideo.onError((e) => {
        this.set({ error: e, status: 'error', playing: false, loading: false });
        this.events.emit('onError', e);
        this.maybeRetryLive(e);
      })
    );
    subs.push(
      NativeVideo.onAttach((e) => {
        this.events.emit('onAttach', e);
      })
    );
    subs.push(
      NativeVideo.onDetach((e) => {
        this.events.emit('onDetach', e);
        if (this.config.pauseOnDetach) {
          this.pause();
        }
      })
    );
    subs.push(
      NativeVideo.onPipChange((e) => {
        this.set({ pip: e.active });
        this.setMode(e.active ? 'pip' : this.deriveMode({ pip: false }));
        this.events.emit('onPipChanged', e);
      })
    );
    subs.push(
      NativeVideo.onLiveChange((e) => {
        // The engine detected live-ness itself, so retry works even when the
        // app never called setLive(). An explicit setLive() still wins — but
        // only for the source it was declared for, so a later video is free to
        // be detected normally.
        const id = this.store.getState().currentVideo?.id;
        if (id !== undefined && this.explicitLive.has(id)) {
          return;
        }
        this.set({ live: e.live });
        if (!e.live) {
          this.clearLiveRetry();
        }
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
    this.updateStallWatchdog(status);
  }

  /**
   * Rebuild a player that has been stuck long enough to count as dead.
   *
   * This is a safety net that watches the symptom rather than any particular
   * cause. Every other recovery path depends on something upstream firing
   * correctly — NetInfo reporting a transition, or the engine raising an
   * error — and when a connection drops mid-stream neither is guaranteed: the
   * native engine can sit in `buffering` forever, and NetInfo never reports a
   * change if the interface stayed up while the link was actually dead. From
   * the viewer's side those are all one thing: a black screen that never
   * recovers. Watching for "stuck" catches them all.
   *
   * Recovery is capped: a source that keeps stalling is genuinely broken, and
   * looping reloads would be worse than showing the failure.
   */
  private updateStallWatchdog(status: PlaybackStatus): void {
    const stuck = status === 'buffering' || status === 'error';
    if (!stuck) {
      // Any other state means it moved — reset the budget too, so a later
      // stall gets a fresh set of attempts.
      this.clearStallWatchdog();
      if (status === 'playing') {
        this.stallRecoveries = 0;
      }
      return;
    }
    if (this.stallTimer || this.stallRecoveries >= MAX_STALL_RECOVERIES) {
      return;
    }
    const delay = status === 'error' ? ERROR_STALL_MS : BUFFER_STALL_MS;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      const s = this.store.getState();
      if (!s.currentVideo || this.userPaused) {
        return;
      }
      // Still stuck in the same state it was armed for.
      if (!s.buffering && s.status !== 'error') {
        return;
      }
      if (s.error && isFatalError(s.error)) {
        return;
      }
      this.log('stall watchdog -> reload', {
        status: s.status,
        attempt: this.stallRecoveries + 1,
      });
      this.stallRecoveries += 1;
      this.reload();
    }, delay);
  }

  private clearStallWatchdog(): void {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
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
      // A different video invalidates any in-flight live retry.
      this.clearLiveRetry();
      // A new source carries its own autoplay intent and clears the pause latch.
      this.autoplayIntent = autoplay;
      this.userPaused = false;
      this.clearStallWatchdog();
      this.stallRecoveries = 0;
      this.set({
        currentVideo: source,
        status: 'loading',
        loading: true,
        position: source.startPosition ?? 0,
        duration: 0,
        buffered: 0,
        error: null,
        // Reset live-ness to whatever this source is actually known to be, or a
        // VOD loaded after a live stream keeps the live styling (and hidden
        // seekbar) until the engine re-reports. If the app pinned live-ness for
        // THIS source via the `live` prop, honour that immediately — otherwise
        // false, and the engine corrects it via onLiveChange once the item is
        // ready. Hard-clearing to false unconditionally was a one-way door: a
        // player's `setLive()` only runs when it mounts, so an already-mounted
        // player getting its video handed back had no way to re-pin it.
        //
        // `liveIcon` deliberately survives: it's a registration owned by the
        // mounted players (see liveIconStack), not per-video state.
        live: this.explicitLive.get(source.id) ?? false,
      });
      // Both engines (native player / native WebView) live behind the same
      // TurboModule; the native side dispatches by source.type.
      NativeVideo.setSource(toNativeSource(source), autoplay);
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
    NativeVideo.preload(toNativeSource(source));
  }

  play(): void {
    // An explicit play clears the "viewer paused this" latch, so focus-resume
    // is allowed again.
    this.userPaused = false;
    NativeVideo.play();
  }

  pause(): void {
    // Latch the intent so regaining focus doesn't restart what was paused
    // deliberately. Cleared by play() or by loading a new source.
    this.userPaused = true;
    NativeVideo.pause();
  }

  /**
   * Pause because the app backgrounded or the screen lost focus — a lifecycle
   * event, not a decision by the viewer.
   *
   * Deliberately does NOT set the `userPaused` latch: going to the background
   * is exactly the case `resumeOnFocus` exists to recover from, so latching
   * here would make the pause permanent and autoplay would never resume.
   */
  pauseForFocusLoss(): void {
    NativeVideo.pause();
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
    this.clearLiveRetry();
    NativeVideo.stop();
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
    NativeVideo.seekTo(clamped);
  }

  seekBy(offset: number): void {
    this.seek(this.store.getState().position + offset);
  }

  setRate(rate: number): void {
    this.set({ rate });
    NativeVideo.setRate(rate);
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(volume, 1));
    this.set({ volume: clamped });
    NativeVideo.setVolume(clamped);
  }

  mute(): void {
    this.mutedUserSet = true;
    this.applyMuted(true);
  }

  unmute(): void {
    this.mutedUserSet = true;
    this.applyMuted(false);
  }

  /**
   * Apply a component's declarative `muted` prop.
   *
   * Ignored once the viewer has toggled audio themselves. Mute is a property of
   * the one shared engine, not of a component, so it has to survive moving
   * between surfaces: unmuting in the inline player then opening fullscreen
   * remounts a player whose prop still says `muted`, and re-asserting it would
   * silently re-mute the video the viewer just turned on (and the same in
   * reverse on the way back).
   */
  setMutedFromProp(muted: boolean): void {
    if (this.mutedUserSet) {
      return;
    }
    this.applyMuted(muted);
  }

  private applyMuted(muted: boolean): void {
    if (this.store.getState().muted === muted) {
      return;
    }
    this.set({ muted });
    NativeVideo.setMuted(muted);
  }

  setRepeat(repeat: boolean): void {
    this.set({ repeat });
    NativeVideo.setRepeat(repeat);
  }

  setResizeMode(mode: ResizeMode): void {
    this.set({ resizeMode: mode });
    NativeVideo.setResizeMode(mode);
  }

  /**
   * Mark the active video live (hides the seek bar) and register the badge
   * renderer, so both inline and the built-in fullscreen host show them.
   *
   * Optional: the engine auto-detects live streams (HLS live window,
   * indefinite duration, YouTube `isLive`) and sets this itself. Calling it
   * pins the value — native detection stops overriding it for this source.
   */
  setLive(live: boolean, liveIcon?: LiveIconRenderer | null): void {
    // Pin against the source this was declared for, so it survives the engine
    // handing this video back later and doesn't leak onto an unrelated video.
    const id = this.store.getState().currentVideo?.id;
    if (id !== undefined) {
      this.explicitLive.set(id, live);
    }
    this.set({ live });
    // Only touch the badge when a renderer was actually passed. Clearing it on
    // every `setLive(false)` is what made the badge vanish after a remount:
    // the registration is presentational and outlives any one live/not-live
    // transition. Use setLiveIcon() to manage it.
    if (liveIcon !== undefined) {
      this.set({ liveIcon });
    }
    if (!live) {
      this.clearLiveRetry();
    }
  }

  /**
   * Register the live badge renderer, independent of live-ness.
   *
   * Kept separate from `setLive` on purpose: the renderer is usually an inline
   * arrow function, so its identity changes every render. Tying live state to
   * that identity meant an unrelated re-render (a status change on network
   * loss, say) could momentarily flip `live` false — revealing the seek bar on
   * a live stream. Pass null to unregister.
   */
  setLiveIcon(liveIcon: LiveIconRenderer | null): void {
    this.set({ liveIcon });
  }

  /**
   * Register a mounted player's live badge renderer. The newest registration is
   * the one shown.
   *
   * Prefer this over `setLiveIcon` from a component: several players can be
   * mounted at once and they all share the single `liveIcon` slot, so ownership
   * has to be tracked. Always pair with `unregisterLiveIcon(renderer)` — pass
   * the SAME function reference back.
   */
  registerLiveIcon(renderer: LiveIconRenderer): void {
    this.liveIconStack.push(renderer);
    this.set({ liveIcon: renderer });
  }

  /**
   * Drop a registration made by `registerLiveIcon` and show whichever earlier
   * one is still mounted (null if none are).
   *
   * Order-independent by design: an unmounting player must not blank a sibling's
   * badge, and a player that unmounts *after* its replacement has already
   * registered must not undo the replacement.
   */
  unregisterLiveIcon(renderer: LiveIconRenderer): void {
    const i = this.liveIconStack.lastIndexOf(renderer);
    if (i === -1) {
      return;
    }
    this.liveIconStack.splice(i, 1);
    const next = this.liveIconStack[this.liveIconStack.length - 1] ?? null;
    this.set({ liveIcon: next });
  }

  /**
   * Re-attempt the current source from scratch.
   *
   * This must go through the native `reload()` rather than re-issuing
   * `setSource`: setSource short-circuits when the id already matches (the
   * same-video handoff that keeps position and buffer across surface changes),
   * so it would only call play() on an already-dead player — a failed
   * AVPlayerItem or an errored YouTube page never recovers from that, which is
   * why a live stream came back to a black screen after the network returned.
   */
  reload(): void {
    if (!this.store.getState().currentVideo) {
      return;
    }
    this.log('reload -> native');
    this.set({ status: 'loading', loading: true, error: null });
    NativeVideo.reload();
  }

  // ------------------------------------------------------ live retry

  /** Retry a failed/dropped LIVE feed — always, unless offline (waits),
   *  permanently broken, or disabled via `liveAutoRetry: false`. */
  private maybeRetryLive(error?: VideoError): void {
    if (!this.config.liveAutoRetry || !this.store.getState().live) {
      return;
    }
    if (error && isFatalError(error)) {
      return;
    }
    this.scheduleLiveRetry();
  }

  private scheduleLiveRetry(): void {
    if (!this.store.getState().live || this.liveRetryTimer) {
      return;
    }
    if (!this.online) {
      // Don't hammer the network offline — resume when connectivity returns.
      this.pendingLiveRetry = true;
      return;
    }
    // Full jitter on the backoff: when a stream drops it drops for everyone
    // watching, and un-jittered retries would reconnect in lockstep and
    // stampede the origin at exactly the moment it's recovering.
    const ceiling = Math.min(
      1000 * 2 ** this.liveRetryAttempt,
      LIVE_RETRY_MAX_DELAY_MS
    );
    const delay = ceiling / 2 + Math.random() * (ceiling / 2);
    this.liveRetryAttempt += 1;
    this.liveRetryTimer = setTimeout(() => {
      this.liveRetryTimer = null;
      if (!this.online) {
        this.pendingLiveRetry = true;
        return;
      }
      if (this.store.getState().live) {
        this.reload();
      }
    }, delay);
  }

  private clearLiveRetry(): void {
    if (this.liveRetryTimer) {
      clearTimeout(this.liveRetryTimer);
      this.liveRetryTimer = null;
    }
    this.liveRetryAttempt = 0;
    this.pendingLiveRetry = false;
  }

  /**
   * Force a screen orientation (`'landscape'`, `'inverted-portrait'`, …),
   * overriding the app's own lock until cleared with `'auto'`.
   */
  setOrientation(lock: OrientationLock): void {
    this.set({ orientationLock: lock });
    NativeVideo.setOrientation(lock);
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
    return NativeVideo.getPosition();
  }

  // -------------------------------------------------------------- surfaces

  /** Re-parent the player into the surface registered under `surfaceId`. */
  attach(surfaceId: string): void {
    if (!RESERVED_SURFACES.has(surfaceId)) {
      this.lastInlineSurfaceId = surfaceId;
    }
    this.set({ surfaceId });
    this.setMode(this.deriveMode({}));
    NativeVideo.attach(surfaceId);
    // Coming back into view counts as regaining focus.
    this.resumeOnFocus();
  }

  /**
   * Resume an autoplay source that has come back into focus.
   *
   * Deliberately narrow: it only fires for a source the app asked to autoplay,
   * never after an explicit `pause()`, and never when already playing. YouTube
   * is the reason this exists — its WebView suspends playback when it loses
   * focus or the app backgrounds, and nothing restarts it.
   *
   * Safe to call before the engine is ready: a play() that lands early is held
   * natively and replayed once the player reports ready.
   */
  private resumeOnFocus(): void {
    if (!this.config.resumeOnFocus || !this.autoplayIntent || this.userPaused) {
      return;
    }
    if (!this.store.getState().currentVideo) {
      return;
    }
    // Intentionally not gated on `playing`. Coming back from the background
    // the OS may have stopped playback without the engine reporting it (most
    // reliably in fullscreen, where no component records the pause), leaving a
    // stale `playing: true` that would skip the resume entirely. play() is
    // idempotent, so issuing it unconditionally is the safer path.
    //
    // reassertVideoOutput() first and unconditionally: if the engine already
    // recovered internally (paused, not stopped — no error, no idle transition)
    // there is no native signal telling us the render surface went stale, so we
    // can't wait for one. We already know playback was interrupted; that alone
    // is reason enough to re-parent.
    this.log('focus resume -> reassert + play + verify');
    NativeVideo.reassertVideoOutput();
    NativeVideo.play();
    this.verifyResume();
  }

  /**
   * Recover playback that a network outage broke.
   *
   * Live retry only covers sources marked live, so without this a VOD — or a
   * live stream that merely stalled without ever raising an error — sat on a
   * black screen after the connection came back, with nothing scheduled to
   * rebuild it. Living on the manager means every surface is covered,
   * fullscreen included, rather than only whichever component is mounted.
   *
   * A viewer-initiated pause is left alone: they chose to stop, and `reload()`
   * would restart playback under them.
   */
  private recoverAfterReconnect(): void {
    const s = this.store.getState();
    if (!s.currentVideo || this.userPaused) {
      return;
    }
    if (s.status === 'error' || s.error) {
      // A player that actually failed can't restart from play(): its item is
      // terminal (or its WebView page is gone). Only a rebuild brings it back.
      this.log('reconnect -> reload (errored)');
      this.reload();
      return;
    }
    if (this.autoplayIntent) {
      // Not errored, just interrupted — nudge it, and let verifyResume rebuild
      // if it turns out not to come back on its own.
      //
      // Re-attach the active surface BEFORE reassertVideoOutput(). On iOS the
      // fullscreen player lives in a Modal whose UIKit view hierarchy can be
      // silently recreated by the OS during a connectivity event, invalidating
      // the UIView pointer stored in the native surface registry without ever
      // triggering a JS unmount. When that happens reassertVideoOutput() looks
      // up the registry, gets nil, and falls into a pendingSurfaceId wait that
      // never resolves — the player keeps playing (audio) over a black frame.
      // Calling attach() first refreshes the registry entry so the subsequent
      // reassert can actually re-parent the AVPlayerLayer / TextureView.
      if (s.surfaceId) {
        NativeVideo.attach(s.surfaceId);
      }
      // reassertVideoOutput() unconditionally, same reasoning as
      // resumeOnFocus: the engine can recover from a network drop on its own —
      // buffering straight back to playing, no error, no idle transition — and
      // when it does, nothing native marks the render surface stale. The
      // reconnect itself is the evidence; acting on it directly is the only way
      // to reach that case, since native never will on its own.
      this.log('reconnect -> attach + reassert + play + verify', { status: s.status });
      NativeVideo.reassertVideoOutput();
      NativeVideo.play();
      this.verifyResume();
    }
  }

  /**
   * Confirm the resume actually took, and rebuild the source if it didn't.
   *
   * A player suspended across a long background can come back unable to
   * restart from play() alone — a WebView whose page was discarded, or an item
   * the OS tore down. Waiting a beat and checking real state distinguishes
   * "still spinning up" (fine) from "never came back" (needs a reload).
   */
  private verifyResume(): void {
    if (this.resumeVerifyTimer) {
      clearTimeout(this.resumeVerifyTimer);
    }
    this.resumeVerifyTimer = setTimeout(() => {
      this.resumeVerifyTimer = null;
      const s = this.store.getState();
      if (!s.currentVideo || this.userPaused) {
        return;
      }
      // Only actual playback counts as recovered. Treating `buffering` as
      // healthy was wrong: a native player whose connection dropped mid-stream
      // sits in buffering indefinitely and never errors, so exempting it meant
      // the rebuild never ran and the viewer kept staring at a black screen.
      // `loading` is exempt because that IS a rebuild already in flight.
      if (s.playing || s.loading) {
        return;
      }
      this.log('resume did not take -> reload', { status: s.status });
      this.reload();
    }, RESUME_VERIFY_MS);
  }

  /** Detach from any surface. Playback continues (audio) unless configured otherwise. */
  detach(): void {
    this.set({ surfaceId: null });
    this.setMode('hidden');
    NativeVideo.detach();
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
    NativeVideo.enterFullscreen(lock);
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
    NativeVideo.exitFullscreen(this.store.getState().orientationLock);
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
    return NativeVideo.enterPip();
  }

  exitPiP(): void {
    NativeVideo.exitPip();
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
    this.clearLiveRetry();
    this.netUnsub?.();
    this.netUnsub = null;
    this.appStateSub?.remove();
    this.appStateSub = null;
    if (this.resumeVerifyTimer) {
      clearTimeout(this.resumeVerifyTimer);
      this.resumeVerifyTimer = null;
    }
    this.clearStallWatchdog();
    this.stallRecoveries = 0;
    // Full teardown resets the store, so the latches guarding it must go too,
    // or a fresh player would inherit the previous session's decisions.
    this.mutedUserSet = false;
    this.userPaused = false;
    this.events.removeAll();
    this.initialized = false;
    this.lastInlineSurfaceId = null;
    this.fullscreenOrientationDefault = null;
    this.explicitLive.clear();
    this.liveIconStack = [];
    NativeVideo.setOrientation('auto');
    NativeVideo.releasePlayer();
    this.store.setState({ ...initialVideoState }, true);
  }

  private set(partial: Partial<VideoState>): void {
    this.store.setState(partial);
  }
}
