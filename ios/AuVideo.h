#import <AuVideoSpec/AuVideoSpec.h>

/**
 * TurboModule glue. All real playback logic lives in the Swift core
 * (AuVideoPlayerCore); this class marshals calls onto the main thread and
 * forwards engine events to JS via the codegen emitters.
 */
@interface AuVideo : NSObject <NativeAuVideoSpec>

@end
