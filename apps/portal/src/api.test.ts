import { afterEach, expect, test, vi } from 'vitest';

import { fetchCoachGoals, fetchLatestSyncRun, fetchPortalData, fetchSyncRunSummary, overviewForWindow, saveCoachGoals, saveSourcePreferences } from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

test('fetches latest sync run with bearer token', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ status: 'success', trigger: 'background', records_received: 12 })
  }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(fetchLatestSyncRun('token-123')).resolves.toMatchObject({
    status: 'success',
    trigger: 'background',
    records_received: 12
  });

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/sync-runs/latest'),
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer token-123'
      })
    })
  );
});

test('fetches sync run summary with bearer token', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      total_runs: 3,
      success_runs: 3,
      error_runs: 0,
      duplicate_runs: 1,
      records_received: 42,
      recent_runs: []
    })
  }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(fetchSyncRunSummary('token-123')).resolves.toMatchObject({
    total_runs: 3,
    duplicate_runs: 1,
    records_received: 42
  });

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/sync-runs/summary'),
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer token-123'
      })
    })
  );
});

test('auto-pairs portal when no token is stored', async () => {
  const storage = new Map<string, string>();
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/auth/register')) {
      return { ok: true, json: async () => ({ device_token: 'fresh-token' }) };
    }
    if (url.includes('/context/dashboard')) {
      return {
        ok: true,
        json: async () => ({
          windows: {
            last_24h: { window: '24h', source_badge: 'Custom', series: [] },
            week: { window: '7d', source_badge: 'Custom', series: [] },
            month: { window: '30d', source_badge: 'Custom', series: [] }
          },
          latest_sync_run: null,
          sync_summary: { total_runs: 0, success_runs: 0, error_runs: 0, duplicate_runs: 0, records_received: 0, recent_runs: [] },
          source_config: { detected_sources: {}, preferred_sources: {}, effective_sources: {}, source_badge: 'Auto' },
          generated_at: '2026-05-24T12:00:00Z'
        })
      };
    }
    throw new Error(url);
  });
  vi.stubGlobal('fetch', fetchMock);

  const result = await fetchPortalData('7d', {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  });

  expect(storage.get('healthconnect.portalToken')).toBe('fresh-token');
  expect(result.token).toBe('fresh-token');
  expect(result.dashboard.windows.week.window).toBe('7d');
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/auth/register'), expect.any(Object));
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/context/dashboard'), expect.any(Object));
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/v1/context/overview'), expect.any(Object));
});

test('re-pairs and retries once when stored token is unauthorized', async () => {
  const storage = new Map<string, string>([['healthconnect.portalToken', 'expired-token']]);
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/context/dashboard') && (init?.headers as Record<string, string>)?.Authorization === 'Bearer expired-token') {
      return { ok: false, status: 401, json: async () => ({ detail: 'Unauthorized' }) };
    }
    if (url.includes('/auth/register')) {
      return { ok: true, json: async () => ({ device_token: 'fresh-token' }) };
    }
    if (url.includes('/context/dashboard')) {
      return {
        ok: true,
        json: async () => ({
          windows: {
            last_24h: { window: '24h', source_badge: 'Custom', series: [] },
            week: { window: '7d', source_badge: 'Custom', series: [] },
            month: { window: '30d', source_badge: 'Custom', series: [] }
          },
          latest_sync_run: null,
          sync_summary: { total_runs: 0, success_runs: 0, error_runs: 0, duplicate_runs: 0, records_received: 0, recent_runs: [] },
          source_config: { detected_sources: {}, preferred_sources: {}, effective_sources: {}, source_badge: 'Auto' },
          generated_at: '2026-05-24T12:00:00Z'
        })
      };
    }
    throw new Error(url);
  });
  vi.stubGlobal('fetch', fetchMock);

  const result = await fetchPortalData('7d', {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  });

  expect(result.token).toBe('fresh-token');
  expect(storage.get('healthconnect.portalToken')).toBe('fresh-token');
});

test('selects overview windows from the dashboard bundle without fetching again', () => {
  const dashboard = {
    generated_at: '2026-05-24T12:00:00Z',
    windows: {
      last_24h: { window: '24h', series: [{ date: '2026-05-24' }] },
      week: { window: '7d', series: [{ date: '2026-05-18' }] },
      month: { window: '30d', series: [{ date: '2026-04-25' }] }
    },
    latest_sync_run: null,
    sync_summary: { total_runs: 0, success_runs: 0, error_runs: 0, duplicate_runs: 0, records_received: 0, recent_runs: [] },
    source_config: { detected_sources: {}, preferred_sources: {}, effective_sources: {}, source_badge: 'Auto' }
  } as any;

  expect(overviewForWindow(dashboard, '24h').window).toBe('24h');
  expect(overviewForWindow(dashboard, '7d').series[0].date).toBe('2026-05-18');
  expect(overviewForWindow(dashboard, '30d').series[0].date).toBe('2026-04-25');
});

test('refreshes the dashboard snapshot before reading portal data when requested', async () => {
  const storage = new Map<string, string>([['healthconnect.portalToken', 'token-123']]);
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/context/dashboard/refresh')) {
      return {
        ok: true,
        json: async () => ({
          windows: {
            last_24h: { window: '24h', source_badge: 'Custom', series: [{ date: '2026-05-26' }] },
            week: { window: '7d', source_badge: 'Custom', series: [] },
            month: { window: '30d', source_badge: 'Custom', series: [] }
          },
          latest_sync_run: null,
          sync_summary: { total_runs: 0, success_runs: 0, error_runs: 0, duplicate_runs: 0, records_received: 0, recent_runs: [] },
          source_config: { detected_sources: {}, preferred_sources: {}, effective_sources: {}, source_badge: 'Auto' },
          generated_at: '2026-05-26T08:00:00Z'
        })
      };
    }
    throw new Error(url);
  });
  vi.stubGlobal('fetch', fetchMock);

  const result = await fetchPortalData('24h', {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  }, { refresh: true });

  expect(result.dashboard.windows.last_24h.series[0].date).toBe('2026-05-26');
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/context/dashboard/refresh'),
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer token-123' })
    })
  );
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/v1/context/dashboard'))).toBe(false);
});

test('saves source preferences with bearer token', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ preferred_sources: { activity: 'android' }, effective_sources: { activity: 'android' }, detected_sources: {}, source_badge: 'Custom' })
  }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(saveSourcePreferences('token-123', { activity: 'android' })).resolves.toMatchObject({
    preferred_sources: { activity: 'android' }
  });

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/config/source-preferences'),
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ preferences: { activity: 'android' } }),
      headers: expect.objectContaining({ Authorization: 'Bearer token-123' })
    })
  );
});

test('fetches and saves coach goals with bearer token', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => ({
      goals: [{ slug: 'recovery', label: 'Récupération', priority: 1, enabled: init?.method !== 'PUT' }],
      is_default: init?.method !== 'PUT',
      updated_at: init?.method === 'PUT' ? '2026-05-31T08:00:00Z' : null
    })
  }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(fetchCoachGoals('token-123')).resolves.toMatchObject({ is_default: true });
  await expect(saveCoachGoals('token-123', [{ slug: 'endurance', label: 'Endurance', priority: 1, enabled: true }])).resolves.toMatchObject({
    is_default: false
  });

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/config/coach-goals'),
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ goals: [{ slug: 'endurance', label: 'Endurance', priority: 1, enabled: true }] }),
      headers: expect.objectContaining({ Authorization: 'Bearer token-123' })
    })
  );
});
