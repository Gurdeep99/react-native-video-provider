import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useVideoManager } from '../provider/VideoContext';
import { usePlayback } from '../hooks/usePlayback';
import { formatTime } from '../utils/formatTime';
import { GestureOverlay } from './GestureOverlay';
import { BackIcon } from './icons';
import SvgIcons from './SvgIcons';

export interface VideoControlsProps {
  /** Seconds jumped by double-tap. Default 10. */
  doubleTapSeek?: number;
  /** Auto-hide delay in ms. Default 3000. */
  hideAfter?: number;
  /** Show the fullscreen toggle button. Default true. */
  showFullscreenButton?: boolean;
  /** Called by the close (✕) button; button hidden when omitted. */
  onClose?: () => void;
  /**
   * Shown instead of the loading spinner while stalled with no connectivity.
   * Default `'No Internet Connection'`. The engine keeps retrying underneath
   * (see `liveAutoRetry` / reconnect recovery) — this only changes what the
   * viewer sees while it's stuck: an indefinite spinner reads as broken,
   * where naming the actual cause doesn't.
   */
  offlineMessage?: string;
  /**
   * Mirrors the player's `isBlur` prop: while true, hides the loading/
   * buffering spinner (in every case, not just while offline — a spinner
   * over a blurred picture reads as broken rather than intentional) and the
   * mute and fullscreen buttons. Default false.
   */
  isBlur?: boolean;
}

/**
 * Minimal built-in chrome: play/pause, seek bar, time, mute and fullscreen
 * toggles, with tap-to-show / double-tap-to-seek gestures. `live` and the
 * live badges come from the store (set via VideoPlayer's `live` /
 * `leftTopIcon` / `rightTopIcon`), so they show inline and in the fullscreen
 * host alike. Apps wanting a custom design can ignore this and build on
 * usePlayback()/useVideo().
 */
