import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';
import { useVideoManager } from '../provider/VideoContext';
import type { YouTubeController } from '../core/YouTubeController';

// Optional peer dependency: only required when a `type: 'youtube'` source is
// actually rendered, so apps that never use YouTube needn't install it.
let WebView: any;
try {
  WebView = require('react-native-webview').WebView;
} catch {
  WebView = null;
}

interface WebViewMessage {
  nativeEvent: { data: string };
}

export interface YouTubeViewProps extends ViewProps {
  /** YouTube video id (the `source.uri` for a `type: 'youtube'` source). */
  videoId: string;
  autoplay?: boolean;
  muted?: boolean;
  /** Start position in seconds. */
  startSeconds?: number;
}

// Bridges the embed's IFrame-API events to React Native and forwards a
// "listening" handshake so the player starts delivering them.
const INJECTED = `(function(){
  function send(d){try{window.ReactNativeWebView.postMessage(typeof d==='string'?d:JSON.stringify(d));}catch(e){}}
  window.addEventListener('message',function(e){send(e.data);});
  document.addEventListener('message',function(e){send(e.data);});
  function listen(){try{window.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}),'*');}catch(e){}}
  listen();setTimeout(listen,800);setTimeout(listen,2000);
})();true;`;

/**
 * Plays a YouTube video in a WebView using the embed URL + a `Referer`
 * header (the config that satisfies referrer-restricted embeds — the same one
 * that works in production apps). YouTube's own controls and native fullscreen
 * are used. Playback state is bridged back to the shared VideoManager on a
 * best-effort basis so `usePlayback`/events still update; explicit commands
 * (`play()/pause()/seek()`) are forwarded to the player when possible.
 */
export function YouTubeView({
  videoId,
  autoplay = true,
  muted = false,
  startSeconds = 0,
  style,
  ...rest
}: YouTubeViewProps) {
  const manager = useVideoManager();
  const ref = useRef<{ injectJavaScript: (js: string) => void } | null>(null);

  const cmd = useCallback((func: string, args: unknown[] = []) => {
    ref.current?.injectJavaScript(
      `try{window.postMessage(JSON.stringify({event:'command',func:'${func}',args:${JSON.stringify(
        args
      )}}),'*');}catch(e){};true;`
    );
  }, []);

  useEffect(() => {
    const controller: YouTubeController = {
      videoId,
      play: () => cmd('playVideo'),
      pause: () => cmd('pauseVideo'),
      stop: () => {
        cmd('pauseVideo');
        cmd('seekTo', [0, true]);
      },
      seekTo: (s) => cmd('seekTo', [s, true]),
      setRate: (r) => cmd('setPlaybackRate', [r]),
      setVolume: (v) => cmd('setVolume', [Math.round(v * 100)]),
      setMuted: (m) => cmd(m ? 'mute' : 'unMute'),
      setRepeat: () => {},
    };
    manager.registerYouTube(controller);
    return () => manager.unregisterYouTube(controller);
  }, [manager, videoId, cmd]);

  const source = useMemo(
    () => ({
      uri:
        `https://www.youtube.com/embed/${videoId}` +
        `?enablejsapi=1&autoplay=${autoplay ? 1 : 0}&mute=${muted ? 1 : 0}` +
        `&controls=1&playsinline=1&fs=1&rel=0&modestbranding=1&iv_load_policy=3` +
        `&start=${Math.floor(startSeconds)}`,
      headers: { Referer: 'https://youtube.com' },
    }),
    [videoId, autoplay, muted, startSeconds]
  );

  const onMessage = (e: WebViewMessage) => {
    let m: { event?: string; info?: unknown };
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (!m || !m.event) {
      return;
    }
    const info = m.info as
      | { playerState?: number; currentTime?: number; duration?: number }
      | number
      | undefined;
    if (m.event === 'onReady' || m.event === 'initialDelivery') {
      const duration =
        typeof info === 'object' ? Number(info?.duration) || 0 : 0;
      manager.ytLoad(duration);
    } else if (m.event === 'onStateChange' || m.event === 'infoDelivery') {
      const state = typeof info === 'number' ? info : info?.playerState;
      if (state === 1) {
        manager.ytStatus('playing');
      } else if (state === 2) {
        manager.ytStatus('paused');
      } else if (state === 3) {
        manager.ytStatus('buffering');
      } else if (state === 0) {
        manager.ytEnded();
      }
      if (typeof info === 'object' && info?.currentTime != null) {
        manager.ytProgress(
          Number(info.currentTime) || 0,
          Number(info.duration) || 0
        );
      }
    } else if (m.event === 'onError') {
      manager.ytError('youtube', String(m.info));
    }
  };

  const onLoadEnd = () => {
    // Clear the loading poster even if the event bridge stays quiet.
    if (manager.store.getState().loading) {
      manager.ytLoad(manager.store.getState().duration || 0);
    }
  };

  if (!WebView) {
    return (
      <View style={[styles.fallback, style]} {...rest}>
        <Text style={styles.fallbackText}>
          react-native-webview is required for YouTube sources. Install it:
          {'\n'}npm install react-native-webview
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]} {...rest}>
      <WebView
        ref={ref}
        source={source}
        style={styles.web}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        mediaPlaybackRequiresUserAction={false}
        androidLayerType="hardware"
        scalesPageToFit={false}
        scrollEnabled={false}
        bounces={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        injectedJavaScript={INJECTED}
        onMessage={onMessage}
        onLoadEnd={onLoadEnd}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  web: {
    flex: 1,
    backgroundColor: '#000',
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
