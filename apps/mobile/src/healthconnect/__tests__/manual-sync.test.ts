import { performHealthConnectSync } from '../sync/manual-sync';

test('normalizes direct API base URL input before constructing the API client', async () => {
  const ingestHealthBatch = jest.fn(async () => ({ accepted: true }));
  const apiFactory = jest.fn(() => ({ ingestHealthBatch }));

  await performHealthConnectSync({
    apiBaseUrl: '  http://127.0.0.1:8010///  ',
    deviceToken: 'token-123',
    now: () => new Date('2026-05-20T10:00:00.000Z'),
    healthConnect: {
      initialize: jest.fn(async () => true),
      requestPermission: jest.fn(async (permissions) => permissions),
      readRecords: jest.fn(async () => ({ records: [] }))
    },
    apiFactory
  });

  expect(apiFactory).toHaveBeenCalledWith('http://127.0.0.1:8010', 'token-123');
});

test('rejects malformed direct API base URL input before reading Health Connect records', async () => {
  const healthConnect = {
    initialize: jest.fn(async () => true),
    requestPermission: jest.fn(),
    readRecords: jest.fn()
  };

  await expect(
    performHealthConnectSync({
      apiBaseUrl: 'http:example.com',
      deviceToken: 'token-123',
      healthConnect,
      apiFactory: jest.fn()
    })
  ).rejects.toThrow('URL API invalide');

  expect(healthConnect.initialize).not.toHaveBeenCalled();
  expect(healthConnect.requestPermission).not.toHaveBeenCalled();
  expect(healthConnect.readRecords).not.toHaveBeenCalled();
});

test('requests the broad ALIS Health Connect read surface before syncing', async () => {
  const requestPermission = jest.fn(async (permissions) => permissions);

  await performHealthConnectSync({
    apiBaseUrl: 'http://127.0.0.1:8010',
    deviceToken: 'token-123',
    now: () => new Date('2026-05-20T10:00:00.000Z'),
    healthConnect: {
      initialize: jest.fn(async () => true),
      requestPermission,
      readRecords: jest.fn(async () => ({ records: [] }))
    },
    apiFactory: () => ({ ingestHealthBatch: jest.fn(async () => ({ accepted: true })) })
  });

  expect(requestPermission).toHaveBeenCalledWith(
    expect.arrayContaining([
      { accessType: 'read', recordType: 'BasalBodyTemperature' },
      { accessType: 'read', recordType: 'BloodPressure' },
      { accessType: 'read', recordType: 'CyclingPedalingCadence' },
      { accessType: 'read', recordType: 'OxygenSaturation' },
      { accessType: 'read', recordType: 'WheelchairPushes' },
      { accessType: 'read', recordType: 'ReadHealthDataHistory' },
      { accessType: 'read', recordType: 'BackgroundAccessPermission' }
    ])
  );
});

test('reads only the compact Health Connect sync surface for manual ingestion', async () => {
  const readRecords = jest.fn(async () => ({ records: [] }));

  await performHealthConnectSync({
    apiBaseUrl: 'http://127.0.0.1:8010',
    deviceToken: 'token-123',
    now: () => new Date('2026-05-20T10:00:00.000Z'),
    healthConnect: {
      initialize: jest.fn(async () => true),
      requestPermission: jest.fn(async (permissions) => permissions),
      readRecords
    },
    apiFactory: () => ({ ingestHealthBatch: jest.fn(async () => ({ accepted: true })) })
  });

  const readTypes = (readRecords.mock.calls as unknown as Array<[string, unknown]>).map(([recordType]) => recordType);
  expect(readTypes).toEqual(
    expect.arrayContaining([
      'Steps',
      'SleepSession',
      'ExerciseSession',
      'HeartRate',
      'HeartRateVariabilityRmssd',
      'RestingHeartRate',
      'Vo2Max',
      'ActiveCaloriesBurned',
      'TotalCaloriesBurned',
      'Distance'
    ])
  );
  expect(readTypes).not.toEqual(expect.arrayContaining(['BasalBodyTemperature', 'StepsCadence', 'Power', 'Speed']));
});

