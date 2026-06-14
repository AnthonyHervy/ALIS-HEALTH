import {
  DAILY_ANALYSIS_PROMPT,
  buildWorkoutAnalysisPrompt,
  dailyAnalysisPrompt,
  isNotifiableWorkout,
  latestWorkoutCandidate,
  selectWorkoutForAnalysis,
  workoutKey,
  workoutNotificationCopy,
  workoutAnalysisLoadingLabel,
  workoutShortLabel
} from './workoutCoach';
import type { OverviewContext, WorkoutHistoryItem } from './types';

function workout(overrides: Partial<WorkoutHistoryItem> = {}): WorkoutHistoryItem {
  return {
    date: '2026-06-01',
    start_time: '2026-06-01T17:10:00Z',
    end_time: '2026-06-01T17:55:00Z',
    activity_type: 'running',
    duration_minutes: 45,
    calories: 420,
    distance_meters: 8200,
    ...overrides
  };
}

function context(history: WorkoutHistoryItem[]): OverviewContext {
  return {
    window: '24h',
    sleep: { sessions: 1, total_duration_minutes: 420, average_duration_minutes: 420, deep_sleep_minutes: 0, rem_sleep_minutes: 0, light_sleep_minutes: 0, awake_minutes: 0 },
    nutrition: { meals: 0, energy_kcal: 0, average_daily_energy_kcal: 0, protein_g: 0, carbohydrates_g: 0, fat_g: 0, hydration_liters: 0 },
    workouts: { sessions: history.length, duration_minutes: 45, calories: 420, distance_meters: 8200, history },
    activity: { steps: 9000, active_calories_kcal: 0, distance_meters: 0 },
    series: []
  };
}

test('builds a stable key and friendly notification copy for a new run', () => {
  const item = workout();

  expect(workoutKey(item)).toBe('workout:running:2026-06-01T17:00:00.000Z:45m');
  expect(workoutShortLabel('running')).toBe('RUN');
  expect(workoutShortLabel('strength_training')).toBe('RENFO');
  expect(workoutNotificationCopy(item)).toEqual({
    title: 'Bravo pour ce RUN !',
    body: 'Découvrir mon analyse'
  });
});

test('labels outdoor cycling as bike while keeping indoor cycling as RPM', () => {
  expect(workoutShortLabel('cycling')).toBe('VÉLO');
  expect(workoutShortLabel('stationary_biking')).toBe('RPM');
  expect(workoutNotificationCopy(workout({ activity_type: 'cycling' }))).toEqual({
    title: 'Bravo pour cette sortie vélo !',
    body: 'Découvrir mon analyse'
  });
  expect(workoutNotificationCopy(workout({ activity_type: 'cycling' }), 'en')).toEqual({
    title: 'Nice outdoor ride!',
    body: 'Open my analysis'
  });
});

test('detects only the latest workout that has not already been notified', () => {
  const older = workout({ start_time: '2026-06-01T12:00:00Z', end_time: '2026-06-01T12:30:00Z' });
  const latest = workout({ start_time: '2026-06-01T18:00:00Z', end_time: '2026-06-01T18:50:00Z' });

  expect(latestWorkoutCandidate(context([older, latest]), null)?.item).toEqual(latest);
  expect(latestWorkoutCandidate(context([older, latest]), workoutKey(latest))).toBeNull();
});

test('does not notify ambiguous non-training Health Connect workouts', () => {
  const ambiguous = workout({
    activity_type: 'other',
    start_time: '2026-06-03T10:55:31.747Z',
    end_time: '2026-06-03T11:49:33.757Z',
    duration_minutes: 54,
    calories: 0,
    distance_meters: 0
  });

  expect(isNotifiableWorkout(ambiguous)).toBe(false);
  expect(latestWorkoutCandidate(context([ambiguous]), null)).toBeNull();
  expect(workoutNotificationCopy(ambiguous)).toBeNull();
});

test('uses a source-stable key for the same cycling workout reported by Google and Garmin', () => {
  const google = workout({
    start_time: '2026-06-02T16:30:09.422000Z',
    end_time: '2026-06-02T17:18:34.347000Z',
    activity_type: 'cycling',
    duration_minutes: 48
  });
  const garmin = workout({
    start_time: '2026-06-02T16:34:16Z',
    end_time: '2026-06-02T17:17:06.181000Z',
    activity_type: 'cycling',
    duration_minutes: 42
  });

  expect(workoutKey(google)).toBe(workoutKey(garmin));
});

test('does not re-notify an overlapping workout already stored with a legacy exact key', () => {
  const googleLegacyKey = '2026-06-02T16:30:09.422000Z|2026-06-02T17:18:34.347000Z|cycling';
  const garmin = workout({
    start_time: '2026-06-02T16:34:16Z',
    end_time: '2026-06-02T17:17:06.181000Z',
    activity_type: 'cycling',
    duration_minutes: 42
  });

  expect(latestWorkoutCandidate(context([garmin]), googleLegacyKey)).toBeNull();
});

