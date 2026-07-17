# react-native-video-provider

**One native player. Many surfaces. Zero interruptions.**

A singleton-engine video library for React Native (Android + iOS, New
Architecture). The app owns exactly one native playback engine (ExoPlayer /
AVPlayer) for its whole lifetime; React components are just *rendering
surfaces* the engine attaches to. Moving from a feed cell to a detail screen
to fullscreen to a floating window never reloads, rebuffers, or resets
position — exactly how YouTube, Netflix and Twitter/X players behave.

```
Feed ──▶ Detail ──▶ Fullscreen (rotation unlocked) ──▶ Floating window
              same engine · same buffer · same position
```

- 🎯 **Singleton engine** — created silently once by the provider; survives
  navigation, tab switches, unmounts, Fast Refresh
- 🔁 **Same-video handoff** — `setSource` with the same `id` is a no-op for
  the engine; the player just re-parents to the new surface
- 📱 **Single-engine feed** — `VideoFeed`, a TikTok/Reels-style list where
  only the scrolled-into-focus video plays, on one player, flat memory
- 📺 **Fullscreen** — built-in host that locks landscape (no accidental
  sensor rotation) and restores the previous orientation on exit
- 🧭 **Orientation control** — force portrait/landscape (+ inverted) per
  player, scoped to fullscreen, or as a standing lock
