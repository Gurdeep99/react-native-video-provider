import { Modal, StatusBar, StyleSheet, View } from 'react-native';
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
 * Rendered automatically — you normally never mount this yourself. Apps
 * that want fullscreen "inside" a navigation screen can instead render a
 * plain <VideoSurface> there and call attach().
 */
export function FullscreenPlayer() {
  const manager = useVideoManager();
  const fullscreen = usePlayback((s) => s.fullscreen);

  if (!fullscreen) {
    return null;
  }

  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={[
        'portrait',
        'portrait-upside-down',
        'landscape',
        'landscape-left',
        'landscape-right',
      ]}
      onRequestClose={() => manager.exitFullscreen()}
    >
      <StatusBar hidden />
      <View style={styles.container}>
        <VideoSurface
          surfaceId={FULLSCREEN_SURFACE_ID}
          autoAttach
          style={styles.surface}
        />
        <VideoControls onClose={() => manager.exitFullscreen()} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  surface: {
    flex: 1,
  },
});
