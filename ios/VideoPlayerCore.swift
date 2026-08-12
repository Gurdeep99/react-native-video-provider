import AVFoundation
import AVKit
import Foundation
import UIKit
import WebKit

@objc(VideoSourceSpec)
public final class VideoSourceSpec: NSObject {
  @objc public let videoId: String
  @objc public let uri: String
  /// "url" (AVPlayer) or "youtube" (WKWebView engine).
  @objc public let type: String
  @objc public let headers: [String: String]
  @objc public let title: String?
  @objc public let artist: String?
  @objc public let artworkUri: String?
  @objc public let startPosition: Double

  @objc public init(
    videoId: String,
    uri: String,
    type: String,
    headers: [String: String],
    title: String?,
    artist: String?,
    artworkUri: String?,
    startPosition: Double
  ) {
    self.videoId = videoId
    self.uri = uri
    self.type = type
    self.headers = headers
    self.title = title
    self.artist = artist
    self.artworkUri = artworkUri
    self.startPosition = startPosition
  }
}

@objc(VideoCoreDelegate)
public protocol VideoCoreDelegate: AnyObject {
  func onStatusChange(_ status: String)
  func onLoad(_ videoId: String, duration: Double, width: Double, height: Double)
  func onProgress(_ position: Double, duration: Double, buffered: Double)
  func onSeek(_ position: Double)
  func onEnd()
  func onError(_ code: String, message: String)
  func onAttach(_ surfaceId: String)
  func onDetach(_ surfaceId: String)
  func onPipChange(_ active: Bool)
  /// Source turned out to be (or stopped being) a live stream.
  func onLiveChange(_ live: Bool)
}

/// UIView whose backing layer is the AVPlayerLayer. Moving this view between
/// surface containers re-parents rendering without touching playback.
@objc(VideoHostView)
public final class VideoHostView: UIView {
  public override static var layerClass: AnyClass { AVPlayerLayer.self }
  public var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

/// The ONE playback engine of the app: a single AVPlayer plus a single host
/// view, re-parented between registered surfaces. Created once, never owned
/// by React components; destroyed only by an explicit releasePlayer().
@objc(VideoPlayerCore)
public final class VideoPlayerCore: NSObject {

  @objc public static let shared = VideoPlayerCore()

  @objc public weak var delegate: VideoCoreDelegate?

  private let player = AVPlayer()
  private let hostView = VideoHostView()

  // Second engine: a re-parentable WKWebView running the YouTube IFrame API.
  private enum Engine { case exo, web }
  private var engine: Engine = .exo
  private var webPositionSec: Double = 0
  private var webDurationSec: Double = 0
  /// True once the IFrame player is created — lets us swap videos instantly.
  private var webLoaded = false
  /// Warming the page in the background; its events aren't user-visible yet.
  private var webWarming = false
  /// A play() that arrived before the IFrame player existed.
  private var pendingWebPlay = false
  /// Incremented per page load. A discarded page (a warm superseded by a real
  /// load) can still have a `ready` in flight; echoing this token lets us tell
  /// that stale message from the current page's.
  private var webLoadToken = 0

  /// Audio settings live on the player, not the video, so they must be
  /// re-applied to every fresh IFrame player. A newly created one always starts
  /// unmuted at full volume — without this the mute button would read "muted"
  /// while a newly loaded YouTube video played sound.
  private var desiredMuted = false
  private var desiredVolume: Double = 1
  private var webView: WKWebView?

  private func ensureWebView() -> WKWebView {
    if let wv = webView { return wv }
    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    config.userContentController.add(self, name: "VideoBridge")
    let wv = WKWebView(frame: .zero, configuration: config)
    wv.scrollView.isScrollEnabled = false
    wv.isOpaque = false
    wv.backgroundColor = .black
    wv.navigationDelegate = self
    webView = wv
    return wv
  }

  /// Rebuild the YouTube player after its web content process died — iOS kills
  /// it under memory pressure, which a long live stream invites. The dead
  /// WKWebView renders blank forever and cannot be revived, so replace it and
  /// reload at the last known position.
  private func recoverFromWebProcessDeath() {
    let dead = webView
    webView = nil
    webLoaded = false
    webWarming = false
    dead?.configuration.userContentController
      .removeScriptMessageHandler(forName: "VideoBridge")
    dead?.removeFromSuperview()

    guard engine == .web, let id = currentVideoId else { return }
    delegate?.onStatusChange("buffering")
    let resumeAt = webPositionSec
    // Clear the id so setYouTube can't take its "same video, just resume"
    // shortcut into the WebView we just discarded.
    currentVideoId = nil
    setYouTube(
      VideoSourceSpec(
        videoId: id,
        uri: id,
        type: "youtube",
        headers: [:],
        title: nil,
        artist: nil,
        artworkUri: nil,
        startPosition: resumeAt
      ),
      autoplay: true
    )
  }

