import { biometricChartData, biometricSummary, buildLocalCoachAdvice, chartContextForWindow, coachActionsForToday, displayContextForWindow, formatReliabilityMetric, formatSourceDiagnostics, lifeBalanceForToday, morningInsightForToday, nutritionInsight, overviewForWindow, shouldShowReliabilityBadge, sleepDetailsForToday, todayCardioInsight, todayWorkoutPresentation, workoutCalorieInsight } from './dashboard';
import { healthSyncSummary } from './syncPresentation';
import type { DashboardData } from './types';

function dashboardFixture(): DashboardData {
  const cloneWindow = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const scoreSet = {
    window: '24h' as const,
    scores: [
      { slug: 'sleep' as const, label: 'Sommeil', value: 79, tone: 'green' as const, confidence: 'medium' as const, explanation: 'Sommeil correct.', contributors: [] },
      { slug: 'recovery' as const, label: 'Récupération', value: 91, tone: 'green' as const, confidence: 'low' as const, explanation: 'Récupération correcte.', contributors: [] },
      { slug: 'movement' as const, label: 'Mouvement', value: 90, tone: 'green' as const, confidence: 'high' as const, explanation: 'Objectif mouvement atteint.', contributors: [] }
    ]
  };
  const last24h: DashboardData['windows']['last_24h'] = {
    window: '24h',
    life_balance_scores: {
      window: '24h',
      scores: [
        { slug: 'sleep', label: 'Sommeil', value: 0, tone: 'red', confidence: 'low', explanation: 'Aucune nuit.', contributors: [] },
        { slug: 'recovery', label: 'Récupération', value: 32, tone: 'red', confidence: 'low', explanation: 'À surveiller.', contributors: [] },
        { slug: 'movement', label: 'Mouvement', value: 1, tone: 'red', confidence: 'high', explanation: 'Mouvement faible.', contributors: [] }
      ]
    },
    sleep: { sessions: 0, total_duration_minutes: 0, average_duration_minutes: 0, deep_sleep_minutes: 0, rem_sleep_minutes: 0, light_sleep_minutes: 0, awake_minutes: 0 },
    nutrition: { meals: 0, energy_kcal: 0, average_daily_energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0, latest_meal_at: null },
    workouts: { sessions: 0, duration_minutes: 0, calories: 0, distance_meters: 0, history: [] },
    activity: { steps: 76, active_calories_kcal: 0, distance_meters: 0 },
    series: [{ date: '2026-05-26', steps: 76, active_calories_kcal: 0, distance_meters: 0, sleep_minutes: 0, workout_minutes: 0, workouts: 0, energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0 }]
  };
  return {
    generated_at: '2026-05-26T08:00:00Z',
    windows: {
      last_24h: last24h,
      week: { ...cloneWindow(last24h), window: '7d' },
      month: { ...cloneWindow(last24h), window: '30d' }
    },
    latest_sync_run: null,
    sync_summary: { total_runs: 0, success_runs: 0, error_runs: 0, duplicate_runs: 0, records_received: 0, recent_runs: [] },
    source_config: { detected_sources: {}, preferred_sources: {}, effective_sources: {}, source_badge: 'Custom' },
    morning_context: {
      status: 'partial_today',
      title: 'Données du matin partielles',
      is_today_partial: true,
      recommended_context: 'previous_day',
      message: 'Données partielles.',
      today_so_far: last24h.series[0],
      previous_day: { date: '2026-05-25', steps: 18436, active_calories_kcal: 0, distance_meters: 14936, sleep_minutes: 375, workout_minutes: 0, workouts: 0, energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0 },
      last_night: { duration_minutes: 375, start_time: '2026-05-25T00:27:30+00:00', end_time: '2026-05-25T07:29:30+00:00', awakenings_count: 8 },
      life_balance_scores: scoreSet
    }
  };
}

test('selects overview windows from dashboard bundle', () => {
  const dashboard = dashboardFixture();
  expect(overviewForWindow(dashboard, '24h').window).toBe('24h');
  expect(overviewForWindow(dashboard, '7d').window).toBe('7d');
  expect(overviewForWindow(dashboard, '30d').window).toBe('30d');
});

