import { DEVICE_NAME } from './config';
import { formatActivityLabel, formatDuration, formatParisDateTime } from './format';
import type { AppLanguage } from './i18n';
import type {
  CoachAction,
  CoachAdvicePayload,
  DashboardData,
  DataReliabilitySummary,
  LifeBalanceScores,
  MetricReliabilitySummary,
  MorningContext,
  OverviewContext,
  Settings,
  SourceDiagnostics,
  SourceDiagnosticMetric,
  WindowKey
} from './types';

export function overviewForWindow(dashboard: DashboardData, window: WindowKey): OverviewContext {
  if (window === '24h') {
    return dashboard.windows.last_24h;
  }
  if (window === '30d') {
    return dashboard.windows.month;
  }
  return dashboard.windows.week;
}

export function displayContextForWindow(dashboard: DashboardData, window: WindowKey): OverviewContext {
  const context = overviewForWindow(dashboard, window);
  if (window !== '24h') {
    return context;
  }
  return withMorningSleepContext(dashboard, context);
}

function withMorningSleepContext(dashboard: DashboardData, context: OverviewContext): OverviewContext {
  const morning = dashboard.morning_context;
  const duration = morning?.last_night?.duration_minutes ?? 0;
  const hasWindowSleep = (context.sleep.sessions ?? 0) > 0
    || (context.sleep.average_duration_minutes ?? 0) > 0
    || (context.sleep.total_duration_minutes ?? 0) > 0;
  if (!morning || duration <= 0 || hasWindowSleep) {
    return context;
  }

  const todayDate = 'date' in morning.today_so_far
    ? morning.today_so_far.date
    : context.series[context.series.length - 1]?.date;
  const currentDayIndex = todayDate
    ? context.series.findIndex((day) => day.date === todayDate)
    : -1;
  const fallbackIndex = context.series.length - 1;

  return {
    ...context,
    sleep: {
      ...context.sleep,
      sessions: Math.max(1, context.sleep.sessions || 0),
      total_duration_minutes: duration,
      average_duration_minutes: duration,
      latest_sleep_start: morning.last_night.start_time ?? context.sleep.latest_sleep_start ?? null,
      latest_sleep_end: morning.last_night.end_time ?? context.sleep.latest_sleep_end ?? null,
      latest_sleep_awakenings_count: morning.last_night.awakenings_count,
      awakenings_count: morning.last_night.awakenings_count,
      source: morning.last_night.source ?? context.sleep.source ?? null
    },
    series: context.series.map((day, index) => {
      const isCurrentDay = currentDayIndex >= 0 ? index === currentDayIndex : index === fallbackIndex;
      return isCurrentDay ? { ...day, sleep_minutes: duration } : day;
    })
  };
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

export function lifeBalanceForToday(dashboard: DashboardData): LifeBalanceScores | undefined {
  const morning = dashboard.morning_context;
  if (morning?.life_balance_scores) {
    return morning.life_balance_scores;
  }
  return dashboard.windows.last_24h.life_balance_scores;
}

export function sleepDetailsForToday(dashboard: DashboardData) {
  const context = dashboard.windows.last_24h;
  const morning = dashboard.morning_context;
  const hasWindowSleep = (context.sleep.average_duration_minutes ?? 0) > 0
    || (context.sleep.total_duration_minutes ?? 0) > 0
    || (context.sleep.sessions ?? 0) > 0;
  if (morning?.last_night.duration_minutes && (!hasWindowSleep || morning.is_today_partial)) {
    return {
      durationMinutes: morning.last_night.duration_minutes,
      startTime: morning.last_night.start_time ?? null,
      endTime: morning.last_night.end_time ?? null,
      awakenings: morning.last_night.awakenings_count
    };
  }
  return {
    durationMinutes: context.sleep.average_duration_minutes ?? context.sleep.total_duration_minutes ?? 0,
    startTime: context.sleep.latest_sleep_start ?? null,
    endTime: context.sleep.latest_sleep_end ?? null,
    awakenings: context.sleep.latest_sleep_awakenings_count ?? context.sleep.awakenings_count ?? 0
  };
}

export function morningInsightForToday(dashboard: DashboardData, language: AppLanguage = 'fr'): { status: string; title: string; message: string } | null {
  const morning = dashboard.morning_context;
  if (!morning?.message) {
    return null;
  }
  const fallbackTitle = morning.is_today_partial
    ? language === 'en' ? 'Partial morning data' : 'Données du matin partielles'
    : language === 'en' ? 'Daily reading' : 'Lecture du jour';
  return {
    status: morning.status ?? (morning.is_today_partial ? 'partial_today' : 'ready'),
    title: language === 'en' ? englishMorningTitle(morning.status, morning.is_today_partial) : morning.title ?? fallbackTitle,
    message: language === 'en' ? englishMorningMessage(morning.status, morning.is_today_partial) : morning.message
  };
}

function englishMorningTitle(status: MorningContext['status'] | undefined, isTodayPartial: boolean): string {
  if (status === 'sleep_missing') {
    return 'Night not measured';
  }
  if (status === 'partial_today' || isTodayPartial) {
    return 'Partial morning data';
  }
  return 'Daily reading';
}

function englishMorningMessage(status: MorningContext['status'] | undefined, isTodayPartial: boolean): string {
  if (status === 'sleep_missing') {
    return 'No usable sleep data was received for the recent window, so sleep scores are unavailable and recovery is estimated with low reliability.';
  }
  if (status === 'partial_today' || isTodayPartial) {
    return 'Today is still partial: reading based on the last complete day and the last measured night.';
  }
  return 'Recent data is usable for today’s reading.';
}

export function coachActionsForToday(dashboard: DashboardData): CoachAction[] {
  const morningActions = dashboard.morning_context?.coach_actions;
  if (morningActions?.length) {
    return morningActions;
  }
  return dashboard.windows.last_24h.coach_actions ?? [];
}

export function nutritionInsight(context: OverviewContext, language: AppLanguage = 'fr') {
  const nutrition = context.nutrition;
  const meals = Math.round(nutrition.meals || 0);
  const averageDailyEnergy = Math.round(nutrition.average_daily_energy_kcal || 0);
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  return {
    title: meals > 0 ? language === 'en' ? 'Validated nutrition' : 'Nutrition validée' : language === 'en' ? 'Nutrition to complete' : 'Nutrition à compléter',
    energy: `${Math.round(nutrition.energy_kcal || 0).toLocaleString(locale)} kcal`,
    meals: language === 'en'
      ? meals > 1 ? `${meals} validated meals` : meals === 1 ? '1 validated meal' : 'No validated meal'
      : meals > 1 ? `${meals} repas validés` : meals === 1 ? '1 repas validé' : 'Aucun repas validé',
    average: averageDailyEnergy > 0
      ? language === 'en' ? `Average ${averageDailyEnergy.toLocaleString(locale)} kcal/day` : `Moyenne ${averageDailyEnergy.toLocaleString(locale)} kcal/j`
      : language === 'en' ? 'Average to complete' : 'Moyenne à compléter',
    latestMeal: nutrition.latest_meal_at
      ? language === 'en' ? `Latest meal ${formatParisDateTime(nutrition.latest_meal_at)}` : `Dernier repas ${formatParisDateTime(nutrition.latest_meal_at)}`
      : language === 'en' ? 'No recent validated meal' : 'Aucun repas validé récent',
    macros: language === 'en'
      ? `P ${Math.round(nutrition.protein_g || 0)} g · C ${Math.round(nutrition.carbohydrates_g || 0)} g · F ${Math.round(nutrition.fat_g || 0)} g`
      : `P ${Math.round(nutrition.protein_g || 0)} g · G ${Math.round(nutrition.carbohydrates_g || 0)} g · L ${Math.round(nutrition.fat_g || 0)} g`,
    hydration: `${(nutrition.hydration_liters || 0).toLocaleString(locale, { maximumFractionDigits: 1 })} L ${language === 'en' ? 'hydration' : 'hydratation'}`,
    prompt: meals > 0
      ? language === 'en' ? 'Can you analyze my validated nutrition today?' : 'Peux-tu analyser ma nutrition validée du jour ?'
      : language === 'en' ? 'How should I structure my nutrition today?' : 'Comment structurer ma nutrition aujourd’hui ?'
  };
}

export function workoutCalorieInsight(context: OverviewContext, language: AppLanguage = 'fr'): { label: string; value: string } | null {
  const total = Number(context.activity.active_calories_kcal || 0);
  if (total <= 0) {
    return null;
  }
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  if (context.window === '24h') {
    return {
      label: language === 'en' ? 'Active calories' : 'Dépense calorique',
      value: `${Math.round(total).toLocaleString(locale)} kcal`
    };
  }
  const average = Number(context.activity.average_daily_active_calories_kcal || 0)
    || total / Math.max(1, context.series.length);
  return {
    label: language === 'en' ? 'Avg. active calories' : 'Dépense calorique moy.',
    value: `${Math.round(average).toLocaleString(locale)} ${language === 'en' ? 'kcal/day' : 'kcal/j'}`
  };
}

export function todayCardioInsight(context: OverviewContext, language: AppLanguage = 'fr'): { label: string; value: string; detail: string } | null {
  const biometrics = context.biometrics;
  if (!biometrics || Number(biometrics.heart_rate_records || 0) <= 0) {
    return null;
  }
  const average = Number(biometrics.average_heart_rate_bpm || 0);
  const min = Number(biometrics.heart_rate_min_bpm || 0);
  const max = Number(biometrics.heart_rate_max_bpm || 0);
  const resting = Number(biometrics.resting_heart_rate_bpm || 0);
  const roundedMin = Math.round(min);
  const roundedMax = Math.round(max);
  const value = roundedMin > 0 && roundedMax > 0
    ? roundedMin === roundedMax ? `${roundedMin} bpm` : `${roundedMin}-${roundedMax} bpm`
    : average > 0 ? `${Math.round(average)} bpm` : '--';
  const details = [
    average > 0 ? `${language === 'en' ? 'Average' : 'Moyenne'} ${Math.round(average)} bpm` : null,
    resting > 0 ? `${language === 'en' ? 'resting' : 'repos'} ${Math.round(resting)} bpm` : null
  ].filter(Boolean);
  return {
    label: language === 'en' ? 'Heart rate' : 'Fréquence cardiaque',
    value,
    detail: details.length ? details.join(' · ') : language === 'en' ? 'Data received' : 'Données reçues'
  };
}

export type BiometricMetric = 'hrv' | 'vo2';

export type BiometricSummary = {
  title: string;
  interval: string;
  average: string;
  median: string;
  sampleCount: number;
  emptyLabel: string;
};

export function biometricChartData(context: OverviewContext, metric: BiometricMetric, language: AppLanguage = 'fr') {
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  return context.series.map((day) => {
    const value = Number(metric === 'hrv' ? day.hrv_rmssd_ms || 0 : day.vo2_max_ml_kg_min || 0);
    return {
      date: day.date,
      value,
      label: metric === 'hrv'
        ? `${Math.round(value).toLocaleString(locale)} ms`
        : value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    };
  });
}

export function biometricSummary(context: OverviewContext, metric: BiometricMetric, language: AppLanguage = 'fr'): BiometricSummary {
  const values = context.series
    .map((day) => Number(metric === 'hrv' ? day.hrv_rmssd_ms || 0 : day.vo2_max_ml_kg_min || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (values.length === 0) {
    return {
      title: biometricTitle(metric),
      interval: '--',
      average: '--',
      median: '--',
      sampleCount: 0,
      emptyLabel: language === 'en' ? 'No data for this period.' : 'Aucune donnée sur cette période.'
    };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    title: biometricTitle(metric),
    interval: formatBiometricRange(values[0], values[values.length - 1], metric, language),
    average: formatBiometricValue(total / values.length, metric, language),
    median: formatBiometricValue(median(values), metric, language),
    sampleCount: values.length,
    emptyLabel: language === 'en' ? 'No data for this period.' : 'Aucune donnée sur cette période.'
  };
}

export type SourceDiagnosticPresentation = {
  title: string;
  selected: string;
  latest: string;
  sources: string[];
};

export type ReliabilityPresentation = {
  metric: string;
  title: string;
  badge: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
  selected: string;
  explanation: string;
  sources: string[];
};

export function humanSourceLabel(source?: string | null, fallback?: string | null, language: AppLanguage = 'fr'): string {
  const rawSource = (source ?? '').trim();
  const rawFallback = (fallback ?? '').trim();
  const value = `${rawSource} ${rawFallback}`.toLowerCase();
  if (!rawSource && !rawFallback) {
    return 'Auto';
  }
  if (value.includes('garmin')) {
    return 'Garmin';
  }
  if (value.includes('ultrahuman')) {
    return 'Ultrahuman';
  }
  if (value.includes('google')) {
    return 'Google Fit';
  }
  if (value.includes('fitbit')) {
    return 'Fitbit';
  }
  if (value.includes('samsung')) {
    return 'Samsung Health';
  }
  if (value.includes('withings')) {
    return 'Withings';
  }
  if (value.includes('whoop') || value.includes('noop')) {
    return 'Whoop';
  }
  if (value === 'android' || value.includes('android.healthconnect.phone') || value.includes('healthconnect.phone')) {
    return language === 'en' ? 'Phone' : 'Téléphone';
  }
  if (rawFallback && !rawFallback.includes('.') && !rawFallback.includes('/')) {
    return rawFallback;
  }
  return language === 'en' ? 'Android source' : 'Source Android';
}

export function formatSourceDiagnostics(diagnostics?: SourceDiagnostics | null, language: AppLanguage = 'fr'): SourceDiagnosticPresentation[] {
  if (!diagnostics?.domains) {
    return [];
  }
  const preferredMetrics = [
    diagnostics.domains.activity?.metrics.steps,
    diagnostics.domains.activity?.metrics.active_calories,
    diagnostics.domains.workouts?.metrics.workouts,
    diagnostics.domains.sleep?.metrics.sleep,
    diagnostics.domains.biometrics?.metrics.heart_rate,
    diagnostics.domains.biometrics?.metrics.hrv,
    diagnostics.domains.biometrics?.metrics.vo2_max
  ].filter(Boolean) as SourceDiagnosticMetric[];

  const seen = new Set<string>();
  return preferredMetrics
    .filter((metric) => {
      const key = `${metric.domain}:${metric.metric}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((metric) => {
      const selectedLabel = humanSourceLabel(metric.selected_source, metric.selected_source_label, language);
      return {
        title: sourceDiagnosticTitle(metric, language),
        selected: metric.status === 'received' && metric.selected_source_label
          ? language === 'en' ? `Selected source: ${selectedLabel}` : `Source retenue : ${selectedLabel}`
          : language === 'en' ? 'Data not received' : 'Donnée non reçue',
        latest: `${language === 'en' ? 'Latest data received' : 'Dernière donnée reçue'} : ${metric.latest_received_at ? formatParisDateTime(metric.latest_received_at) : language === 'en' ? 'not received' : 'non reçu'}`,
        sources: metric.sources.map((source) => {
          const label = humanSourceLabel(source.source, source.source_label, language);
          return language === 'en'
            ? `${label} wrote ${formatDiagnosticValue(source.total, metric, language)}`
            : `${label} a écrit ${formatDiagnosticValue(source.total, metric, language)}`;
        })
      };
    });
}

export function formatReliabilityMetric(
  summary: DataReliabilitySummary | undefined | null,
  metric: string,
  language: AppLanguage = 'fr'
): ReliabilityPresentation | null {
  const item = summary?.metrics?.[metric];
  if (!item) {
    return null;
  }
  const selectedLabel = humanSourceLabel(item.selected_source, item.selected_source_label, language);
  const selected = item.selected_value == null
    ? language === 'en' ? 'Data not received' : 'Donnée non reçue'
    : `${language === 'en' ? 'Selected source' : 'Source retenue'} : ${selectedLabel}`;
  return {
    metric,
    title: reliabilityMetricTitle(item, language),
    badge: reliabilityBadge(item.status, language),
    tone: reliabilityTone(item.status),
    selected,
    explanation: item.user_explanation,
    sources: item.sources.map((source) => `${humanSourceLabel(source.source, source.source_label, language)} · ${formatReliabilityValue(source.value ?? null, item.unit ?? source.unit, language)}`)
  };
}

export function shouldShowReliabilityBadge(reliability?: ReliabilityPresentation | null): boolean {
  return Boolean(reliability && reliability.tone !== 'success');
}

function sourceDiagnosticTitle(metric: SourceDiagnosticMetric, language: AppLanguage): string {
  if (language === 'fr') {
    return metric.label;
  }
  if (metric.metric === 'steps') {
    return 'Steps today';
  }
  if (metric.metric === 'active_calories') {
    return 'Active calories';
  }
  if (metric.metric === 'workouts') {
    return 'Workout sessions';
  }
  if (metric.metric === 'sleep') {
    return 'Sleep';
  }
  if (metric.metric === 'heart_rate') {
    return 'Heart rate';
  }
  if (metric.metric === 'hrv') {
    return 'Heart rate variability';
  }
  if (metric.metric === 'vo2_max') {
    return 'VO2 max';
  }
  return metric.label;
}

function reliabilityBadge(status: MetricReliabilitySummary['status'], language: AppLanguage): string {
  if (status === 'measured') return language === 'en' ? 'Reliable' : 'Fiable';
  if (status === 'partial') return language === 'en' ? 'Partial' : 'Partiel';
  if (status === 'corrected') return language === 'en' ? 'Corrected' : 'Corrigé';
  return language === 'en' ? 'Check' : 'À vérifier';
}

function reliabilityTone(status: MetricReliabilitySummary['status']): ReliabilityPresentation['tone'] {
  if (status === 'measured') return 'success';
  if (status === 'partial' || status === 'corrected') return 'warning';
  if (status === 'missing' || status === 'conflict') return 'danger';
  return 'info';
}

function reliabilityMetricTitle(item: MetricReliabilitySummary, language: AppLanguage): string {
  if (item.metric === 'steps') return language === 'en' ? 'Steps' : 'Pas';
  if (item.metric === 'sleep') return language === 'en' ? 'Sleep' : 'Sommeil';
  if (item.metric === 'workouts') return language === 'en' ? 'Sport' : 'Sport';
  if (item.metric === 'active_calories') return language === 'en' ? 'Active calories' : 'Dépense calorique';
  if (item.metric === 'heart_rate') return language === 'en' ? 'Heart rate' : 'Fréquence cardiaque';
  if (item.metric === 'hrv') return language === 'en' ? 'Heart rate variability' : 'Variabilité cardiaque';
  if (item.metric === 'vo2_max') return 'VO2 max';
  return item.metric;
}

function formatReliabilityValue(value: number | null, unit: string | null | undefined, language: AppLanguage): string {
  if (value == null || !Number.isFinite(value)) {
    return language === 'en' ? 'not received' : 'non reçu';
  }
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  const formatted = rounded.toLocaleString(locale, { maximumFractionDigits: 1 });
  if (unit === 'count') return language === 'en' ? `${formatted} steps` : `${formatted} pas`;
  if (unit === 'session') return language === 'en' ? `${formatted} session${rounded > 1 ? 's' : ''}` : `${formatted} séance${rounded > 1 ? 's' : ''}`;
  if (unit === 'kcal') return `${formatted} kcal`;
  if (unit === 'ms') return `${formatted} ms`;
  if (unit === 'bpm') return `${formatted} bpm`;
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatDiagnosticValue(value: number, metric: SourceDiagnosticMetric, language: AppLanguage = 'fr'): string {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  const formatted = rounded.toLocaleString(locale, { maximumFractionDigits: 1 });
  if (metric.metric === 'steps') {
    return `${formatted} ${language === 'en' ? 'steps' : 'pas'}`;
  }
  if (metric.metric === 'workouts') {
    if (language === 'en') {
      return `${formatted} ${rounded === 1 ? 'session' : 'sessions'}`;
    }
    return `${formatted} séance${rounded > 1 ? 's' : ''}`;
  }
  if (metric.unit === 'kcal') {
    return `${formatted} kcal`;
  }
  if (metric.unit === 'min') {
    return `${formatted} min`;
  }
  if (metric.unit === 'm') {
    return `${formatted} m`;
  }
  if (metric.unit) {
    return `${formatted} ${metric.unit}`;
  }
  return formatted;
}

function biometricTitle(metric: BiometricMetric): string {
  return metric === 'hrv' ? 'Variabilité cardiaque' : 'VO2 max';
}

function formatBiometricValue(value: number, metric: BiometricMetric, language: AppLanguage = 'fr'): string {
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  if (metric === 'hrv') {
    return `${Math.round(value).toLocaleString(locale)} ms`;
  }
  return value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatBiometricRange(min: number, max: number, metric: BiometricMetric, language: AppLanguage = 'fr'): string {
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  if (metric === 'hrv') {
    return `${Math.round(min).toLocaleString(locale)}-${Math.round(max).toLocaleString(locale)} ms`;
  }
  return `${formatBiometricValue(min, metric, language)}-${formatBiometricValue(max, metric, language)}`;
}

function median(values: number[]): number {
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[middle];
  }
  return (values[middle - 1] + values[middle]) / 2;
}

export function todayWorkoutPresentation(context: OverviewContext, language: AppLanguage = 'fr'): {
  value: string;
  detail: string;
  calorie: ReturnType<typeof workoutCalorieInsight>;
} {
  const workouts = context.workouts.history ?? [];
  const workoutPreview = workouts.slice(0, 3).map((item) => `${formatActivityLabel(item.activity_type, language)} - ${formatDuration(item.duration_minutes)}`);
  const hiddenWorkoutCount = Math.max(0, workouts.length - workoutPreview.length);
  return {
    value: workouts.length === 0 ? language === 'en' ? 'None' : 'Aucun' : workouts.length === 1 ? formatActivityLabel(workouts[0].activity_type, language) : `${workouts.length} ${language === 'en' ? 'sports' : 'sports'}`,
    detail: workoutPreview.length > 0 ? `${workoutPreview.join('\n')}${hiddenWorkoutCount > 0 ? `\n+${hiddenWorkoutCount} ${language === 'en' ? 'more' : 'autre(s)'}` : ''}` : '-',
    calorie: workoutCalorieInsight(context, language)
  };
}

export function buildLocalCoachAdvice(dashboard: DashboardData, generatedAt: string): CoachAdvicePayload {
  const context = dashboard.windows.last_24h;
  const morning = dashboard.morning_context;
  const actions = coachActionsForToday(dashboard);
  const primaryAction = actions[0];
  const scores = lifeBalanceForToday(dashboard)?.scores ?? [];
  const rankedScores = scores.filter((score) => score.slug !== 'sleep' || score.contributors.length > 0);
  const weakest = rankedScores.length ? [...rankedScores].sort((left, right) => left.value - right.value)[0] : null;
  const title = weakest ? `Priorité ${weakest.label.toLowerCase()}` : 'Conseil prêt';
  const summary = morning?.is_today_partial
    ? morningSummary(morning)
    : `Lecture instantanée du snapshot : ${sleepSummary(context.sleep.average_duration_minutes ?? context.sleep.total_duration_minutes ?? 0)}, ${(context.activity.steps ?? 0).toLocaleString('fr-FR')} pas, ${formatDuration(context.workouts.duration_minutes ?? 0)} d'entraînement.`;
  return {
    version: 'healthconnect.coach.today_advice.local.v1',
    generated_at: generatedAt,
    model: 'snapshot-local',
    advice: {
      title: primaryAction ? primaryAction.label : title,
      summary,
      action: primaryAction?.action ?? weakest?.explanation ?? 'Posez une question au coach pour une analyse locale plus détaillée.'
    },
    actions,
    confidence: weakest?.confidence ?? 'low',
    context_window: '24h',
    fallback: true
  };
}

function morningSummary(morning: MorningContext): string {
  const previousSteps = Number('steps' in morning.previous_day ? morning.previous_day.steps : 0);
  const todaySteps = Number('steps' in morning.today_so_far ? morning.today_so_far.steps : 0);
  const workoutMinutes = Number('workout_minutes' in morning.previous_day ? morning.previous_day.workout_minutes : 0);
  return `Lecture matin : ${lastNightSummary(morning.last_night.duration_minutes)}, hier ${previousSteps.toLocaleString('fr-FR')} pas et ${formatDuration(workoutMinutes)} d'entraînement. Aujourd'hui reste partiel (${todaySteps.toLocaleString('fr-FR')} pas).`;
}

function sleepSummary(minutes: number): string {
  return minutes > 0 ? `${formatDuration(minutes)} de sommeil` : 'sommeil non mesuré';
}

function lastNightSummary(minutes: number): string {
  return minutes > 0 ? `dernière nuit ${formatDuration(minutes)}` : 'dernière nuit non mesurée';
}

export function deviceNameFromSettings(_settings: Settings): string {
  return DEVICE_NAME;
}
