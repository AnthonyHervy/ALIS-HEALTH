import { HealthConnectApi } from '../services/api';

test('normalizes the API base URL before sending requests', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({ status: 'ready', app: 'HealthConnect API' })
  }));
  global.fetch = fetchMock as unknown as typeof fetch;

  await new HealthConnectApi('  http://localhost:8010///  ', 'token').checkReady();

  expect(fetchMock).toHaveBeenCalledWith('http://localhost:8010/health/ready', expect.any(Object));
});

test('rejects malformed API base URLs', () => {
  expect(() => new HealthConnectApi('http:example.com', 'token')).toThrow('URL API invalide');
});

test('checks the API readiness endpoint without an auth token', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({ status: 'ready', app: 'HealthConnect API' })
  }));
  global.fetch = fetchMock as unknown as typeof fetch;

  await expect(new HealthConnectApi('http://localhost:8010', 'token').checkReady()).resolves.toEqual({
    status: 'ready',
    app: 'HealthConnect API'
  });

  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:8010/health/ready',
    expect.objectContaining({
      headers: expect.not.objectContaining({
        Authorization: expect.anything()
      })
    })
  );
});

test('fetches the latest sync run with auth token', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({ status: 'success', trigger: 'background', records_received: 42 })
  }));
  global.fetch = fetchMock as unknown as typeof fetch;

  await expect(new HealthConnectApi('http://localhost:8010', 'token').getLatestSyncRun()).resolves.toEqual({
    status: 'success',
    trigger: 'background',
    records_received: 42
  });

  expect(fetchMock).toHaveBeenCalledWith('http://localhost:8010/api/v1/sync-runs/latest', expect.any(Object));
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect((init.headers as Headers).get('Authorization')).toBe('Bearer token');
});

test('allows Health Connect ingest batches to run longer than the quick readiness timeout', async () => {
  jest.useFakeTimers();
  const responsePayload = {
    batch_id: 'batch-1',
    status: 'completed',
    records_received: 42,
    message: 'batch ingested'
  };
  const fetchMock = jest.fn((_url: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
      setTimeout(() => {
        resolve({
          ok: true,
          json: async () => responsePayload
        } as Response);
      }, 9000);
    })
  );
  global.fetch = fetchMock as unknown as typeof fetch;

  const request = new HealthConnectApi('http://localhost:8010', 'token').ingestHealthBatch({
    source_type: 'healthconnect',
    device_name: 'Android Device',
    data_start: '2026-06-07T12:00:00.000Z',
    data_end: '2026-06-07T13:00:00.000Z'
  });

  try {
    await jest.advanceTimersByTimeAsync(9000);
    await expect(request).resolves.toEqual(responsePayload);
  } finally {
    jest.useRealTimers();
  }
});

test('retries Health Connect ingest without raw records when React Native fetch fails before reaching the API', async () => {
  const responsePayload = {
    batch_id: 'batch-1',
    status: 'completed',
    records_received: 2,
    message: 'batch ingested'
  };
  const fetchMock = jest
    .fn()
    .mockRejectedValueOnce(new TypeError('Network request failed'))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => responsePayload
    });
  global.fetch = fetchMock as unknown as typeof fetch;

  await expect(
    new HealthConnectApi('http://localhost:8010', 'token').ingestHealthBatch({
      source_type: 'healthconnect',
      device_name: 'Android Device',
      data_start: '2026-06-07T12:00:00.000Z',
      data_end: '2026-06-07T13:00:00.000Z',
      steps: [{ start_time: '2026-06-07T12:00:00.000Z', end_time: '2026-06-07T13:00:00.000Z', count: 1200 }],
      raw_records: {
        Steps: [{ startTime: '2026-06-07T12:00:00.000Z', endTime: '2026-06-07T13:00:00.000Z', count: 1200 }]
      }
    })
  ).resolves.toEqual(responsePayload);

  expect(fetchMock).toHaveBeenCalledTimes(2);
  const firstBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  const retryBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
  expect(firstBody.raw_records).toBeDefined();
  expect(retryBody.raw_records).toBeUndefined();
  expect(retryBody.steps).toHaveLength(1);
});

test('retries Health Connect ingest without raw records when the upload times out before reaching the API', async () => {
  const responsePayload = {
    batch_id: 'batch-1',
    status: 'completed',
    records_received: 2,
    message: 'batch ingested'
  };
  const fetchMock = jest
    .fn()
    .mockRejectedValueOnce(new Error('La synchronisation santé prend trop de temps. Vérifie la connexion puis réessaie.'))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => responsePayload
    });
  global.fetch = fetchMock as unknown as typeof fetch;

  await expect(
    new HealthConnectApi('http://alis.test:8010', 'token').ingestHealthBatch({
      source_type: 'healthconnect',
      device_name: 'Android Device',
      data_start: '2026-06-07T12:00:00.000Z',
      data_end: '2026-06-07T13:00:00.000Z',
      steps: [{ start_time: '2026-06-07T12:00:00.000Z', end_time: '2026-06-07T13:00:00.000Z', count: 1200 }],
      raw_records: {
        Steps: [{ startTime: '2026-06-07T12:00:00.000Z', endTime: '2026-06-07T13:00:00.000Z', count: 1200 }]
      }
    })
  ).resolves.toEqual(responsePayload);

  expect(fetchMock).toHaveBeenCalledTimes(2);
  const retryBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
  expect(retryBody.raw_records).toBeUndefined();
  expect(retryBody.steps).toHaveLength(1);
});

test('splits oversized Health Connect ingest bodies into smaller sequential requests', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      batch_id: `batch-${fetchMock.mock.calls.length}`,
      status: 'completed',
      records_received: 1,
      message: 'batch ingested'
    })
  }));
  global.fetch = fetchMock as unknown as typeof fetch;

  const largeSteps = Array.from({ length: 2200 }, (_, index) => ({
    start_time: `2026-06-07T12:${String(index % 60).padStart(2, '0')}:00.000Z`,
    end_time: `2026-06-07T12:${String(index % 60).padStart(2, '0')}:30.000Z`,
    count: index + 1,
    metadata: { id: `step-${index}`, dataOrigin: 'com.garmin.android.apps.connectmobile' }
  }));
  const largeRawSteps = largeSteps.map((record) => ({
    startTime: record.start_time,
    endTime: record.end_time,
    count: record.count,
    metadata: record.metadata
  }));

  await new HealthConnectApi('http://alis.test:8010', 'token').ingestHealthBatch({
    source_type: 'healthconnect',
    device_name: 'Android Device',
    data_start: '2026-06-07T12:00:00.000Z',
    data_end: '2026-06-07T13:00:00.000Z',
    steps: largeSteps,
    raw_records: { Steps: largeRawSteps }
  });

  expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
  for (const [, init] of calls) {
    const body = JSON.parse(init.body as string);
    const recordCount =
      (body.steps?.length ?? 0) + Object.values(body.raw_records ?? {}).reduce((total: number, records) => total + (records as unknown[]).length, 0);
    expect(recordCount).toBeGreaterThan(0);
    expect(JSON.stringify(body).length).toBeLessThan(250_000);
  }
});
