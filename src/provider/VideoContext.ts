import { createContext, useContext } from 'react';
import { VideoManager } from '../core/VideoManager';

export const VideoContext = createContext<VideoManager | null>(null);

/**
 * Returns the app-wide VideoManager. Falls back to the shared singleton so
 * the API also works outside the provider (e.g. headless/background code).
 */
export function useVideoManager(): VideoManager {
  return useContext(VideoContext) ?? VideoManager.shared;
}
