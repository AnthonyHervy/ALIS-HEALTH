import { registerBackgroundSync, runBackgroundSyncOnce } from '../sync/background-sync';

test('normalizes stored API base URL before background sync', async () => {
  const sync = jest.fn(async () => ({
    syncedRecordCount: 3,
    dataStart: '2026-05-20T08:00:00.000Z',
    dataEnd: '2026-05-20T09:30:00.000Z',
    syncMode: 'incremental' as const
  }));
  const values: Record<string, string> = {
    'alis.apiBaseUrl': '  http://localhost:8010///  ',
    'alis.deviceToken': 'token-123',
    'alis.health.lastSyncAt': '2026-05-20T08:00:00.000Z'
  };
  const storage = {
    getItemAsync: jest.fn(async (key: string) => values[key] ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      values[key] = value;
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete values[key];
    })
  };

  await expect(
    runBackgroundSyncOnce({
      storage,
      getNetworkType: async () => 'WIFI',
      now: () => new Date('2026-05-20T09:30:00.000Z'),
      sync
    })
  ).resolves.toMatchObject({ status: 'synced', syncedRecordCount: 3 });

  expect(sync).toHaveBeenCalledWith(expect.objectContaining({
    apiBaseUrl: 'http://localhost:8010'
  }));
});

test('records failed background sync when stored API base URL is malformed', async () => {
  const sync = jest.fn(async () => ({
    syncedRecordCount: 3,
    dataStart: '2026-05-20T08:00:00.000Z',
    dataEnd: '2026-05-20T09:30:00.000Z',
    syncMode: 'incremental' as const
  }));
  const values: Record<string, string> = {
    'alis.apiBaseUrl': 'http:example.com',
    'alis.deviceToken': 'token-123',
    'alis.health.lastSyncAt': '2026-05-20T08:00:00.000Z'
  };
  const storage = {
    getItemAsync: jest.fn(async (key: string) => values[key] ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      values[key] = value;
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete values[key];
    })
  };

  await expect(
    runBackgroundSyncOnce({
      storage,
      getNetworkType: async () => 'WIFI',
      now: () => new Date('2026-05-20T09:30:00.000Z'),
      sync
    })
  ).resolves.toMatchObject({ status: 'failed', error: expect.stringContaining('URL API invalide') });

  expect(sync).not.toHaveBeenCalled();
  expect(values['alis.health.lastBackgroundSyncStatus']).toContain('"status":"failed"');
  expect(values['alis.health.lastBackgroundSyncStatus']).toContain('URL API invalide');
});

test('runs incremental background sync on cellular when freshness window is due', async () => {
  const sync = jest.fn(async () => ({
    syncedRecordCount: 3,
    dataStart: '2026-05-20T08:00:00.000Z',
    dataEnd: '2026-05-20T09:30:00.000Z',
    syncMode: 'incremental' as const
  }));
  const storage = {
    getItemAsync: jest.fn(async (key: string) => {
      const values: Record<string, string> = {
        'alis.apiBaseUrl': 'http://localhost:8010',
        'alis.deviceToken': 'token-123',
        'alis.health.lastSyncAt': '2026-05-20T08:00:00.000Z'
      };
      return values[key] ?? null;
    }),
    setItemAsync: jest.fn()
  };

  await expect(
    runBackgroundSyncOnce({
      storage,
      getNetworkType: async () => 'CELLULAR',
      now: () => new Date('2026-05-20T09:30:00.000Z'),
      sync
    })
  ).resolves.toMatchObject({ status: 'synced', syncedRecordCount: 3 });

  expect(sync).toHaveBeenCalledWith({
    apiBaseUrl: 'http://localhost:8010',
    deviceToken: 'token-123',
    lastSyncAt: '2026-05-20T08:00:00.000Z',
    syncTrigger: 'background',
    networkType: 'CELLULAR',
    now: expect.any(Function)
  });
});

test('runs incremental background sync when freshness window is due', async () => {
  const sync = jest.fn(async () => ({
    syncedRecordCount: 4,
    dataStart: '2026-05-20T08:00:00.000Z',
    dataEnd: '2026-05-20T12:00:00.000Z',
    syncMode: 'incremental' as const
  }));
  const storage = {
    getItemAsync: jest.fn(async (key: string) => {
      const values: Record<string, string> = {
        'alis.apiBaseUrl': 'http://localhost:8010',
        'alis.deviceToken': 'token-123',
        'alis.health.lastSyncAt': '2026-05-20T08:00:00.000Z'
      };
      return values[key] ?? null;
    }),
    setItemAsync: jest.fn()
  };

  await expect(
    runBackgroundSyncOnce({
      storage,
      getNetworkType: async () => 'WIFI',
      now: () => new Date('2026-05-20T12:00:00.000Z'),
      sync
    })
  ).resolves.toMatchObject({ status: 'synced', syncedRecordCount: 4 });

  expect(sync).toHaveBeenCalledWith({
    apiBaseUrl: 'http://localhost:8010',
    deviceToken: 'token-123',
    lastSyncAt: '2026-05-20T08:00:00.000Z',
    syncTrigger: 'background',
    networkType: 'WIFI',
    now: expect.any(Function)
  });
  expect(storage.setItemAsync).toHaveBeenCalledWith('alis.health.lastSyncAt', '2026-05-20T12:00:00.000Z');
  expect(storage.setItemAsync).toHaveBeenCalledWith('alis.health.lastBackgroundSyncStatus', expect.stringContaining('"status":"synced"'));
});

