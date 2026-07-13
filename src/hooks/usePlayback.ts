import { useStore } from 'zustand';
import { useVideoManager } from '../provider/VideoContext';
import type { VideoState } from '../types/video';

const identity = (s: VideoState): VideoState => s;

/**
 * Subscribe to playback state. Pass a selector so your component only
 * re-renders for the fields it displays:
 *
 * ```tsx
 * const position = usePlayback((s) => s.position);
 * const { playing, duration } = usePlayback((s) => ({ ... }));
 * ```
 */
export function usePlayback(): VideoState;
export function usePlayback<T>(selector: (state: VideoState) => T): T;
export function usePlayback<T>(
  selector?: (state: VideoState) => T
): T | VideoState {
  const manager = useVideoManager();
  return useStore(
    manager.store,
    (selector ?? identity) as (state: VideoState) => T | VideoState
  );
}
