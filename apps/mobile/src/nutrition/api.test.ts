import { createNutritionApiClient } from './api';
import type { NutritionMeal } from './types';

function settings(token: string | null = 'device-token') {
  return {
    apiBaseUrl: 'http://health.local:8010',
    pairingCode: 'pair-code',
    deviceToken: token
  };
}

test('creates a multipart meal upload with multiple photos', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ id: 'meal-1', status: 'analyzing', photo_count: 2 })
  }));
  const client = createNutritionApiClient({ fetchImpl: fetchMock as any });

  await client.createMeal(settings(), jest.fn(), [
    { uri: 'file:///meal.jpg', name: 'meal.jpg', type: 'image/jpeg' },
    { uri: 'file:///barcode.jpg', name: 'barcode.jpg', type: 'image/jpeg' }
  ]);

  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  expect(url).toBe('http://health.local:8010/api/v1/nutrition/meals');
  expect(init.method).toBe('POST');
  expect(headers.Authorization).toBe('Bearer device-token');
  expect(init.body).toBeInstanceOf(FormData);
});

test('adds user notes and barcode hints to meal uploads', async () => {
  const appendSpy = jest.spyOn(FormData.prototype, 'append');
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ id: 'meal-1', status: 'analyzing', photo_count: 1 })
  }));
  const client = createNutritionApiClient({ fetchImpl: fetchMock as any });

  await client.createMeal(settings(), jest.fn(), [
    { uri: 'file:///meal.jpg', name: 'meal.jpg', type: 'image/jpeg' }
  ], {
    notes: 'Assiette de riz, poulet et sauce.',
    barcode: '  3017620422003  '
  });

  expect(appendSpy).toHaveBeenCalledWith('notes', 'Assiette de riz, poulet et sauce.');
  expect(appendSpy).toHaveBeenCalledWith('barcode', '3017620422003');
  appendSpy.mockRestore();
});

test('auto-registers when no token exists before listing meals', async () => {
  const meal: Partial<NutritionMeal> = { id: 'meal-1', status: 'ready' };
  const fetchMock = jest.fn(async (url: string) => {
    if (url.endsWith('/auth/register')) {
      return { ok: true, status: 200, json: async () => ({ device_token: 'new-token' }) };
    }
    return { ok: true, status: 200, json: async () => ({ meals: [meal] }) };
  });
  const save = jest.fn();
  const client = createNutritionApiClient({ fetchImpl: fetchMock as any });

  const result = await client.listMeals(settings(null), save);

  expect(save).toHaveBeenCalledWith({ deviceToken: 'new-token' });
  expect(result.token).toBe('new-token');
  expect(result.meals[0].id).toBe('meal-1');
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/auth/register'),
    expect.objectContaining({
      body: JSON.stringify({
        pairing_code: 'pair-code',
        device_name: 'ALIS'
      })
    })
  );
});

test('normalizes Nutrition API base URLs before listing meals', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ meals: [] })
  }));
  const client = createNutritionApiClient({ fetchImpl: fetchMock as any });

  await client.listMeals({
    ...settings(),
    apiBaseUrl: '  http://health.local:8010///  '
  }, jest.fn());

  expect(fetchMock).toHaveBeenCalledWith(
    'http://health.local:8010/api/v1/nutrition/meals',
    expect.objectContaining({
      headers: { Authorization: 'Bearer device-token' }
    })
  );
});

test('rejects malformed Nutrition API base URLs before fetching', async () => {
  const fetchMock = jest.fn();
  const client = createNutritionApiClient({ fetchImpl: fetchMock as any });

  await expect(client.listMeals({
    ...settings(),
    apiBaseUrl: 'http:health.local:8010'
  }, jest.fn())).rejects.toThrow('URL API invalide');

  expect(fetchMock).not.toHaveBeenCalled();
});

