import * as SecureStore from 'expo-secure-store';

import { normalizeApiBaseUrl } from './apiBaseUrl';
import { saveNativeBackgroundSettings as defaultSaveNativeBackgroundSettings } from './healthconnect/native/healthconnect-native';
import { performHealthConnectSync, type ManualSyncResult } from './healthconnect/sync/manual-sync';
import type { Settings } from './types';

export const HEALTH_LAST_SYNC_AT_KEY = 'alis.health.lastSyncAt';

type SyncStorage = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
};

export type HealthSyncState = {
  lastSyncAt: string | null;
  lastBackgroundStatus: string | null;
};

function latestHealthSyncCursor(storedLastSyncAt: string | null, nativeLastSyncAt: string | null): string | null {
  if (!storedLastSyncAt) {
    return nativeLastSyncAt;
  }
  if (!nativeLastSyncAt) {
    return storedLastSyncAt;
  }

  const storedTime = Date.parse(storedLastSyncAt);
  const nativeTime = Date.parse(nativeLastSyncAt);
  if (Number.isNaN(storedTime) && Number.isNaN(nativeTime)) {
    return nativeLastSyncAt;
  }
  if (Number.isNaN(storedTime)) {
    return nativeLastSyncAt;
  }
  if (Number.isNaN(nativeTime)) {
    return storedLastSyncAt;
  }
  return nativeTime > storedTime ? nativeLastSyncAt : storedLastSyncAt;
}

export async function loadHealthSyncState({
  storage = SecureStore,
  getNativeBackgroundStatus,
  getNativeBackgroundCursor = async () => null
}: {
  storage?: Pick<SyncStorage, 'getItemAsync'>;
  getNativeBackgroundStatus: () => Promise<string | null>;
  getNativeBackgroundCursor?: () => Promise<string | null>;
}): Promise<HealthSyncState> {
  const [storedLastSyncAt, nativeLastSyncAt, lastBackgroundStatus] = await Promise.all([
    storage.getItemAsync(HEALTH_LAST_SYNC_AT_KEY),
    getNativeBackgroundCursor(),
    getNativeBackgroundStatus()
  ]);
  return { lastSyncAt: latestHealthSyncCursor(storedLastSyncAt, nativeLastSyncAt), lastBackgroundStatus };
}

export async function runManualHealthSync({
  settings,
  lastSyncAt,
  storage = SecureStore,
  sync = performHealthConnectSync,
  saveNativeBackgroundSettings = defaultSaveNativeBackgroundSettings
}: {
  settings: Settings;
  lastSyncAt: string | null;
  storage?: SyncStorage;
  sync?: typeof performHealthConnectSync;
  saveNativeBackgroundSettings?: typeof defaultSaveNativeBackgroundSettings;
}): Promise<ManualSyncResult> {
  const apiBaseUrl = normalizeApiBaseUrl(settings.apiBaseUrl);
  const result = await sync({
    apiBaseUrl,
    deviceToken: settings.deviceToken,
    lastSyncAt
  });
  await storage.setItemAsync(HEALTH_LAST_SYNC_AT_KEY, result.dataEnd);
  await saveNativeBackgroundSettings(apiBaseUrl, settings.deviceToken, result.dataEnd);
  return result;
}
