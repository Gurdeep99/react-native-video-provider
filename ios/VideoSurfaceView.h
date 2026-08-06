#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Fabric component view for <VideoSurface>. A dumb mount point: registers
 * itself in the surface registry under its surfaceId prop; the singleton
 * player's host view gets re-parented into it by the core.
 */
@interface AuVideoSurfaceView : RCTViewComponentView

@end

NS_ASSUME_NONNULL_END
