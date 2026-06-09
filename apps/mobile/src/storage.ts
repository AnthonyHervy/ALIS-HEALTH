import * as SecureStore from 'expo-secure-store';

import { normalizeApiBaseUrl, normalizeApiBaseUrlOrFallback } from './apiBaseUrl';
import { DEFAULT_API_BASE_URL, DEFAULT_PAIRING_CODE } from './config';
import { normalizeDashboardOrder, type DashboardBlockKey } from './dashboardLayout';
import { EMPTY_USER_PROFILE, normalizeUserProfile, type UserProfile } from './userProfile';
import type { Settings } from './types';

const API_URL_KEY = 'alis.apiBaseUrl';
const PAIRING_CODE_KEY = 'alis.pairingCode';
const TOKEN_KEY = 'alis.deviceToken';
const NOTIFICATIONS_ENABLED_KEY = 'alis.notificationsEnabled';
const DASHBOARD_ORDER_KEY = 'alis.dashboardOrder';
const LAST_WORKOUT_NOTIFICATION_KEY = 'alis.lastWorkoutNotificationKey';
const USER_PROFILE_KEY = 'alis.userProfile';

export async function loadSettings(): Promise<Settings> {
  const [apiBaseUrl, pairingCode, deviceToken, notificationsEnabled] = await Promise.all([
    SecureStore.getItemAsync(API_URL_KEY),
    SecureStore.getItemAsync(PAIRING_CODE_KEY),
    SecureStore.getItemAsync(TOKEN_KEY),
    SecureStore.getItemAsync(NOTIFICATIONS_ENABLED_KEY)
  ]);
  return {
    apiBaseUrl: normalizeApiBaseUrlOrFallback(apiBaseUrl, DEFAULT_API_BASE_URL),
    pairingCode: pairingCode || DEFAULT_PAIRING_CODE,
    deviceToken: deviceToken || null,
    notificationsEnabled: notificationsEnabled !== 'false'
  };
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  await Promise.all([
    settings.apiBaseUrl !== undefined ? SecureStore.setItemAsync(API_URL_KEY, normalizeApiBaseUrl(settings.apiBaseUrl)) : Promise.resolve(),
    settings.pairingCode !== undefined ? SecureStore.setItemAsync(PAIRING_CODE_KEY, settings.pairingCode) : Promise.resolve(),
    settings.deviceToken !== undefined
      ? settings.deviceToken
        ? SecureStore.setItemAsync(TOKEN_KEY, settings.deviceToken)
        : SecureStore.deleteItemAsync(TOKEN_KEY)
      : Promise.resolve(),
    settings.notificationsEnabled !== undefined
      ? SecureStore.setItemAsync(NOTIFICATIONS_ENABLED_KEY, settings.notificationsEnabled ? 'true' : 'false')
      : Promise.resolve()
  ]);
}

export async function clearDeviceToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function loadDashboardOrder(): Promise<DashboardBlockKey[]> {
  const raw = await SecureStore.getItemAsync(DASHBOARD_ORDER_KEY);
  if (!raw) {
    return normalizeDashboardOrder();
  }
  try {
    const parsed = JSON.parse(raw);
    return normalizeDashboardOrder(Array.isArray(parsed) ? parsed : null);
  } catch {
    return normalizeDashboardOrder();
  }
}

export async function saveDashboardOrder(order: readonly DashboardBlockKey[]): Promise<void> {
  await SecureStore.setItemAsync(DASHBOARD_ORDER_KEY, JSON.stringify(order));
}

export async function loadLastWorkoutNotificationKey(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_WORKOUT_NOTIFICATION_KEY);
}

export async function saveLastWorkoutNotificationKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(LAST_WORKOUT_NOTIFICATION_KEY, key);
}

export async function loadUserProfile(): Promise<UserProfile> {
  const raw = await SecureStore.getItemAsync(USER_PROFILE_KEY);
  if (!raw) {
    return EMPTY_USER_PROFILE;
  }
  try {
    return normalizeUserProfile(JSON.parse(raw));
  } catch {
    return EMPTY_USER_PROFILE;
  }
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  await SecureStore.setItemAsync(USER_PROFILE_KEY, JSON.stringify(normalizeUserProfile(profile)));
}
