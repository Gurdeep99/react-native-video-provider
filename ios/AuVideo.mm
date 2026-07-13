#import "AuVideo.h"

#import <AVKit/AVKit.h>

#if __has_include(<AuVideo/AuVideo-Swift.h>)
#import <AuVideo/AuVideo-Swift.h>
#else
#import "AuVideo-Swift.h"
#endif

using JS::NativeAuVideo::NativeVideoSource;

static AuVideoSourceSpec *AuVideoParseSource(NativeVideoSource &source)
{
  NSMutableDictionary<NSString *, NSString *> *headers = [NSMutableDictionary new];
  if ([source.headers() isKindOfClass:[NSDictionary class]]) {
    [(NSDictionary *)source.headers()
        enumerateKeysAndObjectsUsingBlock:^(id key, id value, BOOL *stop) {
          if ([key isKindOfClass:[NSString class]] && [value isKindOfClass:[NSString class]]) {
            headers[key] = value;
          }
        }];
  }
  return [[AuVideoSourceSpec alloc] initWithVideoId:source.id_()
                                                uri:source.uri()
                                            headers:headers
                                              title:source.title()
                                             artist:source.artist()
                                         artworkUri:source.artworkUri()
                                      startPosition:source.startPosition().value_or(0)];
}

@interface AuVideo () <AuVideoCoreDelegate>
@end

@implementation AuVideo

+ (NSString *)moduleName
{
  return @"AuVideo";
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeAuVideoSpecJSI>(params);
}

#pragma mark - Lifecycle

- (void)nativeInit
{
  dispatch_async(dispatch_get_main_queue(), ^{
    AuVideoPlayerCore.shared.delegate = self;
    [AuVideoPlayerCore.shared initialize];
  });
}

- (void)releasePlayer
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [AuVideoPlayerCore.shared releasePlayer];
  });
}

#pragma mark - Source

- (void)setSource:(NativeVideoSource &)source autoplay:(BOOL)autoplay
{
  AuVideoSourceSpec *spec = AuVideoParseSource(source);
  dispatch_async(dispatch_get_main_queue(), ^{
    [AuVideoPlayerCore.shared setSource:spec autoplay:autoplay];
  });
}

- (void)preload:(NativeVideoSource &)source
{
  AuVideoSourceSpec *spec = AuVideoParseSource(source);
  dispatch_async(dispatch_get_main_queue(), ^{
    [AuVideoPlayerCore.shared preload:spec];
  });
}

#pragma mark - Commands

- (void)play
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoPlayerCore.shared play]; });
}

- (void)pause
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoPlayerCore.shared pause]; });
}

- (void)stop
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoPlayerCore.shared stop]; });
}

- (void)seekTo:(double)position
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoPlayerCore.shared seekTo:position]; });
}

- (void)setRate:(double)rate
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoPlayerCore.shared setRate:rate]; });
}

- (void)setVolume:(double)volume
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoPlayerCore.shared setVolume:volume]; });
}

- (void)setMuted:(BOOL)muted
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoPlayerCore.shared setMuted:muted]; });
}

- (void)setRepeat:(BOOL)repeat
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoPlayerCore.shared setRepeat:repeat]; });
}

- (void)setResizeMode:(NSString *)mode
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoPlayerCore.shared setResizeMode:mode]; });
}

- (void)getPosition:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    resolve(@([AuVideoPlayerCore.shared positionSeconds]));
  });
}

#pragma mark - Surfaces

- (void)attach:(NSString *)surfaceId
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoPlayerCore.shared attach:surfaceId]; });
}

- (void)detach
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoPlayerCore.shared detach]; });
}

#pragma mark - Fullscreen

- (void)enterFullscreen
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoOrientation setFullscreen:YES]; });
}

- (void)exitFullscreen
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoOrientation setFullscreen:NO]; });
}

- (void)setOrientation:(NSString *)orientation
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoOrientation setOrientation:orientation]; });
}

#pragma mark - PiP

- (void)enterPip:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  dispatch_async(dispatch_get_main_queue(), ^{
    resolve(@([AuVideoPlayerCore.shared enterPip]));
  });
}

- (void)exitPip
{
  dispatch_async(dispatch_get_main_queue(), ^{ [AuVideoPlayerCore.shared exitPip]; });
}

#pragma mark - AuVideoCoreDelegate

- (void)onStatusChange:(NSString *)status
{
  [self emitOnStatusChange:@{@"status": status}];
}

- (void)onLoad:(NSString *)videoId duration:(double)duration width:(double)width height:(double)height
{
  [self emitOnLoad:@{
    @"videoId": videoId,
    @"duration": @(duration),
    @"width": @(width),
    @"height": @(height),
  }];
}

- (void)onProgress:(double)position duration:(double)duration buffered:(double)buffered
{
  [self emitOnProgress:@{
    @"position": @(position),
    @"duration": @(duration),
    @"buffered": @(buffered),
  }];
}

- (void)onSeek:(double)position
{
  [self emitOnSeek:@{@"position": @(position)}];
}

- (void)onEnd
{
  [self emitOnEnd];
}

- (void)onError:(NSString *)code message:(NSString *)message
{
  [self emitOnError:@{@"code": code, @"message": message}];
}

- (void)onAttach:(NSString *)surfaceId
{
  [self emitOnAttach:@{@"surfaceId": surfaceId}];
}

- (void)onDetach:(NSString *)surfaceId
{
  [self emitOnDetach:@{@"surfaceId": surfaceId}];
}

- (void)onPipChange:(BOOL)active
{
  [self emitOnPipChange:@{@"active": @(active)}];
}

@end