  private var currentVideoId: String?
  private var currentSurfaceId: String?
  /// Surface we want but that hasn't registered (yet, or again).
  private var pendingSurfaceId: String?

  private var preloaded: [String: AVPlayerItem] = [:]
  private var loadReported = false
  private var repeatEnabled = false
  private var playbackRate: Double = 1
  private var initialized = false

  /// Cap on in-place live recoveries per load. A feed that keeps dropping is
  /// genuinely broken, so stop looping here and let JS retry with backoff.
  private static let maxLiveRecoveries = 5
  /// Live recoveries since the last successful playback.
  private var liveRecoveries = 0
  /// Last live-ness reported to JS, so we only emit on change.
  private var reportedLive: Bool?
  /// Playback was interrupted hard enough that the video output may be stale.
  ///
  /// A network drop can leave the presentation layer showing nothing while the
  /// engine recovers — including when it recovers on its own, with no error and
  /// no stall for anything upstream to react to. Playback resumes, audio and
  /// all, over a black frame that never clears. Re-asserting on the way back to
  /// readyToPlay covers every recovery, ours or the engine's.
  private var videoOutputStale = false
  /// Retained so a failed item can be rebuilt from the same source.
  private var currentSource: VideoSourceSpec?
  /// Position to seek to once the next newly loaded item reaches readyToPlay.
  /// Set by reloadFromPosition() so the viewer's position survives a rebuild.
  private var pendingSeekAfterLoad: Double? = nil

  private var timeObserver: Any?
  private var timeControlObservation: NSKeyValueObservation?
  private var itemStatusObservation: NSKeyValueObservation?
  private var pipController: AVPictureInPictureController?

  private override init() {
    super.init()
  }

  // ------------------------------------------------------------ lifecycle

  /// Idempotent; main thread.
  @objc public func initialize() {
    if initialized { return }
    initialized = true

    hostView.playerLayer.player = player
    hostView.playerLayer.videoGravity = .resizeAspect
    player.actionAtItemEnd = .pause
    // Let AVPlayer start as soon as it has data rather than buffering ahead to
    // guarantee smooth playback — on a live edge the extra buffer is latency,
    // and waiting is what turns a brief dip into a visible stall.
    player.automaticallyWaitsToMinimizeStalling = false

    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    try? AVAudioSession.sharedInstance().setActive(true)

    let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
    timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) {
      [weak self] _ in
      self?.emitProgress()
    }

    timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) {
      [weak self] player, _ in
      guard let self else { return }
      switch player.timeControlStatus {
      case .playing:
        self.delegate?.onStatusChange("playing")
      case .waitingToPlayAtSpecifiedRate:
        self.delegate?.onStatusChange("buffering")
      case .paused:
        if player.currentItem != nil {
          self.delegate?.onStatusChange("paused")
        }
      @unknown default:
        break
      }
    }

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(itemDidPlayToEnd(_:)),
      name: .AVPlayerItemDidPlayToEndTime,
      object: nil
    )
    // A live stream that stalls mid-buffer never resumes on its own — AVPlayer
    // just sits in waitingToPlayAtSpecifiedRate indefinitely.
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(itemStalled(_:)),
      name: .AVPlayerItemPlaybackStalled,
      object: nil
    )
    // Distinct from `.failed`: the item survives but playback aborted, which
    // on a live feed means the edge moved out from under us.
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(itemFailedToPlayToEnd(_:)),
      name: .AVPlayerItemFailedToPlayToEndTime,
      object: nil
    )

    if AVPictureInPictureController.isPictureInPictureSupported() {
      pipController = AVPictureInPictureController(playerLayer: hostView.playerLayer)
      pipController?.delegate = self
    }
  }

  @objc public func releasePlayer() {
    guard initialized else { return }
    initialized = false
    if let observer = timeObserver {
      player.removeTimeObserver(observer)
      timeObserver = nil
    }
    timeControlObservation?.invalidate()
    itemStatusObservation?.invalidate()
    NotificationCenter.default.removeObserver(self)
    detach()
    player.replaceCurrentItem(with: nil)
    if let wv = webView {
      wv.configuration.userContentController.removeScriptMessageHandler(forName: "VideoBridge")
      wv.removeFromSuperview()
      wv.loadHTMLString("", baseURL: nil)
      webView = nil
    }
    webLoaded = false
    webWarming = false
    engine = .exo
    pipController = nil
    currentVideoId = nil
    pendingSurfaceId = nil
    preloaded.removeAll()
    delegate?.onStatusChange("idle")
  }

  // --------------------------------------------------------------- source

  @objc public func setSource(_ source: VideoSourceSpec, autoplay: Bool) {
    initialize()

    if source.type == "youtube" {
      setYouTube(source, autoplay: autoplay)
      return
    }

    // Switching away from the WebView engine: pause + hide it.
    if engine == .web {
      webCmd("pauseVideo")
      engine = .exo
      reAttachActive()
    }

    if source.videoId == currentVideoId {
      // Same-video handoff: never reload; at most honor autoplay.
      if autoplay, player.timeControlStatus != .playing {
        play()
      }
      return
    }

    currentVideoId = source.videoId
    currentSource = source
    loadReported = false
    liveRecoveries = 0
    reportedLive = nil
    delegate?.onStatusChange("loading")

    let item = preloaded.removeValue(forKey: source.videoId) ?? makeItem(source)
    observeItem(item, videoId: source.videoId)
    player.replaceCurrentItem(with: item)

    if source.startPosition > 0 {
      let target = CMTime(seconds: source.startPosition, preferredTimescale: 600)
      player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero)
    }
    if autoplay {
      player.play()
    }
  }

  @objc public func preload(_ source: VideoSourceSpec) {
    if source.type == "youtube" {
      warmYouTube(source)
      return
    }
    // AVPlayerItem starts loading its asset as soon as it exists, so a
    // later attach starts near-instantly.
    guard preloaded[source.videoId] == nil, source.videoId != currentVideoId else { return }
    preloaded[source.videoId] = makeItem(source)
  }

  /// Build the YouTube page ahead of time so the first real play costs a single
  /// loadVideoById instead of a page load, an iframe-API fetch and a player
  /// construction. The video is cued, not played.
  ///
  /// Deliberately invisible: it must not switch the active engine, claim
  /// currentVideoId, or emit events, or it would interrupt what's playing.
  private func warmYouTube(_ source: VideoSourceSpec) {
    if webLoaded || webWarming { return }
    let wv = ensureWebView()
    webWarming = true
    webLoadToken += 1
    let html = youTubeHtml(
      videoId: source.uri, autoplay: false, start: 0, token: webLoadToken
    )
    wv.loadHTMLString(html, baseURL: URL(string: "https://youtube.com"))
  }

  private func makeItem(_ source: VideoSourceSpec) -> AVPlayerItem {
    let url = URL(string: source.uri) ?? URL(fileURLWithPath: source.uri)
    var options: [String: Any] = [:]
    if !source.headers.isEmpty {
      options["AVURLAssetHTTPHeaderFieldsKey"] = source.headers
    }
    let asset = AVURLAsset(url: url, options: options)
    return AVPlayerItem(asset: asset)
  }

  private func observeItem(_ item: AVPlayerItem, videoId: String) {
    itemStatusObservation?.invalidate()
    itemStatusObservation = item.observe(\.status, options: [.new]) {
      [weak self] item, _ in
      guard let self else { return }
      switch item.status {
      case .readyToPlay:
        // Back from a real interruption: rebuild the render path before
        // anything else, or playback resumes into a layer nobody sees.
        if self.videoOutputStale {
          self.videoOutputStale = false
          self.reassertActiveVideoOutput()
        }
        // If the rebuild was triggered by reloadFromPosition(), seek to the
        // viewer's last known position now that the item is ready.
        if let seekTo = self.pendingSeekAfterLoad {
          self.pendingSeekAfterLoad = nil
          let target = CMTime(seconds: seekTo, preferredTimescale: 600)
          self.player.seek(
            to: target, toleranceBefore: .zero, toleranceAfter: .zero
          ) { [weak self] _ in
            self?.player.play()
          }
        }
        // Playing again — let a future stall spend a fresh recovery budget.
        self.liveRecoveries = 0
        self.reportLiveIfChanged()
        if !self.loadReported {
          self.loadReported = true
          let size = item.presentationSize
          let duration = item.duration.isNumeric ? item.duration.seconds : 0
          self.delegate?.onStatusChange("ready")
          self.delegate?.onLoad(
            videoId,
            duration: duration,
            width: Double(size.width),
            height: Double(size.height)
          )
        }
      case .failed:
        self.videoOutputStale = true
        // A failed item is terminal — AVPlayer never retries it. For a live
        // source, swap in a fresh item rather than surfacing a dead player.
        if self.reportedLive == true, self.liveRecoveries < Self.maxLiveRecoveries {
          self.liveRecoveries += 1
          self.delegate?.onStatusChange("buffering")
          self.rebuildCurrentItem()
          return
        }
        let error = item.error as NSError?
        self.delegate?.onError(
          String(error?.code ?? -1),
          message: error?.localizedDescription ?? "Playback failed"
        )
      default:
        break
      }
    }
  }

  /// Rebuild the current source from scratch.
  ///
  /// setSource() deliberately short-circuits when the id is unchanged (the
  /// same-video handoff that preserves position across surface swaps), so it
  /// cannot recover a player that has actually died — a failed AVPlayerItem is
  /// terminal, and a YouTube page whose feed dropped won't restart on play().
  /// Clearing the id (and, for YouTube, the loaded flag) forces the full load
  /// path instead.
  @objc public func reload() {
    guard let source = currentSource else { return }
    currentVideoId = nil
    if source.type == "youtube" {
      // Force a full page load rather than a loadVideoById into a dead page.
      webLoaded = false
    }
    setSource(source, autoplay: true)
    // Re-parent the host view into the active surface. setSource only does this
    // when switching engines, but a rebuild can leave the layer attached to a
    // view torn down during the failure — playback resumes with nothing
    // rendered, which is the black screen after a reconnect.
    reassertActiveVideoOutput()
  }

  /// Rebuild the current source and seek to `position` once ready,
  /// so the viewer resumes from where they were (not from startPosition).
  /// No-op for YouTube sources (no reliable mid-stream seek on a fresh IFrame page).
  @objc public func reloadFromPosition(_ position: Double) {
    guard let source = currentSource, source.type != "youtube" else {
      reload()
      return
    }
    pendingSeekAfterLoad = max(position, 0)
    reload()
  }

  private func setYouTube(_ source: VideoSourceSpec, autoplay: Bool) {
    if engine == .exo { player.pause() }
    engine = .web

    if source.videoId == currentVideoId {
      if autoplay { webCmd("playVideo") }
      reAttachActive()
      return
    }

    currentVideoId = source.videoId
    currentSource = source
    loadReported = false
    webPositionSec = 0
    webDurationSec = 0
    reportedLive = nil
    delegate?.onStatusChange("loading")

    let wv = ensureWebView()
    let start = Int(source.startPosition)
    if webLoaded {
      // Player already alive — swap the video instantly, no page reload.
      webCmd(autoplay ? "loadVideoById" : "cueVideoById", [source.uri, start])
    } else {
      // First time: load the page. baseURL gives it a youtube.com referrer —
      // the embed rejects other referrers (Error 153). No `www` to match.
      // This supersedes any in-flight warm, so its event guard must lift.
      webWarming = false
      // Guarantee the first play. The autoplay URL param and the in-page kick()
      // both usually work, but WebViews drop autoplay often enough that the
      // player can sit "unstarted" — showing YouTube's big play button. Queue
      // an explicit play for the moment the player reports ready.
      pendingWebPlay = autoplay
      webLoadToken += 1
      let html = youTubeHtml(
        videoId: source.uri, autoplay: autoplay, start: start, token: webLoadToken
      )
      wv.loadHTMLString(html, baseURL: URL(string: "https://youtube.com"))
    }
    reAttachActive()
  }

  /// Mirror the YouTube player's live-ness to JS, emitting only on change so a
  /// 2 Hz message stream doesn't churn the store.
  private func reportWebLive(_ obj: [String: Any]) {
    guard let live = obj["live"] as? Bool else { return }
    if reportedLive == live { return }
    reportedLive = live
    delegate?.onLiveChange(live)
  }

  /// Emit onLoad once per loaded video. `ready` fires only for the first page
  /// load; a subsequent `loadVideoById` swap surfaces via the first play state.
  private func reportWebLoadIfNeeded() {
    guard !loadReported else { return }
    loadReported = true
    delegate?.onLoad(
      currentVideoId ?? "", duration: webDurationSec, width: 0, height: 0)
  }

  /// Push the retained audio/rate settings onto a freshly loaded IFrame player.
  private func applyWebPlayerSettings() {
    webCmd("setVolume", [Int(desiredVolume * 100)])
    webCmd(desiredMuted ? "mute" : "unMute")
    if playbackRate != 1 { webCmd("setPlaybackRate", [playbackRate]) }
  }

  /// Fire an IFrame-API command into the WebView (no-op unless WEB engine).
  private func webCmd(_ fn: String, _ args: [Any] = []) {
    guard engine == .web, let wv = webView else { return }
    let encoded = args.map { a -> String in
      if let s = a as? String { return "'\(s)'" }
      if let b = a as? Bool { return b ? "true" : "false" }
      return "\(a)"
    }.joined(separator: ",")
    wv.evaluateJavaScript("auCmd('\(fn)',[\(encoded)]);", completionHandler: nil)
  }

  /// Re-parent the active engine's view into the current surface (engine swap).
  /// Force the engine's video output back onto the current surface.
  ///
  /// Needed after a rebuild: replacing the player item can leave the layer
  /// showing nothing even though playback resumed — **audio but a black
  /// frame**. Re-setting the layer's player rebinds the output.
  ///
  /// attachTo() can't do this on its own: it early-returns when the view is
  /// already in the target container, which it always is after a rebuild.
  /// Public entry point for JS: force a re-parent regardless of native state.
  @objc public func reassertVideoOutput() {
    reassertActiveVideoOutput()
  }

  private func reassertActiveVideoOutput() {
    guard let id = currentSurfaceId ?? pendingSurfaceId else { return }
    guard let container = VideoSurfaceRegistry.view(for: id) else {
      // Surface not mounted yet — attach when it registers.
      pendingSurfaceId = id
      return
    }
    // Force the full detach -> attach cycle rather than just re-binding the
    // layer's player. After a rebuild the presentation layer can be left
    // showing nothing while playback continues, which reads as audio fine over
    // a black frame. Re-parenting rebuilds the presentation path.
    //
    // This is exactly what a viewer does by hand when they exit fullscreen and
    // re-enter it: that unmounts and remounts the surface, and it clears the
    // black frame every time. Doing it here saves them the trip.
    activeView.removeFromSuperview()
    attachTo(container, surfaceId: id)
    // Rebind explicitly too: replaceCurrentItem can leave the layer holding a
    // stale player reference that re-parenting alone doesn't refresh.
    if engine == .exo {
      hostView.playerLayer.player = nil
      hostView.playerLayer.player = player
    }
  }

  private func reAttachActive() {
    guard let id = currentSurfaceId,
          let container = VideoSurfaceRegistry.view(for: id) else { return }
    attachTo(container, surfaceId: id)
  }

  private func handleWebMessage(_ data: String) {
    guard let d = data.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any]
    else { return }
    // While warming (or whenever the WebView isn't the active engine) the page
    // is off-screen scaffolding: record that the player exists, but don't emit
    // — these events describe a video the user isn't watching.
    let isReady = (obj["type"] as? String) == "ready"
    // A page we've already replaced can still deliver its `ready`. Acting on it
    // would mark the *new* page loaded before it is, so anything that doesn't
    // carry the current token is discarded outright.
    if isReady, (obj["tok"] as? Int) != webLoadToken {
      return
    }
    if webWarming || engine != .web {
      if isReady {
        webLoaded = true
        webWarming = false
      }
      return
    }
    switch obj["type"] as? String {
    case "ready":
      webLoaded = true
      webDurationSec = (obj["duration"] as? Double) ?? 0
      reportWebLive(obj)
      reportWebLoadIfNeeded()
      // Carry the player's audio/rate settings onto this new IFrame player,
      // before any play() below so a muted player never leaks sound.
      applyWebPlayerSettings()
      // Replay a play() that arrived while the player was still loading.
      if pendingWebPlay {
        pendingWebPlay = false
        webCmd("playVideo")
      }
    case "state":
      reportWebLive(obj)
      switch (obj["state"] as? Int) ?? -99 {
      case 1:
        reportWebLoadIfNeeded()
        delegate?.onStatusChange("playing")
      case 2: delegate?.onStatusChange("paused")
      case 3: delegate?.onStatusChange("buffering")
      case 0:
        delegate?.onStatusChange("ended")
        delegate?.onEnd()
      default: break
      }
    case "time":
      webPositionSec = (obj["position"] as? Double) ?? 0
      webDurationSec = (obj["duration"] as? Double) ?? 0
      delegate?.onProgress(
        webPositionSec, duration: webDurationSec, buffered: webDurationSec)
    case "error":
      delegate?.onError("youtube", message: "\(obj["code"] ?? "")")
    default:
      break
    }
  }

  private func youTubeHtml(
    videoId: String,
    autoplay: Bool,
    start: Int,
    token: Int
  ) -> String {
    let auto = autoplay ? 1 : 0
    return """
    <!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}
    /* #p is the iframe itself now; pointer-events:none keeps YouTube's own
       chrome untouchable so the library's controls stay the only layer. */
    #p{width:100%;height:100%;border:0;display:block;pointer-events:none}</style>
    </head><body><iframe id="p" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen
    src="https://www.youtube.com/embed/\(videoId)?enablejsapi=1&autoplay=\(auto)&controls=0&playsinline=1&rel=0&modestbranding=1&fs=0&disablekb=1&iv_load_policy=3&start=\(start)&origin=https://youtube.com"></iframe>
    <script>
    var player;
    var tries=0;
    var cur='\(videoId)';
    var tok=\(token);
    function post(m){try{window.webkit.messageHandlers.VideoBridge.postMessage(JSON.stringify(m));}catch(e){}}
    // WebViews routinely ignore the autoplay playerVar, leaving the player
    // "unstarted" (which also shows YouTube's big play button). Nudge it until
    // it actually reaches playing/buffering.
    function kick(){
      if(tries++>15||!player||!player.getPlayerState)return;
      var s=player.getPlayerState();
      if(s===1||s===3)return;
      try{player.playVideo();}catch(e){}
      setTimeout(kick,300);
    }
    // YouTube reports live-ness only via getVideoData(), which is undocumented
    // — guard it and fall back to the duration===0 heuristic live streams show.
    function isLive(){
      try{var d=player.getVideoData&&player.getVideoData();
        if(d&&typeof d.isLive==='boolean')return d.isLive;}catch(e){}
      try{return player.getDuration()===0;}catch(e){return false;}
    }
    // A live stream that drops leaves the player stopped on a still-valid
    // video. Reloading the same id rejoins the broadcast; capped so a
    // permanently dead stream surfaces to JS instead of looping here.
    var revives=0;
    function revive(){
      if(revives++>=5||!player)return;
      try{player.loadVideoById(cur);tries=0;setTimeout(kick,500);}catch(e){}
    }
    window.auCmd=function(f,a){try{
      if(f==='loadVideoById'||f==='cueVideoById'){cur=a[0];revives=0;}
      player&&player[f]&&player[f].apply(player,a);
      if(f==='loadVideoById'||f==='playVideo'){tries=0;setTimeout(kick,300);}}catch(e){}};
    var t=document.createElement('script');t.src='https://www.youtube.com/iframe_api';document.body.appendChild(t);
    function onYouTubeIframeAPIReady(){
      // Attach to the iframe already in the document rather than letting YT
      // build one. The markup version starts fetching the video immediately, in
      // parallel with this API script, instead of waiting for it — that wait was
      // most of the delay before first frame. Player vars come from the URL.
      player=new YT.Player('p',{
        events:{onReady:function(){
            post({type:'ready',tok:tok,duration:player.getDuration(),live:isLive()});
            if(\(auto)){try{player.playVideo();}catch(e){}tries=0;kick();}
          },
          onStateChange:function(e){
            if(e.data===1)revives=0;
            // Live feeds don't "end" — a 0 state means the broadcast dropped.
            if(e.data===0&&isLive()){revive();return;}
            post({type:'state',state:e.data,live:isLive()});
          },
          // 2/5 are transient player faults on a valid video; 100/101/150 mean
          // the video is gone or embedding is barred, which retrying can't fix.
          onError:function(e){
            if((e.data===2||e.data===5)&&revives<5){revive();return;}
            post({type:'error',code:e.data});
          }}});
    }
    setInterval(function(){if(player&&player.getCurrentTime){post({type:'time',position:player.getCurrentTime(),duration:player.getDuration()});}},500);
    </script></body></html>
    """
  }

  // ------------------------------------------------------------- commands

  @objc public func play() {
    if engine == .web {
      // The IFrame player may not exist yet (first load, or a rebuild after the
      // web content process died). A command sent now would be dropped
      // silently, so remember the intent and replay it once it reports ready.
      if !webLoaded {
        pendingWebPlay = true
        return
      }
      webCmd("playVideo")
      return
    }
    if player.currentItem == nil { return }
    player.play()
    if playbackRate != 1 {
      player.rate = Float(playbackRate)
    }
  }

  @objc public func pause() {
    if engine == .web {
      // Cancel any deferred play, or a pause issued while the player was
      // loading would be undone the moment it became ready.
      pendingWebPlay = false
      webCmd("pauseVideo")
      return
    }
    player.pause()
  }

  @objc public func stop() {
    if engine == .web {
      webCmd("pauseVideo")
      webCmd("seekTo", [0, true])
      delegate?.onStatusChange("idle")
      return
    }
    player.pause()
    player.seek(to: .zero)
    delegate?.onStatusChange("idle")
  }

  @objc public func seek(to position: Double) {
    if engine == .web { webCmd("seekTo", [position, true]); return }
    let target = CMTime(seconds: max(position, 0), preferredTimescale: 600)
    player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) {
      [weak self] _ in
      self?.delegate?.onSeek(position)
    }
  }

  @objc public func setRate(_ rate: Double) {
    // Retained for both engines: the web path re-applies it to each new
    // IFrame player, the native path on every play().
    playbackRate = rate
    if engine == .web { webCmd("setPlaybackRate", [rate]); return }
    // Setting rate on a paused player starts playback; mirror ExoPlayer by
    // only applying immediately when already playing (play() re-applies it).
    if player.timeControlStatus == .playing {
      player.rate = Float(rate)
    }
    if #available(iOS 16.0, *) {
      player.defaultRate = Float(rate)
    }
  }

  @objc public func setVolume(_ volume: Double) {
    desiredVolume = min(max(volume, 0), 1)
    if engine == .web {
      webCmd("setVolume", [Int(desiredVolume * 100)])
      return
    }
    player.volume = Float(min(max(volume, 0), 1))
  }

  @objc public func setMuted(_ muted: Bool) {
    desiredMuted = muted
    if engine == .web { webCmd(muted ? "mute" : "unMute"); return }
    player.isMuted = muted
  }

  @objc public func setRepeat(_ enabled: Bool) {
    repeatEnabled = enabled
  }

  @objc public func setResizeMode(_ mode: String) {
    switch mode {
    case "cover":
      hostView.playerLayer.videoGravity = .resizeAspectFill
    case "stretch":
      hostView.playerLayer.videoGravity = .resize
    default:
      hostView.playerLayer.videoGravity = .resizeAspect
    }
  }

  @objc public func positionSeconds() -> Double {
    if engine == .web { return webPositionSec }
    let time = player.currentTime()
    return time.isNumeric ? time.seconds : 0
  }

  // ------------------------------------------------------------- surfaces

  @objc public func attach(_ surfaceId: String) {
    initialize()
    guard let container = VideoSurfaceRegistry.view(for: surfaceId) else {
      // Screen still mounting — attach the moment it registers.
      pendingSurfaceId = surfaceId
      return
    }
    attachTo(container, surfaceId: surfaceId)
  }

  /// The view of the currently-active engine (re-parented across surfaces).
  private var activeView: UIView { (engine == .web ? webView : nil) ?? hostView }

  @objc public func detach() {
    activeView.removeFromSuperview()
    if let surfaceId = currentSurfaceId {
      delegate?.onDetach(surfaceId)
    }
    currentSurfaceId = nil
    pendingSurfaceId = nil
  }

  @objc public func onSurfaceAvailable(_ surfaceId: String, view: UIView) {
    // Also re-attach when the active surface's view was recreated (e.g.
    // navigating back to a screen Fabric re-materialized).
    if surfaceId == pendingSurfaceId || surfaceId == currentSurfaceId {
      attachTo(view, surfaceId: surfaceId)
    }
  }

  @objc public func onSurfaceUnavailable(_ surfaceId: String, view: UIView) {
    if currentSurfaceId == surfaceId, activeView.superview === view {
      activeView.removeFromSuperview()
      currentSurfaceId = nil
      // Keep playing hidden (audio); remounting the same surface re-attaches.
      pendingSurfaceId = surfaceId
      delegate?.onDetach(surfaceId)
    }
  }

  private func attachTo(_ container: UIView, surfaceId: String) {
    let view = activeView
    if currentSurfaceId == surfaceId, view.superview === container {
      pendingSurfaceId = nil
      return
    }
    if let previous = currentSurfaceId, previous != surfaceId {
      delegate?.onDetach(previous)
    }
    // Detach whichever engine view is currently in this container (engine swap).
    if hostView.superview === container { hostView.removeFromSuperview() }
    if let wv = webView, wv.superview === container { wv.removeFromSuperview() }
    view.removeFromSuperview()
    view.frame = container.bounds
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    container.addSubview(view)
    currentSurfaceId = surfaceId
    pendingSurfaceId = nil
    delegate?.onAttach(surfaceId)
  }

  // ------------------------------------------------------------------ pip

  @objc public func enterPip() -> Bool {
    guard let pip = pipController, pip.isPictureInPicturePossible else {
      return false
    }
    pip.startPictureInPicture()
    return true
  }

  @objc public func exitPip() {
    pipController?.stopPictureInPicture()
  }

  // --------------------------------------------------------------- events

  @objc private func itemDidPlayToEnd(_ notification: Notification) {
    guard let item = notification.object as? AVPlayerItem, item === player.currentItem else {
      return
    }
    if repeatEnabled {
      player.seek(to: .zero)
      player.play()
      return
    }
    // A live feed doesn't end — reaching "the end" means the edge dropped.
    if isCurrentItemLive() {
      recoverLive(reason: "ended")
      return
    }
    emitProgress()
    delegate?.onStatusChange("ended")
    delegate?.onEnd()
  }

  @objc private func itemStalled(_ notification: Notification) {
    guard let item = notification.object as? AVPlayerItem,
          item === player.currentItem else { return }
    videoOutputStale = true
    delegate?.onStatusChange("buffering")
    guard isCurrentItemLive() else {
      // VOD refills its buffer on its own; just nudge the rate back.
      player.playImmediately(atRate: Float(playbackRate))
      return
    }
    recoverLive(reason: "stalled")
  }

  @objc private func itemFailedToPlayToEnd(_ notification: Notification) {
    guard let item = notification.object as? AVPlayerItem,
          item === player.currentItem else { return }
    if isCurrentItemLive() {
      recoverLive(reason: "failed-to-play-to-end")
      return
    }
    let error = notification
      .userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? NSError
    delegate?.onError(
      String(error?.code ?? -1),
      message: error?.localizedDescription ?? "Playback failed"
    )
  }

  /// True when the current item has no fixed duration — how HLS live streams
  /// present themselves to AVPlayer.
  private func isCurrentItemLive() -> Bool {
    guard let item = player.currentItem else { return false }
    if item.duration.isIndefinite { return true }
    return !item.duration.isNumeric && item.status == .readyToPlay
  }

  /// Emit live-ness to JS on change, so the UI needs no manual setLive.
  private func reportLiveIfChanged() {
    let live = isCurrentItemLive()
    if reportedLive == live { return }
    reportedLive = live
    delegate?.onLiveChange(live)
  }

  /// Rejoin a live edge that stalled or dropped.
  ///
  /// Seeking to `.positiveInfinity` snaps to the newest available segment,
  /// which clears a stale buffer without the teardown a full reload costs. If
  /// the item is already dead (`.failed`), no amount of seeking revives it —
  /// that path needs a brand-new AVPlayerItem.
  private func recoverLive(reason: String) {
    guard liveRecoveries < Self.maxLiveRecoveries else {
      delegate?.onError("live-recovery-exhausted", message: "Live stream unrecoverable (\(reason))")
      return
    }
    liveRecoveries += 1
    delegate?.onStatusChange("buffering")

    guard let item = player.currentItem else { return }
    if item.status == .failed {
      rebuildCurrentItem()
      return
    }
    // Seek to the end of the seekable window — the current live edge. Passing
    // CMTime.positiveInfinity here would be an indefinite time, which AVPlayer
    // rejects; the seekable range gives a concrete target.
    guard let edge = item.seekableTimeRanges.last?.timeRangeValue,
          edge.duration.isNumeric else {
      // No seekable window yet (still loading) — a fresh item is the only move.
      rebuildCurrentItem()
      return
    }
    player.seek(
      to: CMTimeRangeGetEnd(edge),
      toleranceBefore: .positiveInfinity,
      toleranceAfter: .zero
    ) { [weak self] _ in
      guard let self else { return }
      self.player.playImmediately(atRate: Float(self.playbackRate))
    }
  }

  /// Replace a failed AVPlayerItem with a fresh one for the same source. A
  /// failed item is terminal — AVPlayer will not retry it.
  private func rebuildCurrentItem() {
    guard let source = currentSource, let id = currentVideoId else { return }
    let item = makeItem(source)
    observeItem(item, videoId: id)
    player.replaceCurrentItem(with: item)
    player.playImmediately(atRate: Float(playbackRate))
  }

  private func emitProgress() {
    guard let item = player.currentItem else { return }
    // Until the current item reports ready these samples still describe the
    // previous source — switching away from a live stream that meant emitting
    // its elapsed position against the new video's duration.
    guard loadReported else { return }

    let duration = item.duration.isNumeric ? item.duration.seconds : 0
    // A live stream has no meaningful scrubber position (duration is 0 and the
    // seekbar is hidden), and its elapsed time grows without bound. Report 0
    // rather than let that reach the UI.
    let position = isCurrentItemLive() ? 0 : positionSeconds()
    var buffered: Double = 0
    if let range = item.loadedTimeRanges.first?.timeRangeValue {
      let end = range.start.seconds + range.duration.seconds
      buffered = max(end - position, 0)
    }
    delegate?.onProgress(position, duration: duration, buffered: buffered)
  }
}

extension VideoPlayerCore: WKScriptMessageHandler {
  public func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard message.name == "VideoBridge", let body = message.body as? String else {
      return
    }
    handleWebMessage(body)
  }
}

extension VideoPlayerCore: WKNavigationDelegate {
  /// iOS jettisons the web content process under memory pressure; without
  /// this the YouTube player goes permanently blank with no error.
  public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    recoverFromWebProcessDeath()
  }

  public func webView(
    _ webView: WKWebView,
    didFail navigation: WKNavigation!,
    withError error: Error
  ) {
    delegate?.onError("webview", message: error.localizedDescription)
  }
}

extension VideoPlayerCore: AVPictureInPictureControllerDelegate {
  public func pictureInPictureControllerDidStartPictureInPicture(
    _ pictureInPictureController: AVPictureInPictureController
  ) {
    delegate?.onPipChange(true)
  }

  public func pictureInPictureControllerDidStopPictureInPicture(
    _ pictureInPictureController: AVPictureInPictureController
  ) {
    delegate?.onPipChange(false)
  }
}