test('reads Health Connect records and ingests a normalized batch', async () => {
  const readRecords = jest.fn(async (recordType: string) => ({
    records:
      recordType === 'Steps'
        ? [
            {
              recordType: 'Steps',
              startTime: '2026-05-19T08:00:00.000Z',
              endTime: '2026-05-19T09:00:00.000Z',
              count: 1200
            }
          ]
        : []
  }));
  const ingestHealthBatch = jest.fn(async () => ({ accepted: true }));

  const result = await performHealthConnectSync({
    apiBaseUrl: 'http://127.0.0.1:8010',
    deviceToken: 'token-123',
    now: () => new Date('2026-05-20T10:00:00.000Z'),
    healthConnect: {
      initialize: jest.fn(async () => true),
      requestPermission: jest.fn(async (permissions) => permissions),
      readRecords
    },
    apiFactory: () => ({ ingestHealthBatch })
  });

  expect(readRecords).toHaveBeenCalledWith('Steps', {
    timeRangeFilter: {
      operator: 'between',
      startTime: '2016-05-22T10:00:00.000Z',
      endTime: '2026-05-20T10:00:00.000Z'
    },
    pageSize: 1000
  });
  expect(ingestHealthBatch).toHaveBeenCalledWith(
    expect.objectContaining({
      data_start: '2016-05-22T10:00:00.000Z',
      data_end: '2026-05-20T10:00:00.000Z',
      sync_trigger: 'manual',
      sync_mode: 'initial_full_history',
      steps: [
        {
          start_time: '2026-05-19T08:00:00.000Z',
          end_time: '2026-05-19T09:00:00.000Z',
          count: 1200
        }
      ]
    })
  );
  expect(result).toMatchObject({
    syncedRecordCount: 1,
    dataStart: '2016-05-22T10:00:00.000Z',
    dataEnd: '2026-05-20T10:00:00.000Z',
    syncMode: 'initial_full_history'
  });
});

test('uses the last sync timestamp for subsequent incremental syncs', async () => {
  const readRecords = jest.fn(async () => ({ records: [] }));

  await performHealthConnectSync({
    apiBaseUrl: 'http://127.0.0.1:8010',
    deviceToken: 'token-123',
    lastSyncAt: '2026-05-20T07:30:00.000Z',
    now: () => new Date('2026-05-20T10:00:00.000Z'),
    healthConnect: {
      initialize: jest.fn(async () => true),
      requestPermission: jest.fn(async (permissions) => permissions),
      readRecords
    },
    apiFactory: () => ({ ingestHealthBatch: jest.fn(async () => ({ accepted: true })) })
  });

  expect(readRecords).toHaveBeenCalledWith(
    'Steps',
    expect.objectContaining({
      timeRangeFilter: {
        operator: 'between',
        startTime: '2026-05-20T07:30:00.000Z',
        endTime: '2026-05-20T10:00:00.000Z'
      }
    })
  );
});

test('rereads sleep with a long overlap during incremental syncs so finalized nights are not missed', async () => {
  const readRecords = jest.fn(async () => ({ records: [] }));

  await performHealthConnectSync({
    apiBaseUrl: 'http://127.0.0.1:8010',
    deviceToken: 'token-123',
    lastSyncAt: '2026-05-26T05:30:00.000Z',
    now: () => new Date('2026-05-26T09:00:00.000Z'),
    healthConnect: {
      initialize: jest.fn(async () => true),
      requestPermission: jest.fn(async (permissions) => permissions),
      readRecords
    },
    apiFactory: () => ({ ingestHealthBatch: jest.fn(async () => ({ accepted: true })) })
  });

  expect(readRecords).toHaveBeenCalledWith(
    'SleepSession',
    expect.objectContaining({
      timeRangeFilter: {
        operator: 'between',
        startTime: '2026-05-24T05:30:00.000Z',
        endTime: '2026-05-26T09:00:00.000Z'
      }
    })
  );
});

test('uses a full history window for first sync when history permission is granted', async () => {
  const readRecords = jest.fn(async () => ({ records: [] }));

  const result = await performHealthConnectSync({
    apiBaseUrl: 'http://127.0.0.1:8010',
    deviceToken: 'token-123',
    now: () => new Date('2026-05-20T10:00:00.000Z'),
    healthConnect: {
      initialize: jest.fn(async () => true),
      requestPermission: jest.fn(async (permissions) => permissions),
      readRecords
    },
    apiFactory: () => ({ ingestHealthBatch: jest.fn(async () => ({ accepted: true })) })
  });

  expect(readRecords).toHaveBeenCalledWith(
    'Steps',
    expect.objectContaining({
      timeRangeFilter: expect.objectContaining({
        startTime: '2016-05-22T10:00:00.000Z'
      })
    })
  );
  expect(result.syncMode).toBe('initial_full_history');
});

