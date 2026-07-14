import Foundation
import UIKit

/// Fullscreen + forced-orientation coordination.
///
/// iOS decides allowed orientations by asking the AppDelegate. For rotation
/// to unlock only while the player is fullscreen (and for `setOrientation`
/// locks to apply), the host app forwards that question here (see README):
///
/// ```swift
/// func application(_ application: UIApplication,
///                  supportedInterfaceOrientationsFor window: UIWindow?)
///     -> UIInterfaceOrientationMask {
///   return AuVideoOrientation.mask(withDefault: .portrait)
/// }
/// ```
@objc(AuVideoOrientation)
public final class AuVideoOrientation: NSObject {

  @objc public private(set) static var isFullscreenActive = false

  /// Orientations allowed while fullscreen. Default: everything but upside-down.
  @objc public static var fullscreenMask: UIInterfaceOrientationMask = .allButUpsideDown

  /// Explicit lock. Empty = no lock. Wins over both the app default and the
  /// fullscreen unlock.
  @objc public private(set) static var lockMask: UIInterfaceOrientationMask = []

  /// Call from AppDelegate's supportedInterfaceOrientationsFor.
  @objc(maskWithDefault:)
  public static func mask(
    withDefault defaultMask: UIInterfaceOrientationMask
  ) -> UIInterfaceOrientationMask {
    if !lockMask.isEmpty {
      return lockMask
    }
    return isFullscreenActive ? fullscreenMask : defaultMask
  }

  /// Enter fullscreen and apply `orientation` in the same call — never as a
  /// separate follow-up — so there is no unlocked frame where the sensor
  /// could win before the lock takes effect.
  /// Values: auto | portrait | inverted-portrait | landscape | inverted-landscape
  @objc(enterFullscreen:)
  public static func enterFullscreen(_ orientation: String) {
    isFullscreenActive = true
    lockMask = maskFor(orientation)
    applyCurrent()
  }

  /// Exit fullscreen, restoring `orientation` atomically (same value semantics).
  @objc(exitFullscreen:)
  public static func exitFullscreen(_ orientation: String) {
    isFullscreenActive = false
    lockMask = maskFor(orientation)
    applyCurrent()
  }

  /// Force a screen orientation until cleared with "auto", independent of
  /// fullscreen. (Upside-down portrait is ignored on iPhones without a home
  /// button.)
  @objc(setOrientation:)
  public static func setOrientation(_ orientation: String) {
    lockMask = maskFor(orientation)
    applyCurrent()
  }

  private static func maskFor(_ orientation: String) -> UIInterfaceOrientationMask {
    // "landscape" = device top pointing left (interface landscapeRight),
    // matching Android's SCREEN_ORIENTATION_LANDSCAPE; "inverted-" is the
    // 180° rotation of each.
    switch orientation {
    case "portrait":
      return .portrait
    case "inverted-portrait":
      return .portraitUpsideDown
    case "landscape":
      return .landscapeRight
    case "inverted-landscape":
      return .landscapeLeft
    default:
      return []
    }
  }

  /// Re-query supported orientations and rotate to whatever now applies:
  /// the lock if set, free rotation while fullscreen, else back to portrait
  /// (portrait-locked apps are the common host).
  private static func applyCurrent() {
    if !lockMask.isEmpty {
      refresh(rotatingTo: lockMask)
    } else {
      refresh(rotatingTo: isFullscreenActive ? nil : .portrait)
    }
  }

  private static func refresh(rotatingTo mask: UIInterfaceOrientationMask?) {
    DispatchQueue.main.async {
      if #available(iOS 16.0, *) {
        for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
          scene.keyWindow?.rootViewController?
            .setNeedsUpdateOfSupportedInterfaceOrientations()
          if let mask {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask), errorHandler: { _ in })
          }
        }
      } else {
        if let device = legacyDeviceOrientation(for: mask) {
          UIDevice.current.setValue(device.rawValue, forKey: "orientation")
        }
        UIViewController.attemptRotationToDeviceOrientation()
      }
    }
  }

  private static func legacyDeviceOrientation(
    for mask: UIInterfaceOrientationMask?
  ) -> UIDeviceOrientation? {
    guard let mask else { return nil }
    if mask.contains(.portrait) { return .portrait }
    if mask.contains(.portraitUpsideDown) { return .portraitUpsideDown }
    // Interface landscapeRight is device landscapeLeft, and vice versa.
    if mask.contains(.landscapeRight) { return .landscapeLeft }
    if mask.contains(.landscapeLeft) { return .landscapeRight }
    return nil
  }
}
