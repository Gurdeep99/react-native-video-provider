#import "AuVideoSurfaceView.h"

#import <react/renderer/components/AuVideoSpec/ComponentDescriptors.h>
#import <react/renderer/components/AuVideoSpec/Props.h>
#import <react/renderer/components/AuVideoSpec/RCTComponentViewHelpers.h>

#import <React/RCTConversions.h>

#if __has_include(<AuVideo/AuVideo-Swift.h>)
#import <AuVideo/AuVideo-Swift.h>
#else
#import "AuVideo-Swift.h"
#endif

using namespace facebook::react;

@interface AuVideoSurfaceView () <RCTAuVideoSurfaceViewViewProtocol>
@end

@implementation AuVideoSurfaceView {
  NSString *_surfaceId;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<AuVideoSurfaceViewComponentDescriptor>();
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &newViewProps = *std::static_pointer_cast<AuVideoSurfaceViewProps const>(props);
  NSString *newSurfaceId = RCTNSStringFromStringNilIfEmpty(newViewProps.surfaceId);

  if (![newSurfaceId isEqualToString:_surfaceId]) {
    if (_surfaceId != nil) {
      [AuVideoSurfaceRegistry unregisterSurface:_surfaceId view:self];
    }
    _surfaceId = newSurfaceId;
    if (_surfaceId != nil) {
      [AuVideoSurfaceRegistry registerSurface:_surfaceId view:self];
    }
  }

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  if (_surfaceId != nil) {
    [AuVideoSurfaceRegistry unregisterSurface:_surfaceId view:self];
    _surfaceId = nil;
  }
}

@end

Class<RCTComponentViewProtocol> AuVideoSurfaceViewCls(void)
{
  return AuVideoSurfaceView.class;
}
