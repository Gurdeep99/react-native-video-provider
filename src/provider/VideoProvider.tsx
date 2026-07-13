import { useEffect, useMemo, type PropsWithChildren } from 'react';
import { VideoManager } from '../core/VideoManager';
import type { VideoProviderConfig } from '../types/video';
import { VideoContext } from './VideoContext';
import { FullscreenPlayer } from '../components/FullscreenPlayer';
import { FloatingPlayer } from '../components/FloatingPlayer';

export interface VideoProviderProps extends PropsWithChildren {
  config?: VideoProviderConfig;
}

/**
 * Wrap the app once. Creates the singleton native player silently and
 * mounts the fullscreen/floating hosts above the app so `enterFullscreen()`
 * and `showFloating()` work from any screen.
 *
 * ```tsx
 * <VideoProvider>
 *   <Navigation />
 * </VideoProvider>
 * ```
 */
export function VideoProvider({ children, config }: VideoProviderProps) {
  const manager = useMemo(() => VideoManager.shared, []);

  useEffect(() => {
    manager.init(config);
    // Intentionally no destroy on unmount: the engine outlives React trees
    // (and survives Fast Refresh). Call manager.destroy() explicitly to tear down.
  }, [manager, config]);

  const cfg = manager.providerConfig;

  return (
    <VideoContext.Provider value={manager}>
      {children}
      {cfg.floatingHost !== false ? <FloatingPlayer /> : null}
      {cfg.fullscreenHost !== false ? <FullscreenPlayer /> : null}
    </VideoContext.Provider>
  );
}
