import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react';
import { Dimensions, StyleSheet, View, type ViewProps } from 'react-native';
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
   * Let fullscreen follow the device sensor instead of locking to one
   * orientation: turning the phone rotates the video between landscape-left,
   * landscape-right and portrait, with no exit/re-enter.
   *
   * Fullscreen locks to landscape by default precisely so a video can't
   * sensor-rotate out from under the viewer; set this when you want the
   * opposite. Shorthand for `fullscreenOrientation="auto"` — pass that
   * directly if you need a specific lock, and it wins over this flag.
   *
   * On iOS the app must allow landscape in its Info.plist, and the AppDelegate
   * must forward to `VideoOrientation` (see README) for rotation to be
   * permitted at all.
   */
  rotation?: boolean;
  /**
   * Let the small inline player follow the sensor: physically rotating the
   * device to landscape enters fullscreen, and rotating back to portrait
   * exits it — no button press. Off by default.
   *
   * Pairs with `rotation`, which governs rotation *once already* fullscreen:
   *   - `componentRotation` — how you get INTO fullscreen (turn the phone)
   *   - `rotation`          — whether fullscreen keeps following the sensor
   * Set both for a fully sensor-driven player.
   *
   * Requires the app to allow landscape at the OS level (see `rotation`).
   */
  componentRotation?: boolean;
  /**
   * Older name for {@link componentRotation}; both behave identically and
   * either enables the behaviour. Kept so existing code keeps working.
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
      rotation = false,
      componentRotation = false,
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
        pauseOnFocusLost,
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
      // Declarative default only — a viewer toggle wins from then on, so
      // remounting (e.g. opening fullscreen) can't re-mute what they unmuted.
      manager.setMutedFromProp(muted);
    }, [manager, muted]);

    // Keep the newest renderer reachable without making it an effect dep:
    // `liveIcon` is typically an inline arrow, so its identity changes every
    // render.
    const liveIconRef = useRef(liveIcon);
    useEffect(() => {
      liveIconRef.current = liveIcon;
    });

    const hasLiveIcon = liveIcon != null;
    useEffect(() => {
      // Publish the badge to the store so the built-in fullscreen host (which
      // renders its own controls) shows it too. Registering a stable wrapper
      // keyed on *presence* rather than the prop itself means an ordinary
      // re-render can't churn the registration.
      if (!hasLiveIcon) {
        return;
      }
      const renderer = () => liveIconRef.current?.() ?? null;
      // register/unregister rather than setLiveIcon(null): the slot is shared by
      // every mounted player, so ownership has to be tracked or an unmounting
      // player blanks a sibling's badge with nothing to restore it.
      manager.registerLiveIcon(renderer);
      return () => manager.unregisterLiveIcon(renderer);
    }, [manager, hasLiveIcon]);

    useEffect(() => {
      // Only pin live-ness when the prop was actually supplied. Calling
      // setLive() unconditionally marked it app-controlled, which permanently
      // suppressed the engine's own live detection — after a remount that left
      // a YouTube live stream with no badge and a visible seek bar.
      if (live === undefined) {
        return;
      }
      manager.setLive(live);
      // Re-assert after any handoff of THIS video. `live` is a constant for most
      // callers, so this effect alone only ever ran at mount — meanwhile the
      // engine reloading (or another player taking and returning the engine)
      // resets `live` for the incoming source. Keying on source.id too means an
      // already-mounted player re-pins its own stream instead of silently losing
      // the badge and revealing the seek bar.
    }, [manager, live, source.id]);

    useEffect(() => {
      if (!orientation || orientation === 'auto') {
        return;
      }
      manager.setOrientation(orientation);
      return () => manager.setOrientation('auto');
    }, [manager, orientation]);

    useEffect(() => {
      // An explicit `fullscreenOrientation` is the specific form and wins;
      // `rotation` is the boolean shorthand for "follow the sensor", which is
      // what 'auto' means to both engines (Android FULL_SENSOR, iOS an empty
      // lock so the fullscreen mask applies).
      const lock = fullscreenOrientation ?? (rotation ? 'auto' : null);
      if (!lock) {
        return;
      }
      manager.setFullscreenOrientation(lock);
      return () => manager.setFullscreenOrientation(null);
    }, [manager, fullscreenOrientation, rotation]);

    // Opt-in YouTube-style auto fullscreen on physical rotation: rotating the
    // device to landscape enters fullscreen and rotating back exits. Enters
    // with 'auto' (not a forced lock) so the device sensor keeps driving and
    // rotating back can exit. Needs the app to allow landscape at the OS level.
    const rotateIntoFullscreen = componentRotation || autoFullscreenOnRotate;
    useEffect(() => {
      if (!rotateIntoFullscreen) {
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
    }, [manager, id, rotateIntoFullscreen]);

    // pauseOnFocusLost itself is handled by VideoManager (see setSource's
    // pauseOnFocusLostIntent) — surface-independent by design, so it keeps
    // working when the video moves to fullscreen or floating. A component-
    // local, surfaceId-scoped listener here would silently stop firing the
    // moment ownership moved off this component's own surface.

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
        // never pause a video that has already handed off elsewhere. Same
        // reasoning as the background pause: navigating away isn't the viewer
        // pausing, so re-focusing must be able to resume.
        manager.pauseForFocusLoss();
      }
    }, [manager, id, isFocused]);

    useVideoEvents({
      onLoad: onLoadComplete,
      onBuffer: (e) => onBuffering?.(e.buffering),
      onError,
    });

    // Both url and youtube render into the same native surface — the native
    // core hosts either the player view or a re-parentable WebView.
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