test('marks background sync batches with trigger and network metadata', async () => {
  const ingestHealthBatch = jest.fn(async () => ({ accepted: true }));

  await performHealthConnectSync({
    apiBaseUrl: 'http://127.0.0.1:8010',
    deviceToken: 'token-123',
    lastSyncAt: '2026-05-20T09:00:00.000Z',
    syncTrigger: 'background',
    networkType: 'CELLULAR',
    now: () => new Date('2026-05-20T10:00:00.000Z'),
    healthConnect: {
      initialize: jest.fn(async () => true),
      requestPermission: jest.fn(async (permissions) => permissions),
      readRecords: jest.fn(async () => ({ records: [] }))
    },
    apiFactory: () => ({ ingestHealthBatch })
  });

  expect(ingestHealthBatch).toHaveBeenCalledWith(
    expect.objectContaining({
      sync_trigger: 'background',
      sync_mode: 'incremental',
      network_type: 'CELLULAR'
    })
  );
});

test('falls back to 30 days for first sync when history permission is not granted', async () => {
  const readRecords = jest.fn(async () => ({ records: [] }));

  const result = await performHealthConnectSync({
    apiBaseUrl: 'http://127.0.0.1:8010',
    deviceToken: 'token-123',
    now: () => new Date('2026-05-20T10:00:00.000Z'),
    healthConnect: {
      initialize: jest.fn(async () => true),
      requestPermission: jest.fn(async (permissions) =>
        permissions.filter((permission: { recordType: string }) => permission.recordType !== 'ReadHealthDataHistory')
      ),
      readRecords
    },
    apiFactory: () => ({ ingestHealthBatch: jest.fn(async () => ({ accepted: true })) })
  });

  expect(readRecords).toHaveBeenCalledWith(
    'Steps',
    expect.objectContaining({
      timeRangeFilter: expect.objectContaining({
        startTime: '2026-04-20T10:00:00.000Z'
      })
    })
  );
  expect(result.syncMode).toBe('initial_30d');
});

test('paginates each Health Connect record type to collect the maximum available records', async () => {
  const readRecords = jest.fn(async (recordType: string, options: { pageToken?: string }) => {
    if (recordType !== 'Steps') {
      return { records: [] };
    }
    if (!options.pageToken) {
      return {
        pageToken: 'next-page',
        records: [
          {
            recordType: 'Steps',
            startTime: '2026-05-19T08:00:00.000Z',
            endTime: '2026-05-19T09:00:00.000Z',
            count: 1200
          }
        ]
      };
    }
    return {
      records: [
        {
          recordType: 'Steps',
          startTime: '2026-05-20T08:00:00.000Z',
          endTime: '2026-05-20T09:00:00.000Z',
          count: 1400
        }
      ]
    };
  });
  const ingestHealthBatch = jest.fn(async () => ({ accepted: true }));

  const result = await performHealthConnectSync({
    apiBaseUrl: 'http://127.0.0.1:8010',
    deviceToken: 'token-123',
    now: () => new Date('2026-05-20T10:00:00.000Z'),
    healthConnect: {
      initialize: jest.fn(async () => true),
      requestPermission: jest.fn(async (permissions) => permissions),
      readRecords
    },
    apiFactory: () => ({ ingestHealthBatch })
  });

  expect(readRecords).toHaveBeenCalledWith(
    'Steps',
    expect.objectContaining({
      pageSize: 1000,
      pageToken: 'next-page'
    })
  );
  expect(ingestHealthBatch).toHaveBeenCalledWith(
    expect.objectContaining({
      steps: expect.arrayContaining([
        expect.objectContaining({ count: 1200 }),
        expect.objectContaining({ count: 1400 })
      ])
    })
  );
  expect(result.syncedRecordCount).toBe(2);
});

