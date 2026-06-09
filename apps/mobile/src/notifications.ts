import * as Notifications from 'expo-notifications';

import type { WorkoutHistoryItem } from './types';
import { workoutKey, workoutNotificationCopy } from './workoutCoach';

export const MORNING_NOTIFICATION_ID = 'alis-morning-health-1030';
export const MORNING_NOTIFICATION_CHANNEL_ID = 'daily-health';
export const WORKOUT_ANALYSIS_NOTIFICATION_ID = 'alis-workout-analysis-latest';
export const WORKOUT_ANALYSIS_NOTIFICATION_CHANNEL_ID = 'workout-analysis';
const LEGACY_MORNING_NOTIFICATION_IDS = ['cockpit-morning-health-1030'];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

type NotificationModule = typeof Notifications;

export type MorningNotificationResult = {
  enabled: boolean;
  reason?: 'permission-denied';
};

export async function enableMorningNotification(
  notifications: NotificationModule = Notifications,
  platform: string = 'android'
): Promise<MorningNotificationResult> {
  if (platform === 'android') {
    await notifications.setNotificationChannelAsync(MORNING_NOTIFICATION_CHANNEL_ID, {
      name: 'Rappels santé',
      importance: notifications.AndroidImportance.HIGH
    });
  }

  const permissions = await notifications.getPermissionsAsync();
  const finalPermissions = permissions.status === 'granted'
    ? permissions
    : await notifications.requestPermissionsAsync();

  if (finalPermissions.status !== 'granted') {
    return { enabled: false, reason: 'permission-denied' };
  }

  await cancelMorningNotifications(notifications);
  await notifications.scheduleNotificationAsync({
    identifier: MORNING_NOTIFICATION_ID,
    content: {
      title: 'Bonjour !',
      body: 'Consultez vos données santé du jour',
      data: { target: 'dashboard', window: '24h' }
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 10,
      minute: 30,
      channelId: platform === 'android' ? MORNING_NOTIFICATION_CHANNEL_ID : undefined
    }
  } as Notifications.NotificationRequestInput);

  return { enabled: true };
}

export async function disableMorningNotification(notifications: NotificationModule = Notifications): Promise<void> {
  await cancelMorningNotifications(notifications);
}

async function cancelMorningNotifications(notifications: NotificationModule): Promise<void> {
  for (const identifier of [...LEGACY_MORNING_NOTIFICATION_IDS, MORNING_NOTIFICATION_ID]) {
    await notifications.cancelScheduledNotificationAsync(identifier);
  }
}

export function addMorningNotificationResponseListener(
  onOpenToday: () => void,
  notifications: NotificationModule = Notifications
) {
  return notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (data?.target === 'dashboard') {
      onOpenToday();
    }
  });
}

export async function scheduleWorkoutAnalysisNotification(
  workout: WorkoutHistoryItem,
  notifications: NotificationModule = Notifications,
  platform: string = 'android'
): Promise<void> {
  if (platform === 'android') {
    await notifications.setNotificationChannelAsync(WORKOUT_ANALYSIS_NOTIFICATION_CHANNEL_ID, {
      name: 'Analyses entraînement',
      importance: notifications.AndroidImportance.HIGH
    });
  }

  const copy = workoutNotificationCopy(workout);
  if (!copy) {
    return;
  }
  await clearWorkoutAnalysisNotification(notifications);
  await notifications.scheduleNotificationAsync({
    identifier: WORKOUT_ANALYSIS_NOTIFICATION_ID,
    content: {
      title: copy.title,
      body: copy.body,
      data: {
        target: 'coach-workout',
        workoutKey: workoutKey(workout)
      }
    },
    trigger: null
  });
}

export async function clearWorkoutAnalysisNotification(notifications: NotificationModule = Notifications): Promise<void> {
  await notifications.cancelScheduledNotificationAsync(WORKOUT_ANALYSIS_NOTIFICATION_ID);
  try {
    await notifications.dismissNotificationAsync(WORKOUT_ANALYSIS_NOTIFICATION_ID);
  } catch {
    // Old Android notifications may not have a stable identifier; this cleanup is best-effort.
  }
}

export function addWorkoutAnalysisNotificationResponseListener(
  onOpenWorkoutAnalysis: (workoutKey?: string) => void,
  notifications: NotificationModule = Notifications
) {
  return notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (data?.target === 'coach-workout') {
      onOpenWorkoutAnalysis(typeof data.workoutKey === 'string' ? data.workoutKey : undefined);
    }
  });
}
