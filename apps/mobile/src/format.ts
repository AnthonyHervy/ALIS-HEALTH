import type { AppLanguage } from './i18n';
import type { DataStatus, LifeBalanceScore, OverviewContext, SyncRunSummary, WindowKey } from './types';

export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(safe / 60);
  const remaining = safe % 60;
  if (hours === 0) {
    return `${remaining} min`;
  }
  return `${hours} h ${remaining.toString().padStart(2, '0')}`;
}

const SERVER_TIMESTAMP_WITH_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

export function parseServerTimestamp(timestamp: string): Date {
  const normalized = SERVER_TIMESTAMP_WITH_ZONE.test(timestamp) ? timestamp : `${timestamp}Z`;
  return new Date(normalized);
}

export function formatParisTime(timestamp: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit'
  }).format(parseServerTimestamp(timestamp));
}

export function formatParisDateTime(timestamp: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(parseServerTimestamp(timestamp));
}

export function formatDateLabel(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(`${date}T12:00:00`));
}

export function formatFrenchLongDate(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(new Date(`${date}T12:00:00`));
}

export function formatEnglishLongDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(new Date(`${date}T12:00:00`));
}

export function formatDailyValue(value: number, unit: 'pas' | 'steps' | 'sleep' | 'min'): string {
  const rounded = Math.round(value || 0);
  if ((unit === 'pas' || unit === 'steps') && rounded >= 1000) {
    const locale = unit === 'steps' ? 'en-US' : 'fr-FR';
    return `${rounded.toLocaleString(locale, { notation: 'compact', maximumFractionDigits: 1 }).replace(/\s+/g, ' ')} ${unit === 'steps' ? 'steps' : 'pas'}`;
  }
  if (unit === 'sleep') {
    return formatDuration(rounded);
  }
  if (unit === 'steps') {
    return `${rounded.toLocaleString('en-US')} steps`;
  }
  return `${rounded.toLocaleString('fr-FR')} ${unit}`;
}

