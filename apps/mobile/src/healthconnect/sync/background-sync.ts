import { normalizeApiBaseUrl } from '../../apiBaseUrl';
import { BACKGROUND_SYNC_INTERVAL_HOURS, BACKGROUND_SYNC_TASK_NAME } from '../config';
import { performHealthConnectSync, type ManualSyncResult } from './manual-sync';
import { getSyncDecision } from './sync-policy';

type BackgroundStorage = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync?: (key: string) => Promise<void>;
};

type BackgroundSyncInput = {
  storage?: BackgroundStorage;
  getNetworkType?: () => Promise<string | null>;
  now?: () => Date;
    sync?: (input: {
    apiBaseUrl: string;
    deviceToken: string;
    lastSyncAt: string;
    syncTrigger?: 'manual' | 'background';
    networkType?: string | null;
    now: () => Date;
  }) => Promise<ManualSyncResult>;
};

export type BackgroundSyncRunResult =
  | { status: 'skipped'; reason: 'unconfigured' | 'initial_sync_required' | 'fresh' | 'already_running' | 'cooldown' }
  | { status: 'synced'; syncedRecordCount: number; dataEnd: string }
  | { status: 'failed'; error: string };

const API_URL_KEY = 'alis.apiBaseUrl';
const DEVICE_TOKEN_KEY = 'alis.deviceToken';
const LAST_SYNC_AT_KEY = 'alis.health.lastSyncAt';
const BACKGROUND_SYNC_LOCK_KEY = 'alis.health.backgroundSyncLock';
const BACKGROUND_SYNC_LAST_SUCCESS_KEY = 'alis.health.lastBackgroundSyncSuccessAt';
const BACKGROUND_SYNC_STATUS_KEY = 'alis.health.lastBackgroundSyncStatus';
const BACKGROUND_SYNC_LOCK_MAX_AGE_MS = 30 * 60 * 1000;
const BACKGROUND_SYNC_COOLDOWN_MS = 55 * 60 * 1000;
let backgroundSyncInFlight = false;

type BackgroundScheduler = {
  BackgroundFetchResult?: {
    NewData: unknown;
    Failed: unknown;
    NoData: unknown;
  };
  registerTaskAsync: (taskName: string, options: { minimumInterval: number; stopOnTerminate: boolean; startOnBoot: boolean }) => Promise<void>;
  unregisterTaskAsync?: (taskName: string) => Promise<void>;
};

type BackgroundTaskManager = {
  defineTask?: (taskName: string, task: () => Promise<unknown>) => void;
  isTaskDefined: (taskName: string) => boolean;
  isTaskRegisteredAsync?: (taskName: string) => Promise<boolean>;
};

export async function runBackgroundSyncOnce(input: BackgroundSyncInput = {}): Promise<BackgroundSyncRunResult> {
  const storage = input.storage ?? getDefaultStorage();
  const now = input.now ?? (() => new Date());
  if (backgroundSyncInFlight) {
    return persistBackgroundStatus(storage, { status: 'skipped', reason: 'already_running' });
  }

  backgroundSyncInFlight = true;
  let acquiredLock = false;
  try {
    const nowDate = now();
    const networkType = await (input.getNetworkType ?? getDefaultNetworkType)();

    const [apiBaseUrl, deviceToken, lastSyncAt, lockStartedAt, lastBackgroundSuccessAt] = await Promise.all([
      storage.getItemAsync(API_URL_KEY),
      storage.getItemAsync(DEVICE_TOKEN_KEY),
      storage.getItemAsync(LAST_SYNC_AT_KEY),
      storage.getItemAsync(BACKGROUND_SYNC_LOCK_KEY),
      storage.getItemAsync(BACKGROUND_SYNC_LAST_SUCCESS_KEY)
    ]);

    if (isRecentLock(lockStartedAt, nowDate)) {
      return persistBackgroundStatus(storage, { status: 'skipped', reason: 'already_running' });
    }
    if (isWithinCooldown(lastBackgroundSuccessAt, nowDate)) {
      return persistBackgroundStatus(storage, { status: 'skipped', reason: 'cooldown' });
    }

    const decision = getSyncDecision({
      now: nowDate.toISOString(),
      apiBaseUrl,
      deviceToken,
      lastSyncAt
    });
    if (!decision.shouldSync) {
      return persistBackgroundStatus(storage, { status: 'skipped', reason: decision.reason as 'unconfigured' | 'initial_sync_required' | 'fresh' });
    }

    await storage.setItemAsync(BACKGROUND_SYNC_LOCK_KEY, nowDate.toISOString());
    acquiredLock = true;

    try {
      const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl as string);
      const result = await (input.sync ?? performHealthConnectSync)({
        apiBaseUrl: normalizedApiBaseUrl,
        deviceToken: deviceToken as string,
        lastSyncAt: lastSyncAt as string,
        syncTrigger: 'background',
        networkType,
        now
      });
      await storage.setItemAsync(LAST_SYNC_AT_KEY, result.dataEnd);
      await storage.setItemAsync(BACKGROUND_SYNC_LAST_SUCCESS_KEY, nowDate.toISOString());
      return persistBackgroundStatus(storage, {
        status: 'synced',
        syncedRecordCount: result.syncedRecordCount,
        dataEnd: result.dataEnd
      });
    } catch (error) {
      return persistBackgroundStatus(storage, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Erreur de synchronisation background inconnue'
      });
    }
  } finally {
    backgroundSyncInFlight = false;
    if (acquiredLock) {
      await storage.deleteItemAsync?.(BACKGROUND_SYNC_LOCK_KEY);
    }
  }
}

