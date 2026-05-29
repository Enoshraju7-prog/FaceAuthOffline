import { Keypoint } from '../types';

// ─── Vector operations ────────────────────────────────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// ─── Eye Aspect Ratio (EAR) ───────────────────────────────────────────────────
// Measures how "open" an eye is. EAR < 0.2 → eye closed (blink).
// Landmarks follow the 6-point eye contour scheme used by dlib / MediaPipe.
export function computeEAR(eyeLandmarks: Keypoint[]): number {
  // Vertical distances
  const v1 = dist(eyeLandmarks[1], eyeLandmarks[5]);
  const v2 = dist(eyeLandmarks[2], eyeLandmarks[4]);
  // Horizontal distance
  const h = dist(eyeLandmarks[0], eyeLandmarks[3]);
  return (v1 + v2) / (2 * h + 1e-8);
}

// ─── Mouth Aspect Ratio (MAR) ─────────────────────────────────────────────────
// MAR > 0.5 after baseline subtraction → smile detected.
export function computeMAR(mouthLandmarks: Keypoint[]): number {
  // Vertical mouth opening
  const v1 = dist(mouthLandmarks[1], mouthLandmarks[7]);
  const v2 = dist(mouthLandmarks[2], mouthLandmarks[6]);
  const v3 = dist(mouthLandmarks[3], mouthLandmarks[5]);
  // Horizontal mouth width
  const h = dist(mouthLandmarks[0], mouthLandmarks[4]);
  return (v1 + v2 + v3) / (3 * h + 1e-8);
}

// ─── Head Pose Yaw Estimation ─────────────────────────────────────────────────
// Approximate yaw from nose tip and face bounding box midpoint.
// Returns yaw in degrees. Positive → turned right, negative → turned left.
export function estimateYaw(
  noseTip: Keypoint,
  leftEar: Keypoint,
  rightEar: Keypoint,
): number {
  const faceMidX = (leftEar.x + rightEar.x) / 2;
  const faceWidth = Math.abs(leftEar.x - rightEar.x);
  const offset = noseTip.x - faceMidX;
  return (offset / (faceWidth / 2 + 1e-8)) * 45; // scale to ±45°
}

// ─── Smile from lip corners ───────────────────────────────────────────────────
// Returns true if both lip corners are raised above the lip-centre baseline.
export function isSmile(
  leftCorner: Keypoint,
  rightCorner: Keypoint,
  upperLipCenter: Keypoint,
): boolean {
  const baseline = upperLipCenter.y;
  return leftCorner.y < baseline - 0.01 && rightCorner.y < baseline - 0.01;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dist(a: Keypoint, b: Keypoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function normalise(arr: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < arr.length; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm) + 1e-8;
  return Float32Array.from(arr, v => v / norm);
}
