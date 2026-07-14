import { useRef } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { FLOATING_SURFACE_ID } from '../core/VideoManager';
import { usePlayback } from '../hooks/usePlayback';
import { useVideoManager } from '../provider/VideoContext';
import { CloseIcon, EnterFullscreenIcon } from './icons';
import { VideoSurface } from './VideoSurface';

export interface FloatingPlayerProps {
  /** Width of the floating window. Default 200. */
  width?: number;
}

/**
 * Built-in draggable in-app floating window, rendered by VideoProvider and
 * shown by `showFloating()`. Same engine, same position — expand returns
 * to fullscreen, ✕ hides the window (playback continues; call pause()
 * in onModeChanged if you want otherwise).
 */
export function FloatingPlayer({ width = 200 }: FloatingPlayerProps) {
  const manager = useVideoManager();
  const floating = usePlayback((s) => s.floating);
  const screen = useWindowDimensions();

  const height = (width * 9) / 16;
  const pan = useRef(
    new Animated.ValueXY({
      x: screen.width - width - 12,
      y: screen.height - height - 96,
    })
  ).current;

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        pan.extractOffset();
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
      },
    })
  ).current;

  if (!floating) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.window,
        { width, height, transform: pan.getTranslateTransform() },
      ]}
      {...responder.panHandlers}
    >
      <VideoSurface
        surfaceId={FLOATING_SURFACE_ID}
        autoAttach
        style={styles.surface}
      />
      <Pressable
        style={[styles.button, styles.closeButton]}
        hitSlop={8}
        onPress={() => manager.hideFloating()}
      >
        <CloseIcon size={12} color="#fff" />
      </Pressable>
      <Pressable
        style={[styles.button, styles.expandButton]}
        hitSlop={8}
        onPress={() => {
          manager.hideFloating();
          manager.enterFullscreen();
        }}
      >
        <EnterFullscreenIcon size={12} color="#fff" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  window: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  surface: {
    flex: 1,
  },
  button: {
    position: 'absolute',
    top: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    right: 4,
  },
  expandButton: {
    left: 4,
  },
});
