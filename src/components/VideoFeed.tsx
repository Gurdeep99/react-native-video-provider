import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  FlatList,
  StyleSheet,
  useWindowDimensions,
  View,
  type FlatListProps,
} from 'react-native';
import { useVideoManager } from '../provider/VideoContext';
import type { ResizeMode, VideoSource } from '../types/video';
import { VideoSurface } from './VideoSurface';

/** Surface id a feed item registers under. */
export const feedSurfaceId = (id: string) => `feed:${id}`;

/** Minimal shape of a FlatList viewability token (avoids RN type-name drift). */
interface FeedViewToken {
  item: unknown;
  index: number | null | undefined;
  isViewable: boolean;
}

export interface VideoFeedRenderInfo<T> {
  item: T;
  index: number;
  /** True when this item is the one currently playing. */
  focused: boolean;
}

export interface VideoFeedProps<T extends VideoSource> extends Omit<
  FlatListProps<T>,
  | 'data'
  | 'renderItem'
  | 'keyExtractor'
  | 'onViewableItemsChanged'
  | 'viewabilityConfig'
  | 'getItemLayout'
> {
  /** The videos. Each needs a stable `id` (used for the surface + handoff). */
  data: T[];
  /** Height of each item. Default: the window height (a full-screen reels feed). */
  itemHeight?: number;
  resizeMode?: ResizeMode;
  /** Start muted. Default `true` (autoplay policies + typical feed UX). */
  muted?: boolean;
  /** Loop the focused video. Default `true`. */
  repeat?: boolean;
  /** Percent of an item that must be visible to become focused. Default 80. */
  visibilityThreshold?: number;
  /** Overlay above each item — captions, like button, a tap-to-pause layer, … */
  renderOverlay?: (info: VideoFeedRenderInfo<T>) => ReactNode;
  /** Called when the focused item changes (null when none is visible). */
  onFocusChange?: (item: T | null, index: number) => void;
  /** Pause playback when the feed unmounts. Default `true`. */
  pauseOnUnmount?: boolean;
  /**
   * Screen-focus flag from your navigation library — e.g. React Navigation's
   * `useIsFocused()`. `false` pauses the feed; returning to `true` resumes the
   * item that was in view. Needed because navigating away keeps the feed
   * mounted and the app foregrounded. Leave undefined if you don't navigate.
   */
  isFocused?: boolean;
}

/**
 * A single-engine video feed: render many videos in a scrollable list, but
 * only the one scrolled into focus plays — the rest are stopped. There is
 * still exactly ONE native player; scrolling hands it off to the focused
 * item's surface, so memory and CPU stay flat no matter how long the feed.
 *
 * Each item is a plain `VideoSurface` (never a `VideoPlayer`, which would
 * fight for the engine on mount). Focus is driven centrally from FlatList
 * viewability.
 *
 * ```tsx
 * <VideoFeed
 *   data={videos} // [{ id, uri, title? }, …]
 *   renderOverlay={({ item, focused }) => <Caption title={item.title} />}
 * />
 * ```
 */
export function VideoFeed<T extends VideoSource>({
  data,
  itemHeight,
  resizeMode,
  muted = true,
  repeat = true,
  visibilityThreshold = 80,
  renderOverlay,
  onFocusChange,
  pauseOnUnmount = true,
  isFocused,
  ...rest
}: VideoFeedProps<T>) {
  const manager = useVideoManager();
  const { height: windowHeight } = useWindowDimensions();
  const height = itemHeight ?? windowHeight;
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Global engine settings — apply to whatever is currently playing.
  useEffect(() => {
    if (muted) {
      manager.mute();
    } else {
      manager.unmute();
    }
  }, [manager, muted]);

  useEffect(() => {
    manager.setRepeat(repeat);
  }, [manager, repeat]);

  useEffect(() => {
    if (resizeMode) {
      manager.setResizeMode(resizeMode);
    }
  }, [manager, resizeMode]);

  useEffect(() => {
    return () => {
      if (pauseOnUnmount) {
        manager.pause();
      }
    };
  }, [manager, pauseOnUnmount]);

  useEffect(() => {
    if (isFocused === undefined) {
      return;
    }
    if (!isFocused) {
      if (
        manager.store.getState().surfaceId === feedSurfaceId(focusedId ?? '')
      ) {
        manager.pause();
      }
      return;
    }
    // Screen regained focus — resume the item that was in view.
    const item = data.find((d) => d.id === focusedId);
    if (item) {
      manager.setSource(item, {
        autoplay: true,
        surfaceId: feedSurfaceId(item.id),
      });
    }
  }, [manager, isFocused, focusedId, data]);

  const focus = useCallback(
    (item: T | null, index: number) => {
      setFocusedId(item?.id ?? null);
      if (item) {
        // Same-id handoff aware: re-focusing the same video never reloads.
        // A different id replaces the source, which stops the previous one —
        // so only the focused video ever plays.
        manager.setSource(item, {
          autoplay: true,
          surfaceId: feedSurfaceId(item.id),
        });
      }
      onFocusChange?.(item, index);
    },
    [manager, onFocusChange]
  );

  // FlatList forbids changing these on the fly, so keep them stable and read
  // the latest `focus`/`data` through a ref.
  const latest = useRef({ focus, data });
  latest.current = { focus, data };

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: visibilityThreshold,
    minimumViewTime: 100,
  }).current;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: FeedViewToken[] }) => {
      const focusedToken = viewableItems.find((v) => v.isViewable);
      if (focusedToken) {
        latest.current.focus(focusedToken.item as T, focusedToken.index ?? 0);
      }
    }
  ).current;

  const renderItem = useCallback(
    ({ item, index }: { item: T; index: number }) => (
      <View style={[styles.item, { height }]}>
        <VideoSurface
          surfaceId={feedSurfaceId(item.id)}
          style={StyleSheet.absoluteFill}
        />
        {renderOverlay?.({ item, index, focused: item.id === focusedId })}
      </View>
    ),
    [height, renderOverlay, focusedId]
  );

  return (
    <FlatList
      data={data}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      getItemLayout={(_, index) => ({
        length: height,
        offset: height * index,
        index,
      })}
      showsVerticalScrollIndicator={false}
      snapToInterval={height}
      snapToAlignment="start"
      decelerationRate="fast"
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  item: {
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
});
