import NativeAuVideo from '../NativeAuVideo';
import { FULLSCREEN_SURFACE_ID, VideoManager } from '../core/VideoManager';
import type { VideoSource } from '../types/video';

jest.mock('../NativeAuVideo', () => ({
  __esModule: true,
  default: {
    nativeInit: jest.fn(),
    setSource: jest.fn(),
    preload: jest.fn(),
    reload: jest.fn(),
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
    onLiveChange: jest.fn(() => ({ remove: jest.fn() })),
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

  describe('youtube (native engine)', () => {
    const youtube = (id: string): VideoSource => ({
      id,
      uri: 'ytVideoId',
      type: 'youtube',
    });

    it('routes youtube sources through the native engine with type', () => {
      manager.setSource(youtube('yt1'), { autoplay: false });
      expect(native.setSource).toHaveBeenCalledTimes(1);
      expect(native.setSource).toHaveBeenLastCalledWith(
        expect.objectContaining({ uri: 'ytVideoId', type: 'youtube' }),
        false
      );
      expect(manager.store.getState().currentVideo?.type).toBe('youtube');
    });

    it('sends type "url" for a default source', () => {
      manager.setSource(video('a'), { autoplay: false });
      expect(native.setSource).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'a', type: 'url' }),
        false
      );
    });

    it('commands route to native for youtube too', () => {
      manager.setSource(youtube('yt1'), { autoplay: false });
      manager.play();
      expect(native.play).toHaveBeenCalledTimes(1);
      manager.store.setState({ duration: 100 });
      manager.seek(30);
      expect(native.seekTo).toHaveBeenLastCalledWith(30);
    });
  });

  describe('live badge + reload', () => {
    it('keeps the badge registered across live/not-live transitions', () => {
      const icon = () => null;
      manager.setLiveIcon(icon);
      manager.setLive(true);
      expect(manager.store.getState().liveIcon).toBe(icon);

      // A bare setLive(false) must not unregister the badge — that is what
      // made it disappear after an unmount/remount.
      manager.setLive(false);
      expect(manager.store.getState().liveIcon).toBe(icon);

      manager.setLive(true);
      expect(manager.store.getState().liveIcon).toBe(icon);
    });

    it('keeps the badge registered across a source change', () => {
      const icon = () => null;
      manager.setLiveIcon(icon);
      manager.setSource(video('a'));
      manager.setSource(video('b'));
      expect(manager.store.getState().liveIcon).toBe(icon);
    });

    it('reload rebuilds natively instead of re-issuing setSource', () => {
      manager.setSource(video('liveA'));
      native.setSource.mockClear();

      manager.reload();

      // setSource would hit the same-id handoff and only call play(), which
      // can't revive a failed item or a dead WebView page.
      expect(native.setSource).not.toHaveBeenCalled();
      expect(native.reload).toHaveBeenCalledTimes(1);
      expect(manager.store.getState().loading).toBe(true);
    });

    it('a live retry after an error goes through the native reload', () => {
      jest.useFakeTimers();
      manager.setSource(video('liveA'));
      manager.setLive(true);
      native.reload.mockClear();

      const onError = native.onError.mock.calls.at(-1)?.[0] as (e: {
        code: string;
        message: string;
      }) => void;
      onError({ code: 'io', message: 'network lost' });

      jest.advanceTimersByTime(1000);
      expect(native.reload).toHaveBeenCalledTimes(1);
      // Live-ness must survive the outage, or the seek bar would appear.
      expect(manager.store.getState().live).toBe(true);
      jest.useRealTimers();
    });
  });

  describe('resume on focus', () => {
    it('resumes an autoplay source when it attaches back into view', () => {
      manager.setSource(video('yt1'), { autoplay: true });
      native.play.mockClear();

      manager.attach('feed'); // scrolled back into view
      expect(native.play).toHaveBeenCalled();
    });

    it('does NOT resume after the viewer paused on purpose', () => {
      manager.setSource(video('yt1'), { autoplay: true });
      manager.pause();
      native.play.mockClear();

      manager.attach('feed');
      expect(native.play).not.toHaveBeenCalled();
    });

    it('resumes again once the viewer presses play after pausing', () => {
      manager.setSource(video('yt1'), { autoplay: true });
      manager.pause();
      manager.play(); // clears the pause latch
      native.play.mockClear();

      manager.attach('feed');
      expect(native.play).toHaveBeenCalled();
    });

    it('does NOT resume a source that was never meant to autoplay', () => {
      manager.setSource(video('yt1'), { autoplay: false });
      native.play.mockClear();

      manager.attach('feed');
      expect(native.play).not.toHaveBeenCalled();
    });

    it('a new autoplay source clears a previous pause', () => {
      manager.setSource(video('yt1'), { autoplay: true });
      manager.pause();
      manager.setSource(video('yt2'), { autoplay: true });
      native.play.mockClear();

      manager.attach('feed');
      expect(native.play).toHaveBeenCalled();
    });
  });

  describe('live → VOD handover', () => {
    const fireProgress = (position: number, duration: number) => {
      const handler = native.onProgress.mock.calls.at(-1)?.[0] as (e: {
        position: number;
        duration: number;
        buffered: number;
      }) => void;
      handler({ position, duration, buffered: 0 });
    };

    it('ignores progress from the outgoing video while the next one loads', () => {
      manager.setSource(video('liveA'));
      manager.setLive(true);

      manager.setSource(video('vodB')); // still loading
      // A late tick from the live stream: a live-window position of ~150 days,
      // which previously rendered as "3603:49:34" on the seekbar.
      fireProgress(12_973_774, 0);

      const s = manager.store.getState();
      expect(s.position).toBe(0);
      expect(s.duration).toBe(0);
    });

    it('clears live state when a VOD follows a live source', () => {
      manager.setSource(video('liveA'));
      manager.setLive(true);
      expect(manager.store.getState().live).toBe(true);

      manager.setSource(video('vodB'));
      expect(manager.store.getState().live).toBe(false);
      expect(manager.store.getState().liveIcon).toBeNull();
    });

    it('accepts progress again once the new video has loaded', () => {
      manager.setSource(video('liveA'));
      manager.setLive(true);
      manager.setSource(video('vodB'));

      const onLoad = native.onLoad.mock.calls.at(-1)?.[0] as (e: {
        videoId: string;
        duration: number;
        width: number;
        height: number;
      }) => void;
      onLoad({ videoId: 'vodB', duration: 300, width: 1920, height: 1080 });

      fireProgress(12, 300);
      expect(manager.store.getState().position).toBe(12);
    });
  });

  describe('live retry', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const fireError = () => {
      const handler = native.onError.mock.calls.at(-1)?.[0] as (e: {
        code: string;
        message: string;
      }) => void;
      handler({ code: 'io', message: 'boom' });
    };

    it('retries a live source after a backoff when its feed errors', () => {
      manager.setSource(video('live1'));
      manager.setLive(true);
      native.reload.mockClear();

      fireError();
      expect(native.reload).not.toHaveBeenCalled(); // not immediate

      jest.advanceTimersByTime(1000);
      expect(native.reload).toHaveBeenCalledTimes(1);
      expect(manager.store.getState().status).toBe('loading');
    });

    it('does NOT retry a non-live source on error', () => {
      manager.setSource(video('vod1'));
      native.reload.mockClear();

      fireError();
      jest.advanceTimersByTime(30000);
      expect(native.reload).not.toHaveBeenCalled();
    });

    it('stops retrying once the source is no longer live', () => {
      manager.setSource(video('live1'));
      manager.setLive(true);
      native.reload.mockClear();

      fireError();
      manager.setLive(false); // clears the scheduled retry
      jest.advanceTimersByTime(30000);
      expect(native.reload).not.toHaveBeenCalled();
    });

    const fireLive = (live: boolean) => {
      const handler = native.onLiveChange.mock.calls.at(-1)?.[0] as (e: {
        live: boolean;
      }) => void;
      handler({ live });
    };

    const fireErrorWith = (code: string, message: string) => {
      const handler = native.onError.mock.calls.at(-1)?.[0] as (e: {
        code: string;
        message: string;
      }) => void;
      handler({ code, message });
    };

    it('retries a natively-detected live source without setLive()', () => {
      manager.setSource(video('live1'));
      fireLive(true); // engine reports an HLS live window / YouTube isLive
      native.reload.mockClear();

      fireError();
      jest.advanceTimersByTime(1000);
      expect(native.reload).toHaveBeenCalledTimes(1);
    });

    it('lets an explicit setLive() override native detection', () => {
      manager.setSource(video('vod1'));
      manager.setLive(false); // app insists this is not live
      fireLive(true); // native disagrees — explicit wins
      native.reload.mockClear();

      expect(manager.store.getState().live).toBe(false);
      fireError();
      jest.advanceTimersByTime(30000);
      expect(native.reload).not.toHaveBeenCalled();
    });

    it('re-enables native detection when the source changes', () => {
      manager.setSource(video('vod1'));
      manager.setLive(false);
      manager.setSource(video('live2')); // new source clears the pin
      fireLive(true);

      expect(manager.store.getState().live).toBe(true);
    });

    it('does NOT retry a YouTube video that is gone or un-embeddable', () => {
      manager.setSource(video('live1'));
      manager.setLive(true);
      native.reload.mockClear();

      fireErrorWith('youtube', '150'); // embedding disallowed — never recovers
      jest.advanceTimersByTime(30000);
      expect(native.reload).not.toHaveBeenCalled();
    });

    it('still retries a transient YouTube error', () => {
      manager.setSource(video('live1'));
      manager.setLive(true);
      native.reload.mockClear();

      fireErrorWith('youtube', '5'); // transient HTML5 player fault
      jest.advanceTimersByTime(1000);
      expect(native.reload).toHaveBeenCalledTimes(1);
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
