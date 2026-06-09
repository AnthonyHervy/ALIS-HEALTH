jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 'default', HIGH: 'high' },
  SchedulableTriggerInputTypes: { DAILY: 'daily' },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn()
}));

import {
  MORNING_NOTIFICATION_ID,
  WORKOUT_ANALYSIS_NOTIFICATION_ID,
  WORKOUT_ANALYSIS_NOTIFICATION_CHANNEL_ID,
  clearWorkoutAnalysisNotification,
  disableMorningNotification,
  enableMorningNotification,
  scheduleWorkoutAnalysisNotification
} from './notifications';
import type { WorkoutHistoryItem } from './types';

function fakeNotifications(permissionStatus: 'granted' | 'denied' = 'granted') {
  return {
    setNotificationChannelAsync: jest.fn(async () => undefined),
    getPermissionsAsync: jest.fn(async () => ({ status: permissionStatus })),
    requestPermissionsAsync: jest.fn(async () => ({ status: permissionStatus })),
    cancelScheduledNotificationAsync: jest.fn(async () => undefined),
    dismissNotificationAsync: jest.fn(async () => undefined),
    scheduleNotificationAsync: jest.fn(async () => MORNING_NOTIFICATION_ID),
    AndroidImportance: { DEFAULT: 'default', HIGH: 'high' }
  };
}

function workout(overrides: Partial<WorkoutHistoryItem> = {}): WorkoutHistoryItem {
  return {
    date: '2026-06-01',
    start_time: '2026-06-01T17:10:00Z',
    end_time: '2026-06-01T17:55:00Z',
    activity_type: 'running',
    duration_minutes: 45,
    calories: 420,
    distance_meters: 8200,
    ...overrides
  };
}

test('schedules a daily 10:30 morning notification that opens today dashboard', async () => {
  const notifications = fakeNotifications();

  const result = await enableMorningNotification(notifications as any, 'android');

  expect(result.enabled).toBe(true);
  expect(MORNING_NOTIFICATION_ID).toBe('alis-morning-health-1030');
  expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith('daily-health', expect.objectContaining({
    name: 'Rappels santé',
    importance: 'high'
  }));
  expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('cockpit-morning-health-1030');
  expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(MORNING_NOTIFICATION_ID);
  expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
    identifier: MORNING_NOTIFICATION_ID,
    content: expect.objectContaining({
      title: 'Bonjour !',
      body: 'Consultez vos données santé du jour',
      data: { target: 'dashboard', window: '24h' }
    }),
    trigger: {
      type: 'daily',
      hour: 10,
      minute: 30,
      channelId: 'daily-health'
    }
  });
});

test('does not schedule the morning notification when permission is denied', async () => {
  const notifications = fakeNotifications('denied');

  const result = await enableMorningNotification(notifications as any, 'android');

  expect(result.enabled).toBe(false);
  expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test('cancels the daily morning notification', async () => {
  const notifications = fakeNotifications();

  await disableMorningNotification(notifications as any);

  expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('cockpit-morning-health-1030');
  expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(MORNING_NOTIFICATION_ID);
});

test('schedules a workout analysis notification that opens the coach', async () => {
  const notifications = fakeNotifications();
  notifications.scheduleNotificationAsync.mockResolvedValueOnce('workout-id');

  await scheduleWorkoutAnalysisNotification(workout(), notifications as any, 'android');

  expect(WORKOUT_ANALYSIS_NOTIFICATION_CHANNEL_ID).toBe('workout-analysis');
  expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith('workout-analysis', expect.objectContaining({
    name: 'Analyses entraînement',
    importance: 'high'
  }));
  expect(WORKOUT_ANALYSIS_NOTIFICATION_ID).toBe('alis-workout-analysis-latest');
  expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(WORKOUT_ANALYSIS_NOTIFICATION_ID);
  expect(notifications.dismissNotificationAsync).toHaveBeenCalledWith(WORKOUT_ANALYSIS_NOTIFICATION_ID);
  expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
    identifier: WORKOUT_ANALYSIS_NOTIFICATION_ID,
    content: expect.objectContaining({
      title: 'Bravo pour ce RUN !',
      body: 'Découvrir mon analyse',
      data: expect.objectContaining({
        target: 'coach-workout',
        workoutKey: 'workout:running:2026-06-01T17:00:00.000Z:45m'
      })
    }),
    trigger: null
  });
});

test('clears stale workout analysis notifications', async () => {
  const notifications = fakeNotifications();

  await clearWorkoutAnalysisNotification(notifications as any);

  expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(WORKOUT_ANALYSIS_NOTIFICATION_ID);
  expect(notifications.dismissNotificationAsync).toHaveBeenCalledWith(WORKOUT_ANALYSIS_NOTIFICATION_ID);
});
