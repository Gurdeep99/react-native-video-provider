package com.auvideo

import com.facebook.react.bridge.ReactApplicationContext

class AuVideoModule(reactContext: ReactApplicationContext) :
  NativeAuVideoSpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeAuVideoSpec.NAME
  }
}