test('uses the last three week days for today charts', () => {
  const dashboard = dashboardFixture();
  dashboard.windows.week.series = [
    { date: '2026-05-23', steps: 9000, active_calories_kcal: 0, distance_meters: 0, sleep_minutes: 330, workout_minutes: 0, workouts: 0, energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0 },
    { date: '2026-05-24', steps: 12000, active_calories_kcal: 0, distance_meters: 0, sleep_minutes: 360, workout_minutes: 45, workouts: 1, energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0 },
    { date: '2026-05-25', steps: 18436, active_calories_kcal: 0, distance_meters: 0, sleep_minutes: 375, workout_minutes: 0, workouts: 0, energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0 },
    { date: '2026-05-26', steps: 76, active_calories_kcal: 0, distance_meters: 0, sleep_minutes: 0, workout_minutes: 0, workouts: 0, energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0 }
  ];

  const chartContext = chartContextForWindow(dashboard.windows.last_24h, dashboard.windows.week);

  expect(chartContext.series.map((day) => day.date)).toEqual(['2026-05-24', '2026-05-25', '2026-05-26']);
  expect(chartContext.series.at(-1)?.steps).toBe(76);
});

test('uses morning context for scores and sleep details when today is partial', () => {
  const dashboard = dashboardFixture();
  expect(lifeBalanceForToday(dashboard)?.scores[0].value).toBe(79);
  expect(sleepDetailsForToday(dashboard)).toMatchObject({
    durationMinutes: 375,
    awakenings: 8
  });
});

test('uses the last measured night in today display context when the raw day is still empty', () => {
  const dashboard = dashboardFixture();
  dashboard.morning_context!.last_night = {
    duration_minutes: 419,
    start_time: '2026-06-01T00:22:00+00:00',
    end_time: '2026-06-01T08:39:00+00:00',
    awakenings_count: 5,
    source: 'com.garmin.android.apps.connectmobile'
  };
  dashboard.windows.last_24h.sleep = {
    sessions: 0,
    total_duration_minutes: 0,
    average_duration_minutes: 0,
    deep_sleep_minutes: 0,
    rem_sleep_minutes: 0,
    light_sleep_minutes: 0,
    awake_minutes: 0,
    source: 'com.garmin.android.apps.connectmobile'
  };
  dashboard.windows.last_24h.series = [{
    date: '2026-06-01',
    steps: 138,
    active_calories_kcal: 0,
    distance_meters: 0,
    sleep_minutes: 0,
    workout_minutes: 0,
    workouts: 0,
    energy_kcal: 0,
    protein_g: 0,
    carbohydrates_g: 0,
    fat_g: 0,
    hydration_liters: 0
  }];

  const context = displayContextForWindow(dashboard, '24h');

  expect(context.sleep.sessions).toBe(1);
  expect(context.sleep.average_duration_minutes).toBe(419);
  expect(context.sleep.latest_sleep_start).toBe('2026-06-01T00:22:00+00:00');
  expect(context.sleep.latest_sleep_end).toBe('2026-06-01T08:39:00+00:00');
  expect(context.sleep.latest_sleep_awakenings_count).toBe(5);
  expect(context.series.at(-1)?.sleep_minutes).toBe(419);
});

