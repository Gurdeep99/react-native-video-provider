import { useCallback } from 'react';
import { useVideoManager } from '../provider/VideoContext';
import { usePlayback } from './usePlayback';

export function useFullscreen() {
  const manager = useVideoManager();
  const isFullscreen = usePlayback((s) => s.fullscreen);

  const enter = useCallback(() => manager.enterFullscreen(), [manager]);
  const exit = useCallback(() => manager.exitFullscreen(), [manager]);
  const toggle = useCallback(() => manager.toggleFullscreen(), [manager]);

  return { isFullscreen, enter, exit, toggle };
}