test('caps high-volume biometric pagination so manual sync can reach ingestion', async () => {
  const readRecords = jest.fn(async (recordType: string, options: { pageToken?: string }) => {
    if (recordType !== 'HeartRate') {
      return { records: [] };
    }
    const pageIndex = options.pageToken ? Number(options.pageToken) : 0;
    return {
      pageToken: pageIndex < 9 ? String(pageIndex + 1) : undefined,
      records: [
        {
          recordType: 'HeartRate',
          startTime: `2026-05-20T0${pageIndex}:00:00.000Z`,
          endTime: `2026-05-20T0${pageIndex}:05:00.000Z`,
          samples: [{ time: `2026-05-20T0${pageIndex}:01:00.000Z`, beatsPerMinute: 60 + pageIndex }]
        }
      ]
    };
  });
  const ingestHealthBatch = jest.fn(async () => ({ accepted: true }));

  await performHealthConnectSync({
    apiBaseUrl: 'http://127.0.0.1:8010',
    deviceToken: 'token-123',
    lastSyncAt: '2026-05-19T10:00:00.000Z',
    now: () => new Date('2026-05-20T10:00:00.000Z'),
    healthConnect: {
      initialize: jest.fn(async () => true),
      requestPermission: jest.fn(async (permissions) => permissions),
      readRecords
    },
    apiFactory: () => ({ ingestHealthBatch })
  });

  const heartRateReads = readRecords.mock.calls.filter(([recordType]) => recordType === 'HeartRate');
  expect(heartRateReads).toHaveLength(4);
  expect(heartRateReads.at(-1)?.[1]).toEqual(
    expect.objectContaining({
      pageToken: '3'
    })
  );
  expect(ingestHealthBatch).toHaveBeenCalledWith(
    expect.objectContaining({
      heart_rate: expect.arrayContaining([expect.objectContaining({ bpm: 63 })])
    })
  );
});

test('skips a Health Connect record type that does not return so the sync can finish', async () => {
  jest.useFakeTimers();
  const ingestHealthBatch = jest.fn(async () => ({ accepted: true }));
  const readRecords = jest.fn((recordType: string): Promise<{ records?: any[]; pageToken?: string }> => {
    if (recordType === 'HeartRate') {
      return new Promise(() => {});
    }
    return Promise.resolve({ records: [] });
  });

  try {
    const syncPromise = performHealthConnectSync({
      apiBaseUrl: 'http://127.0.0.1:8010',
      deviceToken: 'token-123',
      lastSyncAt: '2026-05-20T08:00:00.000Z',
      now: () => new Date('2026-05-20T10:00:00.000Z'),
      healthConnect: {
        initialize: jest.fn(async () => true),
        requestPermission: jest.fn(async (permissions) => permissions),
        readRecords
      },
      apiFactory: () => ({ ingestHealthBatch })
    });

    for (let index = 0; index < 100; index += 1) {
      if (readRecords.mock.calls.some(([recordType]) => recordType === 'HeartRate')) {
        break;
      }
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(0);
    }
    expect(readRecords).toHaveBeenCalledWith('HeartRate', expect.any(Object));

    await jest.advanceTimersByTimeAsync(30_000);

    expect(ingestHealthBatch).toHaveBeenCalled();
    await expect(syncPromise).resolves.toMatchObject({
      failedRecordTypes: ['HeartRate']
    });
  } finally {
    jest.useRealTimers();
  }
});

test('fails clearly when device is not paired', async () => {
  await expect(
    performHealthConnectSync({
      apiBaseUrl: 'http://127.0.0.1:8010',
      deviceToken: null,
      healthConnect: {
        initialize: jest.fn(),
        requestPermission: jest.fn(),
        readRecords: jest.fn()
      },
      apiFactory: jest.fn()
    })
  ).rejects.toThrow('Appareil non appairé');
});

test('fails clearly in English when device is not paired and English is requested', async () => {
  await expect(
    performHealthConnectSync({
      apiBaseUrl: 'http://127.0.0.1:8010',
      deviceToken: null,
      language: 'en',
      healthConnect: {
        initialize: jest.fn(),
        requestPermission: jest.fn(),
        readRecords: jest.fn()
      },
      apiFactory: jest.fn()
    })
  ).rejects.toThrow('Device not paired');
});
