import { useEffect, useRef } from 'react';
import { useVideoManager } from '../provider/VideoContext';
import type { VideoEventMap, VideoEventName } from '../types/events';

export type VideoEventHandlers = {
  [K in VideoEventName]?: (payload: VideoEventMap[K]) => void;
};

/**
 * Subscribe to player events for the lifetime of the component.
 * Handlers are kept in a ref, so inline functions are fine.
 *
 * ```tsx
 * useVideoEvents({ onEnd: () => next(), onError: (e) => report(e) });
 * ```
 */
export function useVideoEvents(handlers: VideoEventHandlers): void {
  const manager = useVideoManager();
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const names = Object.keys(ref.current) as VideoEventName[];
    const subs = names.map((name) =>
      manager.addListener(name, (payload) => {
        const handler = ref.current[name] as
          | ((p: VideoEventMap[typeof name]) => void)
          | undefined;
        handler?.(payload);
      })
    );
    return () => subs.forEach((s) => s.remove());
  }, [manager]);
}