export function VideoControls({
  doubleTapSeek = 10,
  hideAfter = 3000,
  showFullscreenButton = true,
  onClose,
  offlineMessage = 'No Internet Connection',
  isBlur = false,
}: VideoControlsProps) {
  const manager = useVideoManager();
  const playing = usePlayback((s) => s.playing);
  const paused = usePlayback((s) => s.paused);
  const status = usePlayback((s) => s.status);
  const buffering = usePlayback((s) => s.buffering);
  const loading = usePlayback((s) => s.loading);
  const position = usePlayback((s) => s.position);
  const duration = usePlayback((s) => s.duration);
  const buffered = usePlayback((s) => s.buffered);
  const muted = usePlayback((s) => s.muted);
  const fullscreen = usePlayback((s) => s.fullscreen);
  const live = usePlayback((s) => s.live);
  const leftTopIcon = usePlayback((s) => s.leftTopIcon);
  const rightTopIcon = usePlayback((s) => s.rightTopIcon);
  const online = usePlayback((s) => s.online);
  const currentVideoId = usePlayback((s) => s.currentVideo?.id);

  // Has this live session reached `playing` at least once? Computed during
  // render (not an effect) so it's already correct for THIS render, not one
  // behind. Reset per video so a new live source gets its own fresh
  // "connecting" grace period.
  const hasEverPlayedRef = useRef(false);
  const lastVideoIdRef = useRef(currentVideoId);
  if (lastVideoIdRef.current !== currentVideoId) {
    lastVideoIdRef.current = currentVideoId;
    hasEverPlayedRef.current = false;
  }
  if (playing) {
    hasEverPlayedRef.current = true;
  }

  // Only relevant before the very first `playing` of this session: hides the
  // loader a beat early, the moment data visibly starts arriving, rather
  // than waiting for the engine's official 'playing' confirmation.
  const feedArriving = playing || buffered > 0 || position > 0;
  // `!playing` is the hard override: `loading`/`buffering` can be
  // momentarily stale/true right as playback actually starts (a status blip
  // arriving a tick before/after onIsPlayingChanged), which showed the
  // loader over an already-playing frame. Once the engine says it's
  // playing, never show it — in either the inline player or the fullscreen
  // host (this component is shared by both).
  //
  // For live, once playback has genuinely started at least once, ANY later
  // loading/buffering is a real stall (dropped connection, etc.) and must
  // show the loader every time — `buffered`/`position` often stay stuck at
  // a stale non-zero value mid-stall rather than reliably resetting to 0,
  // so `feedArriving` alone used to keep the loader hidden right through a
  // real stall. Once the feed recovers, `loading`/`buffering` clear and the
  // loader disappears on its own.
  const showLoader =
    !isBlur &&
    !playing &&
    (live
      ? (loading || buffering) && (hasEverPlayedRef.current || !feedArriving)
      : loading || buffering);
  // For live streams, show the offline indicator the moment connectivity
  // drops — don't wait for the engine to report buffering/loading. The
  // manager pauses the native player on disconnect, so the store will say
  // `paused` (not `buffering`), but the viewer should still see "No
  // Internet Connection" immediately rather than a frozen paused frame.
  const showOffline = !online && (loading || buffering || (live && !playing));

  // Which half of the play/pause button to draw. `playing` alone isn't
  // enough: it can lag the picture actually moving by a tick or two, which
  // drew a play icon over a video that was already running — most visibly on
  // live, where there's no seek bar to contradict it. So also treat the video
  // as playing once playback has demonstrably started.
  //
  // What counts as "started" has to differ by source, because BOTH engines
  // deliberately report position 0 for a live stream — its elapsed time grows
  // without bound and there's no scrubber to drive (VideoPlayerCore.emitProgress,
  // PlayerCore.emitProgress). A position-based test is therefore always false
  // for live, i.e. exactly the case this exists for. So:
  //
  //   known duration (on-demand) → past the 1% mark
  //   live / unknown duration    → the feed has produced something: this
  //                                session reached `playing` at least once,
  //                                or there's buffered data to draw from
  //
  // `paused` is the viewer's own intent and always wins, so a deliberate pause
  // flips back to play immediately. A video that ended, errored or was never
  // started isn't playing either, whatever the progress numbers say.
  const started =
    duration > 0
      ? position / duration >= 0.01
      : hasEverPlayedRef.current || buffered > 0;
  const stopped = status === 'ended' || status === 'error' || status === 'idle';
  const showPauseIcon = playing || (started && !paused && !stopped);

  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackWidth = useRef(0);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => setVisible(false), hideAfter);
  }, [hideAfter]);

  useEffect(() => {
    if (visible && playing) {
      scheduleHide();
    }
    return () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    };
  }, [visible, playing, scheduleHide]);

  // When the player starts loading or buffering (e.g. after a network-recovery
  // reload), force the controls visible so the spinner is shown over the
  // darkened chrome overlay rather than over the raw frozen frame. When the
  // player recovers and starts playing, the existing auto-hide kicks in and
  // schedules the controls to fade out after `hideAfter` ms.
  useEffect(() => {
    if (loading || buffering) {
      setVisible(true);
    } else if (playing) {
      scheduleHide();
    }
  }, [loading, buffering, playing, scheduleHide]);

  const toggleVisible = useCallback(() => setVisible((v) => !v), []);

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    trackWidth.current = e.nativeEvent.layout.width;
  }, []);

  const onTrackPress = useCallback(
    (e: GestureResponderEvent) => {
      if (trackWidth.current > 0 && duration > 0) {
        const ratio = e.nativeEvent.locationX / trackWidth.current;
        manager.seek(ratio * duration);
      }
      scheduleHide();
    },
    [manager, duration, scheduleHide]
  );

  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;

  const muteButton = isBlur ? null : (
    <Pressable
      style={styles.button}
      onPress={() => (muted ? manager.unmute() : manager.mute())}
      hitSlop={8}
    >
      {muted ? (
        <SvgIcons icon="muteUnmute" size={18} fill="#fff" />
      ) : (
        <SvgIcons icon="muteUnmute" type="mute" size={18} fill="#fff" />
      )}
    </Pressable>
  );

  const fullscreenButton = showFullscreenButton && !isBlur ? (
    <Pressable
      style={styles.button}
      onPress={() => manager.toggleFullscreen()}
      hitSlop={8}
    >
      {fullscreen ? (
        <SvgIcons icon="fullScreen" size={18} fill="#fff" />
      ) : (
        <SvgIcons icon="fullScreen" type="full" size={18} fill="#fff" />
      )}
    </Pressable>
  ) : null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} pointerEvents="box-none">
      <GestureOverlay
        onSingleTap={toggleVisible}
        onDoubleTapLeft={live || isBlur ? undefined : () => manager.seekBy(-doubleTapSeek)}
        onDoubleTapRight={live || isBlur ? undefined : () => manager.seekBy(doubleTapSeek)}
      />
      {visible ? (
        <View style={styles.chrome} pointerEvents="box-none">
          <View style={styles.topRow}>
            {onClose ? (
              <Pressable style={styles.button} onPress={onClose} hitSlop={8}>
                <BackIcon size={18} color="#fff" />
              </Pressable>
            ) : (
              <View />
            )}
            {!live ? muteButton : <View />}
          </View>

          {/* Center play/pause — shown for live and on-demand alike, hidden
              only while the loader occupies the same spot. */}
          {showLoader ? (
            <View />
          ) : (
            <Pressable
              style={styles.playButton}
              onPress={() => {
                // Driven by the same flag as the icon rather than
                // manager.toggle(): toggle() reads the store's `playing`,
                // which is exactly the value that can be stale here, so a
                // tap on a pause icon would have called play() and looked
                // like the button did nothing.
                if (showPauseIcon) {
                  manager.pause();
                } else {
                  manager.play();
                }
                scheduleHide();
              }}
              hitSlop={16}
              accessibilityRole="button"
              accessibilityLabel={showPauseIcon ? 'Pause' : 'Play'}
            >
              {showPauseIcon ? (
                <SvgIcons icon="playPause" type="pause" size={34} fill="#fff" />
              ) : (
                <SvgIcons icon="playPause" type="play" size={34} fill="#fff" />
              )}
            </Pressable>
          )}

          <View style={styles.bottomRow}>
            {live ? (
              <>
                {muteButton}
                <View style={styles.spacer} />
                {fullscreenButton}
              </>
            ) : (
              <>
                <Text style={styles.time}>{formatTime(position)}</Text>
                <Pressable
                  style={styles.track}
                  onLayout={onTrackLayout}
                  onPress={onTrackPress}
                >
                  <View style={styles.trackBg} />
                  <View
                    style={[styles.trackFill, { width: `${progress * 100}%` }]}
                  />
                </Pressable>
                <Text style={styles.time}>{formatTime(duration)}</Text>
                {fullscreenButton}
              </>
            )}
          </View>
        </View>
      ) : null}
      {/* Center loader — shown during initial load / buffering regardless of
          whether the chrome is visible (the only center element for live). For
          live it disappears as soon as the feed starts arriving. While
          genuinely offline this becomes a message instead of a spinner: the
          engine keeps retrying underneath (live retry / reconnect recovery),
          but an indefinite spinner reads as broken where naming the actual
          cause doesn't. Reverts to the spinner the moment connectivity
          returns — recovery itself is handled by the manager, not here. */}
      {showOffline ? (
        <View style={styles.centerLoader} pointerEvents="none">
          <Text style={styles.offlineText}>{offlineMessage}</Text>
        </View>
      ) : showLoader ? (
        <View style={styles.centerLoader} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : null}
      {/* Live badges: top corners, above the controls, always visible while
          live — they do NOT hide with the auto-hiding chrome (rendered last
          + high zIndex so they stay on top). */}
      {live && leftTopIcon ? (
        <View
          style={[
            styles.leftTopIcon,
            fullscreen && styles.leftTopIconFullscreen,
          ]}
          pointerEvents="none"
        >
          {leftTopIcon()}
        </View>
      ) : null}
      {live && rightTopIcon ? (
        <View
          style={[
            styles.rightTopIcon,
            fullscreen && styles.rightTopIconFullscreen,
          ]}
          pointerEvents="none"
        >
          {rightTopIcon()}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // On Android, elevation — not tree order — decides what draws on top, and
  // the native video output (the PlayerView's TextureView inside
  // VideoSurfaceView) could composite above a zero-elevation sibling, which
  // hid this whole overlay's center play/pause button. Both hosts render
  // <VideoSurface /> and <VideoControls /> as SIBLINGS (see VideoPlayer and
  // FullscreenPlayer), so the lift has to be on this root: elevation on
  // `chrome` alone only orders children within the root and never beats the
  // surface next to it. That's why the live badges needed re-rendering at the
  // FullscreenPlayer level to stay visible — same cause.
  root: {
    zIndex: 5,
    elevation: 5,
  },
  // Kept under the badges' 10 below so they still sit on top of the chrome.
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'space-between',
    zIndex: 5,
    elevation: 5,
  },
  centerLoader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    elevation: 5,
  },
  offlineText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  leftTopIcon: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 10,
    elevation: 10,
  },
  // Extra inset in fullscreen so the badge clears the status-bar / landscape
  // notch area.
  leftTopIconFullscreen: {
    top: 20,
    left: 44,
  },
  rightTopIcon: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
    elevation: 10,
  },
  // Extra inset in fullscreen so the badge clears the status-bar / landscape
  // notch area.
  rightTopIconFullscreen: {
    top: 20,
    right: 44,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
  },
  playButton: {
    alignSelf: 'center',
  },
  playIcon: {
    color: '#fff',
    fontSize: 34,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  time: {
    color: '#fff',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  track: {
    flex: 1,
    height: 24,
    justifyContent: 'center',
  },
  spacer: {
    flex: 1,
  },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  trackFill: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#fff',
  },
  button: {
    padding: 4,
  },
});
