import { useEffect, useMemo, useRef } from 'react';
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

/** Minimal shape of react-native-webview's onMessage event. */
interface WebViewMessage {
  nativeEvent: { data: string };
}

export interface YouTubeViewProps extends ViewProps {
  /** YouTube video id (the `source.uri` for a `type: 'youtube'` source). */
  videoId: string;
  autoplay?: boolean;
  muted?: boolean;
  repeat?: boolean;
}

/**
 * Plays a YouTube video through the YouTube IFrame API inside a WebView, and
 * bridges it to the shared VideoManager so `usePlayback`, events and the
 * command API work the same as native sources. YouTube's own player UI (incl.
 * its native fullscreen + rotation) is used — the native engine and this one
 * are mutually exclusive per active source.
 */
export function YouTubeView({
  videoId,
  autoplay = true,
  muted = false,
  repeat = false,
  style,
  ...rest
}: YouTubeViewProps) {
  const manager = useVideoManager();
  const ref = useRef<{ injectJavaScript: (js: string) => void } | null>(null);
  const repeatRef = useRef(repeat);
  repeatRef.current = repeat;

  const html = useMemo(
    () => buildHtml(videoId, autoplay, muted),
    [videoId, autoplay, muted]
  );

  useEffect(() => {
    const inject = (js: string) => ref.current?.injectJavaScript(`${js};true;`);
    const controller: YouTubeController = {
      videoId,
      play: () => inject('player&&player.playVideo()'),
      pause: () => inject('player&&player.pauseVideo()'),
      stop: () => inject('player&&(player.pauseVideo(),player.seekTo(0,true))'),
      seekTo: (s) => inject(`player&&player.seekTo(${s},true)`),
      setRate: (r) => inject(`player&&player.setPlaybackRate(${r})`),
      setVolume: (v) =>
        inject(`player&&player.setVolume(${Math.round(v * 100)})`),
      setMuted: (m) => inject(`player&&player.${m ? 'mute' : 'unMute'}()`),
      setRepeat: () => {}, // handled on the 'ended' message via repeatRef
    };
    manager.registerYouTube(controller);
    return () => manager.unregisterYouTube(controller);
  }, [manager, videoId]);

  const onMessage = (e: WebViewMessage) => {
    let msg: { type: string; [k: string]: unknown };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'ready':
        manager.ytLoad(Number(msg.duration) || 0);
        break;
      case 'state':
        handleState(Number(msg.state));
        break;
      case 'time':
        manager.ytProgress(
          Number(msg.position) || 0,
          Number(msg.duration) || 0
        );
        break;
      case 'error':
        manager.ytError('youtube', String(msg.code ?? 'YouTube error'));
        break;
    }
  };

  // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering.
  const handleState = (state: number) => {
    switch (state) {
      case 1:
        manager.ytStatus('playing');
        break;
      case 2:
        manager.ytStatus('paused');
        break;
      case 3:
        manager.ytStatus('buffering');
        break;
      case 0:
        if (repeatRef.current) {
          ref.current?.injectJavaScript(
            'player&&(player.seekTo(0,true),player.playVideo());true;'
          );
        } else {
          manager.ytEnded();
        }
        break;
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
        source={{ html }}
        style={styles.web}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        mediaPlaybackRequiresUserAction={false}
        onMessage={onMessage}
        // The IFrame API must load over http(s), not about:blank.
        baseUrl="https://www.youtube.com"
      />
    </View>
  );
}

function buildHtml(videoId: string, autoplay: boolean, muted: boolean): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}#p{width:100%;height:100%}</style>
</head><body>
<div id="p"></div>
<script>
var player;
function post(m){try{window.ReactNativeWebView.postMessage(JSON.stringify(m))}catch(e){}}
var tag=document.createElement('script');tag.src='https://www.youtube.com/iframe_api';
document.body.appendChild(tag);
function onYouTubeIframeAPIReady(){
  player=new YT.Player('p',{
    videoId:'${videoId}',
    playerVars:{autoplay:${autoplay ? 1 : 0},controls:1,playsinline:1,rel:0,modestbranding:1,fs:1,mute:${muted ? 1 : 0}},
    events:{
      onReady:function(){post({type:'ready',duration:player.getDuration()});},
      onStateChange:function(e){post({type:'state',state:e.data});},
      onError:function(e){post({type:'error',code:e.data});}
    }
  });
}
setInterval(function(){
  if(player&&player.getCurrentTime){post({type:'time',position:player.getCurrentTime(),duration:player.getDuration()});}
},500);
</script>
</body></html>`;
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
