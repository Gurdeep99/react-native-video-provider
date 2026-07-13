package com.auvideo

import android.app.PictureInPictureParams
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Build
import android.util.Rational
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil

class AuVideoModule(reactContext: ReactApplicationContext) :
  NativeAuVideoSpec(reactContext), PlayerCore.Listener {

  private var previousOrientation: Int? = null

  // ------------------------------------------------------------ lifecycle

  override fun nativeInit() {
    UiThreadUtil.runOnUiThread {
      PlayerCore.listener = this
      PlayerCore.initialize(reactApplicationContext)
    }
  }

  override fun releasePlayer() {
    UiThreadUtil.runOnUiThread {
      PlayerCore.release()
      PlayerCore.listener = null
    }
  }

  override fun invalidate() {
    PlayerCore.listener = null
    super.invalidate()
  }

  // -------------------------------------------------------------- source

  override fun setSource(source: ReadableMap, autoplay: Boolean) {
    val spec = parseSource(source) ?: return
    UiThreadUtil.runOnUiThread { PlayerCore.setSource(spec, autoplay) }
  }

  override fun preload(source: ReadableMap) {
    val spec = parseSource(source) ?: return
    UiThreadUtil.runOnUiThread { PlayerCore.preload(spec) }
  }

  private fun parseSource(map: ReadableMap): SourceSpec? {
    val id = map.getString("id") ?: return null
    val uri = map.getString("uri") ?: return null
    val headers = HashMap<String, String>()
    map.getMap("headers")?.let { h ->
      val it = h.keySetIterator()
      while (it.hasNextKey()) {
        val key = it.nextKey()
        h.getString(key)?.let { value -> headers[key] = value }
      }
    }
    return SourceSpec(
      id = id,
      uri = uri,
      headers = headers,
      title = map.getString("title"),
      artist = map.getString("artist"),
      artworkUri = map.getString("artworkUri"),
      startPosition = if (map.hasKey("startPosition")) map.getDouble("startPosition") else 0.0,
    )
  }

  // ------------------------------------------------------------- commands

  override fun play() {
    UiThreadUtil.runOnUiThread { PlayerCore.play() }
  }

  override fun pause() {
    UiThreadUtil.runOnUiThread { PlayerCore.pause() }
  }

  override fun stop() {
    UiThreadUtil.runOnUiThread { PlayerCore.stop() }
  }

  override fun seekTo(position: Double) {
    UiThreadUtil.runOnUiThread { PlayerCore.seekTo(position) }
  }

  override fun setRate(rate: Double) {
    UiThreadUtil.runOnUiThread { PlayerCore.setRate(rate) }
  }

  override fun setVolume(volume: Double) {
    UiThreadUtil.runOnUiThread { PlayerCore.setVolume(volume) }
  }

  override fun setMuted(muted: Boolean) {
    UiThreadUtil.runOnUiThread { PlayerCore.setMuted(muted) }
  }

  override fun setRepeat(repeat: Boolean) {
    UiThreadUtil.runOnUiThread { PlayerCore.setRepeat(repeat) }
  }

  override fun setResizeMode(mode: String) {
    UiThreadUtil.runOnUiThread { PlayerCore.setResizeMode(mode) }
  }

  override fun getPosition(promise: Promise) {
    UiThreadUtil.runOnUiThread { promise.resolve(PlayerCore.positionSeconds()) }
  }

  // ------------------------------------------------------------- surfaces

  override fun attach(surfaceId: String) {
    UiThreadUtil.runOnUiThread { PlayerCore.attach(surfaceId) }
  }

  override fun detach() {
    UiThreadUtil.runOnUiThread { PlayerCore.detach() }
  }

  // ----------------------------------------------------------- fullscreen

  override fun enterFullscreen() {
    UiThreadUtil.runOnUiThread {
      val activity = currentActivity ?: return@runOnUiThread
      if (previousOrientation == null) {
        previousOrientation = activity.requestedOrientation
      }
      // Unlock rotation while fullscreen is visible, even in portrait-locked apps.
      activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR

      val window = activity.window
      WindowCompat.setDecorFitsSystemWindows(window, false)
      WindowInsetsControllerCompat(window, window.decorView).apply {
        systemBarsBehavior =
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        hide(WindowInsetsCompat.Type.systemBars())
      }
    }
  }

  override fun exitFullscreen() {
    UiThreadUtil.runOnUiThread {
      val activity = currentActivity ?: return@runOnUiThread
      activity.requestedOrientation =
        previousOrientation ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      previousOrientation = null

      val window = activity.window
      WindowCompat.setDecorFitsSystemWindows(window, true)
      WindowInsetsControllerCompat(window, window.decorView)
        .show(WindowInsetsCompat.Type.systemBars())
    }
  }

  // ------------------------------------------------------------------ pip

  override fun enterPip(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val activity = currentActivity
      if (
        activity == null ||
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
        !activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
      ) {
        promise.resolve(false)
        return@runOnUiThread
      }
      try {
        val params = PictureInPictureParams.Builder()
          .setAspectRatio(Rational(16, 9))
          .build()
        val entered = activity.enterPictureInPictureMode(params)
        if (entered) {
          emitOnPipChange(Arguments.createMap().apply { putBoolean("active", true) })
        }
        promise.resolve(entered)
      } catch (e: Exception) {
        promise.resolve(false)
      }
    }
  }

  override fun exitPip() {
    UiThreadUtil.runOnUiThread {
      // Android has no direct "leave PiP" API; bringing the task forward
      // expands the PiP window back into the full activity.
      val activity = currentActivity ?: return@runOnUiThread
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activity.isInPictureInPictureMode) {
        activity.moveTaskToBack(false)
        emitOnPipChange(Arguments.createMap().apply { putBoolean("active", false) })
      }
    }
  }

  // --------------------------------------------------- PlayerCore.Listener

  override fun onStatusChange(status: String) {
    emitOnStatusChange(Arguments.createMap().apply { putString("status", status) })
  }

  override fun onLoad(videoId: String, duration: Double, width: Int, height: Int) {
    emitOnLoad(
      Arguments.createMap().apply {
        putString("videoId", videoId)
        putDouble("duration", duration)
        putDouble("width", width.toDouble())
        putDouble("height", height.toDouble())
      }
    )
  }

  override fun onProgress(position: Double, duration: Double, buffered: Double) {
    emitOnProgress(
      Arguments.createMap().apply {
        putDouble("position", position)
        putDouble("duration", duration)
        putDouble("buffered", buffered)
      }
    )
  }

  override fun onSeek(position: Double) {
    emitOnSeek(Arguments.createMap().apply { putDouble("position", position) })
  }

  override fun onEnd() {
    emitOnEnd()
  }

  override fun onError(code: String, message: String) {
    emitOnError(
      Arguments.createMap().apply {
        putString("code", code)
        putString("message", message)
      }
    )
  }

  override fun onAttach(surfaceId: String) {
    emitOnAttach(Arguments.createMap().apply { putString("surfaceId", surfaceId) })
  }

  override fun onDetach(surfaceId: String) {
    emitOnDetach(Arguments.createMap().apply { putString("surfaceId", surfaceId) })
  }

  companion object {
    const val NAME = NativeAuVideoSpec.NAME
  }
}
