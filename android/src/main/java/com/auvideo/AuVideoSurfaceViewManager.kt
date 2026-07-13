package com.auvideo

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.viewmanagers.AuVideoSurfaceViewManagerDelegate
import com.facebook.react.viewmanagers.AuVideoSurfaceViewManagerInterface

@ReactModule(name = AuVideoSurfaceViewManager.NAME)
class AuVideoSurfaceViewManager :
  SimpleViewManager<AuVideoSurfaceView>(),
  AuVideoSurfaceViewManagerInterface<AuVideoSurfaceView> {

  private val delegate = AuVideoSurfaceViewManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<AuVideoSurfaceView> = delegate

  override fun getName(): String = NAME

  override fun createViewInstance(context: ThemedReactContext): AuVideoSurfaceView =
    AuVideoSurfaceView(context)

  @ReactProp(name = "surfaceId")
  override fun setSurfaceId(view: AuVideoSurfaceView, value: String?) {
    view.surfaceId = value
  }

  override fun onDropViewInstance(view: AuVideoSurfaceView) {
    view.surfaceId = null
    super.onDropViewInstance(view)
  }

  companion object {
    const val NAME = "AuVideoSurfaceView"
  }
}
