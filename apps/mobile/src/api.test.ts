import { createAlisApiClient, parseSseText } from './api';
import type { Settings } from './types';

function settings(token: string | null = null): Settings {
  return {
    apiBaseUrl: 'http://health.local:8010',
    pairingCode: 'pair-code',
    deviceToken: token,
    notificationsEnabled: false
  };
}

test('auto-pairs when no token exists and fetches dashboard', async () => {
  const fetchMock = jest.fn(async (url: string) => {
    if (url.endsWith('/auth/register')) {
      return { ok: true, status: 200, json: async () => ({ device_token: 'fresh-token' }) };
    }
    if (url.endsWith('/context/dashboard')) {
      return { ok: true, status: 200, json: async () => ({ generated_at: 'now', windows: {}, latest_sync_run: null, sync_summary: {}, source_config: {} }) };
    }
    throw new Error(url);
  });
  const client = createAlisApiClient({ fetchImpl: fetchMock as any });
  const saved: Partial<Settings> = {};

  const result = await client.fetchDashboard(settings(), (next) => {
    Object.assign(saved, next);
  });

  expect(result.token).toBe('fresh-token');
  expect(saved.deviceToken).toBe('fresh-token');
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/register'), expect.objectContaining({ method: 'POST' }));
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/context/dashboard'), expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' })
  }));
});

test('re-pairs once when stored token is unauthorized', async () => {
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/context/dashboard') && (init?.headers as Record<string, string>).Authorization === 'Bearer expired') {
      return { ok: false, status: 401, json: async () => ({ detail: 'Unauthorized' }) };
    }
    if (url.endsWith('/auth/register')) {
      return { ok: true, status: 200, json: async () => ({ device_token: 'fresh-token' }) };
    }
    return { ok: true, status: 200, json: async () => ({ generated_at: 'now', windows: {}, latest_sync_run: null, sync_summary: {}, source_config: {} }) };
  });
  const client = createAlisApiClient({ fetchImpl: fetchMock as any });
  const saved: Partial<Settings> = {};

  const result = await client.fetchDashboard(settings('expired'), (next) => {
    Object.assign(saved, next);
  });

  expect(result.token).toBe('fresh-token');
  expect(saved.deviceToken).toBe('fresh-token');
});

test('refreshes dashboard through refresh endpoint', async () => {
  const fetchMock = jest.fn(async (url: string) => {
    expect(url).toContain('/context/dashboard/refresh');
    return { ok: true, status: 200, json: async () => ({ generated_at: 'now', windows: {}, latest_sync_run: null, sync_summary: {}, source_config: {} }) };
  });
  const client = createAlisApiClient({ fetchImpl: fetchMock as any });

  await client.fetchDashboard(settings('token'), jest.fn(), { refresh: true });

  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/context/dashboard/refresh'), expect.objectContaining({ method: 'POST' }));
});

test('normalizes dashboard API base URLs before fetching', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ generated_at: 'now', windows: {}, latest_sync_run: null, sync_summary: {}, source_config: {} })
  }));
  const client = createAlisApiClient({ fetchImpl: fetchMock as any });

  await client.fetchDashboard({
    ...settings('token'),
    apiBaseUrl: '  http://health.local:8010///  '
  }, jest.fn());

  expect(fetchMock).toHaveBeenCalledWith(
    'http://health.local:8010/api/v1/context/dashboard',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer token' })
    })
  );
});

test('rejects malformed dashboard API base URLs before fetching', async () => {
  const fetchMock = jest.fn();
  const client = createAlisApiClient({ fetchImpl: fetchMock as any });

  await expect(client.fetchDashboard({
    ...settings('token'),
    apiBaseUrl: 'http:health.local:8010'
  }, jest.fn())).rejects.toThrow('URL API invalide');

  expect(fetchMock).not.toHaveBeenCalled();
});

