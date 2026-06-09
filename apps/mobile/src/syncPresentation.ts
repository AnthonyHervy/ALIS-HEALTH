import { formatParisDateTime, formatParisTime, parseServerTimestamp } from './format';
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
  now = new Date()
}: {
  syncing: boolean;
  lastHealthSyncAt: string | null;
  latestRun: SyncRun | null;
  lastBackgroundStatus: string | null;
  now?: Date;
}): HealthSyncSummary {
  void latestRun;
  void lastBackgroundStatus;

  if (syncing) {
    return {
      title: 'Synchronisation en cours',
      detail: 'Lecture des données santé et envoi vers ALIS...',
      action: 'Synchronisation...'
    };
  }
  if (!lastHealthSyncAt) {
    return {
      title: 'Synchronisation initiale requise',
      detail: 'Lance une synchronisation complète depuis ce téléphone.',
      action: 'Synchroniser'
    };
  }
  const freshness = syncFreshness(lastHealthSyncAt, now);
  return {
    title: 'Dernière synchronisation',
    detail: formatSyncMoment(lastHealthSyncAt, now),
    action: 'Synchroniser',
    freshnessTone: freshness.tone,
    freshnessLabel: freshness.label
  };
}

function formatSyncMoment(timestamp: string, now: Date) {
  const syncDate = parseServerTimestamp(timestamp);
  if (parisDateKey(syncDate) === parisDateKey(now)) {
    return `Aujourd'hui à ${formatParisTime(timestamp)}`;
  }
  return formatParisDateTime(timestamp);
}

function syncFreshness(timestamp: string, now: Date): { tone: 'success' | 'warning' | 'danger'; label: string } {
  const ageHours = Math.max(0, now.getTime() - parseServerTimestamp(timestamp).getTime()) / 36e5;
  if (ageHours < 6) {
    return { tone: 'success', label: 'Données récentes' };
  }
  if (ageHours < 12) {
    return { tone: 'warning', label: 'À resynchroniser bientôt' };
  }
  return { tone: 'danger', label: 'Synchronisation recommandée' };
}

function parisDateKey(date: Date) {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}
