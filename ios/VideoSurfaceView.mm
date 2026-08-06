#import "VideoSurfaceView.h"

#import <react/renderer/components/VideoSpec/ComponentDescriptors.h>
#import <react/renderer/components/VideoSpec/Props.h>
#import <react/renderer/components/VideoSpec/RCTComponentViewHelpers.h>

#import <React/RCTConversions.h>

#import <AVKit/AVKit.h>
// Must precede Video-Swift.h — see the note in Video.mm.
#import <WebKit/WebKit.h>

#if __has_include(<Video/Video-Swift.h>)
#import <Video/Video-Swift.h>
#else
#import "Video-Swift.h"
#endif

using namespace facebook::react;

@interface VideoSurfaceView () <RCTVideoSurfaceViewViewProtocol>
@end

@implementation VideoSurfaceView {
  NSString *_surfaceId;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<VideoSurfaceViewComponentDescriptor>();
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &newViewProps = *std::static_pointer_cast<VideoSurfaceViewProps const>(props);
  NSString *newSurfaceId = RCTNSStringFromStringNilIfEmpty(newViewProps.surfaceId);

  if (![newSurfaceId isEqualToString:_surfaceId]) {
    if (_surfaceId != nil) {
      [VideoSurfaceRegistry unregisterSurface:_surfaceId view:self];
    }
    _surfaceId = newSurfaceId;
    if (_surfaceId != nil) {
      [VideoSurfaceRegistry registerSurface:_surfaceId view:self];
    }
  }

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  if (_surfaceId != nil) {
    [VideoSurfaceRegistry unregisterSurface:_surfaceId view:self];
    _surfaceId = nil;
  }
}

@end

Class<RCTComponentViewProtocol> VideoSurfaceViewCls(void)
{
  return VideoSurfaceView.class;
}
