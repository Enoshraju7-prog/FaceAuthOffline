import CryptoJS from 'crypto-js';
import { FaceEmbedding } from '../types';

export function serialiseEmbedding(embedding: FaceEmbedding): string {
  return JSON.stringify(Array.from(embedding));
}

export function deserialiseEmbedding(raw: string): FaceEmbedding {
  return new Float32Array(JSON.parse(raw) as number[]);
}

export function hashEmbedding(embedding: FaceEmbedding): string {
  return CryptoJS.SHA256(serialiseEmbedding(embedding)).toString();
}