test('selects the exact workout notification key when it is available', () => {
  const strength = workout({
    activity_type: 'strength_training',
    start_time: '2026-06-03T16:00:00Z',
    end_time: '2026-06-03T16:45:00Z'
  });
  const run = workout({
    start_time: '2026-06-03T18:15:00Z',
    end_time: '2026-06-03T18:48:00Z',
    duration_minutes: 33,
    distance_meters: 6100
  });

  expect(selectWorkoutForAnalysis([strength, run], workoutKey(run))).toEqual(run);
});

test('prefers a newer workout over a stale notification key', () => {
  const yesterdayRun = workout({
    start_time: '2026-06-07T15:08:24Z',
    end_time: '2026-06-07T16:02:04.435Z',
    duration_minutes: 53,
    distance_meters: 3133
  });
  const todayStrength = workout({
    activity_type: 'strength_training',
    start_time: '2026-06-08T10:29:26Z',
    end_time: '2026-06-08T11:14:12.344Z',
    duration_minutes: 44,
    distance_meters: 0
  });

  expect(selectWorkoutForAnalysis([todayStrength, yesterdayRun], workoutKey(yesterdayRun))).toEqual(todayStrength);
});

test('falls back to the latest notifiable workout instead of the first history row', () => {
  const strength = workout({
    activity_type: 'strength_training',
    start_time: '2026-06-03T16:00:00Z',
    end_time: '2026-06-03T16:45:00Z'
  });
  const run = workout({
    start_time: '2026-06-03T18:15:00Z',
    end_time: '2026-06-03T18:48:00Z',
    duration_minutes: 33,
    distance_meters: 6100
  });

  expect(selectWorkoutForAnalysis([strength, run], undefined)).toEqual(run);
  expect(selectWorkoutForAnalysis([strength, run], 'workout:running:stale')).toEqual(run);
});

test('builds a running coach prompt that compares with the last 7 days and suggests what to do next', () => {
  const run = workout({
    start_time: '2026-06-03T10:00:00Z',
    end_time: '2026-06-03T10:45:00Z',
    duration_minutes: 45,
    distance_meters: 8200
  });
  const previousRun = workout({
    date: '2026-06-01',
    start_time: '2026-06-01T08:00:00Z',
    end_time: '2026-06-01T08:40:00Z',
    duration_minutes: 40,
    distance_meters: 6900
  });

  const prompt = buildWorkoutAnalysisPrompt(run, context([previousRun, run]));

  expect(prompt).toContain('Analyse cette séance de Running');
  expect(prompt).toContain('8.2 km');
  expect(prompt).toContain('Compare-la aux autres séances de running des 7 derniers jours');
  expect(prompt).toContain('6.9 km');
  expect(prompt).toContain('comme dans une vraie conversation');
  expect(prompt).toContain('2 à 4 paragraphes courts');
  expect(prompt).toContain('pas une fiche froide');
  expect(prompt).toContain('repos');
  expect(prompt).toContain('récupération');
  expect(prompt).toContain('pousser un peu plus');
  expect(prompt).toContain('autre activité');
});

test('builds a strength coach prompt focused on nutrition recovery and lifestyle', () => {
  const strength = workout({
    activity_type: 'strength_training',
    duration_minutes: 45,
    distance_meters: 0,
    calories: 0
  });

  const prompt = buildWorkoutAnalysisPrompt(strength, context([strength]));

  expect(prompt).toContain('Analyse cette séance de Renforcement');
  expect(prompt).toContain('nutrition');
  expect(prompt).toContain('récupération');
  expect(prompt).toContain("hygiène de vie");
  expect(prompt).toContain('protéines');
  expect(prompt).toContain("n'invente pas");
  expect(prompt).toContain('comme dans une vraie conversation');
  expect(prompt).toContain('pas une checklist');
});

test('builds English workout prompts and loading labels when requested', () => {
  const strength = workout({
    activity_type: 'strength_training',
    duration_minutes: 45,
    distance_meters: 0
  });

  const prompt = buildWorkoutAnalysisPrompt(strength, context([strength]), 'en');

  expect(prompt).toContain('Analyze this Strength training workout');
  expect(prompt).toContain('prioritize nutrition');
  expect(prompt).not.toContain('Analyse cette séance');
  expect(dailyAnalysisPrompt('en')).toContain('review my health data');
  expect(workoutAnalysisLoadingLabel('en')).toContain('reviewing your workout');
});

test('asks the daily coach analysis to feel human and encouraging', () => {
  expect(DAILY_ANALYSIS_PROMPT).toContain('humain');
  expect(DAILY_ANALYSIS_PROMPT).toContain('encourageant');
  expect(DAILY_ANALYSIS_PROMPT).not.toContain('liste froide');
});
