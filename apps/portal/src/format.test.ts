import { describe, expect, it } from 'vitest';

import { activityIcon, buildDashboardCards, chartContextForWindow, formatActivityLabel, formatDailyValue, formatDataStatusSummary, formatDateLabel, formatDuration, formatFrenchLongDate, formatLifeBalanceDisplay, formatLifeBalanceTooltip, formatMissingAwareSleepDuration, formatParisDateTime, formatParisTime, formatSyncObservability, historyScrollClass, maxSeriesValue, parseServerTimestamp, sleepTone } from './format';
import type { OverviewContext } from './api';

it('formats minutes as hours and minutes', () => {
  expect(formatDuration(45)).toBe('45 min');
  expect(formatDuration(420)).toBe('7 h 00');
});

describe('buildDashboardCards', () => {
  it('builds stable summary cards from overview context', () => {
    const context: OverviewContext = {
      window: '7d',
      sleep: {
        sessions: 1,
        total_duration_minutes: 420,
        average_duration_minutes: 420,
        deep_sleep_minutes: 60,
        rem_sleep_minutes: 60,
        light_sleep_minutes: 300,
        awake_minutes: 0
      },
      nutrition: {
        meals: 2,
        energy_kcal: 1800,
        protein_g: 120,
        carbohydrates_g: 210,
        fat_g: 65,
        hydration_liters: 2.1
      },
      workouts: {
        sessions: 3,
        duration_minutes: 135,
        calories: 800,
        distance_meters: 0
      },
      activity: {
        steps: 12345,
        active_calories_kcal: 450,
        distance_meters: 7000,
        average_daily_steps: 6666,
        steps_estimated_days: 2
      },
      series: [
        {
          date: '2026-05-18',
          steps: 1000,
          active_calories_kcal: 50,
          distance_meters: 600,
          sleep_minutes: 410,
          workout_minutes: 0,
          workouts: 0,
          energy_kcal: 1800,
          hydration_liters: 2
        },
        {
          date: '2026-05-19',
          steps: 12345,
          active_calories_kcal: 450,
          distance_meters: 7000,
          sleep_minutes: 420,
          workout_minutes: 45,
          workouts: 1,
          energy_kcal: 1900,
          hydration_liters: 2.1
        }
      ]
    };

    expect(buildDashboardCards(context)).toEqual([
      { label: 'Sommeil', value: '7 h 00', detail: 'durée moyenne' },
      { label: 'Nutrition', value: '1800 kcal', detail: '120 g protéines' },
      { label: 'Entraînements', value: '2 h 15', detail: '3 session(s)' },
      { label: 'Activité', value: '6 666', detail: 'pas estimés / jour' }
    ]);
    expect(maxSeriesValue(context, 'steps')).toBe(12345);
    expect(formatDateLabel('2026-05-19')).toContain('19');
    expect(formatDailyValue(40983, 'pas')).toBe('41 k pas');
    expect(formatDailyValue(320, 'sleep')).toBe('5 h 20');
    expect(formatDailyValue(565, 'min')).toBe('565 min');
  });
});

it('uses the previous two days as chart context for today without changing today totals', () => {
  const todayContext = {
    window: '24h',
    activity: { steps: 2587 },
    sleep: {},
    nutrition: {},
    workouts: {},
    series: [{ date: '2026-05-21', steps: 2587, sleep_minutes: 320, workout_minutes: 34 }]
  } as OverviewContext;
  const weekContext = {
    ...todayContext,
    window: '7d',
    series: [
      { date: '2026-05-18', steps: 5700, sleep_minutes: 435, workout_minutes: 45 },
      { date: '2026-05-19', steps: 8700, sleep_minutes: 394, workout_minutes: 41 },
      { date: '2026-05-20', steps: 12400, sleep_minutes: 340, workout_minutes: 38 },
      { date: '2026-05-21', steps: 2587, sleep_minutes: 320, workout_minutes: 34 }
    ]
  } as OverviewContext;

  const chartContext = chartContextForWindow(todayContext, weekContext);

  expect(todayContext.activity.steps).toBe(2587);
  expect(chartContext.series.map((day) => day.date)).toEqual(['2026-05-19', '2026-05-20', '2026-05-21']);
});

it('formats server timestamps in Europe Paris time', () => {
  expect(parseServerTimestamp('2026-05-20T21:04:11.228').toISOString()).toBe('2026-05-20T21:04:11.228Z');
  expect(formatParisDateTime('2026-05-20T21:04:11.228')).toContain('23:04');
  expect(formatParisTime('2026-05-20T23:19:00+00:00')).toBe('01:19');
  expect(formatFrenchLongDate('2026-05-21')).toBe('jeudi 21 mai');
  expect(sleepTone(320)).toBe('danger');
  expect(sleepTone(420)).toBe('warning');
  expect(sleepTone(480)).toBe('success');
});

