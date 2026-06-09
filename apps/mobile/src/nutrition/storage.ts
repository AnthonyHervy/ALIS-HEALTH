import * as SecureStore from 'expo-secure-store';

import { normalizeApiBaseUrl, normalizeApiBaseUrlOrFallback } from '../apiBaseUrl';
import { DEFAULT_API_BASE_URL, DEFAULT_PAIRING_CODE } from './config';
import type { NutritionFoodReference, Settings } from './types';

const API_URL_KEY = 'alis.apiBaseUrl';
const PAIRING_CODE_KEY = 'alis.pairingCode';
const TOKEN_KEY = 'alis.deviceToken';
const LEARNED_REFERENCE_PREFIX = 'nutrition.learnedReference.';
const MAX_LEARNED_REFERENCES_PER_FOOD = 3;

const memoryStorage = new Map<string, string>();

type SecureStoreWithAvailability = typeof SecureStore & {
  isAvailableAsync?: () => Promise<boolean>;
};

async function canUseSecureStore(): Promise<boolean> {
  const isAvailableAsync = (SecureStore as SecureStoreWithAvailability).isAvailableAsync;
  if (!isAvailableAsync) {
    return true;
  }
  try {
    return await isAvailableAsync();
  } catch (_error) {
    return true;
  }
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch (_error) {
    return null;
  }
}

function fallbackGetItem(key: string): string | null {
  const storage = browserStorage();
  return storage?.getItem(key) ?? memoryStorage.get(key) ?? null;
}

function fallbackSetItem(key: string, value: string): void {
  const storage = browserStorage();
  if (storage) {
    storage.setItem(key, value);
    return;
  }
  memoryStorage.set(key, value);
}

function fallbackDeleteItem(key: string): void {
  const storage = browserStorage();
  if (storage) {
    storage.removeItem(key);
  }
  memoryStorage.delete(key);
}

async function getStoredItem(key: string): Promise<string | null> {
  if (await canUseSecureStore()) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (_error) {
      return fallbackGetItem(key);
    }
  }
  return fallbackGetItem(key);
}

async function setStoredItem(key: string, value: string): Promise<void> {
  if (await canUseSecureStore()) {
    try {
      await SecureStore.setItemAsync(key, value);
      return;
    } catch (_error) {
      // Fall through to the web/local fallback.
    }
  }
  fallbackSetItem(key, value);
}

async function deleteStoredItem(key: string): Promise<void> {
  if (await canUseSecureStore()) {
    try {
      await SecureStore.deleteItemAsync(key);
      return;
    } catch (_error) {
      // Fall through to the web/local fallback.
    }
  }
  fallbackDeleteItem(key);
}

export async function loadSettings(): Promise<Settings> {
  const [apiBaseUrl, pairingCode, deviceToken] = await Promise.all([
    getStoredItem(API_URL_KEY),
    getStoredItem(PAIRING_CODE_KEY),
    getStoredItem(TOKEN_KEY)
  ]);
  return {
    apiBaseUrl: normalizeApiBaseUrlOrFallback(apiBaseUrl, DEFAULT_API_BASE_URL),
    pairingCode: pairingCode || DEFAULT_PAIRING_CODE,
    deviceToken: deviceToken || null
  };
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  await Promise.all([
    settings.apiBaseUrl !== undefined ? setStoredItem(API_URL_KEY, normalizeApiBaseUrl(settings.apiBaseUrl)) : Promise.resolve(),
    settings.pairingCode !== undefined ? setStoredItem(PAIRING_CODE_KEY, settings.pairingCode) : Promise.resolve(),
    settings.deviceToken !== undefined
      ? settings.deviceToken
        ? setStoredItem(TOKEN_KEY, settings.deviceToken)
        : deleteStoredItem(TOKEN_KEY)
      : Promise.resolve()
  ]);
}

function normalizeFoodKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function learnedReferenceKey(foodName: string): string | null {
  const normalized = normalizeFoodKey(foodName);
  return normalized ? `${LEARNED_REFERENCE_PREFIX}${normalized}` : null;
}

export async function loadLearnedFoodReferences(foodName: string): Promise<NutritionFoodReference[]> {
  const key = learnedReferenceKey(foodName);
  if (!key) {
    return [];
  }
  const raw = await getStoredItem(key);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_LEARNED_REFERENCES_PER_FOOD) : [];
  } catch (_error) {
    return [];
  }
}

export async function rememberFoodReference(foodName: string, reference: NutritionFoodReference): Promise<void> {
  const key = learnedReferenceKey(foodName);
  if (!key) {
    return;
  }
  const current = await loadLearnedFoodReferences(foodName);
  const withoutDuplicate = current.filter((item) => item.id !== reference.id);
  await setStoredItem(key, JSON.stringify([reference, ...withoutDuplicate].slice(0, MAX_LEARNED_REFERENCES_PER_FOOD)));
}
