/**
 * Implemented by the mounted YouTube WebView (see `YouTubeView`) and
 * registered on the VideoManager, which forwards playback commands to it when
 * the current source is `type: 'youtube'`. The WebView reports state back via
 * the manager's `yt*` callbacks.
 */
export interface YouTubeController {
  /** The YouTube video id this controller drives. */
  readonly videoId: string;
  play(): void;
  pause(): void;
  stop(): void;
  /** @param seconds absolute position */
  seekTo(seconds: number): void;
  setRate(rate: number): void;
  /** @param volume 0..1 */
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setRepeat(repeat: boolean): void;
}
