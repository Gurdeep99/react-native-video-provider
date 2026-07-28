package com.auvideo

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
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
  /** "url" (ExoPlayer) or "youtube" (WebView engine). */
  val type: String,
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

  // Second engine: a re-parentable WebView running the YouTube IFrame API.
  private enum class Engine { EXO, WEB }
  private var engine = Engine.EXO
  private var webView: WebView? = null
  private var webPositionSec = 0.0
  private var webDurationSec = 0.0

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
    webView?.destroy()
    webView = null
    engine = Engine.EXO
    currentVideoId = null
    pendingSurfaceId = null
    preloaded.clear()
    listener?.onStatusChange("idle")
  }

  // --------------------------------------------------------------- source

  fun setSource(source: SourceSpec, autoplay: Boolean) {
    if (source.type == "youtube") {
      setYouTube(source, autoplay)
      return
    }

    val exo = requirePlayer() ?: return

    // Switching away from the WebView engine: pause + hide it.
    if (engine == Engine.WEB) {
      webCmd("pauseVideo")
      engine = Engine.EXO
      reAttachActive()
    }

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

  // ----------------------------------------------------------- youtube engine

  @SuppressLint("SetJavaScriptEnabled")
  private fun ensureWebView(): WebView {
    webView?.let { return it }
    val ctx = requireNotNull(appContext)
    val wv = WebView(ctx)
    wv.settings.javaScriptEnabled = true
    wv.settings.domStorageEnabled = true
    wv.settings.mediaPlaybackRequiresUserGesture = false
    wv.setBackgroundColor(Color.BLACK)
    wv.addJavascriptInterface(
      object {
        @JavascriptInterface
        fun postMessage(data: String) {
          mainHandler.post { handleWebMessage(data) }
        }
      },
      "AuBridge"
    )
    webView = wv
    return wv
  }

  private fun setYouTube(source: SourceSpec, autoplay: Boolean) {
    val wv = ensureWebView()

    // Switching away from ExoPlayer: pause it so audio doesn't double up.
    if (engine == Engine.EXO) {
      player?.pause()
    }
    engine = Engine.WEB

    if (source.id == currentVideoId) {
      if (autoplay) webCmd("playVideo")
      reAttachActive()
      return
    }

    currentVideoId = source.id
    loadReported = false
    webPositionSec = 0.0
    webDurationSec = 0.0
    listener?.onStatusChange("loading")

    val html = buildYouTubeHtml(source.uri, autoplay, source.startPosition.toInt())
    // baseUrl gives the page a youtube.com origin/referrer — the embed rejects
    // other referrers (Error 153). No `www` matches the referrer that works.
    wv.loadDataWithBaseURL("https://youtube.com", html, "text/html", "utf-8", null)
    reAttachActive()
  }

  private fun handleWebMessage(data: String) {
    try {
      val json = org.json.JSONObject(data)
      when (json.optString("type")) {
        "ready" -> {
          webDurationSec = json.optDouble("duration", 0.0)
          if (!loadReported) {
            loadReported = true
            listener?.onLoad(currentVideoId ?: "", webDurationSec, 0, 0)
          }
        }
        "state" -> when (json.optInt("state", -99)) {
          1 -> listener?.onStatusChange("playing")
          2 -> listener?.onStatusChange("paused")
          3 -> listener?.onStatusChange("buffering")
          0 -> { listener?.onStatusChange("ended"); listener?.onEnd() }
        }
        "time" -> {
          webPositionSec = json.optDouble("position", 0.0)
          webDurationSec = json.optDouble("duration", 0.0)
          listener?.onProgress(webPositionSec, webDurationSec, webDurationSec)
        }
        "error" -> listener?.onError("youtube", json.optString("code"))
      }
    } catch (_: Exception) {
    }
  }

  /** Fire an IFrame-API command into the WebView (no-op unless WEB engine). */
  private fun webCmd(func: String, vararg args: Any) {
    val wv = webView ?: return
    val encoded = args.joinToString(",") { a ->
      if (a is String) "'$a'" else a.toString()
    }
    wv.evaluateJavascript("auCmd('$func',[$encoded]);", null)
  }

  private fun buildYouTubeHtml(videoId: String, autoplay: Boolean, start: Int): String {
    val auto = if (autoplay) 1 else 0
    return """<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}#p{width:100%;height:100%}#p iframe{pointer-events:none}</style>
</head><body><div id="p"></div>
<script>
var player;
function post(m){try{AuBridge.postMessage(JSON.stringify(m))}catch(e){}}
window.auCmd=function(f,a){try{player&&player[f]&&player[f].apply(player,a);}catch(e){}};
var t=document.createElement('script');t.src='https://www.youtube.com/iframe_api';document.body.appendChild(t);
function onYouTubeIframeAPIReady(){
  player=new YT.Player('p',{videoId:'$videoId',host:'https://www.youtube.com',
    playerVars:{autoplay:$auto,controls:0,playsinline:1,rel:0,modestbranding:1,fs:0,disablekb:1,iv_load_policy:3,enablejsapi:1,start:$start},
    events:{onReady:function(){post({type:'ready',duration:player.getDuration()});},
      onStateChange:function(e){post({type:'state',state:e.data});},
      onError:function(e){post({type:'error',code:e.data});}}});
}
setInterval(function(){if(player&&player.getCurrentTime){post({type:'time',position:player.getCurrentTime(),duration:player.getDuration()});}},500);
</script></body></html>"""
  }

  /** Re-parent the active engine's view into the current surface (engine swap). */
  private fun reAttachActive() {
    val id = currentSurfaceId ?: return
    val container = SurfaceRegistry.get(id) ?: return
    attachTo(container, id)
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
    if (engine == Engine.WEB) {
      webCmd("playVideo")
      return
    }
    val exo = player ?: return
    // After stop() the player sits in IDLE with its item retained.
    if (exo.playbackState == Player.STATE_IDLE && exo.mediaItemCount > 0) {
      exo.prepare()
    }
    exo.play()
  }

  fun pause() {
    if (engine == Engine.WEB) {
      webCmd("pauseVideo")
      return
    }
    player?.pause()
  }

  fun stop() {
    if (engine == Engine.WEB) {
      webCmd("pauseVideo")
      webCmd("seekTo", 0, true)
      return
    }
    player?.stop()
    stopProgress()
  }

  fun seekTo(positionSec: Double) {
    if (engine == Engine.WEB) {
      webCmd("seekTo", positionSec, true)
      return
    }
    player?.seekTo((positionSec * 1000).toLong())
  }

  fun setRate(rate: Double) {
    if (engine == Engine.WEB) {
      webCmd("setPlaybackRate", rate)
      return
    }
    player?.setPlaybackSpeed(rate.toFloat())
  }

  fun setVolume(volume: Double) {
    if (engine == Engine.WEB) {
      webCmd("setVolume", (volume.coerceIn(0.0, 1.0) * 100).toInt())
      return
    }
    player?.volume = volume.toFloat().coerceIn(0f, 1f)
  }

  fun setMuted(muted: Boolean) {
    if (engine == Engine.WEB) {
      webCmd(if (muted) "mute" else "unMute")
      return
    }
    val exo = player ?: return
    if (muted) {
      exo.volume = 0f
    } else if (exo.volume == 0f) {
      exo.volume = 1f
    }
  }

  fun setRepeat(repeat: Boolean) {
    if (engine == Engine.WEB) return // YouTube loop handled JS-side if needed
    player?.repeatMode = if (repeat) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
  }

  fun setResizeMode(mode: String) {
    playerView?.resizeMode = when (mode) {
      "cover" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
      "stretch" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
      else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
    }
  }

  fun positionSeconds(): Double =
    if (engine == Engine.WEB) webPositionSec else (player?.currentPosition ?: 0L) / 1000.0

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

  /** The view of the currently-active engine (re-parented across surfaces). */
  private fun activeView(): View? = if (engine == Engine.WEB) webView else playerView

  fun detach() {
    val view = activeView() ?: return
    (view.parent as? ViewGroup)?.removeView(view)
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
    val active = activeView() ?: return
    if (currentSurfaceId == surfaceId && active.parent === view) {
      view.removeView(active)
      currentSurfaceId = null
      // Keep playing hidden (audio); remounting the same surface re-attaches.
      pendingSurfaceId = surfaceId
      listener?.onDetach(surfaceId)
    }
  }

  private fun attachTo(container: AuVideoSurfaceView, surfaceId: String) {
    val view = activeView() ?: return
    if (currentSurfaceId == surfaceId && view.parent === container) {
      pendingSurfaceId = null
      return
    }
    currentSurfaceId?.let { previous -> if (previous != surfaceId) listener?.onDetach(previous) }
    // Detach whichever engine view is currently in this container (engine swap).
    playerView?.let { (it.parent as? ViewGroup)?.let { p -> if (p === container) p.removeView(it) } }
    webView?.let { (it.parent as? ViewGroup)?.let { p -> if (p === container) p.removeView(it) } }
    (view.parent as? ViewGroup)?.removeView(view)
    container.addView(
      view,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
    )
    currentSurfaceId = surfaceId
    pendingSurfaceId = null
    if (engine == Engine.EXO) {
      playerView?.let { reassertVideoOutput(it, surfaceId, container) }
    }
    listener?.onAttach(surfaceId)
  }

  /**
   * Re-parenting the PlayerView destroys and recreates its TextureView
   * SurfaceTexture. VOD re-renders the last decoded frame onto the new
   * surface immediately, but a LIVE stream (no buffered frame to re-render)
   * can stay black. Re-binding the player to the view on the next frame
   * forces the video output onto the fresh surface. No-op-safe for VOD.
   */
  private fun reassertVideoOutput(
    pv: PlayerView,
    surfaceId: String,
    container: AuVideoSurfaceView,
  ) {
    mainHandler.post {
      if (currentSurfaceId == surfaceId && pv.parent === container) {
        val exo = player ?: return@post
        pv.player = null
        pv.player = exo
      }
    }
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
