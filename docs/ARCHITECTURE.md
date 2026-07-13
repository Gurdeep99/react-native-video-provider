# Architecture

`react-native-au-video` is built around one principle:

> **There is exactly ONE native playback engine per app. React components never own it — they only borrow a place to render it.**

This is the same model YouTube, Netflix and Twitter/X use: playback survives navigation because
navigation only moves the *rendering surface*, never the player.

```
┌────────────────────────────────────────────────────────────┐
│                        <VideoProvider>                      │
│                                                            │
│   JS  ┌──────────────┐   commands   ┌──────────────────┐   │
│       │  useVideo()  │ ───────────▶ │   VideoManager    │   │
│       │  hooks/APIs  │              │   (JS singleton)  │   │
│       └──────────────┘              └────────┬─────────┘   │
│              ▲                               │             │
│              │ subscribe            TurboModule (JSI)      │
│       ┌──────┴───────┐                       │             │
│       │ Zustand store │ ◀── events ──┐       ▼             │
│       └──────────────┘         ┌─────┴──────────────┐      │
│                                │   Native PlayerCore │      │
│  Native                        │  Android: ExoPlayer │      │
│                                │  iOS:     AVPlayer  │      │
│                                └─────┬──────────────┘      │
│                                      │ attach/detach       │
│              ┌───────────────────────┼──────────────┐      │
│              ▼                       ▼              ▼      │
│      <VideoSurface           <VideoSurface   <VideoSurface │
│        id="feed"/>             id="detail"/>  id="fullscreen"/>
└────────────────────────────────────────────────────────────┘
```

## Layers

### 1. `VideoProvider` (React)
Wraps the app once. Responsibilities:
- initializes the `VideoManager` singleton (which lazily creates the native player — "mount silently")
- exposes React context
- renders the built-in **fullscreen host** and **floating host** overlays above the app so
  `enterFullscreen()` / `showFloating()` work from anywhere without the app adding screens

### 2. `VideoManager` (JS singleton)
The only object that talks to the native module. It owns:
- command API (`play`, `pause`, `seek`, `setSource`, `attach`, …)
- the **same-video handoff** rule: `setSource(v)` where `v.id === currentVideo.id` is a no-op
  for the engine — playback position, buffer and decoder are untouched; only the surface changes
- surface bookkeeping (which surface is active, which to restore after fullscreen/floating exit)
- translating native events into the Zustand store + the public event emitter

### 3. Playback store (Zustand, vanilla store)
Single global state: `currentVideo, status, playing, buffering, position, duration, rate,
volume, muted, fullscreen, pip, floating, mode, surfaceId, error…`.
Components subscribe with selectors, so a progress tick re-renders only what displays time.

### 4. Native `PlayerCore` (one per platform, singleton)
- **Android (Kotlin):** one `ExoPlayer` (AndroidX Media3) + one `PlayerView`
  (TextureView-backed) that is *re-parented* between registered surface `FrameLayout`s.
  The player is created once and never released on unmount — only on `destroy()`.
- **iOS (Swift):** one `AVPlayer` + one host `UIView` whose backing layer is an
  `AVPlayerLayer`. The host view is moved between registered surface `UIView`s.

Re-parenting a view does not interrupt decoding, so switching surfaces causes
**no pause, no rebuffer, no seek reset**.

### 5. `<VideoSurface id="…">` (Fabric component)
Dumb mount point. Registers its native view in the **surface registry** under its id and
unregisters on unmount. It never creates or destroys the player. If the manager already wants
this surface id (e.g. attach was called before the screen finished mounting), the registry
attaches the player the moment the view registers — this makes navigation timing a non-issue.

## Key flows

### Feed → Detail (same video, "reference" handoff)
1. Feed renders `<VideoSurface id="feed">`, `setSource({id:'123',…})`, video plays.
2. User opens Detail with the same video. Detail renders `<VideoSurface id="detail">` and calls
   `setSource({id:'123'})` + `attach('detail')` (or just `<VideoPlayer source={v}>`, which does both).
3. Manager sees `id` unchanged → engine untouched. Registry re-parents the host view to
   the detail surface. Playback continues from the exact frame.
4. If `id` differs → `replaceSource` on the engine (single load, no player recreation).

### Fullscreen
1. `enterFullscreen()` → provider mounts the fullscreen host (a `Modal` covering everything,
   all orientations allowed) containing `<VideoSurface id="__fullscreen__">`.
2. Native side **unlocks rotation**: Android sets `requestedOrientation = FULL_SENSOR` and hides
   system bars; iOS widens the supported-orientation mask (app hooks
   `AuVideoOrientation` in AppDelegate) and requests a geometry update.
3. The user can rotate freely while fullscreen is visible.
4. `exitFullscreen()` restores the previous orientation lock (e.g. portrait-only app returns to
   portrait), unmounts the host, and re-attaches the player to the previous surface.

Apps that want fullscreen "as part of a screen" instead can render their own
`<VideoSurface id="myFullscreen">` anywhere and call `attach('myFullscreen')` — the built-in
host is a convenience, not a requirement.

### Floating
`showFloating()` mounts a draggable overlay (JS `Animated` + gesture) with
`<VideoSurface id="__floating__">`. Same engine, same position.

### Preload
`preload(source)` warms the media without rendering:
- iOS: creates and caches an `AVPlayerItem` (asset begins loading immediately)
- Android: caches the prepared `MediaItem`; upgrade path to Media3 `PreloadManager` is isolated
  inside `PlayerCore` (roadmap)

## Threading & lifecycle rules
- All ExoPlayer / AVPlayer / view re-parenting happens on the **main thread**; the TurboModule
  marshals every call.
- Surfaces hold **weak** references in the registry — an unmounted screen can never leak.
- Surface unmount while attached ⇒ player detaches to a hidden state but **keeps playing**
  (audio continues; a following `attach` restores video instantly). `pauseOnDetach` is a
  provider option.

## Trade-offs made deliberately
| Decision | Why | Alternative rejected |
|---|---|---|
| One engine, moved between views | zero-interruption handoff, minimal memory | player-per-component (react-native-video model): duplicate decoders, reload on navigation |
| TextureView (Android) | re-parents & animates cleanly (floating window, feed scroll) | SurfaceView: cheaper battery-wise but punches a hole — breaks re-parenting/overlays |
| Fullscreen host = RN `Modal` | covers any navigator, per-modal orientation support on iOS | navigation-integrated fullscreen: couples the lib to a nav library |
| Zustand vanilla store | selector-level subscriptions, no `<Context>` re-render storms | Redux (boilerplate), React state in provider (whole-tree re-renders every 250 ms progress tick) |
| Commands are fire-and-forget into native | UI never blocks; store is the read path | promise-per-command: ordering issues when spamming seek |
| Single event channel per concern, JS synthesizes the rich event set | small native surface, stable codegen | 1:1 native event per public event: N× native boilerplate |

## Roadmap (API shaped now, implemented later)
- Queue (next/previous/playlist/autoplay) — `QueueController` slot in the manager
- Background playback: Android `MediaSessionService` + notification, iOS audio session category +
  remote commands (lock screen)
- Gesture extras: brightness/volume vertical swipes (needs native), pinch zoom
- Quality/subtitle/audio-track selection (Media3 `TrackSelector` / AVMediaSelection)
- True Android preloading via Media3 `PreloadManager`
