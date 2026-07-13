import Foundation
import UIKit

/// Fullscreen orientation coordination.
///
/// iOS decides allowed orientations by asking the AppDelegate. For rotation
/// to unlock only while the player is fullscreen, the host app forwards that
/// question here (see README):
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

  /// Call from AppDelegate's supportedInterfaceOrientationsFor.
  @objc(maskWithDefault:)
  public static func mask(
    withDefault defaultMask: UIInterfaceOrientationMask
  ) -> UIInterfaceOrientationMask {
    return isFullscreenActive ? fullscreenMask : defaultMask
  }

  @objc public static func setFullscreen(_ active: Bool) {
    guard isFullscreenActive != active else { return }
    isFullscreenActive = active
    refresh()
  }

  /// Makes the system re-query supported orientations; when exiting
  /// fullscreen in a portrait-locked app this also rotates back.
  private static func refresh() {
    DispatchQueue.main.async {
      if #available(iOS 16.0, *) {
        for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
          scene.keyWindow?.rootViewController?
            .setNeedsUpdateOfSupportedInterfaceOrientations()
          if !isFullscreenActive {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait), errorHandler: { _ in })
          }
        }
      } else {
        if !isFullscreenActive {
          UIDevice.current.setValue(UIInterfaceOrientation.portrait.rawValue, forKey: "orientation")
        }
        UIViewController.attemptRotationToDeviceOrientation()
      }
    }
  }
}
