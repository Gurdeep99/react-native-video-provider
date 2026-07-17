# API Reference

Everything is exported from the package root:

```ts
import { VideoProvider, VideoPlayer, useVideo, ... } from 'react-native-video-provider';
```

## Components

### `<VideoProvider config?>`
Wraps the app once. Creates the singleton engine silently and renders the
built-in fullscreen + floating hosts above the app.

| `config` field | Default | Meaning |
|---|---|---|
| `fullscreenHost` | `true` | Render the built-in fullscreen host (in-window overlay) |
| `floatingHost` | `true` | Render the built-in draggable floating host |
| `pauseOnDetach` | `false` | Pause when the active surface unmounts (default keeps audio running) |
| `lockPortrait` | `false` | Lock the app portrait so the video never sensor-rotates inline — only fullscreen rotates to landscape (on tap). iOS needs the AppDelegate forwarding |

### `<VideoSurface surfaceId autoAttach? …ViewProps>`
A dumb mount point. Registers its native view under `surfaceId`; the engine
renders into at most one surface at a time. `autoAttach` attaches the player
on mount. Unmounting never destroys the player.

### `<VideoPlayer source autoplay? surfaceId? controls? resizeMode? repeat? muted? orientation? fullscreenOrientation? autoFullscreenOnRotate? pauseOnFocusLost? isFocused? live? liveIcon? thumbnail? onLoadComplete? onBuffering? onError? ref? …ViewProps>`
Convenience: `setSource` (handoff-aware) + `attach` + surface + built-in
controls. Default `surfaceId` is `player:<source.id>`, so two VideoPlayers
with the same source id naturally hand the engine to whichever mounted last.

- `repeat` — loop playback when it ends. Default `false`.
- `muted` — default `false`.
- `orientation` forces the screen into that orientation while the player is
  mounted (`'landscape'`, `'inverted-landscape'`, `'portrait'`,
  `'inverted-portrait'`) and releases it on unmount.
- `fullscreenOrientation` forces one only while this player is fullscreen
  (applied when fullscreen opens — including via the built-in controls'
  button — restored when it closes, so the rest of the app is unaffected).
- `autoFullscreenOnRotate` — opt-in (default off). Physically rotating the
  device to landscape auto-enters fullscreen and rotating back exits it
  (YouTube-style); needs the app to allow landscape at the OS level.
- `pauseOnFocusLost` — pause when the app backgrounds while this player is
  the one playing. Default `true`; set `false` for background audio. Only the
  focused player reacts, so a video attached to another surface is untouched.
- `isFocused` — screen-focus flag from your navigation library. Pass
  React Navigation's `useIsFocused()`; `false` pauses, back to `true` resumes.
  This is the **only** reliable way to pause when navigating to another screen
  (React Navigation keeps screens mounted and the app stays foregrounded, so
  neither unmount nor AppState fires):

  ```tsx
  import { useIsFocused } from '@react-navigation/native';
  const isFocused = useIsFocused();
  <VideoPlayer source={video} isFocused={isFocused} />
  // VideoFeed takes the same prop.
  ```
- `onLoadComplete({ videoId, duration, width, height })` — fires once
  metadata is available.
- `onBuffering(buffering: boolean)` — fires whenever buffering starts/stops.
- `onError({ code, message })`.
- `ref` exposes the underlying `VideoManager` — `ref.current.play()`,
  `.seek()`, etc. The same singleton `useVideo()` returns.

### `<VideoFeed data itemHeight? resizeMode? muted? repeat? visibilityThreshold? renderOverlay? onFocusChange? pauseOnUnmount? isFocused? …FlatListProps>`
A single-engine, TikTok/Reels-style feed. Renders many videos in a scrolling
FlatList but only the one scrolled into focus plays — the rest are stopped.
There is still exactly ONE native player; scrolling hands it off to the
focused item's surface, so memory/CPU stay flat no matter how long the feed.

Each item is a plain `VideoSurface` (never a `VideoPlayer` — that would fight
for the engine on mount); focus is driven from FlatList viewability.

```tsx
<VideoFeed
  data={videos} // [{ id, uri, title? }, …] — each needs a stable id
  renderOverlay={({ item, focused }) => (
    <Caption title={item.title} paused={!focused} />
  )}
/>
```

- `itemHeight` — default full window height (paging feed). `data` items each
  need a stable `id`; it's the FlatList key and the surface id.
- `muted` default `true`, `repeat` default `true`, `visibilityThreshold`
  (percent visible to become focused) default `80`.
- `renderOverlay({ item, index, focused })` — captions, like button, a
  tap-to-pause layer built on `useVideo()`, etc.
- `onFocusChange(item | null, index)` fires when the playing item changes.
- Any extra `FlatList` prop passes through (`ListHeaderComponent`, `onEndReached`
  for infinite scroll, `horizontal`, …).

### `<FullscreenPlayer />` / `<FloatingPlayer width? />`
The built-in hosts (rendered by the provider — mount manually only if you
disabled them in config). Fullscreen locks landscape by default (no sensor
rotation; pass `fullscreenOrientation` to change it);
floating is a draggable 16:9 window with close/expand buttons.

### `<MiniPlayer surfaceId? onPress? onClose? />`
Docked bar (thumbnail surface + title + play/pause + close). Attach with
`attach(surfaceId)` (default `"__au_mini__"`).