test('uses the last measured night even when the dashboard marks today as ready but sleep is still empty', () => {
  const dashboard = dashboardFixture();
  dashboard.morning_context!.is_today_partial = false;
  dashboard.morning_context!.recommended_context = 'today_so_far';
  dashboard.morning_context!.status = 'ready';
  dashboard.morning_context!.last_night = {
    duration_minutes: 419,
    start_time: '2026-05-31T00:22:00+00:00',
    end_time: '2026-05-31T08:39:00+00:00',
    awakenings_count: 5,
    source: 'com.garmin.android.apps.connectmobile'
  };
  dashboard.windows.last_24h.sleep = {
    sessions: 0,
    total_duration_minutes: 0,
    average_duration_minutes: 0,
    deep_sleep_minutes: 0,
    rem_sleep_minutes: 0,
    light_sleep_minutes: 0,
    awake_minutes: 0,
    source: 'com.garmin.android.apps.connectmobile'
  };
  dashboard.windows.last_24h.series = [{
    date: '2026-06-01',
    steps: 3621,
    active_calories_kcal: 0,
    distance_meters: 0,
    sleep_minutes: 0,
    workout_minutes: 44,
    workouts: 1,
    energy_kcal: 0,
    protein_g: 0,
    carbohydrates_g: 0,
    fat_g: 0,
    hydration_liters: 0
  }];

  const context = displayContextForWindow(dashboard, '24h');
  const details = sleepDetailsForToday(dashboard);

  expect(context.sleep.sessions).toBe(1);
  expect(context.sleep.average_duration_minutes).toBe(419);
  expect(context.series.at(-1)?.sleep_minutes).toBe(419);
  expect(details).toMatchObject({
    durationMinutes: 419,
    startTime: '2026-05-31T00:22:00+00:00',
    endTime: '2026-05-31T08:39:00+00:00',
    awakenings: 5
  });
});

test('builds local coach advice from morning reference context', () => {
  const dashboard = dashboardFixture();
  dashboard.windows.last_24h.coach_actions = [
    {
      slug: 'protect_recovery',
      label: 'Protéger la récupération',
      priority: 1,
      reason: 'Nuit courte.',
      action: "Décale l'intensité et garde une journée plus douce.",
      tone: 'orange'
    }
  ];
  const advice = buildLocalCoachAdvice(dashboard, '2026-05-26T08:00:00Z');
  expect(advice.advice.summary).toContain('dernière nuit 6 h 15');
  expect(advice.advice.summary).toMatch(/18[\s\u00a0\u202f]436 pas/);
  expect(advice.advice.summary).toContain('76 pas');
  expect(advice.advice.action).toBe("Décale l'intensité et garde une journée plus douce.");
  expect(advice.actions?.[0].slug).toBe('protect_recovery');
});

test('selects coach actions from morning context before the 24h fallback', () => {
  const dashboard = dashboardFixture();
  dashboard.windows.last_24h.coach_actions = [
    {
      slug: 'window-action',
      label: 'Action fenêtre',
      priority: 1,
      reason: 'Raison fenêtre',
      action: 'Action fenêtre',
      tone: 'green'
    }
  ];
  dashboard.morning_context!.coach_actions = [
    {
      slug: 'morning-action',
      label: 'Action matin',
      priority: 1,
      reason: 'Raison matin',
      action: 'Action matin',
      tone: 'orange'
    }
  ];

  expect(coachActionsForToday(dashboard).map((action) => action.slug)).toEqual(['morning-action']);
  delete dashboard.morning_context!.coach_actions;
  expect(coachActionsForToday(dashboard).map((action) => action.slug)).toEqual(['window-action']);
});

test('exposes morning insight when sleep data is missing', () => {
  const dashboard = dashboardFixture();
  dashboard.morning_context = {
    status: 'sleep_missing',
    title: 'Nuit non mesurée',
    is_today_partial: false,
    recommended_context: 'today_so_far',
    message: "Il n'y a pas de données sommeil exploitables.",
    today_so_far: dashboard.windows.last_24h.series[0],
    previous_day: {},
    last_night: { duration_minutes: 0, awakenings_count: 0 },
    life_balance_scores: dashboard.windows.last_24h.life_balance_scores
  };

  expect(morningInsightForToday(dashboard)).toEqual({
    status: 'sleep_missing',
    title: 'Nuit non mesurée',
    message: "Il n'y a pas de données sommeil exploitables."
  });
});

