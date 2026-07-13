import { useCallback, useRef, type PropsWithChildren } from 'react';
import {
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

export interface GestureOverlayProps extends PropsWithChildren {
  onSingleTap?: () => void;
  onDoubleTapLeft?: () => void;
  onDoubleTapRight?: () => void;
  onLongPress?: () => void;
}

const DOUBLE_TAP_MS = 280;

/**
 * Tap layer for player chrome: single tap (toggle controls), double tap
 * left/right (seek back/forward), long press. Pinch/brightness/volume
 * gestures are on the roadmap (need native cooperation).
 */
export function GestureOverlay({
  onSingleTap,
  onDoubleTapLeft,
  onDoubleTapRight,
  onLongPress,
  children,
}: GestureOverlayProps) {
  const width = useRef(0);
  const lastTap = useRef(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    width.current = e.nativeEvent.layout.width;
  }, []);

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      const now = Date.now();
      const x = e.nativeEvent.locationX;

      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0;
        if (singleTapTimer.current) {
          clearTimeout(singleTapTimer.current);
          singleTapTimer.current = null;
        }
        if (x < width.current / 2) {
          onDoubleTapLeft?.();
        } else {
          onDoubleTapRight?.();
        }
        return;
      }

      lastTap.current = now;
      singleTapTimer.current = setTimeout(() => {
        singleTapTimer.current = null;
        onSingleTap?.();
      }, DOUBLE_TAP_MS);
    },
    [onSingleTap, onDoubleTapLeft, onDoubleTapRight]
  );

  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onLayout={onLayout}
      onPress={handlePress}
      onLongPress={onLongPress}
    >
      {children}
    </Pressable>
  );
}
