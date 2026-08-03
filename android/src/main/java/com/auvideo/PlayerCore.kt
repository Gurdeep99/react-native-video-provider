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
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
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
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
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
    /** Source turned out to be (or stopped being) a live stream. */
    fun onLiveChange(live: Boolean)
  }

  var listener: Listener? = null

  private const val PROGRESS_INTERVAL_MS = 500L

  /**
   * Cap on in-place live recoveries per load. A live edge that keeps throwing
   * is a genuinely broken feed, so stop re-preparing in a tight loop and let
   * the error surface to JS, which retries with backoff. Reset whenever
   * playback actually recovers.
   */
  private const val MAX_LIVE_RECOVERIES = 5

  /** Segment-load retries before ExoPlayer gives up (default is 3). */
  private const val LIVE_SEGMENT_RETRIES = 6

  private var appContext: Context? = null
  private var player: ExoPlayer? = null
  private var playerView: PlayerView? = null

  // Second engine: a re-parentable WebView running the YouTube IFrame API.
  private enum class Engine { EXO, WEB }
  private var engine = Engine.EXO
  private var webView: WebView? = null
  /** True once the IFrame player is created — lets us swap videos instantly. */
  private var webLoaded = false
  /** Warming the page in the background; its events aren't user-visible yet. */
  private var webWarming = false
  /** A play() that arrived before the IFrame player existed. */
  private var pendingWebPlay = false
  /**
   * Incremented per page load. A discarded page (a warm superseded by a real
   * load) can still have a `ready` in flight; echoing this token lets us tell
   * that stale message from the current page's.
   */
  private var webLoadToken = 0
  private var webPositionSec = 0.0
  private var webDurationSec = 0.0

  private var currentVideoId: String? = null
  private var currentSurfaceId: String? = null

  /** Surface we want but that hasn't registered (yet, or again). */
  private var pendingSurfaceId: String? = null

  private var loadReported = false
  private val preloaded = HashMap<String, MediaItem>()

  /** In-place live recoveries since the last successful playback. */
  private var liveRecoveries = 0
  /** Last live-ness we told JS about, so we only emit on change. */
  private var reportedLive: Boolean? = null

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
    webView?.let { wv ->
      (wv.parent as? ViewGroup)?.removeView(wv)
      wv.destroy()
    }
    webView = null
    webLoaded = false
    webWarming = false
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
    liveRecoveries = 0
    reportedLive = null
    // Silence the progress ticker across the swap. It samples the player every
    // 500ms, and until the new item is ready those samples still describe the
    // OLD source — leaving a live stream, that means a large live-window
    // position paired with duration 0, which renders as a garbage seekbar.
    stopProgress()
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
    wv.webViewClient = object : WebViewClient() {
      /**
       * The WebView renders in its own OS process, which Android kills under
       * memory pressure — likely during a long live stream. Returning false
       * (the default) takes the whole app down with it. Returning true keeps
       * the app alive; the dead WebView can never be reused, so drop it and
       * rebuild from scratch.
       */
      override fun onRenderProcessGone(
        view: WebView,
        detail: RenderProcessGoneDetail?,
      ): Boolean {
        if (view !== webView) return true
        recoverFromWebProcessDeath()
        return true
      }
    }
    webView = wv
    return wv
  }

  /**
   * Rebuild the YouTube player after its render process died. The old WebView
   * is unusable, so tear it down and reload the page at the last known
   * position; playback resumes where the viewer was.
   */
  private fun recoverFromWebProcessDeath() {
    val dead = webView
    webView = null
    webLoaded = false
    webWarming = false
    dead?.let {
      (it.parent as? ViewGroup)?.removeView(it)
      it.destroy()
    }
    val id = currentVideoId
    if (engine != Engine.WEB || id == null) return
    listener?.onStatusChange("buffering")
    val resumeAt = webPositionSec
    // Force a full page load: currentVideoId is cleared so setYouTube can't
    // take its "same video, just resume" shortcut into the dead WebView.
    currentVideoId = null
    setYouTube(
      SourceSpec(
        id = id,
        uri = id,
        type = "youtube",
        headers = emptyMap(),
        title = null,
        artist = null,
        artworkUri = null,
        startPosition = resumeAt,
      ),
      autoplay = true,
    )
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
    reportedLive = null
    listener?.onStatusChange("loading")

    val start = source.startPosition.toInt()
    if (webLoaded) {
      // Player already alive — swap the video instantly, no page reload.
      webCmd(if (autoplay) "loadVideoById" else "cueVideoById", source.uri, start)
    } else {
      // First time: load the page. baseUrl gives it a youtube.com referrer —
      // the embed rejects other referrers (Error 153). No `www` to match.
      // This supersedes any in-flight warm, so its event guard must lift.
      webWarming = false
      // Guarantee the first play. The autoplay URL param and the in-page kick()
      // both usually work, but WebViews drop autoplay often enough that the
      // player can sit "unstarted" — showing YouTube's big play button. Queue
      // an explicit play for the moment the player reports ready.
      pendingWebPlay = autoplay
      webLoadToken += 1
      val html = buildYouTubeHtml(source.uri, autoplay, start, webLoadToken)
      wv.loadDataWithBaseURL("https://youtube.com", html, "text/html", "utf-8", null)
    }
    reAttachActive()
  }

  private fun handleWebMessage(data: String) {
    try {
      val json = org.json.JSONObject(data)
      val isReady = json.optString("type") == "ready"
      // A page we've already replaced can still deliver its `ready`. Acting on
      // it would mark the *new* page loaded before it is, so anything that
      // doesn't carry the current token is discarded outright.
      if (isReady && json.optInt("tok", -1) != webLoadToken) {
        return
      }
      // While warming (or whenever the WebView isn't the active engine) the
      // page is off-screen scaffolding: record that the player exists, but
      // don't emit — these events describe a video the user isn't watching.
      if (webWarming || engine != Engine.WEB) {
        if (isReady) {
          webLoaded = true
          webWarming = false
        }
        return
      }
      when (json.optString("type")) {
        "ready" -> {
          webLoaded = true
          webDurationSec = json.optDouble("duration", 0.0)
          reportWebLive(json)
          reportWebLoadIfNeeded()
          // Replay a play() that arrived while the player was still loading.
          if (pendingWebPlay) {
            pendingWebPlay = false
            webCmd("playVideo")
          }
        }
        "state" -> {
          reportWebLive(json)
          when (json.optInt("state", -99)) {
            1 -> { reportWebLoadIfNeeded(); listener?.onStatusChange("playing") }
            2 -> listener?.onStatusChange("paused")
            3 -> listener?.onStatusChange("buffering")
            0 -> { listener?.onStatusChange("ended"); listener?.onEnd() }
          }
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

  /**
   * Mirror the YouTube player's live-ness to JS, emitting only on change so a
   * 2 Hz message stream doesn't churn the store.
   */
  private fun reportWebLive(json: org.json.JSONObject) {
    if (!json.has("live")) return
    val live = json.optBoolean("live", false)
    if (reportedLive == live) return
    reportedLive = live
    listener?.onLiveChange(live)
  }

  /**
   * Emit onLoad once per loaded video. `ready` fires only for the first page
   * load; a subsequent `loadVideoById` swap surfaces via the first play state.
   */
  private fun reportWebLoadIfNeeded() {
    if (loadReported) return
    loadReported = true
    listener?.onLoad(currentVideoId ?: "", webDurationSec, 0, 0)
  }

  /** Fire an IFrame-API command into the WebView (no-op unless WEB engine). */
  private fun webCmd(func: String, vararg args: Any) {
    if (engine != Engine.WEB) return
    val wv = webView ?: return
    val encoded = args.joinToString(",") { a ->
      if (a is String) "'$a'" else a.toString()
    }
    wv.evaluateJavascript("auCmd('$func',[$encoded]);", null)
  }

  private fun buildYouTubeHtml(
    videoId: String,
    autoplay: Boolean,
    start: Int,
    token: Int,
  ): String {
    val auto = if (autoplay) 1 else 0
    return """<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}
/* #p is the iframe itself now; pointer-events:none keeps YouTube's own chrome
   untouchable so the library's controls stay the only interactive layer. */
#p{width:100%;height:100%;border:0;display:block;pointer-events:none}</style>
</head><body><iframe id="p" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen
src="https://www.youtube.com/embed/$videoId?enablejsapi=1&autoplay=$auto&controls=0&playsinline=1&rel=0&modestbranding=1&fs=0&disablekb=1&iv_load_policy=3&start=$start&origin=https://youtube.com"></iframe>
<script>
var player;
var tries=0;
var cur='$videoId';
var tok=$token;
function post(m){try{AuBridge.postMessage(JSON.stringify(m))}catch(e){}}
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
// YouTube reports live-ness only via getVideoData(), which is undocumented —
// guard it and fall back to the duration===0 heuristic live streams exhibit.
function isLive(){
  try{var d=player.getVideoData&&player.getVideoData();
    if(d&&typeof d.isLive==='boolean')return d.isLive;}catch(e){}
  try{return player.getDuration()===0;}catch(e){return false;}
}
// A live stream that drops leaves the player stopped on a still-valid video.
// Reloading the same id rejoins the broadcast; capped so a permanently dead
// stream stops looping here and surfaces to JS instead.
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
  // Attach to the iframe already in the document rather than letting YT build
  // one. The markup version starts fetching the video immediately, in parallel
  // with this API script, instead of waiting for it — that wait was most of the
  // delay before first frame. Player vars come from the iframe URL here.
  player=new YT.Player('p',{
    events:{onReady:function(){
        post({type:'ready',tok:tok,duration:player.getDuration(),live:isLive()});
        if($auto){try{player.playVideo();}catch(e){}tries=0;kick();}
      },
      onStateChange:function(e){
        if(e.data===1)revives=0;
        // Live feeds don't "end" — a 0 state means the broadcast dropped.
        if(e.data===0&&isLive()){revive();return;}
        post({type:'state',state:e.data,live:isLive()});
      },
      // 2/5 are transient player faults on a valid video; 100/101/150 mean the
      // video is gone or embedding is disallowed, which retrying can't fix.
      onError:function(e){
        if((e.data===2||e.data===5)&&revives<5){revive();return;}
        post({type:'error',code:e.data});
      }}});
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
    if (source.type == "youtube") {
      warmYouTube(source)
      return
    }
    // v0.1: pre-builds the MediaItem so attach-time setup is instant.
    // Real ahead-of-time buffering via Media3 PreloadManager is roadmap and
    // stays isolated behind this method.
    preloaded[source.id] = buildMediaItem(source)
  }

  /**
   * Build the YouTube page ahead of time so the first real play costs a single
   * loadVideoById instead of a page load, an iframe-API fetch and a player
   * construction. The video is cued, not played.
   *
   * Deliberately invisible: it must not switch the active engine, claim
   * currentVideoId, or emit events, or it would interrupt whatever is playing.
   */
  private fun warmYouTube(source: SourceSpec) {
    if (webLoaded || webWarming) return
    val wv = ensureWebView()
    webWarming = true
    webLoadToken += 1
    val html = buildYouTubeHtml(source.uri, autoplay = false, start = 0, token = webLoadToken)
    wv.loadDataWithBaseURL("https://youtube.com", html, "text/html", "utf-8", null)
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
      // A live segment request that hangs shouldn't stall playback for the
      // default 8s — fail fast so the retry policy can fetch the next one.
      .setConnectTimeoutMs(8_000)
      .setReadTimeoutMs(8_000)
    if (headers.isNotEmpty()) {
      httpFactory.setDefaultRequestProperties(headers)
    }
    return DefaultMediaSourceFactory(DefaultDataSource.Factory(context, httpFactory))
      // Mobile networks drop individual segments constantly; the default of 3
      // retries surfaces a fatal error on what is usually a transient blip.
      .setLoadErrorHandlingPolicy(
        DefaultLoadErrorHandlingPolicy(LIVE_SEGMENT_RETRIES)
      )
  }

  /**
   * True for errors a live stream can recover from in place by seeking back to
   * the live edge and re-preparing.
   *
   * `BEHIND_LIVE_WINDOW` is the classic: the player was paused/backgrounded
   * long enough that its position fell off the start of the sliding window.
   * The network cases are transient blips on mobile — the feed itself is fine.
   */
  private fun isRecoverableLiveError(error: PlaybackException): Boolean {
    if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
      return true
    }
    // Only worth re-preparing a source that has a live edge to seek to.
    if (player?.isCurrentMediaItemLive != true) return false
    return when (error.errorCode) {
      PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
      PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
      PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
      -> true
      else -> false
    }
  }

  /** Emit live-ness to JS when it changes, so the UI needs no manual setLive. */
  private fun reportLiveIfChanged() {
    val exo = player ?: return
    val live = exo.isCurrentMediaItemLive
    if (reportedLive == live) return
    reportedLive = live
    listener?.onLiveChange(live)
  }

  // ------------------------------------------------------------- commands

  fun play() {
    if (engine == Engine.WEB) {
      // The IFrame player may not exist yet (first load, or a rebuild after the
      // render process died). A command sent now would be dropped silently, so
      // remember the intent and replay it when the player reports ready.
      if (!webLoaded) {
        pendingWebPlay = true
        return
      }
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
      // Cancel any deferred play, or a pause issued while the player was
      // loading would be undone the moment it became ready.
      pendingWebPlay = false
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
          // Playing again — let a future stall spend a fresh recovery budget.
          liveRecoveries = 0
          reportLiveIfChanged()
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
      val exo = player
      if (exo != null && isRecoverableLiveError(error) && liveRecoveries < MAX_LIVE_RECOVERIES) {
        // Falling behind the live window (backgrounded, long stall, network
        // drop) leaves the player IDLE holding a now-invalid position. Seeking
        // back to the live edge and re-preparing resumes in place — far faster
        // than surfacing an error and letting JS rebuild the whole source.
        liveRecoveries += 1
        listener?.onStatusChange("buffering")
        exo.seekToDefaultPosition()
        exo.prepare()
        return
      }
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
    // Until the current item reports READY these samples still describe the
    // previous source. Leaving a live stream that meant emitting a live-window
    // position (which runs to millions of seconds — "3603:49:34" on a seekbar)
    // against the new video's duration.
    if (!loadReported) return

    val duration = if (exo.duration == C.TIME_UNSET) 0.0 else exo.duration / 1000.0
    // A live stream's position is measured from the start of the live window,
    // which for a long-running broadcast runs to millions of seconds. There is
    // no meaningful scrubber position for live (duration is 0 and the seekbar
    // is hidden), so report 0 rather than let that number reach the UI.
    val position = if (exo.isCurrentMediaItemLive) 0.0 else exo.currentPosition / 1000.0
    val buffered = ((exo.bufferedPosition - exo.currentPosition).coerceAtLeast(0L)) / 1000.0
    listener?.onProgress(position, duration, buffered)
  }

  private fun requirePlayer(): ExoPlayer? {
    val context = appContext
    if (player == null && context != null) initialize(context)
    return player
  }
}