test('localizes backend morning insight when the app language is English', () => {
  const dashboard = dashboardFixture();
  dashboard.morning_context = {
    status: 'partial_today',
    title: 'Données du matin partielles',
    is_today_partial: true,
    recommended_context: 'previous_day',
    message: 'Données du jour encore partielles : lecture basée sur la dernière journée complète et la dernière nuit mesurée.',
    today_so_far: dashboard.windows.last_24h.series[0],
    previous_day: dashboard.windows.week.series[0],
    last_night: { duration_minutes: 375, awakenings_count: 2 },
    life_balance_scores: dashboard.windows.last_24h.life_balance_scores
  };

  expect(morningInsightForToday(dashboard, 'en')).toEqual({
    status: 'partial_today',
    title: 'Partial morning data',
    message: 'Today is still partial: reading based on the last complete day and the last measured night.'
  });
});

test('builds a readable nutrition insight for cockpit', () => {
  const dashboard = dashboardFixture();
  dashboard.windows.last_24h.nutrition = {
    meals: 2,
    energy_kcal: 1840,
    average_daily_energy_kcal: 920,
    protein_g: 128,
    carbohydrates_g: 190,
    fat_g: 62,
    hydration_liters: 1.7,
    latest_meal_at: '2026-05-26T18:30:00+00:00'
  };

  expect(nutritionInsight(dashboard.windows.last_24h)).toEqual({
    title: 'Nutrition validée',
    energy: '1 840 kcal',
    meals: '2 repas validés',
    average: 'Moyenne 920 kcal/j',
    latestMeal: 'Dernier repas 26/05/2026 20:30',
    macros: 'P 128 g · G 190 g · L 62 g',
    hydration: '1,7 L hydratation',
    prompt: 'Peux-tu analyser ma nutrition validée du jour ?'
  });
});

test('shows workout calorie insight only when calorie data exists', () => {
  const dashboard = dashboardFixture();

  expect(workoutCalorieInsight(dashboard.windows.last_24h)).toBeNull();

  dashboard.windows.last_24h.activity.active_calories_kcal = 2365.62;
  dashboard.windows.week.activity.active_calories_kcal = 13214.28;
  dashboard.windows.week.activity.average_daily_active_calories_kcal = 1887.75;

  expect(workoutCalorieInsight(dashboard.windows.last_24h)).toEqual({
    label: 'Dépense calorique',
    value: '2 366 kcal'
  });
  expect(workoutCalorieInsight(dashboard.windows.week)).toEqual({
    label: 'Dépense calorique moy.',
    value: '1 888 kcal/j'
  });
});

test('prefers total workout calories over daily active calories for today sport', () => {
  const dashboard = dashboardFixture();
  dashboard.windows.last_24h.activity.active_calories_kcal = 578;
  dashboard.windows.last_24h.workouts.calories = 644;
  dashboard.windows.last_24h.workouts.history = [{
    date: '2026-06-16',
    start_time: '2026-06-16T10:34:58+00:00',
    end_time: '2026-06-16T11:17:00.523000+00:00',
    activity_type: 'cycling',
    duration_minutes: 42,
    calories: 644,
    distance_meters: 0
  }];

  expect(workoutCalorieInsight(dashboard.windows.last_24h)).toEqual({
    label: 'Dépense calorique',
    value: '644 kcal'
  });
  expect(todayWorkoutPresentation(dashboard.windows.last_24h).calorie).toEqual({
    label: 'Dépense calorique',
    value: '644 kcal'
  });
});

test('does not present daily active calories as workout spend when sport calories are missing', () => {
  const dashboard = dashboardFixture();
  dashboard.windows.last_24h.activity.active_calories_kcal = 578;
  dashboard.windows.last_24h.workouts.history = [{
    date: '2026-06-16',
    start_time: '2026-06-16T10:34:58+00:00',
    end_time: '2026-06-16T11:17:00.523000+00:00',
    activity_type: 'cycling',
    duration_minutes: 42,
    calories: 0,
    distance_meters: 0
  }];

  expect(workoutCalorieInsight(dashboard.windows.last_24h)).toBeNull();
});