### `<VideoControls doubleTapSeek? hideAfter? showFullscreenButton? onClose? />`
Minimal chrome: play/pause, seek bar, times, mute, fullscreen toggle,
tap-to-show, double-tap seek. Build your own from the hooks if you need
custom design.

Live state comes from the store (set via `VideoPlayer`'s `live` / `liveIcon`,
or `useVideo().setLive(live, liveIcon)`), so the same controls show it inline
and in the fullscreen host. When live: the seek bar/times are hidden (mute +
fullscreen remain) and the `liveIcon` badge sticks to the **top-right, always
visible** — it does not auto-hide with the rest of the controls.

### `<GestureOverlay onSingleTap? onDoubleTapLeft? onDoubleTapRight? onLongPress?>`
Tap-gesture layer used by VideoControls, exported as a building block.

## Hooks

### `useVideo(): VideoManager`
The command API (stable reference; commands never re-render):

```
setSource(source, { autoplay?, surfaceId? })   preload(source)
play() pause() resume() toggle() stop()
seek(sec) seekBy(offset) getPosition()
setRate(r) setVolume(v) mute() unmute() setRepeat(b) setResizeMode(m)
setOrientation(lock)   // 'auto' | 'portrait' | 'inverted-portrait'
                       // | 'landscape' | 'inverted-landscape'
setFullscreenOrientation(lock | null)  // default for enterFullscreen()
attach(surfaceId) detach()
enterFullscreen(orientation?) exitFullscreen() toggleFullscreen(orientation?)
showFloating() hideFloating()
enterPiP() exitPiP()
addListener(event, fn) destroy()
store   // zustand store for imperative reads: store.getState()
```

### `usePlayback(selector?)`
Subscribe to `VideoState` with a selector — the component re-renders only
when the selected slice changes:

```ts
const position = usePlayback((s) => s.position);
```

`VideoState`: `currentVideo, status, playing, paused, buffering, loading,
position, duration, buffered, rate, volume, muted, repeat, resizeMode,
orientationLock, fullscreen, pip, floating, mode, surfaceId, videoWidth,
videoHeight, error`.

### `useFullscreen()` → `{ isFullscreen, enter, exit, toggle, orientationLock, setOrientation }`
`enter(orientation?)` / `toggle(orientation?)` optionally force an
orientation for that fullscreen session only.
### `usePiP()` → `{ isActive, enter, exit }`
### `useVideoEvents(handlers)`
Subscribes for the component lifetime; inline handlers are fine.

## Events

| Event | Payload |
|---|---|
| `onLoad` | `{ videoId, duration, width, height }` |
| `onReady` | `{ videoId }` |
| `onPlay` / `onPause` / `onEnd` | — |
| `onBuffer` | `{ buffering }` |
| `onSeek` | `{ position }` |
| `onProgress` | `{ position, duration, buffered }` (every 500 ms while playing) |
| `onError` | `{ code, message }` |
| `onEnterFullscreen` / `onExitFullscreen` | — |
| `onAttach` / `onDetach` | `{ surfaceId }` |
| `onModeChanged` | `{ mode }` |
| `onVideoChanged` | `{ video }` |
| `onPipChanged` | `{ active }` |

## Types

```ts
interface VideoSource {
  id: string;            // identity used for same-video handoff
  uri: string;           // stream/file URL, OR a YouTube video id when type==='youtube'
  type?: 'url' | 'youtube'; // default 'url' (native engine); 'youtube' → WebView
  headers?: Record<string, string>;
  title?: string;
  artist?: string;
  artworkUri?: string;
  startPosition?: number; // seconds, applied on (re)load only
}

type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'playing'
                    | 'paused' | 'buffering' | 'ended' | 'error';
type PlayerMode = 'inline' | 'fullscreen' | 'floating' | 'pip'
                | 'background' | 'hidden';
type ResizeMode = 'contain' | 'cover' | 'stretch';
type OrientationLock = 'auto' | 'portrait' | 'inverted-portrait'
                     | 'landscape' | 'inverted-landscape';
```

## Semantics worth knowing

- **Same-video handoff:** `setSource(v)` with `v.id === currentVideo.id`
  never touches the engine. Position, buffer and play state survive; only
  the surface changes.
- **Pending attach:** `attach(id)` before the surface mounts is remembered;
  the engine attaches the moment the surface registers.
- **Detached playback:** when the active surface unmounts, playback (audio)
  continues hidden by default; remounting the same surface re-attaches
  automatically. Set `pauseOnDetach: true` to pause instead.
- **Fullscreen restore:** exiting fullscreen/floating re-attaches the last
  non-reserved surface and restores the previous orientation lock.
- **Orientation precedence:** a fullscreen-scoped lock
  (`enterFullscreen('portrait')` or `<VideoPlayer fullscreenOrientation>`) is
  the highest priority — it's applied in the same native call as entering
  fullscreen (never a separate follow-up call), so there's no unlocked frame
  where the sensor could win first. It lasts only for that fullscreen
  session. Below that: an explicit `setOrientation` lock (or a
  `<VideoPlayer orientation>` prop) wins over the fullscreen sensor unlock
  and the app's own lock; `'auto'` restores whatever applied before. On iOS
  this requires the AppDelegate forwarding described in the README; inverted
  portrait is ignored by iPhones without a home button.
- **`destroy()`** is the only thing that releases the native player.
