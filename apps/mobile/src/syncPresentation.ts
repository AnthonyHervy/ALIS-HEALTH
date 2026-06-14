import { formatParisDateTime, formatParisTime, parseServerTimestamp } from './format';
import type { AppLanguage } from './i18n';
import type { SyncRun } from './types';

type HealthSyncSummary = {
  title: string;
  detail: string;
  action: string;
  freshnessTone?: 'success' | 'warning' | 'danger';
  freshnessLabel?: string;
};

export function healthSyncSummary({
  syncing,
  lastHealthSyncAt,
  latestRun,
  lastBackgroundStatus,
  language = 'fr',
  now = new Date()
}: {
  syncing: boolean;
  lastHealthSyncAt: string | null;
  latestRun: SyncRun | null;
  lastBackgroundStatus: string | null;
  language?: AppLanguage;
  now?: Date;
}): HealthSyncSummary {
  void latestRun;
  void lastBackgroundStatus;

  if (syncing) {
    return {
      title: language === 'en' ? 'Sync in progress' : 'Synchronisation en cours',
      detail: language === 'en' ? 'Reading health data and sending it to ALIS...' : 'Lecture des données santé et envoi vers ALIS...',
      action: language === 'en' ? 'Syncing...' : 'Synchronisation...'
    };
  }
  if (!lastHealthSyncAt) {
    return {
      title: language === 'en' ? 'Initial sync required' : 'Synchronisation initiale requise',
      detail: language === 'en' ? 'Run a full sync from this phone.' : 'Lance une synchronisation complète depuis ce téléphone.',
      action: language === 'en' ? 'Sync' : 'Synchroniser'
    };
  }
  const freshness = syncFreshness(lastHealthSyncAt, now, language);
  return {
    title: language === 'en' ? 'Last sync' : 'Dernière synchronisation',
    detail: formatSyncMoment(lastHealthSyncAt, now, language),
    action: language === 'en' ? 'Sync' : 'Synchroniser',
    freshnessTone: freshness.tone,
    freshnessLabel: freshness.label
  };
}

function formatSyncMoment(timestamp: string, now: Date, language: AppLanguage) {
  const syncDate = parseServerTimestamp(timestamp);
  if (parisDateKey(syncDate) === parisDateKey(now)) {
    return language === 'en' ? `Today at ${formatParisTime(timestamp)}` : `Aujourd'hui à ${formatParisTime(timestamp)}`;
  }
  return formatParisDateTime(timestamp);
}

function syncFreshness(timestamp: string, now: Date, language: AppLanguage): { tone: 'success' | 'warning' | 'danger'; label: string } {
  const ageHours = Math.max(0, now.getTime() - parseServerTimestamp(timestamp).getTime()) / 36e5;
  if (ageHours < 6) {
    return { tone: 'success', label: language === 'en' ? 'Fresh data' : 'Données récentes' };
  }
  if (ageHours < 12) {
    return { tone: 'warning', label: language === 'en' ? 'Sync soon' : 'À resynchroniser bientôt' };
  }
  return { tone: 'danger', label: language === 'en' ? 'Sync recommended' : 'Synchronisation recommandée' };
}

function parisDateKey(date: Date) {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}
