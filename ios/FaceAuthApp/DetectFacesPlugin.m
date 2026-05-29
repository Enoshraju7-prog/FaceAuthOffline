// Objective-C bridge that registers DetectFacesPlugin with VisionCamera's
// Frame Processor plugin registry so it is accessible from JS worklets.
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>

// Swift class is accessed via the generated -Swift.h header.
#import "FaceAuthOffline-Swift.h"

VISION_EXPORT_SWIFT_FRAME_PROCESSOR(DetectFacesPlugin, detectFaces)
