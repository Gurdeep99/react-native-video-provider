#import <VideoSpec/VideoSpec.h>

/**
 * TurboModule glue. All real playback logic lives in the Swift core
 * (VideoPlayerCore); this class marshals calls onto the main thread and
 * forwards engine events to JS via the codegen emitters.
 */
@interface Video : NativeVideoSpecBase <NativeVideoSpec>

@end
