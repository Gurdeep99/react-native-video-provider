import { useCallback } from 'react';
import { useVideoManager } from '../provider/VideoContext';
import type { OrientationLock } from '../types/video';
import { usePlayback } from './usePlayback';

export function useFullscreen() {
  const manager = useVideoManager();
  const isFullscreen = usePlayback((s) => s.fullscreen);
  const orientationLock = usePlayback((s) => s.orientationLock);

  const enter = useCallback(() => manager.enterFullscreen(), [manager]);
  const exit = useCallback(() => manager.exitFullscreen(), [manager]);
  const toggle = useCallback(() => manager.toggleFullscreen(), [manager]);
  const setOrientation = useCallback(
    (lock: OrientationLock) => manager.setOrientation(lock),
    [manager]
  );

  return { isFullscreen, enter, exit, toggle, orientationLock, setOrientation };
}
