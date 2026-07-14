import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewProps,
} from 'react-native';
import { usePlayback } from '../hooks/usePlayback';
import { useVideoManager } from '../provider/VideoContext';
import { CloseIcon, PauseIcon, PlayIcon } from './icons';
import { VideoSurface } from './VideoSurface';

export interface MiniPlayerProps extends ViewProps {
  /** Surface id. Default "__au_mini__". */
  surfaceId?: string;
  /** Tapping the bar (e.g. navigate back to the detail screen). */
  onPress?: () => void;
  /** Called by the ✕ button; button hidden when omitted. */
  onClose?: () => void;
}

/**
 * Docked mini player bar (Spotify style): thumbnail surface, title,
 * play/pause and close. Attach it with `attach(surfaceId)` — typically when
 * the user leaves the screen that owned playback.
 */
export function MiniPlayer({
  surfaceId = '__au_mini__',
  onPress,
  onClose,
  style,
  ...rest
}: MiniPlayerProps) {
  const manager = useVideoManager();
  const playing = usePlayback((s) => s.playing);
  const title = usePlayback((s) => s.currentVideo?.title ?? '');

  return (
    <View style={[styles.bar, style]} {...rest}>
      <Pressable style={styles.body} onPress={onPress}>
        <VideoSurface surfaceId={surfaceId} style={styles.thumb} />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </Pressable>
      <Pressable
        style={styles.button}
        hitSlop={8}
        onPress={() => manager.toggle()}
      >
        {playing ? (
          <PauseIcon size={16} color="#fff" />
        ) : (
          <PlayIcon size={16} color="#fff" />
        )}
      </Pressable>
      {onClose ? (
        <Pressable style={styles.button} hitSlop={8} onPress={onClose}>
          <CloseIcon size={16} color="#fff" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    height: 56,
    paddingRight: 8,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  thumb: {
    width: 56 * (16 / 9),
    height: 56,
    backgroundColor: '#000',
  },
  title: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
