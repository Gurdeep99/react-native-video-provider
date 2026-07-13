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
| `fullscreenHost` | `true` | Render the built-in fullscreen Modal host |
| `floatingHost` | `true` | Render the built-in draggable floating host |
| `pauseOnDetach` | `false` | Pause when the active surface unmounts (default keeps audio running) |

### `<VideoSurface surfaceId autoAttach? …ViewProps>`
A dumb mount point. Registers its native view under `surfaceId`; the engine
renders into at most one surface at a time. `autoAttach` attaches the player
on mount. Unmounting never destroys the player.

### `<VideoPlayer source autoplay? surfaceId? controls? resizeMode? …ViewProps>`
Convenience: `setSource` (handoff-aware) + `attach` + surface + built-in
controls. Default `surfaceId` is `player:<source.id>`, so two VideoPlayers
with the same source id naturally hand the engine to whichever mounted last.

### `<FullscreenPlayer />` / `<FloatingPlayer width? />`
The built-in hosts (rendered by the provider — mount manually only if you
disabled them in config). Fullscreen allows all orientations while visible;
floating is a draggable 16:9 window with close/expand buttons.

### `<MiniPlayer surfaceId? onPress? onClose? />`
Docked bar (thumbnail surface + title + play/pause + close). Attach with
`attach(surfaceId)` (default `"__au_mini__"`).

### `<VideoControls doubleTapSeek? hideAfter? showFullscreenButton? onClose? />`
Minimal chrome: play/pause, seek bar, times, mute, fullscreen toggle,
tap-to-show, double-tap seek. Build your own from the hooks if you need
custom design.

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
attach(surfaceId) detach()
enterFullscreen() exitFullscreen() toggleFullscreen()
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
fullscreen, pip, floating, mode, surfaceId, videoWidth, videoHeight, error`.

### `useFullscreen()` → `{ isFullscreen, enter, exit, toggle }`
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
  uri: string;
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
- **`destroy()`** is the only thing that releases the native player.
