jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn()
}));

jest.mock('react-native', () => ({
  NativeModules: {},
  Platform: { OS: 'ios' }
}));

import { loadHealthSyncState, runManualHealthSync } from './healthSync';
import type { Settings } from './types';

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    })
  };
}

const settings: Settings = {
  apiBaseUrl: 'http://alis.local:8010',
  pairingCode: 'pairing',
  deviceToken: 'device-token',
  notificationsEnabled: true,
  language: 'system'
};

test('loads unified Health Connect sync metadata', async () => {
  const storage = createStorage({
    'alis.health.lastSyncAt': '2026-05-31T08:00:00.000Z'
  });

  await expect(loadHealthSyncState({ storage, getNativeBackgroundStatus: async () => '{"status":"synced"}' })).resolves.toEqual({
    lastSyncAt: '2026-05-31T08:00:00.000Z',
    lastBackgroundStatus: '{"status":"synced"}'
  });
});

test('loads Health Connect cursor from native prefs when SecureStore has no cursor', async () => {
  const storage = createStorage();

  await expect(loadHealthSyncState({
    storage,
    getNativeBackgroundStatus: async () => '{"status":"synced"}',
    getNativeBackgroundCursor: async () => '2026-05-31T09:00:00.000Z'
  })).resolves.toEqual({
    lastSyncAt: '2026-05-31T09:00:00.000Z',
    lastBackgroundStatus: '{"status":"synced"}'
  });
});

test('loads newest Health Connect cursor across SecureStore and native prefs', async () => {
  const storage = createStorage({
    'alis.health.lastSyncAt': '2026-05-31T08:00:00.000Z'
  });

  await expect(loadHealthSyncState({
    storage,
    getNativeBackgroundStatus: async () => null,
    getNativeBackgroundCursor: async () => '2026-05-31T09:00:00.000Z'
  })).resolves.toEqual({
    lastSyncAt: '2026-05-31T09:00:00.000Z',
    lastBackgroundStatus: null
  });
});

test('manual sync stores the new cursor and refreshes native background settings', async () => {
  const storage = createStorage();
  const sync = jest.fn(async () => ({
    syncedRecordCount: 12,
    dataStart: '2026-05-31T08:00:00.000Z',
    dataEnd: '2026-05-31T09:00:00.000Z',
    syncMode: 'incremental' as const
  }));
  const saveNativeBackgroundSettings = jest.fn(async () => true);

  await expect(
    runManualHealthSync({
      settings,
      lastSyncAt: '2026-05-31T08:00:00.000Z',
      storage,
      sync,
      saveNativeBackgroundSettings
    })
  ).resolves.toEqual(expect.objectContaining({
    syncedRecordCount: 12,
    dataEnd: '2026-05-31T09:00:00.000Z'
  }));

  expect(sync).toHaveBeenCalledWith({
    apiBaseUrl: settings.apiBaseUrl,
    deviceToken: settings.deviceToken,
    lastSyncAt: '2026-05-31T08:00:00.000Z'
  });
  expect(storage.values.get('alis.health.lastSyncAt')).toBe('2026-05-31T09:00:00.000Z');
  expect(saveNativeBackgroundSettings).toHaveBeenCalledWith(
    settings.apiBaseUrl,
    settings.deviceToken,
    '2026-05-31T09:00:00.000Z'
  );
});

test('manual sync normalizes API base URL before syncing and refreshing native background settings', async () => {
  const storage = createStorage();
  const sync = jest.fn(async () => ({
    syncedRecordCount: 5,
    dataStart: '2026-05-31T08:00:00.000Z',
    dataEnd: '2026-05-31T09:00:00.000Z',
    syncMode: 'incremental' as const
  }));
  const saveNativeBackgroundSettings = jest.fn(async () => true);

  await runManualHealthSync({
    settings: {
      ...settings,
      apiBaseUrl: '  http://alis.local:8010///  '
    },
    lastSyncAt: '2026-05-31T08:00:00.000Z',
    storage,
    sync,
    saveNativeBackgroundSettings
  });

  expect(sync).toHaveBeenCalledWith({
    apiBaseUrl: 'http://alis.local:8010',
    deviceToken: settings.deviceToken,
    lastSyncAt: '2026-05-31T08:00:00.000Z'
  });
  expect(saveNativeBackgroundSettings).toHaveBeenCalledWith(
    'http://alis.local:8010',
    settings.deviceToken,
    '2026-05-31T09:00:00.000Z'
  );
});

test('manual sync forwards the active language to the Health Connect sync', async () => {
  const storage = createStorage();
  const sync = jest.fn(async () => ({
    syncedRecordCount: 5,
    dataStart: '2026-05-31T08:00:00.000Z',
    dataEnd: '2026-05-31T09:00:00.000Z',
    syncMode: 'incremental' as const
  }));
  const saveNativeBackgroundSettings = jest.fn(async () => true);

  await runManualHealthSync({
    settings,
    lastSyncAt: '2026-05-31T08:00:00.000Z',
    language: 'en',
    storage,
    sync,
    saveNativeBackgroundSettings
  });

  expect(sync).toHaveBeenCalledWith(expect.objectContaining({
    language: 'en'
  }));
});

test('manual sync rejects malformed API base URLs before syncing', async () => {
  const storage = createStorage();
  const sync = jest.fn();
  const saveNativeBackgroundSettings = jest.fn();

  await expect(runManualHealthSync({
    settings: {
      ...settings,
      apiBaseUrl: 'http:alis.local:8010'
    },
    lastSyncAt: '2026-05-31T08:00:00.000Z',
    storage,
    sync,
    saveNativeBackgroundSettings
  })).rejects.toThrow('URL API invalide');

  expect(sync).not.toHaveBeenCalled();
  expect(saveNativeBackgroundSettings).not.toHaveBeenCalled();
  expect(storage.values.has('alis.health.lastSyncAt')).toBe(false);
});
