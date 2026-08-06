package com.video

import java.lang.ref.WeakReference

/**
 * Maps surface ids to their mounted native views. Weak references only —
 * an unmounted screen can never be leaked by the registry.
 */
object SurfaceRegistry {
  private val views = HashMap<String, WeakReference<VideoSurfaceView>>()

  fun register(surfaceId: String, view: VideoSurfaceView) {
    views[surfaceId] = WeakReference(view)
    PlayerCore.onSurfaceAvailable(surfaceId, view)
  }

  fun unregister(surfaceId: String, view: VideoSurfaceView) {
    val registered = views[surfaceId]?.get()
    if (registered == null || registered === view) {
      views.remove(surfaceId)
      PlayerCore.onSurfaceUnavailable(surfaceId, view)
    }
  }

  fun get(surfaceId: String): VideoSurfaceView? = views[surfaceId]?.get()
}
