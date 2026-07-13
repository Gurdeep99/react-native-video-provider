package com.auvideo

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView

data class SourceSpec(
  val id: String,
  val uri: String,
  val headers: Map<String, String>,
  val title: String?,
  val artist: String?,
  val artworkUri: String?,
  val startPosition: Double,
)

/**
 * The ONE playback engine of the app.
 *
 * Owns a single ExoPlayer and a single TextureView-backed PlayerView that is
 * re-parented between registered [AuVideoSurfaceView]s. Created lazily on
 * first init and only destroyed by an explicit release() — React component
 * lifecycles never touch it.
 *
 * Everything here must run on the main thread; public entry points marshal.
 */
@SuppressLint("UnsafeOptInUsageError")
object PlayerCore {

  interface Listener {
    fun onStatusChange(status: String)
    fun onLoad(videoId: String, duration: Double, width: Int, height: Int)
    fun onProgress(position: Double, duration: Double, buffered: Double)
    fun onSeek(position: Double)
    fun onEnd()
    fun onError(code: String, message: String)
    fun onAttach(surfaceId: String)
    fun onDetach(surfaceId: String)
  }

  var listener: Listener? = null

  private const val PROGRESS_INTERVAL_MS = 500L

  private var appContext: Context? = null
  private var player: ExoPlayer? = null
  private var playerView: PlayerView? = null

  private var currentVideoId: String? = null
  private var currentSurfaceId: String? = null

  /** Surface we want but that hasn't registered (yet, or again). */
  private var pendingSurfaceId: String? = null

  private var loadReported = false
  private val preloaded = HashMap<String, MediaItem>()

  private val mainHandler = Handler(Looper.getMainLooper())

  private val progressRunnable = object : Runnable {
    override fun run() {
      val p = player ?: return
      emitProgress(p)
      mainHandler.postDelayed(this, PROGRESS_INTERVAL_MS)
    }
  }

  fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
  }

  // ------------------------------------------------------------- lifecycle

  /** Idempotent. */
  fun initialize(context: Context) {
    appContext = context.applicationContext
    if (player != null) return

    val exo = ExoPlayer.Builder(context.applicationContext).build()
    exo.addListener(playerListener)
    player = exo

    // Inflated from XML because surface_type can only be set via attrs.
    val view = LayoutInflater.from(context.applicationContext)
      .inflate(R.layout.au_video_player_view, null) as PlayerView
    view.player = exo
    playerView = view
  }

  fun release() {
    stopProgress()
    detach()
    player?.release()
    playerView?.player = null
    player = null
    playerView = null
    currentVideoId = null
    pendingSurfaceId = null
    preloaded.clear()
    listener?.onStatusChange("idle")
  }

  // --------------------------------------------------------------- source

  fun setSource(source: SourceSpec, autoplay: Boolean) {
    val exo = requirePlayer() ?: return

    if (source.id == currentVideoId) {
      // Same-video handoff: never reload; at most honor autoplay.
      if (autoplay && !exo.isPlaying) play()
      return
    }

    currentVideoId = source.id
    loadReported = false
    listener?.onStatusChange("loading")

    val item = preloaded.remove(source.id) ?: buildMediaItem(source)
    val mediaSource = buildMediaSourceFactory(source.headers).createMediaSource(item)

    if (source.startPosition > 0) {
      exo.setMediaSource(mediaSource, (source.startPosition * 1000).toLong())
    } else {
      exo.setMediaSource(mediaSource, true)
    }
    exo.playWhenReady = autoplay
    exo.prepare()
  }

  fun preload(source: SourceSpec) {
    // v0.1: pre-builds the MediaItem so attach-time setup is instant.
    // Real ahead-of-time buffering via Media3 PreloadManager is roadmap and
    // stays isolated behind this method.
    preloaded[source.id] = buildMediaItem(source)
  }

  private fun buildMediaItem(source: SourceSpec): MediaItem {
    val metadata = MediaMetadata.Builder()
      .setTitle(source.title)
      .setArtist(source.artist)
      .setArtworkUri(source.artworkUri?.let(Uri::parse))
      .build()
    return MediaItem.Builder()
      .setUri(Uri.parse(source.uri))
      .setMediaId(source.id)
      .setMediaMetadata(metadata)
      .build()
  }

  private fun buildMediaSourceFactory(headers: Map<String, String>): DefaultMediaSourceFactory {
    val context = requireNotNull(appContext)
    val httpFactory = DefaultHttpDataSource.Factory()
      .setAllowCrossProtocolRedirects(true)
    if (headers.isNotEmpty()) {
      httpFactory.setDefaultRequestProperties(headers)
    }
    return DefaultMediaSourceFactory(DefaultDataSource.Factory(context, httpFactory))
  }

  // ------------------------------------------------------------- commands

  fun play() {
    val exo = player ?: return
    // After stop() the player sits in IDLE with its item retained.
    if (exo.playbackState == Player.STATE_IDLE && exo.mediaItemCount > 0) {
      exo.prepare()
    }
    exo.play()
  }

  fun pause() {
    player?.pause()
  }

  fun stop() {
    player?.stop()
    stopProgress()
  }

  fun seekTo(positionSec: Double) {
    player?.seekTo((positionSec * 1000).toLong())
  }

  fun setRate(rate: Double) {
    player?.setPlaybackSpeed(rate.toFloat())
  }

  fun setVolume(volume: Double) {
    player?.volume = volume.toFloat().coerceIn(0f, 1f)
  }

  fun setMuted(muted: Boolean) {
    val exo = player ?: return
    if (muted) {
      exo.volume = 0f
    } else if (exo.volume == 0f) {
      exo.volume = 1f
    }
  }

  fun setRepeat(repeat: Boolean) {
    player?.repeatMode = if (repeat) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
  }

  fun setResizeMode(mode: String) {
    playerView?.resizeMode = when (mode) {
      "cover" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
      "stretch" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
      else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
    }
  }

  fun positionSeconds(): Double = (player?.currentPosition ?: 0L) / 1000.0

  // ------------------------------------------------------------- surfaces

  fun attach(surfaceId: String) {
    val view = SurfaceRegistry.get(surfaceId)
    if (view == null) {
      // Screen still mounting — attach the moment it registers.
      pendingSurfaceId = surfaceId
      return
    }
    attachTo(view, surfaceId)
  }

  fun detach() {
    val pv = playerView ?: return
    (pv.parent as? ViewGroup)?.removeView(pv)
    currentSurfaceId?.let { listener?.onDetach(it) }
    currentSurfaceId = null
    pendingSurfaceId = null
  }

  fun onSurfaceAvailable(surfaceId: String, view: AuVideoSurfaceView) {
    // Also re-attach when the active surface's view was recreated (e.g.
    // navigating back to a screen that Fabric re-materialized).
    if (surfaceId == pendingSurfaceId || surfaceId == currentSurfaceId) {
      attachTo(view, surfaceId)
    }
  }

  fun onSurfaceUnavailable(surfaceId: String, view: AuVideoSurfaceView) {
    val pv = playerView ?: return
    if (currentSurfaceId == surfaceId && pv.parent === view) {
      view.removeView(pv)
      currentSurfaceId = null
      // Keep playing hidden (audio); remounting the same surface re-attaches.
      pendingSurfaceId = surfaceId
      listener?.onDetach(surfaceId)
    }
  }

  private fun attachTo(container: AuVideoSurfaceView, surfaceId: String) {
    val pv = playerView ?: return
    if (currentSurfaceId == surfaceId && pv.parent === container) {
      pendingSurfaceId = null
      return
    }
    currentSurfaceId?.let { previous -> if (previous != surfaceId) listener?.onDetach(previous) }
    (pv.parent as? ViewGroup)?.removeView(pv)
    container.addView(
      pv,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
    )
    currentSurfaceId = surfaceId
    pendingSurfaceId = null
    listener?.onAttach(surfaceId)
  }

  // --------------------------------------------------------------- events

  private val playerListener = object : Player.Listener {
    override fun onPlaybackStateChanged(state: Int) {
      val exo = player ?: return
      when (state) {
        Player.STATE_BUFFERING -> listener?.onStatusChange("buffering")
        Player.STATE_READY -> {
          if (!loadReported) {
            loadReported = true
            val size = exo.videoSize
            val duration =
              if (exo.duration == C.TIME_UNSET) 0.0 else exo.duration / 1000.0
            listener?.onLoad(currentVideoId ?: "", duration, size.width, size.height)
          }
          listener?.onStatusChange(if (exo.isPlaying) "playing" else "paused")
        }
        Player.STATE_ENDED -> {
          stopProgress()
          emitProgress(exo)
          listener?.onStatusChange("ended")
          listener?.onEnd()
        }
        Player.STATE_IDLE -> listener?.onStatusChange("idle")
      }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      val exo = player ?: return
      if (isPlaying) {
        listener?.onStatusChange("playing")
        startProgress()
      } else {
        stopProgress()
        if (exo.playbackState == Player.STATE_READY) {
          listener?.onStatusChange("paused")
        }
      }
    }

    override fun onPositionDiscontinuity(
      oldPosition: Player.PositionInfo,
      newPosition: Player.PositionInfo,
      reason: Int,
    ) {
      if (reason == Player.DISCONTINUITY_REASON_SEEK) {
        listener?.onSeek(newPosition.positionMs / 1000.0)
      }
    }

    override fun onPlayerError(error: PlaybackException) {
      listener?.onError(error.errorCodeName, error.message ?: "Playback error")
    }
  }

  private fun startProgress() {
    stopProgress()
    mainHandler.postDelayed(progressRunnable, PROGRESS_INTERVAL_MS)
  }

  private fun stopProgress() {
    mainHandler.removeCallbacks(progressRunnable)
  }

  private fun emitProgress(exo: ExoPlayer) {
    val duration = if (exo.duration == C.TIME_UNSET) 0.0 else exo.duration / 1000.0
    val position = exo.currentPosition / 1000.0
    val buffered = ((exo.bufferedPosition - exo.currentPosition).coerceAtLeast(0L)) / 1000.0
    listener?.onProgress(position, duration, buffered)
  }

  private fun requirePlayer(): ExoPlayer? {
    val context = appContext
    if (player == null && context != null) initialize(context)
    return player
  }
}
