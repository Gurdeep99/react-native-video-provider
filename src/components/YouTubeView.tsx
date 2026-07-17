import { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewProps,
} from 'react-native';
import { useVideoManager } from '../provider/VideoContext';
import type { YouTubeController } from '../core/YouTubeController';

// Optional peer dependency: only required when a `type: 'youtube'` source is
// actually rendered, so apps that never use YouTube needn't install it (it
// pulls in react-native-webview). It handles the embed referrer/origin setup
// that a hand-rolled iframe gets wrong (e.g. "Error 153").
let YoutubePlayer: any;
try {
  YoutubePlayer = require('react-native-youtube-iframe').default;
} catch {
  YoutubePlayer = null;
}

export interface YouTubeViewProps extends ViewProps {
  /** YouTube video id (the `source.uri` for a `type: 'youtube'` source). */
  videoId: string;
  autoplay?: boolean;
  muted?: boolean;
  repeat?: boolean;
  /** Start position in seconds (captured at mount — used to resume). */
  startSeconds?: number;
}

/**
 * Plays a YouTube video via `react-native-youtube-iframe`, bridged to the
 * shared VideoManager so `usePlayback`, events and the command API work the
 * same as native sources. YouTube's own UI is hidden (`controls: false`) — the
 * app draws `<VideoControls>` on top, like a native source.
 */
export function YouTubeView({
  videoId,
  autoplay = true,
  muted = false,
  repeat = false,
  startSeconds = 0,
  style,
  ...rest
}: YouTubeViewProps) {
  const manager = useVideoManager();
  const ref = useRef<{
    seekTo: (s: number, allowAhead: boolean) => void;
    getDuration: () => Promise<number>;
    getCurrentTime: () => Promise<number>;
  } | null>(null);

  // Desired (controlled) state — driven by the manager via the controller.
  const [playing, setPlaying] = useState(autoplay);
  const [isMuted, setIsMuted] = useState(muted);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(100);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const repeatRef = useRef(repeat);
  repeatRef.current = repeat;
  const startRef = useRef(Math.floor(startSeconds));

  useEffect(() => {
    const controller: YouTubeController = {
      videoId,
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      stop: () => {
        setPlaying(false);
        ref.current?.seekTo(0, true);
      },
      seekTo: (s) => ref.current?.seekTo(s, true),
      setRate: (r) => setRate(r),
      setVolume: (v) => setVolume(Math.round(v * 100)),
      setMuted: (m) => setIsMuted(m),
      setRepeat: () => {}, // handled on the 'ended' state via repeatRef
    };
    manager.registerYouTube(controller);
    return () => manager.unregisterYouTube(controller);
  }, [manager, videoId]);

  // Progress ticker (the library is imperative for time).
  useEffect(() => {
    const timer = setInterval(async () => {
      const p = ref.current;
      if (!p) {
        return;
      }
      try {
        const [position, duration] = await Promise.all([
          p.getCurrentTime(),
          p.getDuration(),
        ]);
        manager.ytProgress(position || 0, duration || 0);
      } catch {
        // player not ready yet
      }
    }, 500);
    return () => clearInterval(timer);
  }, [manager]);

  const onReady = useCallback(async () => {
    let duration = 0;
    try {
      duration = (await ref.current?.getDuration()) ?? 0;
    } catch {
      // ignore
    }
    manager.ytLoad(duration);
  }, [manager]);

  const onChangeState = useCallback(
    (state: string) => {
      switch (state) {
        case 'playing':
          manager.ytStatus('playing');
          break;
        case 'paused':
          manager.ytStatus('paused');
          break;
        case 'buffering':
          manager.ytStatus('buffering');
          break;
        case 'ended':
          if (repeatRef.current) {
            ref.current?.seekTo(0, true);
            setPlaying(true);
          } else {
            manager.ytEnded();
          }
          break;
      }
    },
    [manager]
  );

  const onError = useCallback(
    (code: string) => manager.ytError('youtube', code),
    [manager]
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  }, []);

  if (!YoutubePlayer) {
    return (
      <View style={[styles.fallback, style]} {...rest}>
        <Text style={styles.fallbackText}>
          react-native-youtube-iframe is required for YouTube sources. Install
          it:{'\n'}npm install react-native-youtube-iframe react-native-webview
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]} onLayout={onLayout} {...rest}>
      {size.width > 0 ? (
        <YoutubePlayer
          ref={ref}
          height={size.height}
          width={size.width}
          play={playing}
          mute={isMuted}
          volume={volume}
          playbackRate={rate}
          videoId={videoId}
          initialPlayerParams={{
            controls: false,
            modestbranding: true,
            rel: false,
            preventFullScreen: true,
            iv_load_policy: 3,
            start: startRef.current,
          }}
          // Real https referrer/origin — avoids embed rejections (e.g. 153)
          // on referrer-restricted videos.
          baseUrlOverride="https://www.youtube.com"
          webViewProps={{
            androidLayerType: 'hardware',
            allowsInlineMediaPlayback: true,
            mediaPlaybackRequiresUserAction: false,
          }}
          onReady={onReady}
          onChangeState={onChangeState}
          onError={onError}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  fallback: {
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  fallbackText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 12,
  },
});