test('coalesces concurrent background runs into a single sync', async () => {
  const sync = jest.fn(async () => {
    await Promise.resolve();
    return {
      syncedRecordCount: 4,
      dataStart: '2026-05-20T08:00:00.000Z',
      dataEnd: '2026-05-20T12:00:00.000Z',
      syncMode: 'incremental' as const
    };
  });
  const values: Record<string, string> = {
    'alis.apiBaseUrl': 'http://localhost:8010',
    'alis.deviceToken': 'token-123',
    'alis.health.lastSyncAt': '2026-05-20T08:00:00.000Z'
  };
  const storage = {
    getItemAsync: jest.fn(async (key: string) => values[key] ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      values[key] = value;
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete values[key];
    })
  };

  await expect(
    Promise.all([
      runBackgroundSyncOnce({
        storage,
        getNetworkType: async () => 'WIFI',
        now: () => new Date('2026-05-20T12:00:00.000Z'),
        sync
      }),
      runBackgroundSyncOnce({
        storage,
        getNetworkType: async () => 'WIFI',
        now: () => new Date('2026-05-20T12:00:00.000Z'),
        sync
      })
    ])
  ).resolves.toEqual([
    expect.objectContaining({ status: 'synced', syncedRecordCount: 4 }),
    expect.objectContaining({ status: 'skipped', reason: 'already_running' })
  ]);
  expect(sync).toHaveBeenCalledTimes(1);
});

test('skips a background run when a recent lock is stored', async () => {
  const sync = jest.fn(async () => ({
    syncedRecordCount: 4,
    dataStart: '2026-05-20T08:00:00.000Z',
    dataEnd: '2026-05-20T12:00:00.000Z',
    syncMode: 'incremental' as const
  }));
  const values: Record<string, string> = {
    'alis.apiBaseUrl': 'http://localhost:8010',
    'alis.deviceToken': 'token-123',
    'alis.health.lastSyncAt': '2026-05-20T08:00:00.000Z',
    'alis.health.backgroundSyncLock': '2026-05-20T11:55:00.000Z'
  };
  const storage = {
    getItemAsync: jest.fn(async (key: string) => values[key] ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      values[key] = value;
    })
  };

  await expect(runBackgroundSyncOnce({
    storage,
    getNetworkType: async () => 'WIFI',
    now: () => new Date('2026-05-20T12:00:00.000Z'),
    sync
  })).resolves.toMatchObject({ status: 'skipped', reason: 'already_running' });
  expect(sync).not.toHaveBeenCalled();
});

test('skips repeated background runs inside the hourly cooldown', async () => {
  const sync = jest.fn(async () => ({
    syncedRecordCount: 4,
    dataStart: '2026-05-20T08:00:00.000Z',
    dataEnd: '2026-05-20T12:00:00.000Z',
    syncMode: 'incremental' as const
  }));
  const values: Record<string, string> = {
    'alis.apiBaseUrl': 'http://localhost:8010',
    'alis.deviceToken': 'token-123',
    'alis.health.lastSyncAt': '2026-05-20T08:00:00.000Z',
    'alis.health.lastBackgroundSyncSuccessAt': '2026-05-20T11:55:00.000Z'
  };
  const storage = {
    getItemAsync: jest.fn(async (key: string) => values[key] ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      values[key] = value;
    })
  };

  await expect(runBackgroundSyncOnce({
    storage,
    getNetworkType: async () => 'WIFI',
    now: () => new Date('2026-05-20T12:00:00.000Z'),
    sync
  })).resolves.toMatchObject({ status: 'skipped', reason: 'cooldown' });
  expect(sync).not.toHaveBeenCalled();
});

test('registers the background sync task on a one hour interval', async () => {
  const scheduler = {
    registerTaskAsync: jest.fn(async () => undefined)
  };
  const taskManager = {
    isTaskDefined: jest.fn(() => true)
  };

  await registerBackgroundSync({ scheduler, taskManager });

  expect(scheduler.registerTaskAsync).toHaveBeenCalledWith('healthconnect-background-sync', {
    minimumInterval: 3600,
    startOnBoot: true,
    stopOnTerminate: false
  });
});

test('defines the background task before registering when it was not loaded yet', async () => {
  const scheduler = {
    BackgroundFetchResult: {
      NewData: 'new-data',
      Failed: 'failed',
      NoData: 'no-data'
    },
    registerTaskAsync: jest.fn(async () => undefined)
  };
  const taskManager = {
    defineTask: jest.fn(),
    isTaskDefined: jest.fn(() => false)
  };

  await registerBackgroundSync({ scheduler, taskManager });

  expect(taskManager.defineTask).toHaveBeenCalledWith('healthconnect-background-sync', expect.any(Function));
  expect(scheduler.registerTaskAsync).toHaveBeenCalledWith('healthconnect-background-sync', {
    minimumInterval: 3600,
    startOnBoot: true,
    stopOnTerminate: false
  });
});

test('re-registers an existing background sync task to refresh schedule options', async () => {
  const scheduler = {
    registerTaskAsync: jest.fn(async () => undefined),
    unregisterTaskAsync: jest.fn(async () => undefined)
  };
  const taskManager = {
    isTaskDefined: jest.fn(() => true),
    isTaskRegisteredAsync: jest.fn(async () => true)
  };

  await registerBackgroundSync({ scheduler, taskManager });

  expect(scheduler.unregisterTaskAsync).toHaveBeenCalledWith('healthconnect-background-sync');
  expect(scheduler.registerTaskAsync).toHaveBeenCalledWith('healthconnect-background-sync', {
    minimumInterval: 3600,
    startOnBoot: true,
    stopOnTerminate: false
  });
});