export function formatActivityLabel(activityType: string, language: AppLanguage = 'fr'): string {
  if (['cycling', 'stationary_biking', 'spinning'].includes(activityType)) {
    return 'RPM';
  }
  if (activityType === 'strength_training') {
    return language === 'en' ? 'Strength training' : 'Renforcement Musculaire';
  }
  if (activityType === 'rowing') {
    return language === 'en' ? 'Rowing' : 'Rame';
  }
  if (['running', 'running_treadmill'].includes(activityType)) {
    return 'Running';
  }
  return activityType
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function activityIcon(activityType: string): string {
  if (['running', 'running_treadmill'].includes(activityType)) {
    return 'Run';
  }
  if (['cycling', 'stationary_biking', 'spinning'].includes(activityType)) {
    return 'Bike';
  }
  if (activityType === 'strength_training') {
    return 'Force';
  }
  if (activityType === 'rowing') {
    return 'Rame';
  }
  return 'Move';
}

export function scoreColor(tone: LifeBalanceScore['tone']): string {
  if (tone === 'green') {
    return '#16a34a';
  }
  if (tone === 'orange') {
    return '#d97706';
  }
  return '#b91c1c';
}

export function sleepTone(minutes: number): 'danger' | 'warning' | 'success' {
  if (minutes < 360) {
    return 'danger';
  }
  if (minutes < 450) {
    return 'warning';
  }
  return 'success';
}

export function maxSeriesValue(context: OverviewContext, key: keyof OverviewContext['series'][number]): number {
  return Math.max(1, ...context.series.map((day) => Number(day[key]) || 0));
}

export function overviewTitle(window: WindowKey): string {
  if (window === '24h') {
    return "Aujourd'hui";
  }
  if (window === '7d') {
    return '7 jours';
  }
  return '30 jours';
}

export function formatDataStatusSummary(dataStatus?: DataStatus): {
  tone: 'success' | 'warning' | 'danger';
  label: string;
  detail: string;
  domains: Array<{ label: string; value: string; tone: 'success' | 'warning' | 'danger' }>;
} {
  if (!dataStatus) {
    return {
      tone: 'warning',
      label: 'Statut des données indisponible',
      detail: 'Le snapshot ne contient pas encore de diagnostic de fraîcheur.',
      domains: []
    };
  }
  const tone = dataStatus.freshness.status === 'fresh' ? 'success' : dataStatus.freshness.status === 'stale' ? 'warning' : 'danger';
  return {
    tone,
    label: dataStatus.freshness.label,
    detail: `${formatRecordCount(dataStatus.freshness.records_received)} · ${dataStatus.freshness.explanation}`,
    domains: ([
      ['sleep', 'Sommeil'],
      ['activity', 'Activité'],
      ['workouts', 'Entraînements'],
      ['nutrition', 'Nutrition']
    ] as const).map(([key, label]) => {
      const domain = dataStatus.domains[key];
      return {
        label,
        value: domain.source ? `${domain.label} · ${compactSourceName(domain.source)}` : domain.label,
        tone: domain.confidence === 'high' ? 'success' : domain.confidence === 'medium' ? 'warning' : 'danger'
      };
    })
  };
}

function compactSourceName(source: string): string {
  if (source.includes('garmin')) {
    return 'Garmin';
  }
  if (source.includes('ultrahuman')) {
    return 'Ultrahuman';
  }
  if (source.includes('fitness')) {
    return 'Google Fit';
  }
  if (source === 'android') {
    return 'Android';
  }
  return source;
}

export function formatSyncObservability(summary?: SyncRunSummary | null, language: AppLanguage = 'fr'): {
  lastManual: string;
  lastBackground: string;
  nextBackground: string;
  latestError: string;
  records: string;
  runs: string;
  network: string;
} {
  if (!summary) {
    return {
      lastManual: '-',
      lastBackground: '-',
      nextBackground: '-',
      latestError: noRecentErrorLabel(language),
      records: formatRecordCount(0, language),
      runs: formatRunCount(0, 0, 0, language),
      network: '-'
    };
  }
  const latestFailed = summary.recent_runs.find((run) => run.status === 'failed' && run.error_message);
  return {
    lastManual: summary.last_manual_at ? formatParisDateTime(summary.last_manual_at) : '-',
    lastBackground: summary.last_background_at ? formatParisDateTime(summary.last_background_at) : '-',
    nextBackground: summary.last_background_at ? formatParisDateTime(addHours(summary.last_background_at, 1)) : '-',
    latestError: latestFailed?.error_message ?? noRecentErrorLabel(language),
    records: formatRecordCount(summary.records_received, language),
    runs: formatRunCount(summary.total_runs, summary.success_runs, summary.error_runs, language),
    network: summary.latest_network_type ?? '-'
  };
}

function formatRecordCount(count: number, language: AppLanguage = 'fr'): string {
  const safe = Math.max(0, Math.round(count || 0));
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  if (language === 'en') {
    return `${safe.toLocaleString(locale)} ${safe === 1 ? 'record' : 'records'}`;
  }
  return `${safe.toLocaleString(locale)} ${safe > 1 ? 'enregistrements' : 'enregistrement'}`;
}

function formatRunCount(totalRuns: number, successRuns: number, errorRuns: number, language: AppLanguage): string {
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  if (language === 'en') {
    return `${totalRuns.toLocaleString(locale)} run(s) · ${successRuns.toLocaleString(locale)} success · ${errorRuns.toLocaleString(locale)} error(s)`;
  }
  return `${totalRuns.toLocaleString(locale)} run(s) · ${successRuns.toLocaleString(locale)} succès · ${errorRuns.toLocaleString(locale)} erreur(s)`;
}

function noRecentErrorLabel(language: AppLanguage): string {
  return language === 'en' ? 'No recent error' : 'Aucune erreur récente';
}

function addHours(timestamp: string, hours: number): string {
  const next = parseServerTimestamp(timestamp);
  next.setHours(next.getHours() + hours);
  return next.toISOString();
}
