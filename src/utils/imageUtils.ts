import { BoundingBox } from '../types';

const INPUT_SIZE = 112; // MobileFaceNet expects 112×112

/**
 * Crop the face region from a raw RGBA frame, resize it to 112×112,
 * and return a normalised Float32Array in CHW format (RGB, [-1, 1]).
 *
 * In production this runs inside a Vision Camera Frame Processor plugin
 * written in C++/Swift/Kotlin so it stays on the camera thread.
 * This TypeScript version is the reference implementation used in tests
 * and the JS fallback path.
 */
export function preprocessFace(
  rgbaPixels: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  box: BoundingBox,
): Float32Array {
  const { x, y, width, height } = padBoundingBox(box, frameWidth, frameHeight, 0.2);

  const output = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const xScale = width / INPUT_SIZE;
  const yScale = height / INPUT_SIZE;

  for (let row = 0; row < INPUT_SIZE; row++) {
    for (let col = 0; col < INPUT_SIZE; col++) {
      const srcX = Math.round(x + col * xScale);
      const srcY = Math.round(y + row * yScale);
      const srcIdx = (srcY * frameWidth + srcX) * 4;

      const r = rgbaPixels[srcIdx] / 127.5 - 1;
      const g = rgbaPixels[srcIdx + 1] / 127.5 - 1;
      const b = rgbaPixels[srcIdx + 2] / 127.5 - 1;

      const dstOffset = row * INPUT_SIZE + col;
      output[dstOffset] = r;
      output[INPUT_SIZE * INPUT_SIZE + dstOffset] = g;
      output[2 * INPUT_SIZE * INPUT_SIZE + dstOffset] = b;
    }
  }

  return output;
}

/**
 * Expand a bounding box by `padding` fraction of its dimensions,
 * clamped to the frame boundaries.
 */
export function padBoundingBox(
  box: BoundingBox,
  frameW: number,
  frameH: number,
  padding: number,
): BoundingBox {
  const padW = box.width * padding;
  const padH = box.height * padding;
  const x = Math.max(0, box.x - padW);
  const y = Math.max(0, box.y - padH);
  const w = Math.min(frameW - x, box.width + padW * 2);
  const h = Math.min(frameH - y, box.height + padH * 2);
  return { x, y, width: w, height: h };
}

/** Convert absolute pixel box to [0,1] normalised coords. */
export function normaliseBoundingBox(
  box: BoundingBox,
  frameW: number,
  frameH: number,
): BoundingBox {
  return {
    x: box.x / frameW,
    y: box.y / frameH,
    width: box.width / frameW,
    height: box.height / frameH,
  };
}

/** Decode raw BlazeFace output tensor to BoundingBox + keypoints. */
export function decodeBlazeFaceOutput(
  regressors: Float32Array,
  anchors: Float32Array,
  confidences: Float32Array,
  frameW: number,
  frameH: number,
  threshold = 0.75,
): Array<{ box: BoundingBox; score: number; keypoints: Array<{ x: number; y: number }> }> {
  const detections: Array<{ box: BoundingBox; score: number; keypoints: Array<{ x: number; y: number }> }> = [];
  const numAnchors = confidences.length;

  for (let i = 0; i < numAnchors; i++) {
    const score = sigmoid(confidences[i]);
    if (score < threshold) continue;

    const base = i * 16;
    const cx = regressors[base] / frameW + anchors[i * 4];
    const cy = regressors[base + 1] / frameH + anchors[i * 4 + 1];
    const w  = regressors[base + 2] / frameW;
    const h  = regressors[base + 3] / frameH;

    const kps = [];
    for (let k = 0; k < 6; k++) {
      kps.push({
        x: regressors[base + 4 + k * 2]     / frameW + anchors[i * 4],
        y: regressors[base + 4 + k * 2 + 1] / frameH + anchors[i * 4 + 1],
      });
    }

    detections.push({
      box: { x: (cx - w / 2) * frameW, y: (cy - h / 2) * frameH, width: w * frameW, height: h * frameH },
      score,
      keypoints: kps,
    });
  }

  return nonMaxSuppression(detections, 0.3);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function iou(a: BoundingBox, b: BoundingBox): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return inter / (union + 1e-8);
}

function nonMaxSuppression<T extends { box: BoundingBox; score: number }>(
  dets: T[],
  iouThreshold: number,
): T[] {
  dets.sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  const suppressed = new Set<number>();
  for (let i = 0; i < dets.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(dets[i]);
    for (let j = i + 1; j < dets.length; j++) {
      if (iou(dets[i].box, dets[j].box) > iouThreshold) suppressed.add(j);
    }
  }
  return kept;
}
