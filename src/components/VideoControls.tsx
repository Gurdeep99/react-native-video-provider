import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
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
  /**
   * Mark this as a live stream: hides the seek bar/times and moves mute to
   * the bottom-left. Default false.
   */
  live?: boolean;
  /**
   * Render a live indicator (e.g. a Lottie animation or a "LIVE" badge),
   * shown in the control bar only while `live`.
   */
  liveIcon?: () => ReactNode;
  /** Called by the close (✕) button; button hidden when omitted. */
  onClose?: () => void;
}

/**
 * Minimal built-in chrome: play/pause, seek bar, time, mute and fullscreen
 * toggles, with tap-to-show / double-tap-to-seek gestures. Apps wanting a
 * custom design can ignore this and build on usePlayback()/useVideo().
 */
export function VideoControls({
  doubleTapSeek = 10,
  hideAfter = 3000,
  showFullscreenButton = true,
  live = false,
  liveIcon,
  onClose,
}: VideoControlsProps) {
  const manager = useVideoManager();
  const playing = usePlayback((s) => s.playing);
  const buffering = usePlayback((s) => s.buffering);
  const position = usePlayback((s) => s.position);
  const duration = usePlayback((s) => s.duration);
  const muted = usePlayback((s) => s.muted);
  const fullscreen = usePlayback((s) => s.fullscreen);

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

          <Pressable
            style={styles.playButton}
            onPress={() => {
              manager.toggle();
              scheduleHide();
            }}
            hitSlop={16}
          >
            {buffering ? (
              <Text style={styles.playIcon}>…</Text>
            ) : playing ? (
              <SvgIcons icon="playPause" type="pause" size={34} fill="#fff" />
            ) : (
              <SvgIcons icon="playPause" type="play" size={34} fill="#fff" />
            )}
          </Pressable>

          <View style={styles.bottomRow}>
            {live ? (
              <>
                {liveIcon ? liveIcon() : null}
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
