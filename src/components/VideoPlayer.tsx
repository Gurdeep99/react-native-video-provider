import { useEffect } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { useVideoManager } from '../provider/VideoContext';
import type { OrientationLock, ResizeMode, VideoSource } from '../types/video';
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
  /**
   * Force the screen into this orientation while the player is mounted:
   * `'landscape'`, `'inverted-landscape'`, `'portrait'` or
   * `'inverted-portrait'`. Released (back to `'auto'`) on unmount.
   */
  orientation?: OrientationLock;
}

/**
 * Convenience all-in-one player: `setSource` (same-video handoff aware) +
 * `attach` + surface + optional controls. Rendering two VideoPlayers with
 * the same source id moves the ONE engine — it never creates a second one.
 *
 * ```tsx
 * <VideoPlayer source={{ id: '123', uri }} style={{ aspectRatio: 16 / 9 }} />
 * ```
 */
export function VideoPlayer({
  source,
  autoplay = true,
  surfaceId,
  controls = true,
  resizeMode,
  orientation,
  style,
  ...rest
}: VideoPlayerProps) {
  const manager = useVideoManager();
  const id = surfaceId ?? `player:${source.id}`;

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
    if (!orientation || orientation === 'auto') {
      return;
    }
    manager.setOrientation(orientation);
    return () => manager.setOrientation('auto');
  }, [manager, orientation]);

  return (
    <View style={[styles.container, style]} {...rest}>
      <VideoSurface surfaceId={id} style={styles.surface} />
      {controls ? <VideoControls /> : null}
    </View>
  );
}

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
