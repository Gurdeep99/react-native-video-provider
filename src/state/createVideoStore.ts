import { createStore, type StoreApi } from 'zustand/vanilla';
import type { VideoState } from '../types/video';

export const initialVideoState: VideoState = {
  currentVideo: null,
  status: 'idle',
  playing: false,
  paused: false,
  buffering: false,
  loading: false,
  position: 0,
  duration: 0,
  buffered: 0,
  rate: 1,
  volume: 1,
  muted: false,
  repeat: false,
  resizeMode: 'contain',
  fullscreen: false,
  pip: false,
  floating: false,
  mode: 'hidden',
  surfaceId: null,
  videoWidth: 0,
  videoHeight: 0,
  error: null,
};

export type VideoStore = StoreApi<VideoState>;

export function createVideoStore(): VideoStore {
  return createStore<VideoState>()(() => ({ ...initialVideoState }));
}
