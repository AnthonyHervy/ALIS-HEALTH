import { BACKGROUND_SYNC_INTERVAL_HOURS } from '../config';
import type { SyncDecision } from '../types';

export function getSyncDecision(input: {
  now: string;
  apiBaseUrl: string | null;
  deviceToken: string | null;
  lastSyncAt: string | null;
}): SyncDecision {
  if (!input.apiBaseUrl || !input.deviceToken) {
    return { shouldSync: false, reason: 'unconfigured', windowStartAt: null, windowEndAt: null };
  }
  if (!input.lastSyncAt) {
    return { shouldSync: false, reason: 'initial_sync_required', windowStartAt: null, windowEndAt: null };
  }

  const now = new Date(input.now).getTime();
  const lastSync = new Date(input.lastSyncAt).getTime();
  const ageMs = now - lastSync;
  const thresholdMs = BACKGROUND_SYNC_INTERVAL_HOURS * 60 * 60 * 1000;
  if (Number.isNaN(now) || Number.isNaN(lastSync) || ageMs < thresholdMs) {
    return { shouldSync: false, reason: 'fresh', windowStartAt: null, windowEndAt: null };
  }

  return {
    shouldSync: true,
    reason: 'sync_due',
    windowStartAt: new Date(lastSync - 2 * 60 * 60 * 1000).toISOString(),
    windowEndAt: input.now
  };
}
