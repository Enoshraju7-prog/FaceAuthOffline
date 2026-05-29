// ─── Core domain types ────────────────────────────────────────────────────────

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Keypoint {
  x: number;
  y: number;
}

/** 6 BlazeFace keypoints: rightEye, leftEye, nose, mouth, rightEar, leftEar */
export interface FaceDetection {
  boundingBox: BoundingBox;
  keypoints: Keypoint[];
  confidence: number;
}

/** 192-dimensional embedding from MobileFaceNet */
export type FaceEmbedding = Float32Array;

/** 468 3-D landmark positions from MediaPipe Face Mesh */
export type FaceLandmarks = Array<{ x: number; y: number; z: number }>;

// ─── Liveness ─────────────────────────────────────────────────────────────────

export type LivenessChallenge = 'BLINK' | 'SMILE' | 'TURN_LEFT' | 'TURN_RIGHT';

export interface LivenessState {
  currentChallenge: LivenessChallenge;
  challengeIndex: number;
  totalChallenges: number;
  completed: boolean;
  failed: boolean;
  timeoutMs: number;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export interface UserRecord {
  id: string;
  name: string;
  employeeId: string;
  department: string;
  enrolledAt: number;
  embeddingHash: string;
}

export interface FaceEmbeddingRecord {
  id: string;
  userId: string;
  embedding: string;     // JSON-serialised Float32Array
  createdAt: number;
}

export interface AuthSession {
  id: string;
  userId: string;
  timestamp: number;
  location?: string;
  livenessScore: number;
  recognitionScore: number;
  synced: number;        // 0 = pending, 1 = synced
  deviceId: string;
}

export interface SyncQueueItem {
  id: string;
  sessionId: string;
  payload: string;       // JSON
  attempts: number;
  lastAttempt: number;
  createdAt: number;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Home: undefined;
  Enroll: undefined;
  Auth: undefined;
  Admin: undefined;
};

// ─── AWS / Sync ───────────────────────────────────────────────────────────────

export interface SyncPayload {
  deviceId: string;
  sessions: AuthSession[];
  syncedAt: number;
}

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  error?: string;
}

// ─── App context ──────────────────────────────────────────────────────────────

export interface AppState {
  isOnline: boolean;
  pendingSyncCount: number;
  lastSyncAt: number | null;
  enrolledUserCount: number;
}
