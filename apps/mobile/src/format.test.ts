import { activityIcon, formatActivityLabel, formatDailyValue, formatDataStatusSummary, formatDuration, formatParisTime, formatSyncObservability, sleepTone } from './format';

test('formats durations and Paris timestamps', () => {
  expect(formatDuration(375)).toBe('6 h 15');
  expect(formatDuration(8)).toBe('8 min');
  expect(formatParisTime('2026-05-25T07:29:30+00:00')).toBe('09:29');
});

test('formats dashboard labels and values', () => {
  expect(formatDailyValue(18436, 'pas')).toBe('18,4 k pas');
  expect(formatDailyValue(18436, 'steps')).toBe('18.4K steps');
  expect(formatDailyValue(375, 'sleep')).toBe('6 h 15');
  expect(formatActivityLabel('strength_training')).toBe('Renforcement Musculaire');
  expect(formatActivityLabel('strength_training', 'en')).toBe('Strength training');
  expect(formatActivityLabel('cycling')).toBe('RPM');
  expect(activityIcon('rowing')).toBe('Rame');
  expect(sleepTone(375)).toBe('warning');
});

test('formats dashboard data status for quick trust reading', () => {
  const summary = formatDataStatusSummary({
    freshness: {
      status: 'fresh',
      label: 'Données à jour',
      explanation: 'Le snapshot affiché correspond à la dernière synchronisation connue.',
      records_received: 46637,
      is_stale: false,
      computed_at: '2026-05-31T08:00:00Z',
      last_success_at: '2026-05-31T07:59:00Z',
      last_manual_at: null,
      last_background_at: '2026-05-31T07:59:00Z',
      latest_run_status: 'success'
    },
    domains: {
      sleep: { status: 'missing', confidence: 'low', source: null, label: 'Sommeil non mesuré', explanation: 'Aucune nuit exploitable.' },
      activity: { status: 'measured', confidence: 'high', source: 'com.garmin.android.apps.connectmobile', label: 'Activité mesurée', explanation: 'Pas Garmin.' },
      workouts: { status: 'none', confidence: 'high', source: 'com.garmin.android.apps.connectmobile', label: 'Aucun entraînement détecté', explanation: 'Vrai zéro.' },
      nutrition: { status: 'missing', confidence: 'low', source: null, label: 'Nutrition non renseignée', explanation: 'Aucun repas.' }
    }
  });

  expect(summary.tone).toBe('success');
  expect(summary.label).toBe('Données à jour');
  expect(summary.detail).toContain('46 637 enregistrements');
  expect(summary.domains[0]).toEqual({ label: 'Sommeil', value: 'Sommeil non mesuré', tone: 'danger' });
  expect(summary.domains[1].value).toContain('Garmin');
});

test('formats sync observability with background next run and latest error', () => {
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
  expect(summary.records).toBe('46 637 enregistrements');
});

test('formats sync observability in English', () => {
  const summary = formatSyncObservability({
    total_runs: 3,
    success_runs: 2,
    error_runs: 1,
    duplicate_runs: 0,
    records_received: 46637,
    last_success_at: '2026-05-31T07:59:00Z',
    last_manual_at: null,
    last_background_at: null,
    latest_network_type: 'wifi',
    recent_runs: []
  }, 'en');

  expect(summary.latestError).toBe('No recent error');
  expect(summary.records).toBe('46,637 records');
  expect(summary.runs).toBe('3 run(s) · 2 success · 1 error(s)');
});
