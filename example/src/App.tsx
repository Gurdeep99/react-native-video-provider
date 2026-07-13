import { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  VideoPlayer,
  VideoProvider,
  usePlayback,
  useVideo,
  type VideoSource,
} from 'react-native-video-provider';

const VIDEOS: VideoSource[] = [
  {
    id: 'bunny',
    uri: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    title: 'Big Buck Bunny',
  },
  {
    id: 'sintel',
    uri: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    title: 'Sintel',
  },
  {
    id: 'blazes',
    uri: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    title: 'For Bigger Blazes',
  },
];

function FeedScreen({
  active,
  onSelect,
  onOpenDetail,
}: {
  active: VideoSource | null;
  onSelect: (v: VideoSource) => void;
  onOpenDetail: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.feed}>
      <Text style={styles.heading}>Feed</Text>
      {VIDEOS.map((video) => (
        <View key={video.id} style={styles.card}>
          <Text style={styles.cardTitle}>{video.title}</Text>
          {active?.id === video.id ? (
            <>
              <VideoPlayer source={video} style={styles.player} />
              <Pressable style={styles.link} onPress={onOpenDetail}>
                <Text style={styles.linkText}>
                  Open detail screen → (same video, no reload)
                </Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={styles.thumb} onPress={() => onSelect(video)}>
              <Text style={styles.thumbText}>▶ Tap to play</Text>
            </Pressable>
          )}
        </View>
      ))}
      <StatusPanel />
    </ScrollView>
  );
}

function DetailScreen({
  video,
  onBack,
}: {
  video: VideoSource;
  onBack: () => void;
}) {
  const player = useVideo();
  return (
    <ScrollView contentContainerStyle={styles.feed}>
      <Pressable style={styles.link} onPress={onBack}>
        <Text style={styles.linkText}>← Back to feed</Text>
      </Pressable>
      <Text style={styles.heading}>{video.title}</Text>
      {/* Same source id ⇒ the engine hands off: position and buffer survive. */}
      <VideoPlayer source={video} style={styles.playerLarge} />
      <View style={styles.row}>
        <Pressable style={styles.button} onPress={() => player.enterFullscreen()}>
          <Text style={styles.buttonText}>Fullscreen</Text>
        </Pressable>
        <Pressable
          style={styles.button}
          onPress={() => {
            onBack();
            player.showFloating();
          }}
        >
          <Text style={styles.buttonText}>Float + back</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={() => player.enterPiP()}>
          <Text style={styles.buttonText}>PiP</Text>
        </Pressable>
      </View>
      <StatusPanel />
    </ScrollView>
  );
}

function StatusPanel() {
  const status = usePlayback((s) => s.status);
  const position = usePlayback((s) => s.position);
  const duration = usePlayback((s) => s.duration);
  const mode = usePlayback((s) => s.mode);
  const surfaceId = usePlayback((s) => s.surfaceId);
  return (
    <View style={styles.panel}>
      <Text style={styles.panelText}>
        {status} · {position.toFixed(1)}s / {duration.toFixed(1)}s
      </Text>
      <Text style={styles.panelText}>
        mode: {mode} · surface: {surfaceId ?? '—'}
      </Text>
    </View>
  );
}

function Screens() {
  const [active, setActive] = useState<VideoSource | null>(null);
  const [screen, setScreen] = useState<'feed' | 'detail'>('feed');

  if (screen === 'detail' && active) {
    return <DetailScreen video={active} onBack={() => setScreen('feed')} />;
  }
  return (
    <FeedScreen
      active={active}
      onSelect={setActive}
      onOpenDetail={() => setScreen('detail')}
    />
  );
}

export default function App() {
  return (
    <VideoProvider>
      <SafeAreaView style={styles.root}>
        <Screens />
      </SafeAreaView>
    </VideoProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0e0e10',
  },
  feed: {
    padding: 16,
    gap: 12,
  },
  heading: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  card: {
    gap: 8,
    marginBottom: 8,
  },
  cardTitle: {
    color: '#ddd',
    fontSize: 15,
    fontWeight: '600',
  },
  thumb: {
    aspectRatio: 16 / 9,
    borderRadius: 10,
    backgroundColor: '#26262b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbText: {
    color: '#aaa',
    fontSize: 16,
  },
  player: {
    aspectRatio: 16 / 9,
    borderRadius: 10,
  },
  playerLarge: {
    aspectRatio: 16 / 9,
    borderRadius: 10,
  },
  link: {
    paddingVertical: 6,
  },
  linkText: {
    color: '#6ea8ff',
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    backgroundColor: '#2b2b31',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
  },
  panel: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#1b1b1f',
  },
  panelText: {
    color: '#9a9aa2',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
});
