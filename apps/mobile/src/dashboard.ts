import { DEVICE_NAME } from './config';
import { formatActivityLabel, formatDuration, formatParisDateTime } from './format';
import type { CoachAction, CoachAdvicePayload, DashboardData, LifeBalanceScores, MorningContext, OverviewContext, Settings, WindowKey } from './types';

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

export function morningInsightForToday(dashboard: DashboardData): { status: string; title: string; message: string } | null {
  const morning = dashboard.morning_context;
  if (!morning?.message) {
    return null;
  }
  return {
    status: morning.status ?? (morning.is_today_partial ? 'partial_today' : 'ready'),
    title: morning.title ?? (morning.is_today_partial ? 'Données du matin partielles' : 'Lecture du jour'),
    message: morning.message
  };
}

export function coachActionsForToday(dashboard: DashboardData): CoachAction[] {
  const morningActions = dashboard.morning_context?.coach_actions;
  if (morningActions?.length) {
    return morningActions;
  }
  return dashboard.windows.last_24h.coach_actions ?? [];
}

export function nutritionInsight(context: OverviewContext) {
  const nutrition = context.nutrition;
  const meals = Math.round(nutrition.meals || 0);
  const averageDailyEnergy = Math.round(nutrition.average_daily_energy_kcal || 0);
  return {
    title: meals > 0 ? 'Nutrition validée' : 'Nutrition à compléter',
    energy: `${Math.round(nutrition.energy_kcal || 0).toLocaleString('fr-FR')} kcal`,
    meals: meals > 1 ? `${meals} repas validés` : meals === 1 ? '1 repas validé' : 'Aucun repas validé',
    average: averageDailyEnergy > 0 ? `Moyenne ${averageDailyEnergy.toLocaleString('fr-FR')} kcal/j` : 'Moyenne à compléter',
    latestMeal: nutrition.latest_meal_at ? `Dernier repas ${formatParisDateTime(nutrition.latest_meal_at)}` : 'Aucun repas validé récent',
    macros: `P ${Math.round(nutrition.protein_g || 0)} g · G ${Math.round(nutrition.carbohydrates_g || 0)} g · L ${Math.round(nutrition.fat_g || 0)} g`,
    hydration: `${(nutrition.hydration_liters || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} L hydratation`,
    prompt: meals > 0 ? 'Peux-tu analyser ma nutrition validée du jour ?' : 'Comment structurer ma nutrition aujourd’hui ?'
  };
}

export function workoutCalorieInsight(context: OverviewContext): { label: string; value: string } | null {
  const total = Number(context.activity.active_calories_kcal || 0);
  if (total <= 0) {
    return null;
  }
  if (context.window === '24h') {
    return {
      label: 'Dépense calorique',
      value: `${Math.round(total).toLocaleString('fr-FR')} kcal`
    };
  }
  const average = Number(context.activity.average_daily_active_calories_kcal || 0)
    || total / Math.max(1, context.series.length);
  return {
    label: 'Dépense calorique moy.',
    value: `${Math.round(average).toLocaleString('fr-FR')} kcal/j`
  };
}

export function todayCardioInsight(context: OverviewContext): { label: string; value: string; detail: string } | null {
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
    average > 0 ? `Moyenne ${Math.round(average)} bpm` : null,
    resting > 0 ? `repos ${Math.round(resting)} bpm` : null
  ].filter(Boolean);
  return {
    label: 'Fréquence cardiaque',
    value,
    detail: details.length ? details.join(' · ') : 'Données reçues'
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

export function biometricChartData(context: OverviewContext, metric: BiometricMetric) {
  return context.series.map((day) => {
    const value = Number(metric === 'hrv' ? day.hrv_rmssd_ms || 0 : day.vo2_max_ml_kg_min || 0);
    return {
      date: day.date,
      value,
      label: metric === 'hrv'
        ? `${Math.round(value).toLocaleString('fr-FR')} ms`
        : value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    };
  });
}

export function biometricSummary(context: OverviewContext, metric: BiometricMetric): BiometricSummary {
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
      emptyLabel: 'Aucune donnée sur cette période.'
    };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    title: biometricTitle(metric),
    interval: formatBiometricRange(values[0], values[values.length - 1], metric),
    average: formatBiometricValue(total / values.length, metric),
    median: formatBiometricValue(median(values), metric),
    sampleCount: values.length,
    emptyLabel: 'Aucune donnée sur cette période.'
  };
}

function biometricTitle(metric: BiometricMetric): string {
  return metric === 'hrv' ? 'Variabilité cardiaque' : 'VO2 max';
}

function formatBiometricValue(value: number, metric: BiometricMetric): string {
  if (metric === 'hrv') {
    return `${Math.round(value).toLocaleString('fr-FR')} ms`;
  }
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatBiometricRange(min: number, max: number, metric: BiometricMetric): string {
  if (metric === 'hrv') {
    return `${Math.round(min).toLocaleString('fr-FR')}-${Math.round(max).toLocaleString('fr-FR')} ms`;
  }
  return `${formatBiometricValue(min, metric)}-${formatBiometricValue(max, metric)}`;
}

function median(values: number[]): number {
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[middle];
  }
  return (values[middle - 1] + values[middle]) / 2;
}

export function todayWorkoutPresentation(context: OverviewContext): {
  value: string;
  detail: string;
  calorie: ReturnType<typeof workoutCalorieInsight>;
} {
  const workouts = context.workouts.history ?? [];
  const workoutPreview = workouts.slice(0, 3).map((item) => `${formatActivityLabel(item.activity_type)} - ${formatDuration(item.duration_minutes)}`);
  const hiddenWorkoutCount = Math.max(0, workouts.length - workoutPreview.length);
  return {
    value: workouts.length === 0 ? 'Aucun' : workouts.length === 1 ? formatActivityLabel(workouts[0].activity_type) : `${workouts.length} sports`,
    detail: workoutPreview.length > 0 ? `${workoutPreview.join('\n')}${hiddenWorkoutCount > 0 ? `\n+${hiddenWorkoutCount} autre(s)` : ''}` : '-',
    calorie: workoutCalorieInsight(context)
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
