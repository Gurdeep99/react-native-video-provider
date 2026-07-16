import { useEffect } from 'react';
import { BackHandler, StatusBar, StyleSheet, View } from 'react-native';
import { FULLSCREEN_SURFACE_ID } from '../core/VideoManager';
import { usePlayback } from '../hooks/usePlayback';
import { useVideoManager } from '../provider/VideoContext';
import { VideoControls } from './VideoControls';
import { VideoSurface } from './VideoSurface';

/**
 * Built-in fullscreen host, rendered by VideoProvider. While visible,
 * rotation is unlocked natively (all orientations allowed); on exit the
 * previous orientation lock is restored and the player re-attaches to the
 * surface it came from.
 *
 * Implemented as an in-window absolute overlay (not a Modal). A Modal is a
 * separate Android window, and re-parenting the player's TextureView into it
 * — then rotating — drops the video surface (black screen, audio only) for
 * live streams. The floating host already proves in-window re-parenting is
 * reliable, so fullscreen uses the same approach.
 *
 * Rendered automatically — you normally never mount this yourself. Apps
 * that want fullscreen "inside" a navigation screen can instead render a
 * plain <VideoSurface> there and call attach().
 */
export function FullscreenPlayer() {
  const manager = useVideoManager();
  const fullscreen = usePlayback((s) => s.fullscreen);

  // Android hardware back exits fullscreen (Modal used to do this for us).
  useEffect(() => {
    if (!fullscreen) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      manager.exitFullscreen();
      return true;
    });
    return () => sub.remove();
  }, [manager, fullscreen]);

  if (!fullscreen) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      <StatusBar hidden />
      <VideoSurface
        surfaceId={FULLSCREEN_SURFACE_ID}
        autoAttach
        style={styles.surface}
      />
      <VideoControls onClose={() => manager.exitFullscreen()} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    // Above the app tree and the floating host (provider renders us last too).
    zIndex: 9999,
    elevation: 9999,
  },
  surface: {
    flex: 1,
  },
});
