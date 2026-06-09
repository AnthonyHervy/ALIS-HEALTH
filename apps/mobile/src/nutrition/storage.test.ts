jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(async () => false),
  getItemAsync: jest.fn(async () => {
    throw new Error('SecureStore unavailable');
  }),
  setItemAsync: jest.fn(async () => {
    throw new Error('SecureStore unavailable');
  }),
  deleteItemAsync: jest.fn(async () => {
    throw new Error('SecureStore unavailable');
  })
}));

import { loadLearnedFoodReferences, loadSettings, rememberFoodReference, saveSettings } from './storage';

test('persists settings with the local fallback when SecureStore is unavailable', async () => {
  await saveSettings({
    apiBaseUrl: 'http://localhost:8010',
    pairingCode: 'pairing',
    deviceToken: 'token-1'
  });

  await expect(loadSettings()).resolves.toEqual({
    apiBaseUrl: 'http://localhost:8010',
    pairingCode: 'pairing',
    deviceToken: 'token-1'
  });

  await saveSettings({ deviceToken: null });

  await expect(loadSettings()).resolves.toEqual({
    apiBaseUrl: 'http://localhost:8010',
    pairingCode: 'pairing',
    deviceToken: null
  });
});

test('normalizes Nutrition API base URLs with fallback storage', async () => {
  await saveSettings({
    apiBaseUrl: '  http://localhost:8010///  '
  });

  await expect(loadSettings()).resolves.toEqual(expect.objectContaining({
    apiBaseUrl: 'http://localhost:8010'
  }));
});

test('stores recent food reference corrections for quick reuse', async () => {
  await rememberFoodReference('Pâtes penne', {
    id: 'food-pasta',
    source: 'ciqual',
    source_id: '12345',
    name: 'Pâtes alimentaires cuites',
    energy_kcal_100g: 150,
    protein_g_100g: 5,
    carbohydrates_g_100g: 28,
    fat_g_100g: 1,
    dataset_version: 'ciqual-2025-11-03'
  });

  await expect(loadLearnedFoodReferences('pates penne')).resolves.toEqual([
    expect.objectContaining({
      id: 'food-pasta',
      name: 'Pâtes alimentaires cuites'
    })
  ]);
});
