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
- 📺 **Fullscreen** — built-in host that unlocks rotation while visible and
  restores the previous orientation lock on exit
- 🎈 **Floating player** — built-in draggable in-app window
- 🖼 **Picture in Picture** — Android + iOS
- ⚡ **New Architecture native** — TurboModule + Fabric, typed end to end
- 🧠 **Zustand-powered state** — selector subscriptions, no re-render storms

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and
[docs/API.md](docs/API.md) for the complete API reference.

## Installation

```sh
npm install react-native-video-provider
cd ios && pod install
```

Requires React Native 0.80+ with the New Architecture enabled.

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

**3. Open a detail screen with the same video** — because the `id` matches,
the engine is untouched and playback continues from the exact frame:

```tsx
// DetailScreen.tsx — same source id ⇒ handoff, not reload
<VideoPlayer source={{ id: '123', uri }} style={{ aspectRatio: 16 / 9 }} />
```

**4. Fullscreen / floating / PiP from anywhere:**

```tsx
const player = useVideo();

player.enterFullscreen(); // rotation unlocks while visible
player.showFloating();    // draggable in-app window
player.enterPiP();        // system picture-in-picture
```

**5. Force an orientation** — per player, imperatively, or whenever
fullscreen is active:

```tsx
// While this player is mounted (released on unmount):
<VideoPlayer source={video} orientation="landscape" />

// Imperative — 'auto' | 'portrait' | 'inverted-portrait'
//             | 'landscape' | 'inverted-landscape'
player.setOrientation('inverted-landscape');
player.setOrientation('auto'); // release

// Always go landscape in the built-in fullscreen host:
<VideoProvider config={{ fullscreenOrientation: 'landscape' }}>
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
optional controls in one component.

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
library so rotation unlocks while fullscreen is visible and `setOrientation`
/ the `orientation` prop can force a rotation (skip this only if you don't
use those features and your app already supports all orientations):

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
