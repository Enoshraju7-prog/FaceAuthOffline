import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import RNFS from 'react-native-fs';
import { LivenessChallenge, LivenessState, BoundingBox, FaceLandmarks } from '../types';
import { computeEAR, computeMAR, estimateYaw, isSmile } from '../utils/mathUtils';
import { preprocessFace } from '../utils/imageUtils';

// MediaPipe Face Mesh landmark indices
const LEFT_EYE_IDX  = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE_IDX = [33, 160, 158, 133, 153, 144];
const MOUTH_IDX     = [61, 39, 37, 0, 267, 269, 291, 405];
const NOSE_IDX      = 1;
const L_EAR_IDX     = 234;
const R_EAR_IDX     = 454;
const U_LIP_IDX     = 13;
const L_CORNER_IDX  = 61;
const R_CORNER_IDX  = 291;

// Thresholds
const EAR_BLINK_THRESHOLD = 0.20;
const BLINK_FRAMES_NEEDED = 2;
const MAR_SMILE_THRESHOLD = 0.40;
const SMILE_FRAMES_NEEDED = 3;
const YAW_TURN_THRESHOLD  = 18; // degrees

const MODEL_FILENAME = 'facemesh_lite.tflite';
const LANDMARK_COUNT = 468;

/**
 * Passive anti-spoofing via challenge-response using MediaPipe Face Mesh.
 *
 * Three challenge types:
 *   BLINK       – EAR drops below 0.20 for ≥2 consecutive frames
 *   SMILE       – MAR rises and lip corners lift for ≥3 frames
 *   TURN_LEFT/RIGHT – Yaw exceeds ±18° for ≥2 frames
 *
 * A random sequence of 3 challenges is presented at enrolment/auth time.
 * All checks run entirely offline on-device.
 */
class LivenessService {
  private model: TensorflowModel | null = null;
  private ready = false;

  // Rolling counters reset per challenge
  private blinkFrames = 0;
  private smileFrames = 0;
  private turnFrames  = 0;

  async init(): Promise<void> {
    if (this.ready) return;
    const modelPath = `${RNFS.MainBundlePath}/models/${MODEL_FILENAME}`;
    this.model = await loadTensorflowModel({ url: `file://${modelPath}` });
    this.ready = true;
  }

  /** Generate a randomised sequence of `count` challenges (no duplicates). */
  generateChallengeSequence(count = 3): LivenessChallenge[] {
    const pool: LivenessChallenge[] = ['BLINK', 'SMILE', 'TURN_LEFT', 'TURN_RIGHT'];
    const shuffled = pool.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  /**
   * Run the Face Mesh model on one frame and extract 468 3-D landmarks.
   * Input:  [1, 192, 192, 3] float32
   * Output: [1, 468, 3] float32 (x, y in [0,1] relative to crop; z is depth)
   */
  async extractLandmarks(
    rgbaPixels: Uint8Array,
    frameWidth: number,
    frameHeight: number,
    box: BoundingBox,
  ): Promise<FaceLandmarks | null> {
    if (!this.model) return null;

    // Face Mesh needs 192×192 input – reuse preprocessFace with forced size
    const input = preprocessFace(rgbaPixels, frameWidth, frameHeight, box);
    const [raw] = await this.model.run([input]) as [Float32Array];

    if (raw.length < LANDMARK_COUNT * 3) return null;

    const landmarks: FaceLandmarks = [];
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      landmarks.push({ x: raw[i * 3], y: raw[i * 3 + 1], z: raw[i * 3 + 2] });
    }
    return landmarks;
  }

  /**
   * Evaluate one frame against the current challenge.
   * Returns true when the challenge condition has been held long enough.
   */
  evaluateFrame(landmarks: FaceLandmarks, challenge: LivenessChallenge): boolean {
    switch (challenge) {
      case 'BLINK':
        return this.checkBlink(landmarks);
      case 'SMILE':
        return this.checkSmile(landmarks);
      case 'TURN_LEFT':
        return this.checkTurn(landmarks, 'LEFT');
      case 'TURN_RIGHT':
        return this.checkTurn(landmarks, 'RIGHT');
    }
  }

  private checkBlink(lm: FaceLandmarks): boolean {
    const leftEye  = LEFT_EYE_IDX.map(i => lm[i]);
    const rightEye = RIGHT_EYE_IDX.map(i => lm[i]);
    const ear = (computeEAR(leftEye) + computeEAR(rightEye)) / 2;

    if (ear < EAR_BLINK_THRESHOLD) {
      this.blinkFrames++;
    } else {
      // Reset if eyes reopen before threshold met – prevents partial-blink pass
      if (this.blinkFrames < BLINK_FRAMES_NEEDED) this.blinkFrames = 0;
    }
    return this.blinkFrames >= BLINK_FRAMES_NEEDED;
  }

  private checkSmile(lm: FaceLandmarks): boolean {
    const mouthPts = MOUTH_IDX.map(i => lm[i]);
    const mar = computeMAR(mouthPts);
    const smile = isSmile(lm[L_CORNER_IDX], lm[R_CORNER_IDX], lm[U_LIP_IDX]);

    if (mar > MAR_SMILE_THRESHOLD && smile) {
      this.smileFrames++;
    } else {
      this.smileFrames = 0;
    }
    return this.smileFrames >= SMILE_FRAMES_NEEDED;
  }

  private checkTurn(lm: FaceLandmarks, direction: 'LEFT' | 'RIGHT'): boolean {
    const yaw = estimateYaw(lm[NOSE_IDX], lm[L_EAR_IDX], lm[R_EAR_IDX]);
    const turned =
      direction === 'LEFT' ? yaw < -YAW_TURN_THRESHOLD : yaw > YAW_TURN_THRESHOLD;

    if (turned) {
      this.turnFrames++;
    } else {
      this.turnFrames = 0;
    }
    return this.turnFrames >= 2;
  }

  /** Reset per-challenge counters between challenges. */
  resetCounters(): void {
    this.blinkFrames = 0;
    this.smileFrames = 0;
    this.turnFrames  = 0;
  }

  dispose(): void {
    this.model = null;
    this.ready = false;
  }
}

export default new LivenessService();