export async function registerBackgroundSync(input: {
  scheduler?: BackgroundScheduler;
  taskManager?: BackgroundTaskManager;
} = {}) {
  const scheduler = input.scheduler ?? getDefaultBackgroundFetch();
  const taskManager = input.taskManager ?? getDefaultTaskManager();
  if (!taskManager.isTaskDefined(BACKGROUND_SYNC_TASK_NAME)) {
    defineBackgroundTask(taskManager, scheduler);
  }
  if (taskManager.isTaskRegisteredAsync && scheduler.unregisterTaskAsync && await taskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK_NAME)) {
    await scheduler.unregisterTaskAsync(BACKGROUND_SYNC_TASK_NAME);
  }
  await scheduler.registerTaskAsync(BACKGROUND_SYNC_TASK_NAME, {
    minimumInterval: BACKGROUND_SYNC_INTERVAL_HOURS * 60 * 60,
    stopOnTerminate: false,
    startOnBoot: true
  });
}

function defineBackgroundTask(taskManager: BackgroundTaskManager, scheduler: BackgroundScheduler) {
  if (!taskManager.defineTask || !scheduler.BackgroundFetchResult) {
    return;
  }
  taskManager.defineTask(BACKGROUND_SYNC_TASK_NAME, async () => {
    const result = await runBackgroundSyncOnce();
    if (result.status === 'synced') {
      return scheduler.BackgroundFetchResult?.NewData;
    }
    if (result.status === 'failed') {
      return scheduler.BackgroundFetchResult?.Failed;
    }
    return scheduler.BackgroundFetchResult?.NoData;
  });
}

async function getDefaultNetworkType() {
  const Network = require('expo-network');
  const state = await Network.getNetworkStateAsync();
  return state.type ?? null;
}

function getDefaultStorage(): BackgroundStorage {
  return require('expo-secure-store');
}

function getDefaultBackgroundFetch(): BackgroundScheduler {
  return require('expo-background-fetch');
}

function getDefaultTaskManager(): BackgroundTaskManager {
  return require('expo-task-manager');
}

async function persistBackgroundStatus<T extends BackgroundSyncRunResult>(storage: BackgroundStorage, result: T): Promise<T> {
  await storage.setItemAsync(
    BACKGROUND_SYNC_STATUS_KEY,
    JSON.stringify({
      ...result,
      recordedAt: new Date().toISOString()
    })
  );
  return result;
}

function isRecentLock(value: string | null, now: Date) {
  return isTimestampWithin(value, now, BACKGROUND_SYNC_LOCK_MAX_AGE_MS);
}

function isWithinCooldown(value: string | null, now: Date) {
  return isTimestampWithin(value, now, BACKGROUND_SYNC_COOLDOWN_MS);
}

function isTimestampWithin(value: string | null, now: Date, maxAgeMs: number) {
  if (!value) {
    return false;
  }
  const startedAt = new Date(value).getTime();
  if (Number.isNaN(startedAt)) {
    return false;
  }
  return now.getTime() - startedAt < maxAgeMs;
}