test('uses ALIS language for generic dashboard API errors', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: false,
    status: 503,
    json: async () => ({ detail: 'Unavailable' })
  }));
  const client = createAlisApiClient({ fetchImpl: fetchMock as any });

  await expect(client.fetchDashboard(settings('token'), jest.fn())).rejects.toThrow('ALIS API 503');
});

test('parses server-sent coach deltas', () => {
  expect(parseSseText('event: delta\ndata: {"text":"Bon"}\n\nevent: delta\ndata: {"text":"jour"}\n\nevent: done\ndata: {}\n\n')).toEqual(['Bon', 'jour']);
});

test('fetches and saves editable agent prompt', async () => {
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/config/agent-prompt') && init?.method === 'PUT') {
      return { ok: true, status: 200, json: async () => ({ prompt: 'Prompt custom', is_default: false, updated_at: 'now' }) };
    }
    if (url.endsWith('/config/agent-prompt')) {
      return { ok: true, status: 200, json: async () => ({ prompt: 'Prompt default', is_default: true, updated_at: null }) };
    }
    throw new Error(url);
  });
  const client = createAlisApiClient({ fetchImpl: fetchMock as any });

  const fetched = await client.fetchAgentPrompt(settings('token'), jest.fn());
  const saved = await client.saveAgentPrompt(settings('token'), jest.fn(), 'Prompt custom');

  expect(fetched.agentPrompt.is_default).toBe(true);
  expect(saved.agentPrompt.prompt).toBe('Prompt custom');
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/config/agent-prompt'), expect.objectContaining({
    method: 'PUT',
    body: JSON.stringify({ prompt: 'Prompt custom' })
  }));
});

test('fetches and saves structured coach goals', async () => {
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/config/coach-goals') && init?.method === 'PUT') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          goals: [{ slug: 'endurance', label: 'Endurance', priority: 1, enabled: true }],
          is_default: false,
          updated_at: 'now'
        })
      };
    }
    if (url.endsWith('/config/coach-goals')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          goals: [{ slug: 'recovery', label: 'Récupération', priority: 1, enabled: true }],
          is_default: true,
          updated_at: null
        })
      };
    }
    throw new Error(url);
  });
  const client = createAlisApiClient({ fetchImpl: fetchMock as any });

  const fetched = await client.fetchCoachGoals(settings('token'), jest.fn());
  const saved = await client.saveCoachGoals(settings('token'), jest.fn(), [{ slug: 'endurance', label: 'Endurance', priority: 1, enabled: true }]);

  expect(fetched.coachGoals.is_default).toBe(true);
  expect(saved.coachGoals.goals[0].slug).toBe('endurance');
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/config/coach-goals'), expect.objectContaining({
    method: 'PUT',
    body: JSON.stringify({ goals: [{ slug: 'endurance', label: 'Endurance', priority: 1, enabled: true }] })
  }));
});

test('fetches coach model status before chat warmup', async () => {
  const fetchMock = jest.fn(async (url: string) => {
    if (url.endsWith('/coach/status')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'gpt-oss:20b',
          loaded: false,
          first_token_latency_ms: 42000,
          keep_alive: '4h',
          context_tokens: 8192,
          think: 'medium'
        })
      };
    }
    throw new Error(url);
  });
  const client = createAlisApiClient({ fetchImpl: fetchMock as any });

  const result = await client.fetchCoachStatus(settings('token'), jest.fn());

  expect(result.status.loaded).toBe(false);
  expect(result.status.model).toBe('gpt-oss:20b');
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/coach/status'), expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer token' })
  }));
});

test('uses ALIS language for coach stream API errors', async () => {
  const fetchMock = jest.fn(async (url: string) => {
    if (url.endsWith('/coach/chat/stream')) {
      return { ok: false, status: 503, text: async () => '' };
    }
    throw new Error(url);
  });
  const client = createAlisApiClient({ fetchImpl: fetchMock as any });

  await expect(
    client.streamCoachChat({
      settings: settings('token'),
      save: jest.fn(),
      message: 'Bonjour',
      history: [],
      onDelta: jest.fn()
    })
  ).rejects.toThrow('ALIS Coach API 503');
});