test('keeps calories as a separate today tile after sport when available', () => {
  const dashboard = dashboardFixture();
  dashboard.windows.last_24h.activity.active_calories_kcal = 2365.62;
  dashboard.windows.last_24h.workouts.calories = 644;
  dashboard.windows.last_24h.workouts.history = [{
    date: '2026-05-26',
    start_time: '2026-05-26T08:00:00+00:00',
    end_time: '2026-05-26T08:42:00+00:00',
    activity_type: 'cycling',
    duration_minutes: 42,
    calories: 644,
    distance_meters: 0
  }];

  expect(todayWorkoutPresentation(dashboard.windows.last_24h)).toEqual({
    value: 'RPM',
    detail: 'RPM - 42 min',
    calorie: { label: 'Dépense calorique', value: '644 kcal' }
  });
});

test('summarizes today heart-rate range when cardio samples are available', () => {
  const dashboard = dashboardFixture();
  dashboard.windows.last_24h.biometrics = {
    hrv_records: 1,
    hrv_rmssd_ms: 62,
    latest_hrv_at: '2026-06-03T05:00:00+00:00',
    heart_rate_records: 3,
    average_heart_rate_bpm: 87.666,
    heart_rate_min_bpm: 50,
    heart_rate_max_bpm: 158,
    latest_heart_rate_at: '2026-06-03T17:30:00+00:00',
    resting_heart_rate_records: 1,
    resting_heart_rate_bpm: 53,
    latest_resting_heart_rate_at: '2026-06-03T05:10:00+00:00',
    vo2_max_records: 1,
    vo2_max_ml_kg_min: 48,
    latest_vo2_max_at: '2026-06-03T08:00:00+00:00'
  };

  expect(todayCardioInsight(dashboard.windows.last_24h)).toEqual({
    label: 'Fréquence cardiaque',
    value: '50-158 bpm',
    detail: 'Moyenne 88 bpm · repos 53 bpm'
  });
});

test('builds HRV and VO2 chart data from daily biometrics', () => {
  const dashboard = dashboardFixture();
  dashboard.windows.week.series = [
    { date: '2026-06-01', steps: 0, active_calories_kcal: 0, distance_meters: 0, sleep_minutes: 0, workout_minutes: 0, workouts: 0, energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0, hrv_rmssd_ms: 41.2, vo2_max_ml_kg_min: 47.1 },
    { date: '2026-06-02', steps: 0, active_calories_kcal: 0, distance_meters: 0, sleep_minutes: 0, workout_minutes: 0, workouts: 0, energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0, hrv_rmssd_ms: 44.4, vo2_max_ml_kg_min: 47.7 },
    { date: '2026-06-03', steps: 0, active_calories_kcal: 0, distance_meters: 0, sleep_minutes: 0, workout_minutes: 0, workouts: 0, energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0, hrv_rmssd_ms: 62.0, vo2_max_ml_kg_min: 48.0 }
  ];

  expect(biometricChartData(dashboard.windows.week, 'hrv').map(({ date, value, label }) => ({ date, value, label }))).toEqual([
    { date: '2026-06-01', value: 41.2, label: '41 ms' },
    { date: '2026-06-02', value: 44.4, label: '44 ms' },
    { date: '2026-06-03', value: 62.0, label: '62 ms' }
  ]);
  expect(biometricChartData(dashboard.windows.week, 'vo2').map(({ date, value, label }) => ({ date, value, label }))).toEqual([
    { date: '2026-06-01', value: 47.1, label: '47,1' },
    { date: '2026-06-02', value: 47.7, label: '47,7' },
    { date: '2026-06-03', value: 48.0, label: '48,0' }
  ]);
});

