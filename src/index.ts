export {
  VideoProvider,
  type VideoProviderProps,
} from './provider/VideoProvider';
export { useVideoManager } from './provider/VideoContext';
export {
  VideoManager,
  FULLSCREEN_SURFACE_ID,
  FLOATING_SURFACE_ID,
} from './core/VideoManager';

export {
  VideoSurface,
  type VideoSurfaceProps,
} from './components/VideoSurface';
export { VideoPlayer, type VideoPlayerProps } from './components/VideoPlayer';
export {
  VideoFeed,
  feedSurfaceId,
  type VideoFeedProps,
  type VideoFeedRenderInfo,
} from './components/VideoFeed';
export { FullscreenPlayer } from './components/FullscreenPlayer';
export {
  FloatingPlayer,
  type FloatingPlayerProps,
} from './components/FloatingPlayer';
export { MiniPlayer, type MiniPlayerProps } from './components/MiniPlayer';
export {
  VideoControls,
  type VideoControlsProps,
} from './components/VideoControls';
export {
  GestureOverlay,
  type GestureOverlayProps,
} from './components/GestureOverlay';

export { useVideo } from './hooks/useVideo';
export { usePlayback } from './hooks/usePlayback';
export { useFullscreen } from './hooks/useFullscreen';
export { usePiP } from './hooks/usePiP';
export {
  useVideoEvents,
  type VideoEventHandlers,
} from './hooks/useVideoEvents';

export { formatTime } from './utils/formatTime';

export type {
  VideoSource,
  ResizeMode,
  OrientationLock,
  PlayerMode,
  PlaybackStatus,
  VideoError,
  VideoState,
  SetSourceOptions,
  VideoProviderConfig,
  VideoEventMap,
  VideoEventName,
} from './types';
