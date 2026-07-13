import { useCallback } from 'react';
import { useVideoManager } from '../provider/VideoContext';
import type { OrientationLock } from '../types/video';
import { usePlayback } from './usePlayback';

export function useFullscreen() {
  const manager = useVideoManager();
  const isFullscreen = usePlayback((s) => s.fullscreen);
  const orientationLock = usePlayback((s) => s.orientationLock);

  const enter = useCallback(
    (orientation?: OrientationLock) => manager.enterFullscreen(orientation),
    [manager]
  );
  const exit = useCallback(() => manager.exitFullscreen(), [manager]);
  const toggle = useCallback(
    (orientation?: OrientationLock) => manager.toggleFullscreen(orientation),
    [manager]
  );
  const setOrientation = useCallback(
    (lock: OrientationLock) => manager.setOrientation(lock),
    [manager]
  );

  return { isFullscreen, enter, exit, toggle, orientationLock, setOrientation };
}
