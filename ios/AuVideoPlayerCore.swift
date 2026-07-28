import AVFoundation
import AVKit
import Foundation
import UIKit
import WebKit

@objc(AuVideoSourceSpec)
public final class AuVideoSourceSpec: NSObject {
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

@objc(AuVideoCoreDelegate)
public protocol AuVideoCoreDelegate: AnyObject {
  func onStatusChange(_ status: String)
  func onLoad(_ videoId: String, duration: Double, width: Double, height: Double)
  func onProgress(_ position: Double, duration: Double, buffered: Double)
  func onSeek(_ position: Double)
  func onEnd()
  func onError(_ code: String, message: String)
  func onAttach(_ surfaceId: String)
  func onDetach(_ surfaceId: String)
  func onPipChange(_ active: Bool)
}

/// UIView whose backing layer is the AVPlayerLayer. Moving this view between
/// surface containers re-parents rendering without touching playback.
@objc(AuVideoHostView)
public final class AuVideoHostView: UIView {
  public override static var layerClass: AnyClass { AVPlayerLayer.self }
  public var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

/// The ONE playback engine of the app: a single AVPlayer plus a single host
/// view, re-parented between registered surfaces. Created once, never owned
/// by React components; destroyed only by an explicit releasePlayer().
@objc(AuVideoPlayerCore)
public final class AuVideoPlayerCore: NSObject {

  @objc public static let shared = AuVideoPlayerCore()

  @objc public weak var delegate: AuVideoCoreDelegate?

  private let player = AVPlayer()
  private let hostView = AuVideoHostView()

  // Second engine: a re-parentable WKWebView running the YouTube IFrame API.
  private enum Engine { case exo, web }
  private var engine: Engine = .exo
  private var webPositionSec: Double = 0
  private var webDurationSec: Double = 0
  /// True once the IFrame player is created — lets us swap videos instantly.
  private var webLoaded = false
  private var webView: WKWebView?

  private func ensureWebView() -> WKWebView {
    if let wv = webView { return wv }
    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    config.userContentController.add(self, name: "AuBridge")
    let wv = WKWebView(frame: .zero, configuration: config)
    wv.scrollView.isScrollEnabled = false
    wv.isOpaque = false
    wv.backgroundColor = .black
    webView = wv
    return wv
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
      wv.configuration.userContentController.removeScriptMessageHandler(forName: "AuBridge")
      wv.removeFromSuperview()
      wv.loadHTMLString("", baseURL: nil)
      webView = nil
    }
    webLoaded = false
    engine = .exo
    pipController = nil
    currentVideoId = nil
    pendingSurfaceId = nil
    preloaded.removeAll()
    delegate?.onStatusChange("idle")
  }

  // --------------------------------------------------------------- source

