import type { PlayerMode, VideoError, VideoSource } from './video';

export interface VideoEventMap {
  onLoad: { videoId: string; duration: number; width: number; height: number };
  onReady: { videoId: string };
  onPlay: undefined;
  onPause: undefined;
  onBuffer: { buffering: boolean };
  onSeek: { position: number };
  onProgress: { position: number; duration: number; buffered: number };
  onEnd: undefined;
  onError: VideoError;
  onEnterFullscreen: undefined;
  onExitFullscreen: undefined;
  onAttach: { surfaceId: string };
  onDetach: { surfaceId: string };
  onModeChanged: { mode: PlayerMode };
  onVideoChanged: { video: VideoSource | null };
  onPipChanged: { active: boolean };
}

export type VideoEventName = keyof VideoEventMap;
