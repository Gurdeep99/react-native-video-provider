import { useEffect } from 'react';
import type { ViewProps } from 'react-native';
import AuVideoSurfaceNativeComponent from '../AuVideoSurfaceNativeComponent';
import { useVideoManager } from '../provider/VideoContext';

export interface VideoSurfaceProps extends ViewProps {
  /** Id this surface registers under. Attach the player with `attach(id)`. */
  surfaceId: string;
  /** Attach the player to this surface as soon as it mounts. Default false. */
  autoAttach?: boolean;
}

/**
 * A dumb rendering surface. It never creates a player — it only marks a
 * spot where the singleton engine can render. Mount as many as you like;
 * the player shows in at most one at a time.
 *
 * ```tsx
 * <VideoSurface surfaceId="feed" style={{ aspectRatio: 16 / 9 }} />
 * ```
 */
export function VideoSurface({ surfaceId, autoAttach = false, ...rest }: VideoSurfaceProps) {
  const manager = useVideoManager();

  useEffect(() => {
    if (autoAttach) {
      manager.attach(surfaceId);
    }
    return () => {
      manager.handleSurfaceUnmount(surfaceId);
    };
  }, [manager, surfaceId, autoAttach]);

  return <AuVideoSurfaceNativeComponent surfaceId={surfaceId} {...rest} />;
}
