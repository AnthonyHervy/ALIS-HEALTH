import * as Notifications from 'expo-notifications';

import type { AppLanguage } from '../i18n';

const CHANNEL_ID = 'nutrition-analysis';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

export async function notifyMealReady(title?: string, language: AppLanguage = 'fr'): Promise<void> {
  const resolvedTitle = title ?? (language === 'en' ? 'Nutrition analysis ready' : 'Analyse nutrition prête');
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: language === 'en' ? 'Nutrition analyses' : 'Analyses nutrition',
    importance: Notifications.AndroidImportance.HIGH
  });
  const permissions = await Notifications.getPermissionsAsync();
  const finalPermissions =
    permissions.status === 'granted' ? permissions : await Notifications.requestPermissionsAsync();
  if (finalPermissions.status !== 'granted') {
    return;
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: resolvedTitle,
      body: language === 'en' ? 'Your meal is ready to review and validate.' : 'Ton repas est prêt à être relu et validé.',
      data: { target: 'nutrition' }
    },
    trigger: null
  });
}

export function addNutritionNotificationResponseListener(
  onOpenNutrition: () => void,
  notifications: typeof Notifications = Notifications
) {
  return notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (data?.target === 'nutrition') {
      onOpenNutrition();
    }
  });
}
