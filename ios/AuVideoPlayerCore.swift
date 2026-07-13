import AVFoundation
import AVKit
import Foundation
import UIKit

@objc(AuVideoSourceSpec)
public final class AuVideoSourceSpec: NSObject {
  @objc public let videoId: String
  @objc public let uri: String
  @objc public let headers: [String: String]
  @objc public let title: String?
  @objc public let artist: String?
  @objc public let artworkUri: String?
  @objc public let startPosition: Double

  @objc public init(
    videoId: String,
    uri: String,
    headers: [String: String],
    title: String?,
    artist: String?,
    artworkUri: String?,
    startPosition: Double
  ) {
    self.videoId = videoId
    self.uri = uri
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
    pipController = nil
    currentVideoId = nil
    pendingSurfaceId = nil
    preloaded.removeAll()
    delegate?.onStatusChange("idle")
  }

  // --------------------------------------------------------------- source

  @objc public func setSource(_ source: AuVideoSourceSpec, autoplay: Bool) {
    initialize()

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

  // ------------------------------------------------------------- commands

  @objc public func play() {
    if player.currentItem == nil { return }
    player.play()
    if playbackRate != 1 {
      player.rate = Float(playbackRate)
    }
  }

  @objc public func pause() {
    player.pause()
  }

  @objc public func stop() {
    player.pause()
    player.seek(to: .zero)
    delegate?.onStatusChange("idle")
  }

  @objc public func seek(to position: Double) {
    let target = CMTime(seconds: max(position, 0), preferredTimescale: 600)
    player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) {
      [weak self] _ in
      self?.delegate?.onSeek(position)
    }
  }

  @objc public func setRate(_ rate: Double) {
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
    player.volume = Float(min(max(volume, 0), 1))
  }

  @objc public func setMuted(_ muted: Bool) {
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

  @objc public func detach() {
    hostView.removeFromSuperview()
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
    if currentSurfaceId == surfaceId, hostView.superview === view {
      hostView.removeFromSuperview()
      currentSurfaceId = nil
      // Keep playing hidden (audio); remounting the same surface re-attaches.
      pendingSurfaceId = surfaceId
      delegate?.onDetach(surfaceId)
    }
  }

  private func attachTo(_ container: UIView, surfaceId: String) {
    if currentSurfaceId == surfaceId, hostView.superview === container {
      pendingSurfaceId = nil
      return
    }
    if let previous = currentSurfaceId, previous != surfaceId {
      delegate?.onDetach(previous)
    }
    hostView.removeFromSuperview()
    hostView.frame = container.bounds
    hostView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    container.addSubview(hostView)
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
