import NativeAuVideo from '../NativeAuVideo';
import { FULLSCREEN_SURFACE_ID, VideoManager } from '../core/VideoManager';
import type { VideoSource } from '../types/video';

jest.mock('../NativeAuVideo', () => ({
  __esModule: true,
  default: {
    nativeInit: jest.fn(),
    setSource: jest.fn(),
    preload: jest.fn(),
    play: jest.fn(),
    pause: jest.fn(),
    stop: jest.fn(),
    seekTo: jest.fn(),
    setRate: jest.fn(),
    setVolume: jest.fn(),
    setMuted: jest.fn(),
    setRepeat: jest.fn(),
    setResizeMode: jest.fn(),
    setOrientation: jest.fn(),
    attach: jest.fn(),
    detach: jest.fn(),
    enterFullscreen: jest.fn(),
    exitFullscreen: jest.fn(),
    enterPip: jest.fn().mockResolvedValue(true),
    exitPip: jest.fn(),
    getPosition: jest.fn().mockResolvedValue(0),
    releasePlayer: jest.fn(),
    onStatusChange: jest.fn(() => ({ remove: jest.fn() })),
    onLoad: jest.fn(() => ({ remove: jest.fn() })),
    onProgress: jest.fn(() => ({ remove: jest.fn() })),
    onSeek: jest.fn(() => ({ remove: jest.fn() })),
    onEnd: jest.fn(() => ({ remove: jest.fn() })),
    onError: jest.fn(() => ({ remove: jest.fn() })),
    onAttach: jest.fn(() => ({ remove: jest.fn() })),
    onDetach: jest.fn(() => ({ remove: jest.fn() })),
    onPipChange: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

const native = NativeAuVideo as jest.Mocked<typeof NativeAuVideo>;

const video = (id: string): VideoSource => ({
  id,
  uri: `https://example.com/${id}.mp4`,
  title: id,
});

describe('VideoManager', () => {
  const manager = VideoManager.shared;

  beforeEach(() => {
    manager.destroy();
    jest.clearAllMocks();
    manager.init();
  });

  it('is a singleton', () => {
    expect(VideoManager.shared).toBe(VideoManager.shared);
  });

  it('initializes the native player exactly once', () => {
    manager.init();
    manager.init();
    expect(native.nativeInit).toHaveBeenCalledTimes(1);
  });

  describe('same-video handoff', () => {
    it('loads a new source', () => {
      manager.setSource(video('a'));
      expect(native.setSource).toHaveBeenCalledTimes(1);
      expect(manager.store.getState().currentVideo?.id).toBe('a');
      expect(manager.store.getState().status).toBe('loading');
    });

    it('does NOT reload when the same video id is set again', () => {
      manager.setSource(video('a'));
      native.setSource.mockClear();

      manager.setSource(video('a'), { surfaceId: 'detail' });

      expect(native.setSource).not.toHaveBeenCalled();
      expect(native.attach).toHaveBeenCalledWith('detail');
    });

    it('replaces the source when the video id changes', () => {
      manager.setSource(video('a'));
      manager.setSource(video('b'));
      expect(native.setSource).toHaveBeenCalledTimes(2);
      expect(manager.store.getState().currentVideo?.id).toBe('b');
    });
  });

  describe('surfaces', () => {
    it('attach updates the store and native side', () => {
      manager.attach('feed');
      expect(native.attach).toHaveBeenCalledWith('feed');
      expect(manager.store.getState().surfaceId).toBe('feed');
      expect(manager.store.getState().mode).toBe('inline');
    });

    it('surface unmount clears state only for the active surface', () => {
      manager.attach('feed');
      manager.handleSurfaceUnmount('other');
      expect(manager.store.getState().surfaceId).toBe('feed');

      manager.handleSurfaceUnmount('feed');
      expect(manager.store.getState().surfaceId).toBeNull();
    });
  });

  describe('fullscreen', () => {
    it('locks landscape by default and restores the previous surface on exit', () => {
      manager.attach('feed');
      manager.enterFullscreen();

      // Default fullscreen locks landscape (no sensor rotation).
      expect(native.enterFullscreen).toHaveBeenLastCalledWith('landscape');
      expect(manager.store.getState().fullscreen).toBe(true);
      expect(manager.store.getState().mode).toBe('fullscreen');

      // Built-in host mounts and attaches its own surface.
      manager.attach(FULLSCREEN_SURFACE_ID);

      manager.exitFullscreen();
      expect(native.exitFullscreen).toHaveBeenLastCalledWith('auto');
      expect(manager.store.getState().fullscreen).toBe(false);
      // Player returned to the surface it came from.
      expect(native.attach).toHaveBeenLastCalledWith('feed');
      expect(manager.store.getState().mode).toBe('inline');
    });

    it('enter/exit are idempotent', () => {
      manager.enterFullscreen();
      manager.enterFullscreen();
      expect(native.enterFullscreen).toHaveBeenCalledTimes(1);

      manager.exitFullscreen();
      manager.exitFullscreen();
      expect(native.exitFullscreen).toHaveBeenCalledTimes(1);
    });
  });

  describe('orientation', () => {
    it('forwards locks to native and tracks them in state', () => {
      manager.setOrientation('landscape');
      expect(native.setOrientation).toHaveBeenLastCalledWith('landscape');
      expect(manager.store.getState().orientationLock).toBe('landscape');

      manager.setOrientation('auto');
      expect(native.setOrientation).toHaveBeenLastCalledWith('auto');
      expect(manager.store.getState().orientationLock).toBe('auto');
    });

    it('applies a scoped orientation atomically with enterFullscreen (no separate call)', () => {
      manager.enterFullscreen('portrait');
      expect(native.enterFullscreen).toHaveBeenLastCalledWith('portrait');
      expect(native.setOrientation).not.toHaveBeenCalled();

      manager.exitFullscreen();
      // No standing lock was set, so exit restores 'auto' — the rest of the
      // app is unaffected.
      expect(native.exitFullscreen).toHaveBeenLastCalledWith('auto');
    });

    it('a scoped orientation always wins over any other state (highest priority)', () => {
      manager.setOrientation('inverted-portrait');
      manager.enterFullscreen('landscape');
      // The explicit fullscreen argument beats the standing lock outright.
      expect(native.enterFullscreen).toHaveBeenLastCalledWith('landscape');

      manager.exitFullscreen();
      // The standing lock (set before fullscreen) is restored afterward.
      expect(native.exitFullscreen).toHaveBeenLastCalledWith(
        'inverted-portrait'
      );
    });

    it('defaults to landscape even with a standing portrait lock, and restores it on exit', () => {
      // The `lockPortrait` use case: app is portrait inline, fullscreen still
      // rotates to landscape; exiting returns to the portrait lock.
      manager.setOrientation('portrait');
      manager.enterFullscreen(); // no scoped override
      expect(native.enterFullscreen).toHaveBeenLastCalledWith('landscape');

      manager.exitFullscreen();
      expect(native.exitFullscreen).toHaveBeenLastCalledWith('portrait');
    });

    it('uses the registered per-player default and ignores event args', () => {
      manager.setFullscreenOrientation('portrait');
      // Built-in controls call enterFullscreen with no argument; hook `enter`
      // may be passed to onPress and receive a press event.
      manager.enterFullscreen({ nativeEvent: {} } as never);
      expect(native.enterFullscreen).toHaveBeenLastCalledWith('portrait');

      manager.exitFullscreen();
      expect(native.exitFullscreen).toHaveBeenLastCalledWith('auto');

      manager.setFullscreenOrientation(null);
      manager.enterFullscreen();
      // No prop, no standing lock → default landscape lock (no sensor).
      expect(native.enterFullscreen).toHaveBeenLastCalledWith('landscape');
    });

    it('follows the sensor only when entered with explicit auto', () => {
      // autoFullscreenOnRotate enters this way to allow rotate-back-to-exit.
      manager.enterFullscreen('auto');
      expect(native.enterFullscreen).toHaveBeenLastCalledWith('auto');
    });

    it('lockPortrait config locks the app portrait on init', () => {
      manager.destroy();
      jest.clearAllMocks();
      manager.init({ lockPortrait: true });
      expect(native.setOrientation).toHaveBeenLastCalledWith('portrait');
      expect(manager.store.getState().orientationLock).toBe('portrait');

      // Reset so the leaked config doesn't affect later tests (init merges
      // config and destroy() keeps it).
      manager.destroy();
      manager.init({ lockPortrait: false });
    });
  });

  describe('youtube routing', () => {
    const youtube = (id: string): VideoSource => ({
      id,
      uri: 'ytVideoId',
      type: 'youtube',
    });

    it('does not touch the native engine for youtube sources', () => {
      manager.setSource(youtube('yt1'));
      expect(native.setSource).not.toHaveBeenCalled();
      expect(manager.store.getState().currentVideo?.type).toBe('youtube');
      expect(manager.store.getState().status).toBe('loading');
    });

    it('routes commands to the registered youtube controller', () => {
      const controller = {
        videoId: 'ytVideoId',
        play: jest.fn(),
        pause: jest.fn(),
        stop: jest.fn(),
        seekTo: jest.fn(),
        setRate: jest.fn(),
        setVolume: jest.fn(),
        setMuted: jest.fn(),
        setRepeat: jest.fn(),
      };
      manager.setSource(youtube('yt1'), { autoplay: false });
      manager.registerYouTube(controller);

      manager.play();
      expect(controller.play).toHaveBeenCalledTimes(1);
      expect(native.play).not.toHaveBeenCalled();

      manager.store.setState({ duration: 100 });
      manager.seek(30);
      expect(controller.seekTo).toHaveBeenLastCalledWith(30);
      expect(native.seekTo).not.toHaveBeenCalled();
    });

    it('reports youtube state back into the store', () => {
      manager.setSource(youtube('yt1'), { autoplay: false });
      manager.ytLoad(120);
      expect(manager.store.getState().duration).toBe(120);
      expect(manager.store.getState().loading).toBe(false);

      manager.ytStatus('playing');
      expect(manager.store.getState().playing).toBe(true);
    });
  });

  describe('floating', () => {
    it('toggles floating mode and restores the inline surface', () => {
      manager.attach('feed');
      manager.showFloating();
      expect(manager.store.getState().floating).toBe(true);
      expect(manager.store.getState().mode).toBe('floating');

      manager.hideFloating();
      expect(manager.store.getState().floating).toBe(false);
      expect(native.attach).toHaveBeenLastCalledWith('feed');
    });
  });

  it('seek clamps into [0, duration]', () => {
    manager.store.setState({ duration: 100 });
    manager.seek(500);
    expect(native.seekTo).toHaveBeenLastCalledWith(100);
    manager.seek(-5);
    expect(native.seekTo).toHaveBeenLastCalledWith(0);
  });

  it('volume clamps into [0, 1]', () => {
    manager.setVolume(2);
    expect(native.setVolume).toHaveBeenLastCalledWith(1);
    expect(manager.store.getState().volume).toBe(1);
  });
});
