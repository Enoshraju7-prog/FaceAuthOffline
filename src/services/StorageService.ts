import SQLite, { SQLiteDatabase } from 'react-native-sqlite-storage';
import { v4 as uuidv4 } from 'uuid';
import CryptoJS from 'crypto-js';
import {
  UserRecord,
  AuthSession,
  SyncQueueItem,
  FaceEmbedding,
} from '../types';
import { serialiseEmbedding, deserialiseEmbedding, hashEmbedding } from '../utils/embeddingUtils';

SQLite.enablePromise(true);

const DB_NAME         = 'faceauth.db';
const DB_VERSION      = '1.0';
const DB_DISPLAY_NAME = 'FaceAuth Offline DB';
const DB_SIZE         = 5 * 1024 * 1024;

let encryptionKey = 'CHANGE_ME_DERIVE_FROM_DEVICE_ID';

class StorageService {
  private db: SQLiteDatabase | null = null;

  async init(key: string): Promise<void> {
    encryptionKey = key;
    this.db = await SQLite.openDatabase({ name: DB_NAME, location: 'default' });
    await this.createTables();
  }

  private async createTables(): Promise<void> {
    const db = this.requireDb();
    await db.executeSql(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, employee_id TEXT NOT NULL UNIQUE,
      department TEXT, enrolled_at INTEGER NOT NULL, emb_hash TEXT NOT NULL);`);
    await db.executeSql(`CREATE TABLE IF NOT EXISTS face_embeddings (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, embedding TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id));`);
    await db.executeSql(`CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, timestamp INTEGER NOT NULL, location TEXT,
      liveness_score REAL NOT NULL, recognition_score REAL NOT NULL,
      synced INTEGER DEFAULT 0, device_id TEXT NOT NULL);`);
    await db.executeSql(`CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL,
      attempts INTEGER DEFAULT 0, last_attempt INTEGER DEFAULT 0, created_at INTEGER NOT NULL);`);
    await db.executeSql('CREATE INDEX IF NOT EXISTS idx_sessions_synced ON auth_sessions(synced);');
    await db.executeSql('CREATE INDEX IF NOT EXISTS idx_emb_user ON face_embeddings(user_id);');
  }

  // ─── Users ──────────────────────────────────────────────────────────────────

  async enrollUser(
    name: string,
    employeeId: string,
    department: string,
    embedding: FaceEmbedding,
  ): Promise<UserRecord> {
    const db = this.requireDb();
    const id = uuidv4(), now = Date.now();
    const embHash = hashEmbedding(embedding);

    await db.executeSql(
      'INSERT INTO users (id, name, employee_id, department, enrolled_at, emb_hash) VALUES (?,?,?,?,?,?)',
      [id, name, employeeId, department, now, embHash],
    );
    await this.saveEmbedding(id, embedding);
    return { id, name, employeeId, department, enrolledAt: now, embeddingHash: embHash };
  }

  async getAllUsers(): Promise<UserRecord[]> {
    const db = this.requireDb();
    const [result] = await db.executeSql('SELECT * FROM users ORDER BY name;');
    return rowsToArray<UserRecord>(result.rows, (row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.name as string,
      employeeId: row.employee_id as string,
      department: row.department as string,
      enrolledAt: row.enrolled_at as number,
      embeddingHash: row.emb_hash as string,
    }));
  }

  async deleteUser(userId: string): Promise<void> {
    const db = this.requireDb();
    await db.executeSql('DELETE FROM face_embeddings WHERE user_id = ?', [userId]);
    await db.executeSql('DELETE FROM users WHERE id = ?', [userId]);
  }

  // ─── Embeddings ─────────────────────────────────────────────────────────────

  private async saveEmbedding(userId: string, embedding: FaceEmbedding): Promise<void> {
    const db = this.requireDb();
    const id = uuidv4(), now = Date.now();
    const serialised = serialiseEmbedding(embedding);
    const encrypted  = CryptoJS.AES.encrypt(serialised, encryptionKey).toString();
    await db.executeSql(
      'INSERT INTO face_embeddings (id, user_id, embedding, created_at) VALUES (?,?,?,?)',
      [id, userId, encrypted, now],
    );
  }

  async loadAllEmbeddings(): Promise<Array<{ userId: string; embedding: FaceEmbedding }>> {
    const db = this.requireDb();
    const [result] = await db.executeSql('SELECT user_id, embedding FROM face_embeddings;');
    const gallery: Array<{ userId: string; embedding: FaceEmbedding }> = [];
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows.item(i) as Record<string, unknown>;
      const decrypted = CryptoJS.AES
        .decrypt(row.embedding as string, encryptionKey)
        .toString(CryptoJS.enc.Utf8);
      gallery.push({ userId: row.user_id as string, embedding: deserialiseEmbedding(decrypted) });
    }
    return gallery;
  }

  // ─── Auth Sessions ───────────────────────────────────────────────────────────

  async saveAuthSession(session: Omit<AuthSession, 'synced'>): Promise<void> {
    const db = this.requireDb();
    await db.executeSql(
      `INSERT INTO auth_sessions
       (id, user_id, timestamp, location, liveness_score, recognition_score, synced, device_id)
       VALUES (?,?,?,?,?,?,0,?)`,
      [session.id, session.userId, session.timestamp, session.location ?? null,
       session.livenessScore, session.recognitionScore, session.deviceId],
    );
    await this.enqueueSync(session.id, JSON.stringify({ ...session, synced: 0 }));
  }

  async getPendingSessions(): Promise<AuthSession[]> {
    const db = this.requireDb();
    const [result] = await db.executeSql(
      'SELECT * FROM auth_sessions WHERE synced = 0 ORDER BY timestamp;',
    );
    return rowsToArray<AuthSession>(result.rows, (row: Record<string, unknown>) => ({
      id:               row.id as string,
      userId:           row.user_id as string,
      timestamp:        row.timestamp as number,
      location:         row.location as string | undefined,
      livenessScore:    row.liveness_score as number,
      recognitionScore: row.recognition_score as number,
      synced:           row.synced as number,
      deviceId:         row.device_id as string,
    }));
  }

  async markSessionsSynced(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const db = this.requireDb();
    const ph = ids.map(() => '?').join(',');
    await db.executeSql(`UPDATE auth_sessions SET synced = 1 WHERE id IN (${ph})`, ids);
    await db.executeSql(`DELETE FROM sync_queue WHERE session_id IN (${ph})`, ids);
  }

  // ─── Sync Queue ──────────────────────────────────────────────────────────────

  private async enqueueSync(sessionId: string, payload: string): Promise<void> {
    const db = this.requireDb();
    const id = uuidv4();
    await db.executeSql(
      'INSERT OR IGNORE INTO sync_queue (id, session_id, payload, attempts, last_attempt, created_at) VALUES (?,?,?,0,0,?)',
      [id, sessionId, payload, Date.now()],
    );
  }

  async getPendingSyncQueue(): Promise<SyncQueueItem[]> {
    const db = this.requireDb();
    const [result] = await db.executeSql('SELECT * FROM sync_queue ORDER BY created_at LIMIT 100;');
    return rowsToArray<SyncQueueItem>(result.rows, (row: Record<string, unknown>) => ({
      id:          row.id as string,
      sessionId:   row.session_id as string,
      payload:     row.payload as string,
      attempts:    row.attempts as number,
      lastAttempt: row.last_attempt as number,
      createdAt:   row.created_at as number,
    }));
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────

  async getPendingSyncCount(): Promise<number> {
    const db = this.requireDb();
    const [result] = await db.executeSql(
      'SELECT COUNT(*) as cnt FROM auth_sessions WHERE synced = 0;',
    );
    return (result.rows.item(0) as Record<string, unknown>).cnt as number;
  }

  async getEnrolledUserCount(): Promise<number> {
    const db = this.requireDb();
    const [result] = await db.executeSql('SELECT COUNT(*) as cnt FROM users;');
    return (result.rows.item(0) as Record<string, unknown>).cnt as number;
  }

  private requireDb(): SQLiteDatabase {
    if (!this.db) throw new Error('StorageService not initialised.');
    return this.db;
  }
}

function rowsToArray<T>(
  rows: { length: number; item: (i: number) => unknown },
  mapper: (row: Record<string, unknown>) => T,
): T[] {
  const out: T[] = [];
  for (let i = 0; i < rows.length; i++) {
    out.push(mapper(rows.item(i) as Record<string, unknown>));
  }
  return out;
}

export default new StorageService();
