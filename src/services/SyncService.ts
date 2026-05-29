import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import axios, { AxiosInstance } from 'axios';
import { SyncPayload, SyncResult } from '../types';
import StorageService from './StorageService';
import DeviceInfoService from './DeviceInfoService';

const AWS_ENDPOINT = 'https://hxzyjbjg05.execute-api.ap-south-1.amazonaws.com/prod';
const SYNC_PATH    = '/sessions';
const MAX_RETRIES  = 3;
const RETRY_DELAY_MS = 5_000;
const BATCH_SIZE   = 50;

/**
 * SyncService handles:
 *  1. Monitoring network state via @react-native-community/netinfo
 *  2. Batching pending AuthSession records to AWS API Gateway → Lambda → DynamoDB
 *  3. Marking sessions as synced and purging the local sync queue on success
 *  4. Exponential back-off on transient errors
 *
 * The AWS endpoint expects a signed request (AWS SigV4 or Cognito JWT).
 * For the prototype we use an API Key header; replace with Amplify Auth in production.
 */
class SyncService {
  private client: AxiosInstance;
  private unsubscribe: (() => void) | null = null;
  private syncing = false;
  private onStatusChange?: (isOnline: boolean, pending: number) => void;

  constructor() {
    this.client = axios.create({
      baseURL: AWS_ENDPOINT,
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'REPLACE_WITH_YOUR_API_KEY',
      },
    });
  }

  /** Begin watching for connectivity; auto-sync when online. */
  startMonitoring(cb?: (isOnline: boolean, pending: number) => void): void {
    this.onStatusChange = cb;

    this.unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const online = !!(state.isConnected && state.isInternetReachable);
      if (online) {
        this.triggerSync();
      } else {
        StorageService.getPendingSyncCount().then(n => cb?.(false, n));
      }
    });
  }

  stopMonitoring(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Manually trigger a sync cycle (e.g., on app foreground). */
  async triggerSync(): Promise<SyncResult> {
    if (this.syncing) return { success: false, syncedCount: 0, error: 'Sync already running' };

    this.syncing = true;
    let totalSynced = 0;

    try {
      const pending = await StorageService.getPendingSessions();
      if (!pending.length) {
        return { success: true, syncedCount: 0 };
      }

      const deviceId = await DeviceInfoService.getDeviceId();

      // Process in batches to avoid oversized payloads
      for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
        const batch = pending.slice(offset, offset + BATCH_SIZE);

        const payload: SyncPayload = {
          deviceId,
          sessions: batch,
          syncedAt: Date.now(),
        };

        const success = await this.sendWithRetry(payload);

        if (success) {
          const ids = batch.map(s => s.id);
          await StorageService.markSessionsSynced(ids);
          totalSynced += ids.length;
        }
      }

      const remaining = await StorageService.getPendingSyncCount();
      this.onStatusChange?.(true, remaining);

      return { success: true, syncedCount: totalSynced };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, syncedCount: totalSynced, error: msg };
    } finally {
      this.syncing = false;
    }
  }

  private async sendWithRetry(payload: SyncPayload): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.post(SYNC_PATH, payload);
        return response.status >= 200 && response.status < 300;
      } catch {
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default new SyncService();
