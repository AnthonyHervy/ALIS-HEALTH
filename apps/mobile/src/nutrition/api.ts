import { normalizeApiBaseUrl } from '../apiBaseUrl';
import { DEVICE_NAME } from '../config';
import type {
  LocalPhoto,
  NutritionDatasetStatus,
  NutritionDiagnostic,
  NutritionFoodReference,
  NutritionMeal,
  NutritionMealEdit,
  Settings
} from './types';

type FetchLike = typeof fetch;
type SaveSettings = (settings: Partial<Settings>) => Promise<unknown> | unknown;
const DEFAULT_REQUEST_TIMEOUT_MS = 20000;

class UnauthorizedError extends Error {
  constructor() {
    super('ALIS Nutrition API 401');
  }
}

export function cleanBaseUrl(value: string): string {
  return normalizeApiBaseUrl(value);
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error('ALIS Nutrition API timeout')), timeoutMs);
  });
  try {
    return (await Promise.race([fetchImpl(url, init), timeout])) as Response;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function readJson<T>(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(fetchImpl, url, init, timeoutMs);
  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    let detail = `ALIS Nutrition API ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') {
        detail = body.detail;
      }
    } catch (_error) {
      // Keep the HTTP status fallback.
    }
    throw new Error(detail);
  }
  return response.json();
}

async function readNoContent(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<void> {
  const response = await fetchWithTimeout(fetchImpl, url, init, timeoutMs);
  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    let detail = `ALIS Nutrition API ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') {
        detail = body.detail;
      }
    } catch (_error) {
      // Keep the HTTP status fallback.
    }
    throw new Error(detail);
  }
}

async function registerDevice(fetchImpl: FetchLike, settings: Settings, timeoutMs: number): Promise<string> {
  const payload = await readJson<{ device_token: string }>(
    fetchImpl,
    `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/auth/register`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairing_code: settings.pairingCode,
        device_name: DEVICE_NAME
      })
    },
    timeoutMs
  );
  return payload.device_token;
}

async function ensureToken(fetchImpl: FetchLike, settings: Settings, save: SaveSettings, timeoutMs: number): Promise<string> {
  if (settings.deviceToken) {
    return settings.deviceToken;
  }
  const token = await registerDevice(fetchImpl, settings, timeoutMs);
  await save({ deviceToken: token });
  return token;
}

function mealPath(settings: Settings, suffix = ''): string {
  return `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/nutrition/meals${suffix}`;
}

function foodSearchPath(settings: Settings, query: string): string {
  return `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/nutrition/foods/search?q=${encodeURIComponent(query)}`;
}

function datasetStatusPath(settings: Settings): string {
  return `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/nutrition/datasets/status`;
}

function diagnosticsPath(settings: Settings): string {
  return `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/nutrition/diagnostics`;
}

async function withTokenRetry<T>(
  fetchImpl: FetchLike,
  settings: Settings,
  save: SaveSettings,
  timeoutMs: number,
  request: (token: string) => Promise<T>
): Promise<{ token: string; value: T }> {
  let token = await ensureToken(fetchImpl, settings, save, timeoutMs);
  try {
    return { token, value: await request(token) };
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      throw error;
    }
    token = await registerDevice(fetchImpl, { ...settings, deviceToken: null }, timeoutMs);
    await save({ deviceToken: token });
    return { token, value: await request(token) };
  }
}

