import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { AppState } from '../types';
import StorageService from '../services/StorageService';
import SyncService from '../services/SyncService';
import DeviceInfoService from '../services/DeviceInfoService';
import FaceDetectionService from '../services/FaceDetectionService';
import FaceRecognitionService from '../services/FaceRecognitionService';
import LivenessService from '../services/LivenessService';

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  triggerSync: () => Promise<void>;
}

type AppAction =
  | { type: 'SET_ONLINE'; payload: boolean }
  | { type: 'SET_PENDING_SYNC'; payload: number }
  | { type: 'SET_LAST_SYNC'; payload: number }
  | { type: 'SET_USER_COUNT'; payload: number }
  | { type: 'SYNC_COMPLETE'; payload: { syncedCount: number; remaining: number } };

const initialState: AppState = {
  isOnline: false,
  pendingSyncCount: 0,
  lastSyncAt: null,
  enrolledUserCount: 0,
};

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_ONLINE':
      return { ...state, isOnline: action.payload };
    case 'SET_PENDING_SYNC':
      return { ...state, pendingSyncCount: action.payload };
    case 'SET_LAST_SYNC':
      return { ...state, lastSyncAt: action.payload };
    case 'SET_USER_COUNT':
      return { ...state, enrolledUserCount: action.payload };
    case 'SYNC_COMPLETE':
      return {
        ...state,
        lastSyncAt: Date.now(),
        pendingSyncCount: action.payload.remaining,
      };
    default:
      return state;
  }
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    async function bootstrap() {
      // Init storage with device-derived encryption key
      const key = await DeviceInfoService.getEncryptionKey();
      await StorageService.init(key);

      // Load initial stats
      const [pending, users] = await Promise.all([
        StorageService.getPendingSyncCount(),
        StorageService.getEnrolledUserCount(),
      ]);
      dispatch({ type: 'SET_PENDING_SYNC', payload: pending });
      dispatch({ type: 'SET_USER_COUNT', payload: users });

      // Init AI models (loads .tflite files from bundle)
      await Promise.all([
        FaceDetectionService.init(),
        FaceRecognitionService.init(),
        LivenessService.init(),
      ]);

      // Start connectivity monitoring & auto-sync
      SyncService.startMonitoring((isOnline, pendingCount) => {
        dispatch({ type: 'SET_ONLINE', payload: isOnline });
        dispatch({ type: 'SET_PENDING_SYNC', payload: pendingCount });
      });
    }

    bootstrap();
    return () => SyncService.stopMonitoring();
  }, []);

  const triggerSync = async () => {
    const result = await SyncService.triggerSync();
    if (result.success) {
      const remaining = await StorageService.getPendingSyncCount();
      dispatch({ type: 'SYNC_COMPLETE', payload: { syncedCount: result.syncedCount, remaining } });
    }
  };

  return (
    <AppContext.Provider value={{ state, dispatch, triggerSync }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
