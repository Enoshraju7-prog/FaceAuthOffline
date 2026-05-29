import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import RNFS from 'react-native-fs';
import { FaceEmbedding, BoundingBox } from '../types';
import { preprocessFace } from '../utils/imageUtils';
import { cosineSimilarity, normalise } from '../utils/mathUtils';

const MODEL_FILENAME        = 'mobilefacenet_int8.tflite';
const RECOGNITION_THRESHOLD = 0.65;
const EMBEDDING_DIM         = 192;

class FaceRecognitionService {
  private model: TensorflowModel | null = null;
  private ready = false;

  async init(): Promise<void> {
    if (this.ready) return;
    const modelPath = `${RNFS.MainBundlePath}/models/${MODEL_FILENAME}`;
    this.model = await loadTensorflowModel(
      { url: `file://${modelPath}` },
      'android-gpu',
    );
    this.ready = true;
  }

  async extractEmbedding(
    rgbaPixels: Uint8Array,
    frameWidth: number,
    frameHeight: number,
    box: BoundingBox,
  ): Promise<FaceEmbedding> {
    if (!this.model) throw new Error('FaceRecognitionService not initialised');
    const input = preprocessFace(rgbaPixels, frameWidth, frameHeight, box);
    const [rawOutput] = await this.model.run([input]) as [Float32Array];
    const embedding = rawOutput.slice(0, EMBEDDING_DIM);
    return normalise(embedding);
  }

  findMatch(
    probe: FaceEmbedding,
    gallery: Array<{ userId: string; embedding: FaceEmbedding }>,
  ): { userId: string; similarity: number } | null {
    let best: { userId: string; similarity: number } | null = null;
    for (const { userId, embedding } of gallery) {
      const sim = cosineSimilarity(probe, embedding);
      if (sim > RECOGNITION_THRESHOLD && (!best || sim > best.similarity)) {
        best = { userId, similarity: sim };
      }
    }
    return best;
  }

  dispose(): void {
    this.model = null;
    this.ready = false;
  }
}

export default new FaceRecognitionService();
