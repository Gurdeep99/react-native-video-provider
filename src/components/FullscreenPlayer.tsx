import { useEffect } from 'react';
import {
  BackHandler,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { FULLSCREEN_SURFACE_ID } from '../core/VideoManager';
import { usePlayback } from '../hooks/usePlayback';
import { useVideoManager } from '../provider/VideoContext';
import type { OrientationLock } from '../types/video';
import { VideoControls } from './VideoControls';
import { VideoSurface } from './VideoSurface';
import { YouTubeView } from './YouTubeView';

type ModalOrientation =
  | 'portrait'
  | 'portrait-upside-down'
  | 'landscape'
  | 'landscape-left'
  | 'landscape-right';

const ALL_ORIENTATIONS: ModalOrientation[] = [
  'portrait',
  'portrait-upside-down',
  'landscape',
  'landscape-left',
  'landscape-right',
];

/** Which orientations the iOS Modal may present — this is what locks it. */
function modalOrientations(lock: OrientationLock): ModalOrientation[] {
  switch (lock) {
    case 'portrait':
    case 'inverted-portrait':
      return ['portrait', 'portrait-upside-down'];
    case 'landscape':
    case 'inverted-landscape':
      return ['landscape', 'landscape-left', 'landscape-right'];
    default:
      return ALL_ORIENTATIONS; // 'auto' → follow the sensor
  }
}

/**
 * Built-in fullscreen host, rendered by VideoProvider.
 *
 * Platform split:
 * - iOS uses a `Modal` whose `supportedOrientations` are derived from the
 *   locked fullscreen orientation. That's how iOS rotates a fullscreen video
 *   (and locks out the portrait sensor) WITHOUT app-wide landscape config.
 * - Android uses an in-window absolute overlay (a Modal is a separate window,
 *   and re-parenting the player's TextureView into it drops the video surface
 *   — black screen, audio only — for live streams). Rotation is driven by the
 *   native `requestedOrientation` lock.
 */
export function FullscreenPlayer() {
  const manager = useVideoManager();
  const fullscreen = usePlayback((s) => s.fullscreen);
  const fullscreenLock = usePlayback((s) => s.fullscreenLock);
  const currentVideo = usePlayback((s) => s.currentVideo);

  // Android hardware back exits fullscreen (the iOS Modal handles its own).
  useEffect(() => {
    if (!fullscreen || Platform.OS !== 'android') {
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

  const isYouTube = currentVideo?.type === 'youtube';
  const media = isYouTube ? (
    <YouTubeView
      videoId={currentVideo!.uri}
      autoplay
      muted={manager.store.getState().muted}
      repeat={manager.store.getState().repeat}
      startSeconds={manager.store.getState().position}
      style={styles.surface}
    />
  ) : (
    <VideoSurface
      surfaceId={FULLSCREEN_SURFACE_ID}
      autoAttach
      style={styles.surface}
    />
  );

  const content = (
    <>
      <StatusBar hidden />
      {media}
      <VideoControls onClose={() => manager.exitFullscreen()} />
    </>
  );

  if (Platform.OS === 'ios') {
    return (
      <Modal
        visible
        transparent={false}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        supportedOrientations={modalOrientations(fullscreenLock)}
        onRequestClose={() => manager.exitFullscreen()}
      >
        <View style={styles.container}>{content}</View>
      </Modal>
    );
  }

  return <View style={styles.overlay}>{content}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
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
