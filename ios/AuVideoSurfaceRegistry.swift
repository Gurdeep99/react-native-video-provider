import Foundation
import UIKit

/// Maps surface ids to their mounted container views. Weak references only —
/// an unmounted screen can never be leaked by the registry.
@objc(AuVideoSurfaceRegistry)
public final class AuVideoSurfaceRegistry: NSObject {

  private static let views = NSMapTable<NSString, UIView>.strongToWeakObjects()

  @objc(registerSurface:view:)
  public static func register(_ surfaceId: String, view: UIView) {
    views.setObject(view, forKey: surfaceId as NSString)
    AuVideoPlayerCore.shared.onSurfaceAvailable(surfaceId, view: view)
  }

  @objc(unregisterSurface:view:)
  public static func unregister(_ surfaceId: String, view: UIView) {
    let registered = views.object(forKey: surfaceId as NSString)
    if registered == nil || registered === view {
      views.removeObject(forKey: surfaceId as NSString)
      AuVideoPlayerCore.shared.onSurfaceUnavailable(surfaceId, view: view)
    }
  }

  @objc(viewForSurface:)
  public static func view(for surfaceId: String) -> UIView? {
    return views.object(forKey: surfaceId as NSString)
  }
}
