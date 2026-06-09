import type { DataStatus, LifeBalanceScore, OverviewContext, SyncRunSummary, WindowKey } from './api';

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours === 0) {
    return `${remaining} min`;
  }
  return `${hours} h ${remaining.toString().padStart(2, '0')}`;
}

export function buildDashboardCards(context: OverviewContext) {
  const isToday = context.window === '24h';
  const activityValue = isToday
    ? context.activity.steps
    : context.activity.average_daily_steps ?? Math.round(context.activity.steps / Math.max(1, context.series.length));
  const hasEstimatedSteps = Boolean(context.activity.steps_estimated_days);
  const sleepMinutes = context.sleep.average_duration_minutes ?? context.sleep.total_duration_minutes ?? 0;
  const sleepDisplay = formatMissingAwareSleepDuration(sleepMinutes);
  return [
    {
      label: 'Sommeil',
      value: sleepDisplay.value,
      detail: sleepDisplay.hasData ? 'durée moyenne' : 'absence de données'
    },
    {
      label: 'Nutrition',
      value: `${Math.round(context.nutrition.energy_kcal)} kcal`,
      detail: `${Math.round(context.nutrition.protein_g)} g protéines`
    },
    {
      label: 'Entraînements',
      value: formatDuration(context.workouts.duration_minutes),
      detail: `${context.workouts.sessions} session(s)`
    },
    {
      label: 'Activité',
      value: activityValue.toLocaleString('fr-FR'),
      detail: hasEstimatedSteps ? (isToday ? 'pas estimés' : 'pas estimés / jour') : (isToday ? 'pas' : 'pas / jour')
    }
  ];
}

export function formatMissingAwareSleepDuration(minutes: number | null | undefined): { value: string; detail: string; hasData: boolean } {
  const normalized = Number(minutes ?? 0);
  if (normalized <= 0) {
    return {
      value: '--',
      detail: 'Absence de données sommeil',
      hasData: false
    };
  }
  return {
    value: formatDuration(normalized),
    detail: '',
    hasData: true
  };
}

export function maxSeriesValue(context: OverviewContext, key: keyof OverviewContext['series'][number]): number {
  return Math.max(1, ...context.series.map((day) => Number(day[key]) || 0));
}

export function chartContextForWindow(context: OverviewContext, recentContext?: OverviewContext): OverviewContext {
  if (context.window !== '24h' || !recentContext || context.series.length === 0) {
    return context;
  }
  const today = context.series[context.series.length - 1]?.date;
  const todayByDate = new Map(context.series.map((day) => [day.date, day]));
  const recentSeries = recentContext.series
    .filter((day) => day.date <= today)
    .slice(-3)
    .map((day) => todayByDate.get(day.date) ?? day);
  return {
    ...context,
    series: recentSeries.length > 0 ? recentSeries : context.series
  };
}

export function formatDateLabel(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(`${date}T12:00:00`));
}

const SERVER_TIMESTAMP_WITH_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

export function parseServerTimestamp(timestamp: string): Date {
  const normalized = SERVER_TIMESTAMP_WITH_ZONE.test(timestamp) ? timestamp : `${timestamp}Z`;
  return new Date(normalized);
}

export function formatParisDateTime(timestamp: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(parseServerTimestamp(timestamp));
}

export function formatParisTime(timestamp: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit'
  }).format(parseServerTimestamp(timestamp));
}

export function formatFrenchLongDate(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(new Date(`${date}T12:00:00`));
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

export function formatDailyValue(value: number, unit: string): string {
  const rounded = Math.round(value);
  if (unit === 'pas' && rounded >= 1000) {
    const compact = rounded.toLocaleString('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).replace(/\s+/g, ' ');
    return `${compact} pas`;
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

export function formatLifeBalanceTooltip(score: LifeBalanceScore): string {
  const contributors = score.contributors
    .map((item) => `${item.label}: ${item.value}`)
    .join(' · ');
  return contributors ? `${score.explanation} · ${contributors}` : score.explanation;
}

export function formatLifeBalanceDisplay(score: LifeBalanceScore): { value: string; unavailable: boolean; meta: string | null } {
  const unavailable = score.contributors.length === 0 && /absence|aucune/i.test(score.explanation);
  if (unavailable) {
    return {
      value: '--',
      unavailable: true,
      meta: 'Absence de données'
    };
  }
  return {
    value: `${Math.round(score.value)}%`,
    unavailable: false,
    meta: score.confidence === 'low' ? 'Fiabilité faible' : null
  };
}

export function historyScrollClass(window: WindowKey): string {
  return window === '30d' ? 'workout-history scrollable' : 'workout-history';
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
    detail: `${dataStatus.freshness.records_received.toLocaleString('fr-FR')} records · ${dataStatus.freshness.explanation}`,
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
      records: '0 records',
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
    records: `${summary.records_received.toLocaleString('fr-FR')} records`,
    runs: `${summary.total_runs.toLocaleString('fr-FR')} run(s) · ${summary.success_runs.toLocaleString('fr-FR')} succès · ${summary.error_runs.toLocaleString('fr-FR')} erreur(s)`,
    network: summary.latest_network_type ?? '-'
  };
}

function addHours(timestamp: string, hours: number): string {
  const next = parseServerTimestamp(timestamp);
  next.setHours(next.getHours() + hours);
  return next.toISOString();
}
