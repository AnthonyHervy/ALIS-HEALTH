import { NativeModules, Platform } from 'react-native';

type HealthConnectNativeModule = {
  saveSettings: (apiBaseUrl: string, deviceToken: string, lastSyncAt?: string | null) => Promise<boolean>;
  enqueueBackgroundSync: () => Promise<boolean>;
  getBackgroundStatus: () => Promise<string | null>;
  getBackgroundCursor?: () => Promise<string | null>;
};

const nativeModule = NativeModules.HealthConnectNative as HealthConnectNativeModule | undefined;

export async function saveNativeBackgroundSettings(
  apiBaseUrl: string,
  deviceToken: string | null,
  lastSyncAt?: string | null
): Promise<boolean> {
  if (Platform.OS !== 'android' || !nativeModule || !deviceToken) {
    return false;
  }
  return nativeModule.saveSettings(apiBaseUrl, deviceToken, lastSyncAt ?? null);
}

export async function enqueueNativeBackgroundSync(): Promise<boolean> {
  if (Platform.OS !== 'android' || !nativeModule) {
    return false;
  }
  return nativeModule.enqueueBackgroundSync();
}

export async function getNativeBackgroundStatus(): Promise<string | null> {
  if (Platform.OS !== 'android' || !nativeModule) {
    return null;
  }
  return nativeModule.getBackgroundStatus();
}

export async function getNativeBackgroundCursor(): Promise<string | null> {
  if (Platform.OS !== 'android' || !nativeModule?.getBackgroundCursor) {
    return null;
  }
  return nativeModule.getBackgroundCursor();
}
