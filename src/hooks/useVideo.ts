import { useVideoManager } from '../provider/VideoContext';
import type { VideoManager } from '../core/VideoManager';

/**
 * Command API for the singleton player:
 * `play, pause, resume, toggle, stop, seek, seekBy, setSource, preload,
 * attach, detach, enterFullscreen, exitFullscreen, showFloating,
 * hideFloating, enterPiP, exitPiP, setRate, setVolume, mute, unmute,
 * setRepeat, setResizeMode, addListener, destroy` — plus `store` for
 * imperative reads (`useVideo().store.getState()`).
 *
 * Commands never cause re-renders; subscribe with `usePlayback()` for state.
 */
export function useVideo(): VideoManager {
  return useVideoManager();
}
