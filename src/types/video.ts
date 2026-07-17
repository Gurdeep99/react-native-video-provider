import type { ReactNode } from 'react';

/** Renders a live indicator (badge / Lottie) shown while a live stream plays. */
export type LiveIconRenderer = () => ReactNode;

export interface VideoSource {
  /**
   * Stable identity of the video. The engine uses this for same-video
   * handoff: setting a source whose `id` matches the current one never
   * reloads, rebuffers or resets position.
   */
  id: string;
  /**
   * The media. For `type: 'url'` (default) a stream/file URL
   * (`https://…/video.m3u8`). For `type: 'youtube'` the YouTube **video id**
   * (e.g. `'dQw4w9WgXcQ'`), played through the YouTube IFrame player.
   */
  uri: string;
  /**
   * `'url'` (default) uses the native engine (ExoPlayer / AVPlayer).
   * `'youtube'` uses a WebView + the YouTube IFrame API — required because
   * YouTube can't be played through the native engine.
   */
  type?: 'url' | 'youtube';
  headers?: Record<string, string>;
  title?: string;
  artist?: string;
  artworkUri?: string;
  /** Seconds. Applied only when the item is (re)loaded. */
  startPosition?: number;
}

export type ResizeMode = 'contain' | 'cover' | 'stretch';

/**
 * Forced screen orientation.
 *
 * - `auto` — no lock; the app's own orientation settings apply.
 * - `landscape` / `inverted-landscape` — the two landscape rotations
 *   (inverted = rotated 180°).
 * - `portrait` / `inverted-portrait` — upright and upside-down portrait.
 *   Note: iPhones without a home button ignore upside-down portrait.
 */
export type OrientationLock =
  | 'auto'
  | 'portrait'
  | 'inverted-portrait'
  | 'landscape'
  | 'inverted-landscape';

export type PlayerMode =
  'inline' | 'fullscreen' | 'floating' | 'pip' | 'background' | 'hidden';

export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended'
  | 'error';

export interface VideoError {
  code: string;
  message: string;
}

export interface VideoState {
  currentVideo: VideoSource | null;
  status: PlaybackStatus;
  playing: boolean;
  paused: boolean;
  buffering: boolean;
  loading: boolean;
  /** Seconds */
  position: number;
  /** Seconds. 0 until loaded. */
  duration: number;
  /** Seconds of buffered media ahead of position. */
  buffered: number;
  rate: number;
  volume: number;
  muted: boolean;
  repeat: boolean;
  resizeMode: ResizeMode;
  /** Orientation forced via `setOrientation` (not the fullscreen unlock). */
  orientationLock: OrientationLock;
  fullscreen: boolean;
  /** Orientation locked for the current fullscreen session ('auto' = sensor). */
  fullscreenLock: OrientationLock;
  pip: boolean;
  floating: boolean;
  /** True while the active video is a live stream (hides the seek bar). */
  live: boolean;
  /** Renderer for the persistent live badge, or null. */
  liveIcon: LiveIconRenderer | null;
  mode: PlayerMode;
  /** Surface the player is currently requested/attached to. */
  surfaceId: string | null;
  videoWidth: number;
  videoHeight: number;
  error: VideoError | null;
}

export interface SetSourceOptions {
  /** Start playing as soon as ready (or immediately on handoff). Default true. */
  autoplay?: boolean;
  /** Attach the player to this surface as part of setting the source. */
  surfaceId?: string;
}

export interface VideoProviderConfig {
  /**
   * Render the built-in fullscreen host (an in-window overlay that locks
   * landscape). Set false if you render your own fullscreen surface.
   * Default true.
   */
  fullscreenHost?: boolean;
  /**
   * Render the built-in draggable floating player host. Default true.
   */
  floatingHost?: boolean;
  /** Pause playback when the active surface unmounts. Default false. */
  pauseOnDetach?: boolean;
  /**
   * Lock the whole app to portrait so the video never sensor-rotates inline —
   * only the fullscreen host rotates to landscape (on tap). Default false.
   * On iOS this needs the AppDelegate forwarding to `AuVideoOrientation`.
   */
  lockPortrait?: boolean;
}
