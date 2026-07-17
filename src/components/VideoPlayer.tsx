import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react';
import {
  AppState,
  Dimensions,
  StyleSheet,
  View,
  type ViewProps,
} from 'react-native';
import { VideoManager } from '../core/VideoManager';
import { useVideoManager } from '../provider/VideoContext';
import { usePlayback } from '../hooks/usePlayback';
import { useVideoEvents } from '../hooks/useVideoEvents';
import type { VideoEventMap } from '../types/events';
import type {
  OrientationLock,
  ResizeMode,
  VideoError,
  VideoSource,
} from '../types/video';
import { VideoControls } from './VideoControls';
import { VideoSurface } from './VideoSurface';
import { YouTubeView } from './YouTubeView';

export interface VideoPlayerProps extends ViewProps {
  source: VideoSource;
  /** Default true. */
  autoplay?: boolean;
  /**
   * Surface id to register/attach under. Defaults to `player:<source.id>`,
   * so a feed item and a detail screen showing the same video naturally
   * hand the player off to whichever mounted last.
   */
  surfaceId?: string;
  /** Show built-in controls. Default true. */
  controls?: boolean;
  resizeMode?: ResizeMode;
  /** Loop playback when it ends. Default false. */
  repeat?: boolean;
  /** Default false. */
  muted?: boolean;
  /**
   * Force the screen into this orientation while the player is mounted:
   * `'landscape'`, `'inverted-landscape'`, `'portrait'` or
   * `'inverted-portrait'`. Released (back to `'auto'`) on unmount.
   */
  orientation?: OrientationLock;
  /**
   * Orientation to force ONLY while this player is fullscreen (e.g.
   * `'portrait'` for a vertical video). Applied when fullscreen opens —
   * including via the built-in controls' fullscreen button — and restored
   * when it closes, so the rest of the app is unaffected.
   *
   */
  fullscreenOrientation?: OrientationLock;
  /**
   * YouTube-style: physically rotating the device to landscape auto-enters
   * fullscreen, and rotating back to portrait exits it. Off by default.
   * Requires the app to allow landscape at the OS level.
   */
  autoFullscreenOnRotate?: boolean;
  /**
   * Pause this player when it loses focus — i.e. the app goes to the
   * background while this player's surface is the one currently playing.
   * Default `true`. Set `false` to keep playing (e.g. background audio).
   * Only the focused player acts, so a video attached elsewhere is untouched.
   */
  pauseOnFocusLost?: boolean;
  /**
   * Screen-focus flag from your navigation library — e.g. React Navigation's
   * `useIsFocused()`. `false` pauses this player; returning to `true` reclaims
   * the engine and resumes this video. This is the only reliable way to pause
   * on screen navigation (React Navigation keeps screens mounted and the app
   * stays foregrounded, so unmount/AppState never fire). Leave undefined if
   * you don't use navigation.
   *
   * ```tsx
   * const isFocused = useIsFocused(); // @react-navigation/native
   * <VideoPlayer source={video} isFocused={isFocused} />
   * ```
   */
  isFocused?: boolean;
  /**
   * Mark this as a live stream: the built-in controls hide the seek bar/times
   * and show `liveIcon` (if given). Default false.
   */
  live?: boolean;
  /**
   * Render a live indicator shown in the controls while `live` — e.g. a
   * Lottie animation or a "LIVE" badge: `liveIcon={() => <LottieView … />}`.
   */
  liveIcon?: () => ReactNode;
  /**
   * Render a poster shown over the video only during the initial load
   * (before the first frame) — e.g. `thumbnail={() => <Image … />}`.
   */
  thumbnail?: () => ReactNode;
  /** Fires once metadata (duration, dimensions) is available. */
  onLoadComplete?: (info: VideoEventMap['onLoad']) => void;
  /** Fires whenever buffering starts or stops. */
  onBuffering?: (buffering: boolean) => void;
  onError?: (error: VideoError) => void;
}

/**
 * Convenience all-in-one player: `setSource` (same-video handoff aware) +
 * `attach` + surface + optional controls. Rendering two VideoPlayers with
 * the same source id moves the ONE engine — it never creates a second one.
 *
 * ```tsx
 * <VideoPlayer source={{ id: '123', uri }} style={{ aspectRatio: 16 / 9 }} />
 * ```
 *
 * `ref` exposes the underlying `VideoManager` for imperative control
 * (`ref.current.play()`, `.seek()`, …) — the same instance `useVideo()`
 * returns elsewhere in the app.
 */
