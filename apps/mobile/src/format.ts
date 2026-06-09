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

export function formatDailyValue(value: number, unit: 'pas' | 'sleep' | 'min'): string {
  const rounded = Math.round(value || 0);
  if (unit === 'pas' && rounded >= 1000) {
    return `${rounded.toLocaleString('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).replace(/\s+/g, ' ')} pas`;
  }
  if (unit === 'sleep') {
    return formatDuration(rounded);
  }
  return `${rounded.toLocaleString('fr-FR')} ${unit}`;
}

export function formatActivityLabel(activityType: string): string {
  if (['cycling', 'stationary_biking', 'spinning'].includes(activityType)) {
    return 'RPM';
  }
  if (activityType === 'strength_training') {
    return 'Renforcement Musculaire';
  }
  if (activityType === 'rowing') {
    return 'Rame';
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

export function formatSyncObservability(summary?: SyncRunSummary | null): {
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
      latestError: 'Aucune erreur récente',
      records: formatRecordCount(0),
      runs: '0 run · 0 succès · 0 erreur',
      network: '-'
    };
  }
  const latestFailed = summary.recent_runs.find((run) => run.status === 'failed' && run.error_message);
  return {
    lastManual: summary.last_manual_at ? formatParisDateTime(summary.last_manual_at) : '-',
    lastBackground: summary.last_background_at ? formatParisDateTime(summary.last_background_at) : '-',
    nextBackground: summary.last_background_at ? formatParisDateTime(addHours(summary.last_background_at, 1)) : '-',
    latestError: latestFailed?.error_message ?? 'Aucune erreur récente',
    records: formatRecordCount(summary.records_received),
    runs: `${summary.total_runs.toLocaleString('fr-FR')} run(s) · ${summary.success_runs.toLocaleString('fr-FR')} succès · ${summary.error_runs.toLocaleString('fr-FR')} erreur(s)`,
    network: summary.latest_network_type ?? '-'
  };
}

function formatRecordCount(count: number): string {
  const safe = Math.max(0, Math.round(count || 0));
  return `${safe.toLocaleString('fr-FR')} ${safe > 1 ? 'enregistrements' : 'enregistrement'}`;
}

function addHours(timestamp: string, hours: number): string {
  const next = parseServerTimestamp(timestamp);
  next.setHours(next.getHours() + hours);
  return next.toISOString();
}
