jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn()
}));

import * as Notifications from 'expo-notifications';

import { notifyMealReady } from './notifications';

test('schedules the meal-ready notification in English when requested', async () => {
  await notifyMealReady(undefined, 'en');

  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('nutrition-analysis', expect.objectContaining({
    name: 'Nutrition analyses',
    importance: 'high'
  }));
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.objectContaining({
      title: 'Nutrition analysis ready',
      body: 'Your meal is ready to review and validate.'
    })
  }));
});