test('summarizes HRV and VO2 as interval average and median', () => {
  const dashboard = dashboardFixture();
  dashboard.windows.week.series = [
    { date: '2026-06-01', steps: 0, active_calories_kcal: 0, distance_meters: 0, sleep_minutes: 0, workout_minutes: 0, workouts: 0, energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0, hrv_rmssd_ms: 41.2, vo2_max_ml_kg_min: 47.1 },
    { date: '2026-06-02', steps: 0, active_calories_kcal: 0, distance_meters: 0, sleep_minutes: 0, workout_minutes: 0, workouts: 0, energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0, hrv_rmssd_ms: 44.4, vo2_max_ml_kg_min: 47.7 },
    { date: '2026-06-03', steps: 0, active_calories_kcal: 0, distance_meters: 0, sleep_minutes: 0, workout_minutes: 0, workouts: 0, energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0, hrv_rmssd_ms: 62.0, vo2_max_ml_kg_min: 48.0 }
  ];

  expect(biometricSummary(dashboard.windows.week, 'hrv')).toEqual({
    title: 'Variabilité cardiaque',
    interval: '41-62 ms',
    average: '49 ms',
    median: '44 ms',
    sampleCount: 3,
    emptyLabel: 'Aucune donnée sur cette période.'
  });
  expect(biometricSummary(dashboard.windows.week, 'vo2')).toEqual({
    title: 'VO2 max',
    interval: '47,1-48,0',
    average: '47,6',
    median: '47,7',
    sampleCount: 3,
    emptyLabel: 'Aucune donnée sur cette période.'
  });

  dashboard.windows.week.series = dashboard.windows.week.series.map((day) => ({
    ...day,
    hrv_rmssd_ms: 0,
    vo2_max_ml_kg_min: 0
  }));
  expect(biometricSummary(dashboard.windows.week, 'hrv').sampleCount).toBe(0);
  expect(biometricSummary(dashboard.windows.week, 'hrv').emptyLabel).toBe('Aucune donnée sur cette période.');
});

test('formats source diagnostics for user-facing reliability copy', () => {
  const dashboard = dashboardFixture();
  dashboard.source_diagnostics = {
    generated_at: '2026-06-14T08:00:00Z',
    domains: {
      activity: {
        selected_source: 'com.garmin.android.apps.connectmobile',
        selected_source_label: 'Garmin',
        metrics: {
          steps: {
            metric: 'steps',
            label: 'Pas',
            domain: 'activity',
            unit: 'count',
            status: 'received',
            selected_source: 'com.garmin.android.apps.connectmobile',
            selected_source_label: 'Garmin',
            selected_value: 17334,
            selected_records: 1,
            latest_received_at: '2026-05-19T20:00:00+00:00',
            sources: [
              { source: 'com.garmin.android.apps.connectmobile', source_label: 'Garmin', total: 17334, records: 1, latest_received_at: '2026-05-19T20:00:00+00:00', selected: true },
              { source: 'com.google.android.apps.fitness', source_label: 'Google Fit', total: 13016, records: 1, latest_received_at: '2026-05-19T20:00:00+00:00', selected: false },
              { source: 'com.android.healthconnect.phone.jb', source_label: 'com.android.healthconnect.phone.jb', total: 20204, records: 1, latest_received_at: '2026-05-19T20:00:00+00:00', selected: false },
              { source: 'noop.whoop.sync', source_label: 'noop.whoop.sync', total: 12000, records: 1, latest_received_at: '2026-05-19T20:00:00+00:00', selected: false }
            ]
          }
        }
      },
      biometrics: {
        selected_source: null,
        selected_source_label: 'Auto',
        metrics: {
          hrv: {
            metric: 'hrv',
            label: 'Variabilite cardiaque',
            domain: 'biometrics',
            unit: 'ms',
            status: 'not_received',
            selected_source: null,
            selected_source_label: 'Auto',
            selected_value: null,
            selected_records: 0,
            latest_received_at: null,
            sources: []
          }
        }
      }
    }
  };

  expect(formatSourceDiagnostics(dashboard.source_diagnostics)).toEqual([
    {
      title: 'Pas',
      selected: 'Source retenue : Garmin',
      latest: 'Dernière donnée reçue : 19/05/2026 22:00',
      sources: [
        'Garmin a écrit 17 334 pas',
        'Google Fit a écrit 13 016 pas',
        'Téléphone a écrit 20 204 pas',
        'Whoop a écrit 12 000 pas'
      ]
    },
    {
      title: 'Variabilite cardiaque',
      selected: 'Donnée non reçue',
      latest: 'Dernière donnée reçue : non reçu',
      sources: []
    }
  ]);

  expect(formatSourceDiagnostics(dashboard.source_diagnostics, 'en')).toEqual([
    {
      title: 'Steps today',
      selected: 'Selected source: Garmin',
      latest: 'Latest data received : 19/05/2026 22:00',
      sources: [
        'Garmin wrote 17,334 steps',
        'Google Fit wrote 13,016 steps',
        'Phone wrote 20,204 steps',
        'Whoop wrote 12,000 steps'
      ]
    },
    {
      title: 'Heart rate variability',
      selected: 'Data not received',
      latest: 'Latest data received : not received',
      sources: []
    }
  ]);
});

