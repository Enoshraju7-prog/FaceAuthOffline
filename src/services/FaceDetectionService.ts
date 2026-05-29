import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import RNFS from 'react-native-fs';
import { FaceDetection, BoundingBox } from '../types';
import { decodeBlazeFaceOutput } from '../utils/imageUtils';

const MODEL_FILENAME = 'blazeface.tflite';
const ANCHOR_FILENAME = 'blazeface_anchors.bin';
const SCORE_THRESHOLD = 0.75;
const INPUT_W = 128;
const INPUT_H = 128;

/**
 * Wraps the BlazeFace TFLite model (~0.6 MB).
 *
 * Model I/O:
 *   Input  : [1, 128, 128, 3] float32, pixels normalised to [-1, 1]
 *   Output : regressors [1, 896, 16] + scores [1, 896, 1]
 *
 * Pre-computed anchor centroids are stored as a flat binary Float32 array
 * alongside the model in assets/models/.
 */
class FaceDetectionService {
  private model: TensorflowModel | null = null;
  private anchors: Float32Array | null = null;
  private ready = false;

  async init(): Promise<void> {
    if (this.ready) return;

    const modelPath = `${RNFS.MainBundlePath}/models/${MODEL_FILENAME}`;
    const anchorPath = `${RNFS.MainBundlePath}/models/${ANCHOR_FILENAME}`;

    this.model = await loadTensorflowModel({ url: `file://${modelPath}` });

    const anchorBase64 = await RNFS.readFile(anchorPath, 'base64');
    const buf = Buffer.from(anchorBase64, 'base64');
    this.anchors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

    this.ready = true;
  }

  /**
   * Detect faces in a single camera frame.
   *
   * @param rgbaPixels  Raw RGBA bytes from the frame processor (128×128 after resize)
   * @param frameWidth  Original frame width (for coordinate rescaling)
   * @param frameHeight Original frame height
   */
  async detect(
    rgbaPixels: Uint8Array,
    frameWidth: number,
    frameHeight: number,
  ): Promise<FaceDetection[]> {
    if (!this.model || !this.anchors) throw new Error('FaceDetectionService not initialised');

    // Normalise to [-1, 1] and convert RGBA → RGB float32
    const input = new Float32Array(INPUT_W * INPUT_H * 3);
    for (let i = 0; i < INPUT_W * INPUT_H; i++) {
      input[i * 3]     = rgbaPixels[i * 4]     / 127.5 - 1; // R
      input[i * 3 + 1] = rgbaPixels[i * 4 + 1] / 127.5 - 1; // G
      input[i * 3 + 2] = rgbaPixels[i * 4 + 2] / 127.5 - 1; // B
    }

    const [regressors, scores] = await this.model.run([input]) as [Float32Array, Float32Array];

    const rawDetections = decodeBlazeFaceOutput(
      regressors,
      this.anchors,
      scores,
      INPUT_W,
      INPUT_H,
      SCORE_THRESHOLD,
    );

    // Rescale coordinates back to original frame dimensions
    const scaleX = frameWidth / INPUT_W;
    const scaleY = frameHeight / INPUT_H;

    return rawDetections.map(det => ({
      boundingBox: {
        x: det.box.x * scaleX,
        y: det.box.y * scaleY,
        width: det.box.width * scaleX,
        height: det.box.height * scaleY,
      } as BoundingBox,
      keypoints: det.keypoints.map(kp => ({ x: kp.x * scaleX, y: kp.y * scaleY })),
      confidence: det.score,
    }));
  }

  /** Returns true only when exactly one face is detected at acceptable size. */
  isSingleFaceValid(detections: FaceDetection[], frameW: number, frameH: number): boolean {
    if (detections.length !== 1) return false;
    const { width, height } = detections[0].boundingBox;
    const minFraction = 0.15;
    return width / frameW > minFraction && height / frameH > minFraction;
  }

  dispose(): void {
    this.model = null;
    this.ready = false;
  }
}

export default new FaceDetectionService();