test('sends review edits, validation, reanalysis, and delete requests', async () => {
  const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: init?.method === 'DELETE' ? 204 : 200,
    json: async () => ({ id: 'meal-1' })
  }));
  const client = createNutritionApiClient({ fetchImpl: fetchMock as any });

  await client.updateMeal(settings(), jest.fn(), 'meal-1', [
    { id: 'item-1', portion_g: 200, included: true, reference_id: 'food-1' }
  ]);
  await client.validateMeal(settings(), jest.fn(), 'meal-1');
  await client.reanalyzeMeal(settings(), jest.fn(), 'meal-1');
  await client.deleteMeal(settings(), jest.fn(), 'meal-1');

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    'http://health.local:8010/api/v1/nutrition/meals/meal-1',
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        items: [{ id: 'item-1', portion_g: 200, included: true, reference_id: 'food-1' }]
      })
    })
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    'http://health.local:8010/api/v1/nutrition/meals/meal-1/validate',
    expect.objectContaining({ method: 'POST' })
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    3,
    'http://health.local:8010/api/v1/nutrition/meals/meal-1/reanalyze',
    expect.objectContaining({ method: 'POST' })
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    4,
    'http://health.local:8010/api/v1/nutrition/meals/meal-1',
    expect.objectContaining({ method: 'DELETE' })
  );
});

test('searches nutrition food references', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ foods: [{ id: 'food-1', name: 'Poulet roti' }] })
  }));
  const client = createNutritionApiClient({ fetchImpl: fetchMock as any });

  const result = await client.searchFoodReferences(settings(), jest.fn(), 'poulet roti');

  expect(fetchMock).toHaveBeenCalledWith(
    'http://health.local:8010/api/v1/nutrition/foods/search?q=poulet%20roti',
    expect.objectContaining({
      headers: { Authorization: 'Bearer device-token' }
    })
  );
  expect(result.foods[0].id).toBe('food-1');
});

test('fetches nutrition dataset status', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ciqual_loaded: true,
      openfoodfacts_loaded: false,
      total_references: 3484,
      sources: [{ source: 'ciqual', reference_count: 3484, dataset_versions: ['ciqual-2025-11-03'] }]
    })
  }));
  const client = createNutritionApiClient({ fetchImpl: fetchMock as any });

  const result = await client.fetchDatasetStatus(settings(), jest.fn());

  expect(fetchMock).toHaveBeenCalledWith(
    'http://health.local:8010/api/v1/nutrition/datasets/status',
    expect.objectContaining({
      headers: { Authorization: 'Bearer device-token' }
    })
  );
  expect(result.status.ciqual_loaded).toBe(true);
  expect(result.status.total_references).toBe(3484);
});

test('fetches nutrition diagnostics', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      api_status: 'ok',
      datasets: {
        ciqual_loaded: true,
        openfoodfacts_loaded: true,
        total_references: 8826,
        sources: []
      },
      ollama: {
        base_url: 'http://host.docker.internal:11434',
        model: 'qwen3-vl:30b',
        reachable: true,
        model_available: true
      },
      jobs: { pending: 1, running: 0, failed: 0 }
    })
  }));
  const client = createNutritionApiClient({ fetchImpl: fetchMock as any });

  const result = await client.fetchDiagnostics(settings(), jest.fn());

  expect(fetchMock).toHaveBeenCalledWith(
    'http://health.local:8010/api/v1/nutrition/diagnostics',
    expect.objectContaining({
      headers: { Authorization: 'Bearer device-token' }
    })
  );
  expect(result.diagnostics.ollama.model_available).toBe(true);
  expect(result.diagnostics.jobs.pending).toBe(1);
});

test('times out stuck network requests', async () => {
  const fetchMock = jest.fn(() => new Promise(() => undefined));
  const client = createNutritionApiClient({ fetchImpl: fetchMock as any, requestTimeoutMs: 1 });

  await expect(client.listMeals(settings(), jest.fn())).rejects.toThrow('ALIS Nutrition API timeout');
});
