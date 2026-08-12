import NativeVideo from '../NativeVideo';
import { FULLSCREEN_SURFACE_ID, VideoManager } from '../core/VideoManager';
import type { VideoSource } from '../types/video';

jest.mock('../NativeVideo', () => ({
  __esModule: true,
  default: {
    nativeInit: jest.fn(),
    setSource: jest.fn(),
    preload: jest.fn(),
    reload: jest.fn(),
    reloadFromPosition: jest.fn(),
    reassertVideoOutput: jest.fn(),
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

// Captured NetInfo callback so tests can drive connectivity transitions.
// Must be `mock`-prefixed: jest hoists mock factories above other bindings.
let mockNetInfoListener: ((s: unknown) => void) | null = null;
jest.mock(
  '@react-native-community/netinfo',
  () => ({
    __esModule: true,
    default: {
      addEventListener: (cb: (s: unknown) => void) => {
        mockNetInfoListener = cb;
        return () => {};
      },
    },
  }),
  { virtual: true }
);

const native = NativeVideo as jest.Mocked<typeof NativeVideo>;

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

  describe('sensor-following fullscreen (rotation prop)', () => {
    it("'auto' lets fullscreen follow the sensor instead of locking", () => {
      // What VideoPlayer registers for `rotation`. 'auto' is what both engines
      // read as "no lock": Android FULL_SENSOR, iOS an empty mask so the
      // fullscreen mask applies.
      manager.setFullscreenOrientation('auto');
      manager.enterFullscreen();

      expect(native.enterFullscreen).toHaveBeenLastCalledWith('auto');
      expect(manager.store.getState().fullscreenLock).toBe('auto');
    });

    it('still locks landscape when rotation is not registered', () => {
      manager.enterFullscreen();
      expect(native.enterFullscreen).toHaveBeenLastCalledWith('landscape');
    });

    it('an explicit fullscreenOrientation still wins over auto', () => {
      // VideoPlayer resolves `fullscreenOrientation ?? (rotation ? 'auto' : null)`,
      // so a specific lock is what reaches the manager.
      manager.setFullscreenOrientation('portrait');
      manager.enterFullscreen();
      expect(native.enterFullscreen).toHaveBeenLastCalledWith('portrait');
    });
  });

  describe('mute state across surfaces', () => {
    it('a viewer unmute survives a remount that still says muted', () => {
      // Inline player mounts muted.
      manager.setMutedFromProp(true);
      expect(manager.store.getState().muted).toBe(true);

      // Viewer unmutes via the controls.
      manager.unmute();
      expect(manager.store.getState().muted).toBe(false);

      // Fullscreen opens and the player remounts with muted={true} still set —
      // this used to silently re-mute the video they just turned on.
      manager.setMutedFromProp(true);
      expect(manager.store.getState().muted).toBe(false);
    });

    it('works in reverse: a viewer mute survives an unmuted prop', () => {
      manager.setMutedFromProp(false);
      manager.mute();
      expect(manager.store.getState().muted).toBe(true);

      manager.setMutedFromProp(false);
      expect(manager.store.getState().muted).toBe(true);
    });

    it('the prop still applies until the viewer touches it', () => {
      manager.setMutedFromProp(true);
      expect(manager.store.getState().muted).toBe(true);
      manager.setMutedFromProp(false);
      expect(manager.store.getState().muted).toBe(false);
    });

    it('does not re-issue a native call when the value is unchanged', () => {
      manager.mute();
      native.setMuted.mockClear();
      manager.mute();
      expect(native.setMuted).not.toHaveBeenCalled();
    });
  });

  describe('mute is shared between the inline player and fullscreen', () => {
    // There is exactly one engine and one `muted` boolean in the store — the
    // built-in FullscreenPlayer never sets mute itself, it only displays and
    // toggles the same value the inline player does. These lock that
    // guarantee in as a regression test rather than an implicit accident of
    // the architecture.

    it('muting the inline ("component") player carries into fullscreen', () => {
      manager.attach('feed'); // the small inline surface
      manager.mute();

      manager.enterFullscreen();
      manager.attach(FULLSCREEN_SURFACE_ID); // built-in host attaches itself

      expect(manager.store.getState().muted).toBe(true);
    });

    it('unmuting the inline player carries into fullscreen', () => {
      manager.attach('feed');
      manager.mute();
      manager.unmute();

      manager.enterFullscreen();
      manager.attach(FULLSCREEN_SURFACE_ID);

      expect(manager.store.getState().muted).toBe(false);
    });

    it('toggling mute while fullscreen carries back to the inline player on exit', () => {
      manager.attach('feed');
      manager.enterFullscreen();
      manager.attach(FULLSCREEN_SURFACE_ID);

      manager.mute(); // toggled from fullscreen's controls

      manager.exitFullscreen();
      expect(manager.store.getState().muted).toBe(true);
    });
  });

  describe('reassertVideoOutput on recovery', () => {
    it('force re-parents on reconnect even when playback never errored', () => {
      // The engine recovered from the network drop entirely on its own —
      // buffering straight back to playing, no error, no idle transition. No
      // native signal exists for "the surface might be stale"; the reconnect
      // itself is the only evidence, so JS must act on it directly.
      manager.setSource(video('vod1'));
      const onLoad = native.onLoad.mock.calls.at(-1)?.[0] as (e: {
        videoId: string;
        duration: number;
        width: number;
        height: number;
      }) => void;
      onLoad({ videoId: 'vod1', duration: 60, width: 640, height: 360 });

      const onStatus = native.onStatusChange.mock.calls.at(-1)?.[0] as (e: {
        status: string;
      }) => void;
      onStatus({ status: 'playing' }); // was already playing throughout

      jest.useFakeTimers();
      const handler = mockNetInfoListener!;
      handler({ isConnected: false, isInternetReachable: false });
      native.reloadFromPosition.mockClear();
      handler({ isConnected: true, isInternetReachable: true });
      jest.advanceTimersByTime(600);

      expect(native.reloadFromPosition).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('force re-parents on focus resume regardless of reported playing state', () => {
      manager.setSource(video('vod1'), { autoplay: true });
      native.reassertVideoOutput.mockClear();

      manager.attach('feed'); // regaining focus
      expect(native.reassertVideoOutput).toHaveBeenCalledTimes(1);
    });
  });

  describe('stall watchdog', () => {
    const setStatus = (status: string) => {
      const handler = native.onStatusChange.mock.calls.at(-1)?.[0] as (e: {
        status: string;
      }) => void;
      handler({ status });
    };

    it('rebuilds a player left buffering indefinitely', () => {
      jest.useFakeTimers();
      manager.setSource(video('vod1'));
      native.reload.mockClear();

      // No NetInfo transition, no error — the engine simply never recovers.
      // This is the case every other path misses.
      setStatus('buffering');
      jest.advanceTimersByTime(13000);

      expect(native.reload).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('does not rebuild when buffering resolves on its own', () => {
      jest.useFakeTimers();
      manager.setSource(video('vod1'));
      native.reload.mockClear();

      setStatus('buffering');
      jest.advanceTimersByTime(4000);
      setStatus('playing'); // recovered by itself
      jest.advanceTimersByTime(20000);

      expect(native.reload).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('gives up after repeated stalls rather than looping forever', () => {
      jest.useFakeTimers();
      manager.setSource(video('vod1'));
      native.reload.mockClear();

      for (let i = 0; i < 6; i += 1) {
        setStatus('buffering');
        jest.advanceTimersByTime(13000);
        setStatus('loading'); // reload() moves it out of buffering
      }

      expect(native.reload).toHaveBeenCalledTimes(3);
      jest.useRealTimers();
    });
  });

  describe('reconnect recovery', () => {
    const setOnline = (online: boolean) => {
      mockNetInfoListener?.({
        isConnected: online,
        isInternetReachable: online,
      });
    };

    const fireError = () => {
      const handler = native.onError.mock.calls.at(-1)?.[0] as (e: {
        code: string;
        message: string;
      }) => void;
      handler({ code: 'io', message: 'network lost' });
    };

    it('rebuilds a NON-live video that failed while offline', () => {
      jest.useFakeTimers();
      manager.setSource(video('vod1')); // never marked live
      native.reloadFromPosition.mockClear();

      setOnline(false);
      fireError();
      setOnline(true);
      jest.advanceTimersByTime(600);

      // Live retry doesn't cover this source; reconnect recovery must.
      expect(native.reloadFromPosition).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('nudges an interrupted (but not errored) video and verifies it', () => {
      jest.useFakeTimers();
      manager.setSource(video('vod1'));
      const onLoad = native.onLoad.mock.calls.at(-1)?.[0] as (e: {
        videoId: string;
        duration: number;
        width: number;
        height: number;
      }) => void;
      onLoad({ videoId: 'vod1', duration: 60, width: 640, height: 360 });
      native.play.mockClear();
      native.reload.mockClear();

      setOnline(false);
      setOnline(true);
      jest.advanceTimersByTime(600);
      expect(native.reloadFromPosition).toHaveBeenCalledWith(0);
      jest.useRealTimers();
    });

    it('rebuilds a player still stuck buffering after the grace period', () => {
      jest.useFakeTimers();
      manager.setSource(video('vod1'));
      const onLoad = native.onLoad.mock.calls.at(-1)?.[0] as (e: {
        videoId: string;
        duration: number;
        width: number;
        height: number;
      }) => void;
      onLoad({ videoId: 'vod1', duration: 60, width: 640, height: 360 });
      native.reload.mockClear();

      setOnline(false);
      setOnline(true);

      // Native video often stalls without ever erroring — it just sits in
      // buffering forever, which is the black screen. Buffering must NOT count
      // as recovered.
      const onStatus = native.onStatusChange.mock.calls.at(-1)?.[0] as (e: {
        status: string;
      }) => void;
      onStatus({ status: 'buffering' });

      jest.advanceTimersByTime(5000);
      expect(native.reloadFromPosition).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('leaves a deliberately paused video alone on reconnect', () => {
      manager.setSource(video('vod1'));
      manager.pause();
      native.reload.mockClear();
      native.play.mockClear();

      setOnline(false);
      fireError();
      setOnline(true);

      expect(native.reload).not.toHaveBeenCalled();
      expect(native.play).not.toHaveBeenCalled();
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

  describe('app-pinned live-ness is per source', () => {
    const fireLiveChange = (live: boolean) => {
      const handler = native.onLiveChange.mock.calls.at(-1)?.[0] as (e: {
        live: boolean;
      }) => void;
      handler({ live });
    };

    it('restores the pin when the engine hands a video back', () => {
      manager.setSource(video('liveA'));
      manager.setLive(true);

      // Another card takes the engine...
      manager.setSource(video('liveB'));
      manager.setLive(true);
      // ...and then the first one gets it back. Its player never unmounted, so
      // nothing calls setLive() for it a second time — the manager has to
      // remember. Previously `live` was hard-cleared here and stayed false, so
      // the badge vanished and the seek bar appeared on a live stream.
      manager.setSource(video('liveA'));

      expect(manager.store.getState().live).toBe(true);
    });

    it('does not leak a pin onto an unrelated video', () => {
      manager.setSource(video('liveA'));
      manager.setLive(true);

      manager.setSource(video('vodB'));
      expect(manager.store.getState().live).toBe(false);
    });

    it('still lets the engine detect a source the app never pinned', () => {
      manager.setSource(video('liveA'));
      manager.setLive(true);
      manager.setSource(video('unknownB'));

      // A single global "app took control" latch suppressed native detection
      // for every later source too, so this stayed false forever.
      fireLiveChange(true);
      expect(manager.store.getState().live).toBe(true);
    });

    it('keeps honouring the pin over engine detection for its own source', () => {
      manager.setSource(video('liveA'));
      manager.setLive(true);

      fireLiveChange(false);
      expect(manager.store.getState().live).toBe(true);
    });
  });

  describe('live badge ownership', () => {
    it('restores a surviving registration when another unmounts', () => {
      const a = () => null;
      const b = () => null;
      manager.registerLiveIcon(a);
      manager.registerLiveIcon(b);
      expect(manager.store.getState().liveIcon).toBe(b);

      // b unmounting must not blank the badge while a is still mounted.
      manager.unregisterLiveIcon(b);
      expect(manager.store.getState().liveIcon).toBe(a);

      manager.unregisterLiveIcon(a);
      expect(manager.store.getState().liveIcon).toBeNull();
    });

    it('a late unmount does not clobber the incoming registration', () => {
      const outgoing = () => null;
      const incoming = () => null;
      manager.registerLiveIcon(outgoing);
      // Virtualised list remount: the replacement registers before the old one
      // tears down. Clearing unconditionally left the slot empty for good.
      manager.registerLiveIcon(incoming);
      manager.unregisterLiveIcon(outgoing);
      expect(manager.store.getState().liveIcon).toBe(incoming);
    });

    it('ignores an unregister for a renderer that never registered', () => {
      const a = () => null;
      manager.registerLiveIcon(a);
      manager.unregisterLiveIcon(() => null);
      expect(manager.store.getState().liveIcon).toBe(a);
    });
  });

  describe('resume on focus', () => {
    it('resumes an autoplay source when it attaches back into view', () => {
      manager.setSource(video('yt1'), { autoplay: true });
      native.play.mockClear();

      manager.attach('feed'); // scrolled back into view
      expect(native.play).toHaveBeenCalled();
    });

    it('resumes after a background pause (lifecycle, not a viewer decision)', () => {
      manager.setSource(video('yt1'), { autoplay: true });
      manager.pauseForFocusLoss(); // app went to background
      native.play.mockClear();

      manager.attach('feed'); // back in the foreground
      expect(native.play).toHaveBeenCalled();
    });

    const fireLoaded = () => {
      const onLoad = native.onLoad.mock.calls.at(-1)?.[0] as (e: {
        videoId: string;
        duration: number;
        width: number;
        height: number;
      }) => void;
      onLoad({ videoId: 'yt1', duration: 120, width: 1280, height: 720 });
    };

    it('reloads when a resume fails to restart playback', () => {
      jest.useFakeTimers();
      manager.setSource(video('yt1'), { autoplay: true });
      fireLoaded(); // video was up and running before backgrounding
      manager.pauseForFocusLoss();
      native.reload.mockClear();

      manager.attach('feed');
      // Engine never reports playing/buffering — it came back dead.
      jest.advanceTimersByTime(5000);
      expect(native.reloadFromPosition).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('does NOT reload when the resume did restart playback', () => {
      jest.useFakeTimers();
      manager.setSource(video('yt1'), { autoplay: true });
      fireLoaded();
      manager.pauseForFocusLoss();
      native.reload.mockClear();
      native.reloadFromPosition.mockClear();

      manager.attach('feed');
      const onStatus = native.onStatusChange.mock.calls.at(-1)?.[0] as (e: {
        status: string;
      }) => void;
      onStatus({ status: 'playing' });

      const onProgress = native.onProgress.mock.calls.at(-1)?.[0] as (e: {
        position: number;
        duration: number;
        buffered: number;
      }) => void;
      if (onProgress) {
        onProgress({ position: 1.5, duration: 120, buffered: 10 });
      }

      jest.advanceTimersByTime(5000);
      expect(native.reload).not.toHaveBeenCalled();
      expect(native.reloadFromPosition).not.toHaveBeenCalled();
      jest.useRealTimers();
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
