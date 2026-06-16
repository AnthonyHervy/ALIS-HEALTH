jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      values.delete(key);
    }),
    __values: values
  };
});

import * as SecureStore from 'expo-secure-store';

import {
  clearCoachChatHistory,
  loadCoachChatHistory,
  loadDashboardOrder,
  loadLastWorkoutNotificationKey,
  loadSettings,
  loadUserProfile,
  saveCoachChatHistory,
  saveDashboardOrder,
  saveLastWorkoutNotificationKey,
  saveSettings,
  saveUserProfile
} from './storage';

const secureStoreValues = (SecureStore as unknown as { __values: Map<string, string> }).__values;

beforeEach(() => {
  secureStoreValues.clear();
});

test('loads morning notifications as enabled by default', async () => {
  await expect(loadSettings()).resolves.toEqual(expect.objectContaining({
    notificationsEnabled: true
  }));
});

test('persists morning notification preference', async () => {
  await saveSettings({ notificationsEnabled: true });

  await expect(loadSettings()).resolves.toEqual(expect.objectContaining({
    notificationsEnabled: true
  }));
});

test('persists the preferred ALIS language', async () => {
  await saveSettings({ language: 'en' });

  expect(secureStoreValues.get('alis.language')).toBe('en');
  await expect(loadSettings()).resolves.toEqual(expect.objectContaining({
    language: 'en'
  }));
});

test('persists the unified ALIS device settings', async () => {
  await saveSettings({
    apiBaseUrl: 'http://alis.local:8010',
    pairingCode: 'pair-alias',
    deviceToken: 'device-token-1'
  });

  expect(secureStoreValues.get('alis.apiBaseUrl')).toBe('http://alis.local:8010');
  expect(secureStoreValues.get('alis.pairingCode')).toBe('pair-alias');
  expect(secureStoreValues.get('alis.deviceToken')).toBe('device-token-1');
  expect(secureStoreValues.has('cockpit.deviceToken')).toBe(false);
  await expect(loadSettings()).resolves.toEqual(expect.objectContaining({
    apiBaseUrl: 'http://alis.local:8010',
    pairingCode: 'pair-alias',
    deviceToken: 'device-token-1',
    notificationsEnabled: true
  }));
});

test('normalizes stored API base URLs', async () => {
  await saveSettings({
    apiBaseUrl: '  http://alis.local:8010///  '
  });

  expect(secureStoreValues.get('alis.apiBaseUrl')).toBe('http://alis.local:8010');
  await expect(loadSettings()).resolves.toEqual(expect.objectContaining({
    apiBaseUrl: 'http://alis.local:8010'
  }));
});

test('persists the customizable dashboard order', async () => {
  await saveDashboardOrder(['coach', 'summary', 'scores']);

  expect(secureStoreValues.get('alis.dashboardOrder')).toBe('["coach","summary","scores"]');
  await expect(loadDashboardOrder()).resolves.toEqual(expect.arrayContaining(['coach', 'summary', 'scores']));
  await expect(loadDashboardOrder()).resolves.toEqual(expect.not.arrayContaining(['nutrition']));
});

test('persists the last workout notification key', async () => {
  await saveLastWorkoutNotificationKey('start|end|running');

  expect(secureStoreValues.get('alis.lastWorkoutNotificationKey')).toBe('start|end|running');
  await expect(loadLastWorkoutNotificationKey()).resolves.toBe('start|end|running');
});

test('persists the user profile used by coach context', async () => {
  await saveUserProfile({
    firstName: 'Anthony',
    sex: 'male',
    age: '36',
    weightKg: '82',
    heightCm: '181'
  });

  expect(secureStoreValues.get('alis.userProfile')).toBe(JSON.stringify({
    firstName: 'Anthony',
    sex: 'male',
    age: '36',
    weightKg: '82',
    heightCm: '181'
  }));
  await expect(loadUserProfile()).resolves.toEqual({
    firstName: 'Anthony',
    sex: 'male',
    age: '36',
    weightKg: '82',
    heightCm: '181'
  });
});

test('persists compact local coach chat history without transient loading messages', async () => {
  await saveCoachChatHistory([
    { role: 'user', content: 'Analyse mes donnees du jour', hidden: true },
    { role: 'assistant', content: '', loadingLabel: 'Generation' },
    { role: 'assistant', content: 'Bonne base aujourd’hui, garde une sortie facile.' }
  ]);

  expect(JSON.parse(secureStoreValues.get('alis.coachChatHistory') ?? '[]')).toEqual([
    { role: 'user', content: 'Analyse mes donnees du jour', hidden: true },
    { role: 'assistant', content: 'Bonne base aujourd’hui, garde une sortie facile.' }
  ]);
  await expect(loadCoachChatHistory()).resolves.toEqual([
    { role: 'user', content: 'Analyse mes donnees du jour', hidden: true },
    { role: 'assistant', content: 'Bonne base aujourd’hui, garde une sortie facile.' }
  ]);
});

test('limits and clears local coach chat history', async () => {
  await saveCoachChatHistory(Array.from({ length: 35 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index + 1}`
  })));

  const history = await loadCoachChatHistory();
  expect(history).toHaveLength(30);
  expect(history[0].content).toBe('message 6');

  await clearCoachChatHistory();
  await expect(loadCoachChatHistory()).resolves.toEqual([]);
});
