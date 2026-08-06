package com.video

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.viewmanagers.VideoSurfaceViewManagerDelegate
import com.facebook.react.viewmanagers.VideoSurfaceViewManagerInterface

@ReactModule(name = VideoSurfaceViewManager.NAME)
class VideoSurfaceViewManager :
  SimpleViewManager<VideoSurfaceView>(),
  VideoSurfaceViewManagerInterface<VideoSurfaceView> {

  private val delegate = VideoSurfaceViewManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<VideoSurfaceView> = delegate

  override fun getName(): String = NAME

  override fun createViewInstance(context: ThemedReactContext): VideoSurfaceView =
    VideoSurfaceView(context)

  @ReactProp(name = "surfaceId")
  override fun setSurfaceId(view: VideoSurfaceView, value: String?) {
    view.surfaceId = value
  }

  override fun onDropViewInstance(view: VideoSurfaceView) {
    view.surfaceId = null
    super.onDropViewInstance(view)
  }

  companion object {
    const val NAME = "VideoSurfaceView"
  }
}