test('formats reliability badge and detail in French without debug terms', () => {
  const summary = {
    generated_at: '2026-06-14T12:00:00+00:00',
    metrics: {
      steps: {
        metric: 'steps',
        domain: 'activity',
        status: 'corrected',
        confidence: 'medium',
        selected_source: 'com.garmin.android.apps.connectmobile',
        selected_source_label: 'Garmin',
        selected_value: 15459,
        unit: 'count',
        latest_received_at: '2026-06-14T12:00:00+00:00',
        badge_label: 'Corrige',
        user_explanation: 'ALIS retient Garmin car la source retenue semblait partielle.',
        coach_reason: 'ALIS retient Garmin car la source retenue semblait partielle.',
        sources: [
          { source: 'android', source_label: 'Android', value: 6000, unit: 'count', latest_received_at: '2026-06-14T08:00:00+00:00', selected: false, note: null },
          { source: 'com.garmin.android.apps.connectmobile', source_label: 'Garmin', value: 15459, unit: 'count', latest_received_at: '2026-06-14T12:00:00+00:00', selected: true, note: null }
        ]
      }
    }
  } as const;

  const formatted = formatReliabilityMetric(summary, 'steps', 'fr');

  expect(formatted?.badge).toBe('Corrigé');
  expect(formatted?.tone).toBe('warning');
  expect(formatted?.title).toBe('Pas');
  expect(formatted?.selected).toContain('Garmin');
  expect(formatted?.sources.join(' ')).not.toMatch(/payload|batch|records|com\.garmin/);
});

test('formats reliability badge and detail in English', () => {
  const summary = {
    generated_at: '2026-06-14T12:00:00+00:00',
    metrics: {
      hrv: {
        metric: 'hrv',
        domain: 'biometrics',
        status: 'missing',
        confidence: 'low',
        selected_source: null,
        selected_source_label: 'Auto',
        selected_value: null,
        unit: 'ms',
        latest_received_at: null,
        badge_label: 'A verifier',
        user_explanation: 'Variabilite cardiaque pas recue par ALIS pour cette période.',
        coach_reason: 'HRV not received in ALIS.',
        sources: []
      }
    }
  } as const;

  const formatted = formatReliabilityMetric(summary, 'hrv', 'en');

  expect(formatted?.badge).toBe('Check');
  expect(formatted?.title).toBe('Heart rate variability');
  expect(formatted?.selected).toBe('Data not received');
});

test('omits reliability badge for high-confidence measured metrics by default', () => {
  expect(shouldShowReliabilityBadge({
    metric: 'steps',
    title: 'Pas',
    badge: 'Fiable',
    tone: 'success',
    selected: 'Source retenue : Garmin',
    explanation: 'Source complète.',
    sources: ['Garmin · 12 000 pas']
  })).toBe(false);
});

test('shows reliability badge for corrected partial conflict and missing metrics', () => {
  expect(shouldShowReliabilityBadge({
    metric: 'steps',
    title: 'Pas',
    badge: 'Corrigé',
    tone: 'warning',
    selected: 'Source retenue : Garmin',
    explanation: 'Source corrigée.',
    sources: []
  })).toBe(true);
  expect(shouldShowReliabilityBadge({
    metric: 'hrv',
    title: 'Variabilité cardiaque',
    badge: 'À vérifier',
    tone: 'danger',
    selected: 'Donnée non reçue',
    explanation: 'Aucune donnée reçue.',
    sources: []
  })).toBe(true);
});

