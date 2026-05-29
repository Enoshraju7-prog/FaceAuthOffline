import React, { useRef, useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useFrameProcessor,
  Frame,
} from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';
import { BoundingBox, FaceDetection } from '../types';

interface FaceCameraProps {
  onFaceDetected: (detections: FaceDetection[]) => void;
  onFrame?: (frame: Frame) => void;
  overlayChildren?: React.ReactNode;
}

/**
 * Camera component that feeds every frame to the BlazeFace detector.
 *
 * Vision Camera v3 Frame Processors run on a dedicated C++ thread, so
 * heavy TFLite inference does NOT block the JS thread.
 *
 * In a production build, face detection runs as a Frame Processor Plugin
 * (native Swift/Kotlin module) that returns bounding boxes directly.
 * This component provides the React-side wire-up.
 */
const FaceCamera: React.FC<FaceCameraProps> = ({
  onFaceDetected,
  onFrame,
  overlayChildren,
}) => {
  const device = useCameraDevice('front');
  const cameraRef = useRef<Camera>(null);

  const handleDetections = useCallback(
    (detections: FaceDetection[]) => {
      onFaceDetected(detections);
    },
    [onFaceDetected],
  );

  // Frame processor: runs on the camera thread (C++/JSI) in production.
  // The 'detectFaces' plugin is a VisionCamera Frame Processor plugin
  // compiled into the native module (android/ios folders).
  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      // detectFaces is a Frame Processor Plugin registered natively
      // It returns { detections: FaceDetection[], frameWidth, frameHeight }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (global as any).detectFaces(frame) as {
        detections: FaceDetection[];
      };

      if (result?.detections) {
        runOnJS(handleDetections)(result.detections);
      }
      if (onFrame) {
        runOnJS(onFrame)(frame);
      }
    },
    [handleDetections, onFrame],
  );

  if (!device) return null;

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
      />
      {overlayChildren}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});

export default FaceCamera;
