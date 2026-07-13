package com.auvideo

import android.content.Context
import android.view.View
import android.widget.FrameLayout

/**
 * A dumb mount point the player view gets re-parented into. Does not create
 * or own any player resources.
 */
class AuVideoSurfaceView(context: Context) : FrameLayout(context) {

  var surfaceId: String? = null
    set(value) {
      if (field == value) return
      field?.let { SurfaceRegistry.unregister(it, this) }
      field = value
      value?.let { SurfaceRegistry.register(it, this) }
    }

  // RN lays this view out itself; children added natively (the player view)
  // would otherwise never get measured. Standard measure-and-layout relay.
  private val measureAndLayout = Runnable {
    measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
    )
    layout(left, top, right, bottom)
  }

  override fun requestLayout() {
    super.requestLayout()
    post(measureAndLayout)
  }

  override fun onViewAdded(child: View?) {
    super.onViewAdded(child)
    post(measureAndLayout)
  }
}
