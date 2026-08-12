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
  const online = usePlayback((s) => s.online);

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

  // Re-attach the fullscreen surface whenever connectivity is restored while
  // fullscreen is active.
  //
  // A network drop can cause iOS UIKit to silently recreate the Modal's view
  // hierarchy, which invalidates the UIView pointer held by the native surface
  // registry without triggering a JS unmount. When that happens,
  // reassertVideoOutput() can't find the container and the player stays parented
  // to a stale (invisible) view — audio plays, black screen.
  //
  // Calling attach() here refreshes the registry pointer: the surface is still
  // mounted, so the native view is valid; attach() re-parents the AVPlayerLayer
  // / TextureView into it, clearing the black frame. This runs on every online
  // change so that an offline → online transition always heals the output.
  useEffect(() => {
    if (!fullscreen) {
      return;
    }
    manager.attach(FULLSCREEN_SURFACE_ID);
  }, [manager, fullscreen, online]);

  if (!fullscreen) {
    return null;
  }

  const content = (
    <>
      <StatusBar hidden />
      <VideoSurface
        surfaceId={FULLSCREEN_SURFACE_ID}
        autoAttach
        style={styles.surface}
      />
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
