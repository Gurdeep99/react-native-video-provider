import { useEffect, useRef } from 'react';
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
import type { OrientationLock, TopIconRenderer } from '../types/video';
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
  const live = usePlayback((s) => s.live);
  const leftTopIcon: TopIconRenderer | null = usePlayback((s) => s.leftTopIcon);
  const rightTopIcon: TopIconRenderer | null = usePlayback((s) => s.rightTopIcon);

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
  // fullscreen is ALREADY active (not on the transition into fullscreen —
  // see wasFullscreen below).
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
  const wasFullscreen = useRef(false);
  useEffect(() => {
    if (!fullscreen) {
      wasFullscreen.current = false;
      return;
    }
    if (!wasFullscreen.current) {
      // Just entered fullscreen: <VideoSurface autoAttach> below already
      // attaches on its own mount. Calling attach() again here raced it —
      // two reparent/native-rebind cycles back to back for the same surface,
      // which is a real source of the visible glitch/frame-skip on entry.
      wasFullscreen.current = true;
      return;
    }
    // Only re-attach when coming BACK online — going offline doesn't need a
    // re-attach, and doing one triggers resumeOnFocus() inside attach() which
    // would restart the player we just network-paused.
    if (!online) {
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
      {/* Live badges rendered at the FullscreenPlayer level — directly in the
          Modal's view hierarchy, AFTER VideoControls — so they reliably paint
          on top of the native AVPlayerLayer / TextureView. Inside VideoControls
          they're siblings of the absoluteFill surface overlay, but on iOS
          Modals the native video layer can composite above regular RN views,
          hiding the badges even with zIndex. Rendering here as the last
          children of the Modal container guarantees they sit on top. */}
      {live && leftTopIcon ? (
        <View style={styles.fsBadgeLeft} pointerEvents="none">
          {leftTopIcon()}
        </View>
      ) : null}
      {live && rightTopIcon ? (
        <View style={styles.fsBadgeRight} pointerEvents="none">
          {rightTopIcon()}
        </View>
      ) : null}
    </>
  );

  if (Platform.OS === 'ios') {
    return (
      <Modal
        visible
        transparent={false}
        animationType="none"
        presentationStyle="fullScreen"
        statusBarTranslucent
        supportedOrientations={modalOrientations(fullscreenLock)}
        onRequestClose={() => manager.exitFullscreen()}
        // <VideoSurface autoAttach> below attaches as soon as it mounts —
        // which, under a Modal, is before the modal has actually finished
        // presenting (it's a genuinely new window, not just a subview add).
        // The AVPlayerLayer can end up parented into a view the window
        // compositor hasn't connected yet: audio plays, black frame. Once
        // the Modal confirms it's actually up, force a reassert regardless
        // of whether the surface pointer looks unchanged.
        //
        // animationType="none" eliminates the fade transition so it doesn't
        // layer a JS-driven animation on top of the system rotation animation —
        // the combination produced a visible glitch on portrait→landscape entry.
        // The system rotation animation alone already looks correct and natural.
        //
        // Two reasserts: the first fires immediately on Modal confirmation;
        // the second catches devices where the window compositor takes longer
        // to connect (surface was valid but the CALayer draw cycle hadn't run).
        onShow={() => {
          manager.reassertVideoOutput();
          setTimeout(() => manager.reassertVideoOutput(), 150);
        }}
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
  // Fullscreen-level live badges — rendered as the last children of the Modal
  // container so they sit on top of everything, including the native video
  // layer. Matches the insets from VideoControls' fullscreen badge styles.
  fsBadgeLeft: {
    position: 'absolute',
    top: 20,
    left: 44,
    zIndex: 10,
    elevation: 10,
  },
  fsBadgeRight: {
    position: 'absolute',
    top: 20,
    right: 44,
    zIndex: 10,
    elevation: 10,
  },
});