  @objc public func setSource(_ source: AuVideoSourceSpec, autoplay: Bool) {
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
    loadReported = false
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

  @objc public func preload(_ source: AuVideoSourceSpec) {
    // AVPlayerItem starts loading its asset as soon as it exists, so a
    // later attach starts near-instantly.
    guard preloaded[source.videoId] == nil, source.videoId != currentVideoId else { return }
    preloaded[source.videoId] = makeItem(source)
  }

  private func makeItem(_ source: AuVideoSourceSpec) -> AVPlayerItem {
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

  // ----------------------------------------------------------- youtube engine

  private func setYouTube(_ source: AuVideoSourceSpec, autoplay: Bool) {
    if engine == .exo { player.pause() }
    engine = .web

    if source.videoId == currentVideoId {
      if autoplay { webCmd("playVideo") }
      reAttachActive()
      return
    }

    currentVideoId = source.videoId
    loadReported = false
    webPositionSec = 0
    webDurationSec = 0
    delegate?.onStatusChange("loading")

    let wv = ensureWebView()
    let start = Int(source.startPosition)
    if webLoaded {
      // Player already alive — swap the video instantly, no page reload.
      webCmd(autoplay ? "loadVideoById" : "cueVideoById", [source.uri, start])
    } else {
      // First time: load the page. baseURL gives it a youtube.com referrer —
      // the embed rejects other referrers (Error 153). No `www` to match.
      let html = youTubeHtml(videoId: source.uri, autoplay: autoplay, start: start)
      wv.loadHTMLString(html, baseURL: URL(string: "https://youtube.com"))
    }
    reAttachActive()
  }

  /// Emit onLoad once per loaded video. `ready` fires only for the first page
  /// load; a subsequent `loadVideoById` swap surfaces via the first play state.
  private func reportWebLoadIfNeeded() {
    guard !loadReported else { return }
    loadReported = true
    delegate?.onLoad(
      currentVideoId ?? "", duration: webDurationSec, width: 0, height: 0)
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
  private func reAttachActive() {
    guard let id = currentSurfaceId,
          let container = AuVideoSurfaceRegistry.view(for: id) else { return }
    attachTo(container, surfaceId: id)
  }

  private func handleWebMessage(_ data: String) {
    guard let d = data.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any]
    else { return }
    switch obj["type"] as? String {
    case "ready":
      webLoaded = true
      webDurationSec = (obj["duration"] as? Double) ?? 0
      reportWebLoadIfNeeded()
    case "state":
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

  private func youTubeHtml(videoId: String, autoplay: Bool, start: Int) -> String {
    let auto = autoplay ? 1 : 0
    return """
    <!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}#p{width:100%;height:100%}#p iframe{pointer-events:none}</style>
    </head><body><div id="p"></div>
    <script>
    var player;
    function post(m){try{window.webkit.messageHandlers.AuBridge.postMessage(JSON.stringify(m));}catch(e){}}
    window.auCmd=function(f,a){try{player&&player[f]&&player[f].apply(player,a);}catch(e){}};
    var t=document.createElement('script');t.src='https://www.youtube.com/iframe_api';document.body.appendChild(t);
    function onYouTubeIframeAPIReady(){
      player=new YT.Player('p',{videoId:'\(videoId)',host:'https://www.youtube.com',
        playerVars:{autoplay:\(auto),controls:0,playsinline:1,rel:0,modestbranding:1,fs:0,disablekb:1,iv_load_policy:3,enablejsapi:1,start:\(start)},
        events:{onReady:function(){post({type:'ready',duration:player.getDuration()});},
          onStateChange:function(e){post({type:'state',state:e.data});},
          onError:function(e){post({type:'error',code:e.data});}}});
    }
    setInterval(function(){if(player&&player.getCurrentTime){post({type:'time',position:player.getCurrentTime(),duration:player.getDuration()});}},500);
    </script></body></html>
    """
  }

  // ------------------------------------------------------------- commands

  @objc public func play() {
    if engine == .web { webCmd("playVideo"); return }
    if player.currentItem == nil { return }
    player.play()
    if playbackRate != 1 {
      player.rate = Float(playbackRate)
    }
  }

  @objc public func pause() {
    if engine == .web { webCmd("pauseVideo"); return }
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
    if engine == .web { webCmd("setPlaybackRate", [rate]); return }
    playbackRate = rate
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
    if engine == .web {
      webCmd("setVolume", [Int(min(max(volume, 0), 1) * 100)])
      return
    }
    player.volume = Float(min(max(volume, 0), 1))
  }

  @objc public func setMuted(_ muted: Bool) {
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
    guard let container = AuVideoSurfaceRegistry.view(for: surfaceId) else {
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
    emitProgress()
    delegate?.onStatusChange("ended")
    delegate?.onEnd()
  }

  private func emitProgress() {
    guard let item = player.currentItem else { return }
    let position = positionSeconds()
    let duration = item.duration.isNumeric ? item.duration.seconds : 0
    var buffered: Double = 0
    if let range = item.loadedTimeRanges.first?.timeRangeValue {
      let end = range.start.seconds + range.duration.seconds
      buffered = max(end - position, 0)
    }
    delegate?.onProgress(position, duration: duration, buffered: buffered)
  }
}

extension AuVideoPlayerCore: WKScriptMessageHandler {
  public func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard message.name == "AuBridge", let body = message.body as? String else {
      return
    }
    handleWebMessage(body)
  }
}

extension AuVideoPlayerCore: AVPictureInPictureControllerDelegate {
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
