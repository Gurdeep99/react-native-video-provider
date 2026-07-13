import { useCallback } from 'react';
import { useVideoManager } from '../provider/VideoContext';
import { usePlayback } from './usePlayback';

export function usePiP() {
  const manager = useVideoManager();
  const isActive = usePlayback((s) => s.pip);

  const enter = useCallback(() => manager.enterPiP(), [manager]);
  const exit = useCallback(() => manager.exitPiP(), [manager]);

  return { isActive, enter, exit };
}
