import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { AppState, StyleSheet, View, type ViewProps } from 'react-native';
import { VideoManager } from '../core/VideoManager';
import { useVideoManager } from '../provider/VideoContext';
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
   */
  fullscreenOrientation?: OrientationLock;
  /**
   * Pause this player when it loses focus — i.e. the app goes to the
   * background while this player's surface is the one currently playing.
   * Default `true`. Set `false` to keep playing (e.g. background audio).
   * Only the focused player acts, so a video attached elsewhere is untouched.
   */
  pauseOnFocusLost?: boolean;
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
      pauseOnFocusLost = true,
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

    useImperativeHandle(ref, () => manager, [manager]);

    useEffect(() => {
      manager.setSource(source, { autoplay, surfaceId: id });
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

    useVideoEvents({
      onLoad: onLoadComplete,
      onBuffer: (e) => onBuffering?.(e.buffering),
      onError,
    });

    return (
      <View style={[styles.container, style]} {...rest}>
        <VideoSurface surfaceId={id} style={styles.surface} />
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
