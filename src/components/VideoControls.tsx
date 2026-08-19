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
}

/**
 * Minimal built-in chrome: play/pause, seek bar, time, mute and fullscreen
 * toggles, with tap-to-show / double-tap-to-seek gestures. `live` and the
 * live badge come from the store (set via VideoPlayer's `live` / `liveIcon`),
 * so they show inline and in the fullscreen host alike. Apps wanting a custom
 * design can ignore this and build on usePlayback()/useVideo().
 */
export function VideoControls({
  doubleTapSeek = 10,
  hideAfter = 3000,
  showFullscreenButton = true,
  onClose,
  offlineMessage = 'No Internet Connection',
}: VideoControlsProps) {
  const manager = useVideoManager();
  const playing = usePlayback((s) => s.playing);
  const buffering = usePlayback((s) => s.buffering);
  const loading = usePlayback((s) => s.loading);
  const position = usePlayback((s) => s.position);
  const duration = usePlayback((s) => s.duration);
  const buffered = usePlayback((s) => s.buffered);
  const muted = usePlayback((s) => s.muted);
  const fullscreen = usePlayback((s) => s.fullscreen);
  const live = usePlayback((s) => s.live);
  const liveIcon = usePlayback((s) => s.liveIcon);
  const online = usePlayback((s) => s.online);

  const feedArriving = playing || buffered > 0 || position > 0;
  const showLoader = live
    ? (loading || buffering) && !feedArriving
    : loading || buffering;
  const showOffline = !online && (loading || buffering);

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

  const muteButton = (
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

  const fullscreenButton = showFullscreenButton ? (
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
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <GestureOverlay
        onSingleTap={toggleVisible}
        onDoubleTapLeft={() => manager.seekBy(-doubleTapSeek)}
        onDoubleTapRight={() => manager.seekBy(doubleTapSeek)}
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

          {/* Center play/pause — hidden while the loader shows and hidden
              entirely for live (only the loader appears). */}
          {live || showLoader ? (
            <View />
          ) : (
            <Pressable
              style={styles.playButton}
              onPress={() => {
                manager.toggle();
                scheduleHide();
              }}
              hitSlop={16}
            >
              {playing ? (
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
      {/* Live badge: top-left, above the controls, always visible while live —
          it does NOT hide with the auto-hiding chrome (rendered last + high
          zIndex so it stays on top). */}
      {live && liveIcon ? (
        <View
          style={[styles.liveBadge, fullscreen && styles.liveBadgeFullscreen]}
          pointerEvents="none"
        >
          {liveIcon()}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'space-between',
  },
  centerLoader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
  liveBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 10,
    elevation: 10,
  },
  // Extra inset in fullscreen so the badge clears the status-bar / landscape
  // notch area.
  liveBadgeFullscreen: {
    top: 20,
    left: 44,
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