it('formats activity labels and icons for dashboard display', () => {
  expect(formatActivityLabel('running')).toBe('Running');
  expect(formatActivityLabel('stationary_biking')).toBe('RPM');
  expect(formatActivityLabel('spinning')).toBe('RPM');
  expect(formatActivityLabel('strength_training')).toBe('Renforcement Musculaire');
  expect(formatActivityLabel('rowing')).toBe('Rame');
  expect(activityIcon('running')).toBe('Run');
  expect(activityIcon('strength_training')).toBe('Force');
  expect(activityIcon('rowing')).toBe('Rame');
});

it('formats life balance score tooltips and scroll behavior', () => {
  expect(formatLifeBalanceTooltip({
    slug: 'sleep',
    label: 'Sommeil',
    value: 58,
    tone: 'orange',
    confidence: 'medium',
    explanation: 'Durée courte.',
    contributors: [
      { key: 'duration_minutes', label: 'Durée', value: 268 },
      { key: 'awakenings', label: 'Réveils', value: 4 }
    ]
  })).toBe('Durée courte. · Durée: 268 · Réveils: 4');
  expect(historyScrollClass('7d')).toBe('workout-history');
  expect(historyScrollClass('30d')).toBe('workout-history scrollable');
});

it('formats missing health data without implying zero values', () => {
  expect(formatLifeBalanceDisplay({
    slug: 'sleep',
    label: 'Sommeil',
    value: 0,
    tone: 'red',
    confidence: 'low',
    explanation: 'Absence de données sommeil sur la fenêtre récente.',
    contributors: []
  })).toEqual({
    value: '--',
    unavailable: true,
    meta: 'Absence de données'
  });

  expect(formatLifeBalanceDisplay({
    slug: 'recovery',
    label: 'Récupération',
    value: 32,
    tone: 'red',
    confidence: 'low',
    explanation: 'Fiabilité faible : récupération estimée avec une nuit moyenne faute de mesure sommeil.',
    contributors: [
      { key: 'sleep_score', label: 'Score sommeil estimé', value: 70 },
      { key: 'sleep_data_quality', label: 'Fiabilité sommeil', value: 'faible' }
    ]
  })).toEqual({
    value: '32%',
    unavailable: false,
    meta: 'Fiabilité faible'
  });

  expect(formatMissingAwareSleepDuration(0)).toEqual({
    value: '--',
    detail: 'Absence de données sommeil',
    hasData: false
  });
});

it('formats dashboard data status for quick trust reading', () => {
  const summary = formatDataStatusSummary({
    freshness: {
      status: 'stale',
      label: 'Mise à jour en arrière-plan',
      explanation: 'Snapshot à recalculer.',
      records_received: 46637,
      is_stale: true,
      computed_at: '2026-05-31T08:00:00Z',
      last_success_at: '2026-05-31T07:59:00Z',
      last_manual_at: null,
      last_background_at: '2026-05-31T07:59:00Z',
      latest_run_status: 'success'
    },
    domains: {
      sleep: { status: 'missing', confidence: 'low', source: null, label: 'Sommeil non mesuré', explanation: 'Aucune nuit exploitable.' },
      activity: { status: 'estimated', confidence: 'medium', source: 'com.garmin.android.apps.connectmobile', label: 'Activité estimée', explanation: 'Distance.' },
      workouts: { status: 'none', confidence: 'high', source: 'com.garmin.android.apps.connectmobile', label: 'Aucun entraînement détecté', explanation: 'Vrai zéro.' },
      nutrition: { status: 'missing', confidence: 'low', source: null, label: 'Nutrition non renseignée', explanation: 'Aucun repas.' }
    }
  });

  expect(summary.tone).toBe('warning');
  expect(summary.label).toBe('Mise à jour en arrière-plan');
  expect(summary.detail).toContain('46 637 records');
  expect(summary.domains.map((domain) => domain.label)).toEqual(['Sommeil', 'Activité', 'Entraînements', 'Nutrition']);
  expect(summary.domains[1].value).toContain('Garmin');
});

it('formats sync observability with background next run and latest error', () => {
  const summary = formatSyncObservability({
    total_runs: 3,
    success_runs: 2,
    error_runs: 1,
    duplicate_runs: 0,
    records_received: 46637,
    last_success_at: '2026-05-31T07:59:00Z',
    last_manual_at: '2026-05-30T23:04:00Z',
    last_background_at: '2026-05-31T07:59:00Z',
    latest_network_type: 'cellular',
    recent_runs: [
      {
        id: 'failed-bg',
        trigger: 'background',
        status: 'failed',
        records_received: 0,
        error_message: 'Network request failed',
        created_at: '2026-05-31T08:10:00Z'
      },
      {
        id: 'ok-bg',
        trigger: 'background',
        status: 'success',
        records_received: 120,
        created_at: '2026-05-31T07:59:00Z'
      }
    ]
  });

  expect(summary.lastManual).toContain('31/05/2026');
  expect(summary.lastBackground).toContain('31/05/2026');
  expect(summary.nextBackground).toContain('10:59');
  expect(summary.latestError).toBe('Network request failed');
  expect(summary.records).toContain('46 637');
});
