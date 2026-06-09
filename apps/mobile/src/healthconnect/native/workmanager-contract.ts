import { BACKGROUND_SYNC_INTERVAL_HOURS, BACKGROUND_SYNC_TASK_NAME } from '../config';

export const workManagerContract = {
  uniqueName: BACKGROUND_SYNC_TASK_NAME,
  repeatIntervalHours: BACKGROUND_SYNC_INTERVAL_HOURS,
  requiredNetworkType: 'ANY_CONNECTED_NETWORK',
  sleepLookbackHours: 48
} as const;