- ⏸️ **Focus-aware** — auto-pause on app background and on screen navigation
  (React Navigation's `useIsFocused()`)
- 🎈 **Floating player** — built-in draggable in-app window
- 🖼 **Picture in Picture** — Android + iOS
- ⚡ **New Architecture native** — TurboModule + Fabric, typed end to end
- 🧠 **Zustand-powered state** — selector subscriptions, no re-render storms

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and
[docs/API.md](docs/API.md) for the complete API reference.

## Installation

```sh
npm install react-native-video-provider react-native-svg
cd ios && pod install
```

`react-native-svg` is a peer dependency (used by the built-in control icons).
Add `react-native-webview` too **only if** you use YouTube sources
(`npm install react-native-webview`) — it's an optional peer dependency.

Requires the New Architecture. Works on React Native **0.79+** — the
TurboModule spec uses direct codegen-type imports so it parses on 0.79's
codegen as well as 0.80+.

## Quick start

**1. Wrap the app once.** The provider silently creates the engine and mounts
the fullscreen/floating hosts above your app:

```tsx
import { VideoProvider } from 'react-native-video-provider';

export default function App() {
  return (
    <VideoProvider>
      <Navigation />
    </VideoProvider>
  );
}
```

**2. Play a video anywhere:**

```tsx
import { VideoPlayer } from 'react-native-video-provider';

<VideoPlayer
  source={{ id: '123', uri: 'https://example.com/video.m3u8', title: 'Big Buck Bunny' }}
  style={{ aspectRatio: 16 / 9 }}
/>
```

**Play a YouTube video** — same component, same state/events/commands. Just
set `type: 'youtube'` and put the YouTube **video id** in `uri`:

```tsx
<VideoPlayer source={{ id: 'y1', uri: 'dQw4w9WgXcQ', type: 'youtube' }} style={{ aspectRatio: 16 / 9 }} />
```

YouTube plays in a WebView (IFrame API) but uses the **same built-in
`VideoControls`** (YouTube's own UI is hidden) and the same fullscreen host —
so it looks and behaves like a native source. `usePlayback`, `useVideoEvents`,
`play()/pause()/seek()` all work the same. Native (`type: 'url'`, the default)
and YouTube sources are interchangeable. Requires `react-native-webview`.

> YouTube can't re-parent its WebView the way the native engine re-parents its
> view, so entering/exiting fullscreen re-creates the WebView (it resumes at
> the current position). Cross-surface handoff (feed → detail) reloads for
> YouTube; native video stays seamless.

**3. Open a detail screen with the same video** — because the `id` matches,
the engine is untouched and playback continues from the exact frame:

```tsx
// DetailScreen.tsx — same source id ⇒ handoff, not reload
<VideoPlayer source={{ id: '123', uri }} style={{ aspectRatio: 16 / 9 }} />
```

**4. Fullscreen / floating / PiP from anywhere:**

```tsx
const player = useVideo();

player.enterFullscreen(); // locks landscape (no sensor rotation)
player.showFloating();    // draggable in-app window
player.enterPiP();        // system picture-in-picture
```

**5. Force an orientation** — values: `'auto' | 'portrait' |
'inverted-portrait' | 'landscape' | 'inverted-landscape'`.

Scoped to fullscreen (applied when fullscreen opens, restored when it
closes — the rest of the app is unaffected):

```tsx
// This player's fullscreen (incl. the built-in controls' button) locks to
// portrait — e.g. a vertical video:
<VideoPlayer source={video} fullscreenOrientation="portrait" />

// Or per call:
const { enter, toggle } = useFullscreen();
enter('landscape');
```

Fullscreen **locks** orientation — it never follows the device sensor.
Tapping the fullscreen button rotates to landscape (default) and it stays put
however you hold the phone; tapping exit returns to portrait. To also stop the
*inline* video from sensor-rotating with the rest of the app, set
`lockPortrait` on the provider — the app stays portrait and only fullscreen
rotates to landscape:

```tsx
<VideoProvider config={{ lockPortrait: true }}>
```

Opt in to YouTube-style sensor auto fullscreen with `autoFullscreenOnRotate`
(off by default): physically rotating to landscape enters fullscreen and
rotating back exits. Requires the app to allow landscape at the OS level:

```tsx
<VideoPlayer source={video} autoFullscreenOnRotate />
```

Or as a standing lock, independent of fullscreen:

```tsx
// While this player is mounted (released on unmount):
<VideoPlayer source={video} orientation="landscape" />

// Imperative:
player.setOrientation('inverted-landscape');
player.setOrientation('auto'); // release
```

On iOS this needs the AppDelegate forwarding shown in
[Platform setup](#ios--fullscreen-rotation). Inverted portrait is ignored by
iPhones without a home button (the OS doesn't allow it).

## Surfaces (the core idea)

`<VideoSurface>` never creates a player — it registers a mount point. The
engine renders into at most one surface at a time; `attach(id)` re-parents
the native player view with no playback interruption. If you attach to a
surface that hasn't mounted yet (navigation in flight), the engine attaches
the moment it appears.

```tsx
<VideoSurface surfaceId="feed" style={{ aspectRatio: 16 / 9 }} />

const player = useVideo();
player.setSource(video);   // load (or hand off)
player.attach('feed');     // render here
```

`<VideoPlayer>` is the convenience wrapper that does `setSource` + `attach` +
optional controls in one component. Handy props:

```tsx
<VideoPlayer
  source={video}
  autoplay muted repeat          // playback flags
  resizeMode="contain"           // contain | cover | stretch
  controls                       // built-in chrome (SVG icons)
  onLoadComplete={(m) => {}}     // duration/dimensions ready
  onBuffering={(b) => {}}
  onError={(e) => {}}
  ref={playerRef}                // → the VideoManager (playerRef.current.seek(…))
/>
```

Pass `live` for a live stream: the controls hide the seek bar/times and show
just mute + fullscreen. `liveIcon` renders a live indicator (e.g. a Lottie
badge), and `thumbnail` shows a poster over the video during the initial load:

```tsx
<VideoPlayer
  source={liveSource}
  live
  liveIcon={() => <LottieView source={liveAnim} autoPlay loop style={{ width: 44, height: 20 }} />}
  thumbnail={() => <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
/>
```

## Video feed (single engine, only the focused one plays)

`<VideoFeed>` is a TikTok/Reels-style vertical feed. It renders many videos in
a FlatList but plays **only the one scrolled into focus** — on the same single
engine, so memory and CPU stay flat no matter how long the feed. Each item is
just a surface; scrolling hands the one player off to the focused item.

```tsx
import { VideoFeed } from 'react-native-video-provider';

<VideoFeed
  data={videos} // [{ id, uri, title? }, …] — each needs a stable id
  renderOverlay={({ item, focused }) => (
    <Caption title={item.title} paused={!focused} />
  )}
/>
```

Any extra `FlatList` prop passes through (`onEndReached` for infinite scroll,
`ListHeaderComponent`, …).

## Pausing on focus loss

Both `<VideoPlayer>` and `<VideoFeed>` pause automatically when the **app is
backgrounded** (opt out with `pauseOnFocusLost={false}` for background audio).

For **screen navigation** (navigating to another screen while the app stays
foregrounded), pass your navigation library's focus flag — React Navigation
keeps screens mounted, so there is no other reliable signal:

```tsx
import { useIsFocused } from '@react-navigation/native';

function Screen() {
  const isFocused = useIsFocused();
  return <VideoPlayer source={video} isFocused={isFocused} />;
  // VideoFeed takes the same prop.
}
```

`false` pauses; returning to `true` resumes (reclaiming the engine if another
video took it while you were away).

## State & events

```tsx
// Selector subscriptions — re-render only for what you display
const position = usePlayback((s) => s.position);
const { isFullscreen, toggle } = useFullscreen();

useVideoEvents({
  onEnd: () => playNext(),
  onError: (e) => console.warn(e.code, e.message),
});
```

## Platform setup

### iOS — fullscreen rotation

iOS asks the AppDelegate which orientations are allowed. Forward that to the
library so fullscreen can rotate to landscape and `setOrientation` / the
`orientation` prop can force a rotation (skip this only if you don't use those
features and your app already supports all orientations):

```swift
// AppDelegate.swift
import AuVideo

func application(_ application: UIApplication,
                 supportedInterfaceOrientationsFor window: UIWindow?)
    -> UIInterfaceOrientationMask {
  return AuVideoOrientation.mask(withDefault: .portrait)
}
```

### iOS — Picture in Picture / background audio

Enable *Audio, AirPlay and Picture in Picture* in Signing & Capabilities →
Background Modes (adds `audio` to `UIBackgroundModes` in Info.plist).

### Android — Picture in Picture

Declare PiP support on your main activity in `AndroidManifest.xml`:

```xml
<activity
  android:name=".MainActivity"
  android:supportsPictureInPicture="true"
  android:configChanges="keyboard|keyboardHidden|orientation|screenLayout|screenSize|smallestScreenSize|uiMode|density" />
```

(The `orientation|screenSize` entries are part of the default RN template and
also keep fullscreen rotation from recreating the activity.)

## Example app

```sh
yarn
yarn example android   # or: yarn example ios
```

The example shows a feed → detail handoff with a live status panel, plus
fullscreen, floating and PiP buttons.

## Roadmap

- Queue (next/previous/playlist/autoplay)
- Background playback (Android MediaSessionService + notification, iOS remote
  commands / lock-screen controls)
- Quality, subtitle and audio-track selection
- Brightness/volume swipe gestures, pinch zoom
- True ahead-of-time preloading (Media3 `PreloadManager`)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[architecture doc](docs/ARCHITECTURE.md). PRs that add a second player
instance will be rejected on principle. 🙂

## License

MIT
