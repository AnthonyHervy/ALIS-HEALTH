import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

import { BACKGROUND_SYNC_TASK_NAME } from '../config';
import { runBackgroundSyncOnce } from './background-sync';

TaskManager.defineTask(BACKGROUND_SYNC_TASK_NAME, async () => {
  const result = await runBackgroundSyncOnce();
  if (result.status === 'synced') {
    return BackgroundFetch.BackgroundFetchResult.NewData;
  }
  if (result.status === 'failed') {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
  return BackgroundFetch.BackgroundFetchResult.NoData;
});