test('summarizes mobile sync state with ALIS-facing wording', () => {
  expect(healthSyncSummary({
    syncing: false,
    lastHealthSyncAt: null,
    latestRun: null,
    lastBackgroundStatus: null
  })).toEqual({
    title: 'Synchronisation initiale requise',
    detail: 'Lance une synchronisation complète depuis ce téléphone.',
    action: 'Synchroniser'
  });

  expect(healthSyncSummary({
    syncing: true,
    lastHealthSyncAt: '2026-05-26T08:00:00Z',
    latestRun: null,
    lastBackgroundStatus: null
  })).toEqual({
    title: 'Synchronisation en cours',
    detail: 'Lecture des données santé et envoi vers ALIS...',
    action: 'Synchronisation...'
  });

  expect(healthSyncSummary({
    syncing: false,
    lastHealthSyncAt: '2026-05-26T08:00:00Z',
    latestRun: { status: 'success', trigger: 'manual', records_received: 42 },
    lastBackgroundStatus: JSON.stringify({ status: 'synced', syncedRecordCount: 42, dataEnd: '2026-05-26T08:00:00Z', recordedAt: '2026-05-26T08:10:00Z' }),
    now: new Date('2026-05-26T12:00:00+02:00')
  })).toMatchObject({
    title: 'Dernière synchronisation',
    detail: "Aujourd'hui à 10:00",
    freshnessTone: 'success',
    freshnessLabel: 'Données récentes',
    action: 'Synchroniser'
  });
});

test('summarizes mobile sync state in English', () => {
  expect(healthSyncSummary({
    syncing: false,
    lastHealthSyncAt: null,
    latestRun: null,
    lastBackgroundStatus: null,
    language: 'en'
  })).toEqual({
    title: 'Initial sync required',
    detail: 'Run a full sync from this phone.',
    action: 'Sync'
  });

  expect(healthSyncSummary({
    syncing: false,
    lastHealthSyncAt: '2026-05-26T08:00:00Z',
    latestRun: { status: 'success', trigger: 'manual', records_received: 42 },
    lastBackgroundStatus: null,
    language: 'en',
    now: new Date('2026-05-26T12:00:00+02:00')
  })).toMatchObject({
    title: 'Last sync',
    detail: 'Today at 10:00',
    freshnessTone: 'success',
    freshnessLabel: 'Fresh data',
    action: 'Sync'
  });
});

test('grades mobile sync freshness without exposing technical run details', () => {
  expect(healthSyncSummary({
    syncing: false,
    lastHealthSyncAt: '2026-05-26T08:00:00Z',
    latestRun: { status: 'error', trigger: 'background', records_received: 0 },
    lastBackgroundStatus: JSON.stringify({ status: 'failed', error: 'Timeout réseau', recordedAt: '2026-05-26T08:10:00Z' }),
    now: new Date('2026-05-26T18:30:00+02:00')
  })).toMatchObject({
    detail: "Aujourd'hui à 10:00",
    freshnessTone: 'warning',
    freshnessLabel: 'À resynchroniser bientôt'
  });

  expect(healthSyncSummary({
    syncing: false,
    lastHealthSyncAt: '2026-05-25T08:00:00Z',
    latestRun: { status: 'success', trigger: 'background', records_received: 0 },
    lastBackgroundStatus: JSON.stringify({ status: 'skipped', reason: 'initial_sync_required', recordedAt: '2026-05-26T08:10:00Z' }),
    now: new Date('2026-05-26T23:00:00+02:00')
  })).toMatchObject({
    detail: '25/05/2026 10:00',
    freshnessTone: 'danger',
    freshnessLabel: 'Synchronisation recommandée'
  });
});

test('summarizes missing server run and unknown background sync defensively', () => {
  const summary = healthSyncSummary({
    syncing: false,
    lastHealthSyncAt: '2026-05-26T08:00:00Z',
    latestRun: null,
    lastBackgroundStatus: 'planifié',
    now: new Date('2026-05-26T12:00:00+02:00')
  });

  expect(summary.detail).toBe("Aujourd'hui à 10:00");
  expect(summary.freshnessTone).toBe('success');
});