export const VideoPlayer = forwardRef<VideoManager, VideoPlayerProps>(
  (
    {
      source,
      autoplay = true,
      surfaceId,
      controls = true,
      resizeMode,
      repeat,
      muted,
      orientation,
      fullscreenOrientation,
      autoFullscreenOnRotate = false,
      pauseOnFocusLost = true,
      isFocused,
      live = false,
      liveIcon,
      thumbnail,
      onLoadComplete,
      onBuffering,
      onError,
      style,
      ...rest
    },
    ref
  ) => {
    const manager = useVideoManager();
    const id = surfaceId ?? `player:${source.id}`;

    // Poster is shown only during the initial load — `loading` is true from
    // setSource until onLoad, and stays false for mid-stream buffering.
    const loading = usePlayback((s) => s.loading);
    // For youtube: the inline WebView hands off to the fullscreen host.
    const fullscreen = usePlayback((s) => s.fullscreen);

    // Read the latest source without retriggering effects on every render
    // (source is usually a fresh object literal each render).
    const sourceRef = useRef(source);
    sourceRef.current = source;

    useImperativeHandle(ref, () => manager, [manager]);

    useEffect(() => {
      // Don't autoplay a player that mounts already unfocused (isFocused
      // false), else it'd flash play → pause on the next screen.
      manager.setSource(source, {
        autoplay: autoplay && isFocused !== false,
        surfaceId: id,
      });
      // Attach on mount / when the video identity changes. Other source
      // fields (title, headers) don't retrigger: identity is source.id.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [manager, source.id, id]);

    useEffect(() => {
      if (resizeMode) {
        manager.setResizeMode(resizeMode);
      }
    }, [manager, resizeMode]);

    useEffect(() => {
      if (repeat === undefined) {
        return;
      }
      manager.setRepeat(repeat);
    }, [manager, repeat]);

    useEffect(() => {
      if (muted === undefined) {
        return;
      }
      if (muted) {
        manager.mute();
      } else {
        manager.unmute();
      }
    }, [manager, muted]);

    useEffect(() => {
      // Publish live state + badge to the store so the built-in fullscreen
      // host (which renders its own controls) shows them too.
      manager.setLive(live, liveIcon ?? null);
      return () => manager.setLive(false);
    }, [manager, live, liveIcon]);

    useEffect(() => {
      if (!orientation || orientation === 'auto') {
        return;
      }
      manager.setOrientation(orientation);
      return () => manager.setOrientation('auto');
    }, [manager, orientation]);

    useEffect(() => {
      if (!fullscreenOrientation) {
        return;
      }
      manager.setFullscreenOrientation(fullscreenOrientation);
      return () => manager.setFullscreenOrientation(null);
    }, [manager, fullscreenOrientation]);

    // Opt-in YouTube-style auto fullscreen on physical rotation: rotating the
    // device to landscape enters fullscreen and rotating back exits. Enters
    // with 'auto' (not a forced lock) so the device sensor keeps driving and
    // rotating back can exit. Off unless `autoFullscreenOnRotate` is set, and
    // needs the app to allow landscape at the OS level.
    useEffect(() => {
      if (!autoFullscreenOnRotate) {
        return;
      }
      const onChange = ({
        window,
      }: {
        window: { width: number; height: number };
      }) => {
        const landscape = window.width > window.height;
        const state = manager.store.getState();
        // Ignore when another video owns the engine and we're not fullscreen.
        if (state.surfaceId !== id && !state.fullscreen) {
          return;
        }
        if (landscape && !state.fullscreen) {
          manager.enterFullscreen('auto');
        } else if (!landscape && state.fullscreen) {
          manager.exitFullscreen();
        }
      };
      const sub = Dimensions.addEventListener('change', onChange);
      return () => sub.remove();
    }, [manager, id, autoFullscreenOnRotate]);

    useEffect(() => {
      if (!pauseOnFocusLost) {
        return;
      }
      const sub = AppState.addEventListener('change', (next) => {
        // Only the player currently owning the engine reacts, so a video
        // attached to another surface keeps playing untouched.
        if (next !== 'active' && manager.store.getState().surfaceId === id) {
          manager.pause();
        }
      });
      return () => sub.remove();
    }, [manager, id, pauseOnFocusLost]);

    useEffect(() => {
      if (isFocused === undefined) {
        return;
      }
      const state = manager.store.getState();
      if (isFocused) {
        // Regained screen focus. If the engine is still ours, just resume;
        // otherwise it moved to another video while we were blurred — reclaim
        // it (same-id handoff means no reload if it never actually left).
        if (
          state.surfaceId === id &&
          state.currentVideo?.id === sourceRef.current.id
        ) {
          manager.play();
        } else {
          manager.setSource(sourceRef.current, {
            autoplay: true,
            surfaceId: id,
          });
        }
      } else if (state.surfaceId === id) {
        // Lost screen focus while playing our video — pause. Guarded so we
        // never pause a video that has already handed off elsewhere.
        manager.pause();
      }
    }, [manager, id, isFocused]);

    useVideoEvents({
      onLoad: onLoadComplete,
      onBuffer: (e) => onBuffering?.(e.buffering),
      onError,
    });

    // YouTube plays in a WebView with our own <VideoControls> overlay
    // (controls: 0 in the iframe). It can't re-parent its WebView, so
    // fullscreen hands off to the fullscreen host: the inline view unmounts
    // while fullscreen (avoiding double audio), resuming at the current
    // position on either transition.
    if (source.type === 'youtube') {
      return (
        <View style={[styles.container, style]} {...rest}>
          {!fullscreen ? (
            <>
              <YouTubeView
                videoId={source.uri}
                autoplay={autoplay}
                muted={muted}
                repeat={repeat}
                startSeconds={manager.store.getState().position}
                style={styles.surface}
              />
              {controls ? <VideoControls /> : null}
            </>
          ) : null}
          {thumbnail && loading ? (
            <View style={styles.surface} pointerEvents="none">
              {thumbnail()}
            </View>
          ) : null}
        </View>
      );
    }

    return (
      <View style={[styles.container, style]} {...rest}>
        <VideoSurface surfaceId={id} style={styles.surface} />
        {thumbnail && loading ? (
          <View style={styles.surface} pointerEvents="none">
            {thumbnail()}
          </View>
        ) : null}
        {controls ? <VideoControls /> : null}
      </View>
    );
  }
);

VideoPlayer.displayName = 'VideoPlayer';

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  surface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
