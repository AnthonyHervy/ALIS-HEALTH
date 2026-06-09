import { afterEach, expect, test, vi } from 'vitest';

import { fetchAgentPrompt, fetchCoachTodayAdvice, saveAgentPrompt, streamCoachChat } from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

test('fetches coach today advice with bearer token', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      version: 'healthconnect.coach.today_advice.v1',
      generated_at: '2026-05-25T08:00:00Z',
      model: 'qwen3.6:35b',
      advice: { title: 'Priorité sommeil', summary: 'Nuit courte.', action: 'Couche-toi plus tôt.' },
      confidence: 'medium',
      context_window: '24h',
      fallback: false
    })
  }));
  vi.stubGlobal('fetch', fetchMock);

  const payload = await fetchCoachTodayAdvice('token-123');

  expect(payload.advice.title).toBe('Priorité sommeil');
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/coach/today-advice'),
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer token-123' })
    })
  );
});

test('streams coach chat deltas in order', async () => {
  const encoded = new TextEncoder().encode(
    'event: meta\ndata: {"model":"qwen3.6:35b"}\n\n' +
      'event: delta\ndata: {"text":"Bonjour "}\n\n' +
      'event: delta\ndata: {"text":"Alex"}\n\n' +
      'event: done\ndata: {}\n\n'
  );
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    }
  });
  const fetchMock = vi.fn(async () => ({ ok: true, body: stream }));
  vi.stubGlobal('fetch', fetchMock);

  const chunks: string[] = [];
  await streamCoachChat({
    token: 'token-123',
    message: 'Comment récupérer ?',
    history: [],
    onDelta: (chunk) => chunks.push(chunk)
  });

  expect(chunks).toEqual(['Bonjour ', 'Alex']);
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/coach/chat/stream'),
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ message: 'Comment récupérer ?', mode: 'coach', history: [] }),
      headers: expect.objectContaining({ Authorization: 'Bearer token-123' })
    })
  );
});

test('fetches and saves editable agent prompt', async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => init?.method === 'PUT'
      ? { prompt: 'Prompt custom', is_default: false, updated_at: '2026-05-27T10:00:00Z' }
      : { prompt: 'Prompt default', is_default: true, updated_at: null }
  }));
  vi.stubGlobal('fetch', fetchMock);

  const current = await fetchAgentPrompt('token-123');
  const saved = await saveAgentPrompt('token-123', 'Prompt custom');

  expect(current.prompt).toBe('Prompt default');
  expect(saved.is_default).toBe(false);
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/config/agent-prompt'),
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-123' }) })
  );
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/config/agent-prompt'),
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ prompt: 'Prompt custom' })
    })
  );
});