export function createNutritionApiClient({
  fetchImpl = fetch,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
}: {
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
} = {}) {
  async function listMeals(settings: Settings, save: SaveSettings): Promise<{ meals: NutritionMeal[]; token: string }> {
    const result = await withTokenRetry(fetchImpl, settings, save, requestTimeoutMs, (token) =>
      readJson<{ meals: NutritionMeal[] }>(fetchImpl, mealPath(settings), {
        headers: { Authorization: `Bearer ${token}` }
      }, requestTimeoutMs)
    );
    return { token: result.token, meals: result.value.meals };
  }

  async function fetchMeal(settings: Settings, save: SaveSettings, mealId: string): Promise<{ meal: NutritionMeal; token: string }> {
    const result = await withTokenRetry(fetchImpl, settings, save, requestTimeoutMs, (token) =>
      readJson<NutritionMeal>(fetchImpl, mealPath(settings, `/${mealId}`), {
        headers: { Authorization: `Bearer ${token}` }
      }, requestTimeoutMs)
    );
    return { token: result.token, meal: result.value };
  }

  async function createMeal(
    settings: Settings,
    save: SaveSettings,
    photos: LocalPhoto[],
    options: { consumedAt?: string; mealType?: string; notes?: string; barcode?: string } = {}
  ): Promise<{ meal: NutritionMeal; token: string }> {
    const form = new FormData();
    if (options.consumedAt) {
      form.append('consumed_at', options.consumedAt);
    }
    if (options.mealType) {
      form.append('meal_type', options.mealType);
    }
    const notes = options.notes?.trim();
    if (notes) {
      form.append('notes', notes);
    }
    const barcode = options.barcode?.trim();
    if (barcode) {
      form.append('barcode', barcode);
    }
    for (const photo of photos) {
      form.append('photos', {
        uri: photo.uri,
        name: photo.name,
        type: photo.type
      } as unknown as Blob);
    }
    const result = await withTokenRetry(fetchImpl, settings, save, requestTimeoutMs, (token) =>
      readJson<NutritionMeal>(fetchImpl, mealPath(settings), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      }, requestTimeoutMs)
    );
    return { token: result.token, meal: result.value };
  }

  async function updateMeal(
    settings: Settings,
    save: SaveSettings,
    mealId: string,
    items: NutritionMealEdit[]
  ): Promise<{ meal: NutritionMeal; token: string }> {
    const result = await withTokenRetry(fetchImpl, settings, save, requestTimeoutMs, (token) =>
      readJson<NutritionMeal>(fetchImpl, mealPath(settings, `/${mealId}`), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ items })
      }, requestTimeoutMs)
    );
    return { token: result.token, meal: result.value };
  }

  async function validateMeal(settings: Settings, save: SaveSettings, mealId: string): Promise<{ meal: NutritionMeal; token: string }> {
    const result = await withTokenRetry(fetchImpl, settings, save, requestTimeoutMs, (token) =>
      readJson<NutritionMeal>(fetchImpl, mealPath(settings, `/${mealId}/validate`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }, requestTimeoutMs)
    );
    return { token: result.token, meal: result.value };
  }

  async function reanalyzeMeal(settings: Settings, save: SaveSettings, mealId: string): Promise<{ meal: NutritionMeal; token: string }> {
    const result = await withTokenRetry(fetchImpl, settings, save, requestTimeoutMs, (token) =>
      readJson<NutritionMeal>(fetchImpl, mealPath(settings, `/${mealId}/reanalyze`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }, requestTimeoutMs)
    );
    return { token: result.token, meal: result.value };
  }

  async function deleteMeal(settings: Settings, save: SaveSettings, mealId: string): Promise<{ token: string }> {
    const result = await withTokenRetry(fetchImpl, settings, save, requestTimeoutMs, (token) =>
      readNoContent(fetchImpl, mealPath(settings, `/${mealId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      }, requestTimeoutMs)
    );
    return { token: result.token };
  }

  async function searchFoodReferences(
    settings: Settings,
    save: SaveSettings,
    query: string
  ): Promise<{ foods: NutritionFoodReference[]; token: string }> {
    const result = await withTokenRetry(fetchImpl, settings, save, requestTimeoutMs, (token) =>
      readJson<{ foods: NutritionFoodReference[] }>(fetchImpl, foodSearchPath(settings, query), {
        headers: { Authorization: `Bearer ${token}` }
      }, requestTimeoutMs)
    );
    return { token: result.token, foods: result.value.foods };
  }

  async function fetchDatasetStatus(settings: Settings, save: SaveSettings): Promise<{ status: NutritionDatasetStatus; token: string }> {
    const result = await withTokenRetry(fetchImpl, settings, save, requestTimeoutMs, (token) =>
      readJson<NutritionDatasetStatus>(fetchImpl, datasetStatusPath(settings), {
        headers: { Authorization: `Bearer ${token}` }
      }, requestTimeoutMs)
    );
    return { token: result.token, status: result.value };
  }

  async function fetchDiagnostics(settings: Settings, save: SaveSettings): Promise<{ diagnostics: NutritionDiagnostic; token: string }> {
    const result = await withTokenRetry(fetchImpl, settings, save, requestTimeoutMs, (token) =>
      readJson<NutritionDiagnostic>(fetchImpl, diagnosticsPath(settings), {
        headers: { Authorization: `Bearer ${token}` }
      }, requestTimeoutMs)
    );
    return { token: result.token, diagnostics: result.value };
  }

  return {
    listMeals,
    fetchMeal,
    createMeal,
    updateMeal,
    validateMeal,
    reanalyzeMeal,
    deleteMeal,
    searchFoodReferences,
    fetchDatasetStatus,
    fetchDiagnostics
  };
}
