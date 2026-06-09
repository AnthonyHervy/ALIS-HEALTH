import { formatActivityLabel, formatDuration } from './format';
import type { OverviewContext, WorkoutHistoryItem } from './types';

export const DAILY_ANALYSIS_PROMPT = [
  'Peux-tu étudier mes données du jour et me proposer les priorités ?',
  'Réponds avec un ton humain, sympa et encourageant, comme un coach qui me connaît.',
  'Garde des priorités claires, mais évite le rendu froid ou mécanique.'
].join(' ');
export const DAILY_ANALYSIS_LOADING_LABEL = "J'étudie vos données du jour pour vous conseiller au mieux ...";
export const WORKOUT_ANALYSIS_LOADING_LABEL = "J'étudie votre séance et vos données du jour pour vous conseiller au mieux ...";
const WORKOUT_KEY_BUCKET_MINUTES = 15;
const LEGACY_WORKOUT_OVERLAP_TOLERANCE_MINUTES = 30;
const MIN_NOTIFIABLE_WORKOUT_MINUTES = 10;
const TRAINING_ACTIVITY_TYPES = new Set([
  'running',
  'running_treadmill',
  'cycling',
  'stationary_biking',
  'spinning',
  'strength_training',
  'rowing'
]);

export function workoutKey(item: WorkoutHistoryItem): string {
  const start = parseWorkoutTime(item.start_time);
  const duration = workoutDurationMinutes(item);
  if (start === null || duration === null) {
    return legacyWorkoutKey(item);
  }
  const bucketMs = WORKOUT_KEY_BUCKET_MINUTES * 60 * 1000;
  const bucketedStart = new Date(Math.floor(start / bucketMs) * bucketMs).toISOString();
  const bucketedDuration = Math.max(
    WORKOUT_KEY_BUCKET_MINUTES,
    Math.round(duration / WORKOUT_KEY_BUCKET_MINUTES) * WORKOUT_KEY_BUCKET_MINUTES
  );
  return `workout:${item.activity_type}:${bucketedStart}:${bucketedDuration}m`;
}

function legacyWorkoutKey(item: WorkoutHistoryItem): string {
  return `${item.start_time}|${item.end_time}|${item.activity_type}`;
}

function parseWorkoutTime(value: string | null | undefined): number | null {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function workoutDurationMinutes(item: WorkoutHistoryItem): number | null {
  if (Number.isFinite(item.duration_minutes) && item.duration_minutes > 0) {
    return item.duration_minutes;
  }
  const start = parseWorkoutTime(item.start_time);
  const end = parseWorkoutTime(item.end_time);
  if (start === null || end === null || end <= start) {
    return null;
  }
  return (end - start) / (60 * 1000);
}

function legacyKeyAlreadyCoversWorkout(item: WorkoutHistoryItem, lastNotifiedKey: string): boolean {
  const parts = lastNotifiedKey.split('|');
  if (parts.length < 3 || parts[2] !== item.activity_type) {
    return false;
  }
  const previousStart = parseWorkoutTime(parts[0]);
  const previousEnd = parseWorkoutTime(parts[1]);
  const currentStart = parseWorkoutTime(item.start_time);
  const currentEnd = parseWorkoutTime(item.end_time);
  if (previousStart === null || previousEnd === null || currentStart === null || currentEnd === null) {
    return false;
  }
  const toleranceMs = LEGACY_WORKOUT_OVERLAP_TOLERANCE_MINUTES * 60 * 1000;
  const startsClose = Math.abs(previousStart - currentStart) <= toleranceMs;
  const endsClose = Math.abs(previousEnd - currentEnd) <= toleranceMs;
  const overlaps = Math.max(previousStart, currentStart) <= Math.min(previousEnd, currentEnd);
  return startsClose && (endsClose || overlaps);
}

export function hasWorkoutBeenNotified(item: WorkoutHistoryItem, lastNotifiedKey: string | null): boolean {
  if (!lastNotifiedKey) {
    return false;
  }
  return (
    lastNotifiedKey === workoutKey(item)
    || lastNotifiedKey === legacyWorkoutKey(item)
    || legacyKeyAlreadyCoversWorkout(item, lastNotifiedKey)
  );
}

export function workoutShortLabel(activityType: string): string {
  if (['running', 'running_treadmill'].includes(activityType)) {
    return 'RUN';
  }
  if (activityType === 'strength_training') {
    return 'RENFO';
  }
  if (['cycling', 'stationary_biking', 'spinning'].includes(activityType)) {
    return 'RPM';
  }
  return formatActivityLabel(activityType).toUpperCase();
}

export function isNotifiableWorkout(item: WorkoutHistoryItem): boolean {
  const activityType = String(item.activity_type || '').trim().toLowerCase();
  const duration = workoutDurationMinutes(item);
  return TRAINING_ACTIVITY_TYPES.has(activityType)
    && duration !== null
    && duration >= MIN_NOTIFIABLE_WORKOUT_MINUTES;
}

export function workoutNotificationCopy(item: WorkoutHistoryItem): { title: string; body: string } | null {
  if (!isNotifiableWorkout(item)) {
    return null;
  }
  return {
    title: `Bravo pour ce ${workoutShortLabel(item.activity_type)} !`,
    body: 'Découvrir mon analyse'
  };
}

export function latestWorkoutCandidate(context: OverviewContext, lastNotifiedKey: string | null): { key: string; item: WorkoutHistoryItem } | null {
  const latest = [...(context.workouts.history ?? [])]
    .filter(isNotifiableWorkout)
    .sort((left, right) => (
      new Date(right.end_time).getTime() - new Date(left.end_time).getTime()
    ))[0];
  if (!latest) {
    return null;
  }
  const key = workoutKey(latest);
  return hasWorkoutBeenNotified(latest, lastNotifiedKey) ? null : { key, item: latest };
}

export function selectWorkoutForAnalysis(history: WorkoutHistoryItem[], key?: string | null): WorkoutHistoryItem | null {
  const notifiableHistory = history.filter(isNotifiableWorkout);
  const latest = [...notifiableHistory].sort((left, right) => workoutSortTimestamp(right) - workoutSortTimestamp(left))[0] ?? null;
  if (key) {
    const exact = notifiableHistory.find((item) => workoutKey(item) === key);
    if (exact) {
      if (latest && workoutKey(latest) !== workoutKey(exact) && workoutSortTimestamp(latest) > workoutSortTimestamp(exact)) {
        return latest;
      }
      return exact;
    }
  }
  return latest;
}

export function buildWorkoutAnalysisPrompt(item: WorkoutHistoryItem, weekContext?: OverviewContext): string {
  const activityType = String(item.activity_type || '').trim().toLowerCase();
  const workoutSummary = `${formatDuration(item.duration_minutes)}${distanceSummary(item)}`;
  const base = [
    `Analyse cette séance de ${formatActivityLabel(item.activity_type)} (${workoutSummary}).`,
    'Mets-la en perspective avec mon sommeil, ma récupération, mon activité du jour, ma charge récente et mes objectifs.',
    "Sois concret, humain, encourageant, et n'invente pas de données absentes.",
    "Réponds comme dans une vraie conversation, pas une fiche froide: commence par une phrase naturelle et motivante, puis 2 à 4 paragraphes courts.",
    "Tu peux ajouter une mini-liste de 2 ou 3 actions seulement si elle aide vraiment, mais ce ne doit pas ressembler à une checklist."
  ];

  if (['running', 'running_treadmill'].includes(activityType)) {
    return [
      ...base,
      "C'est un running: nomme-le clairement comme un run et ne le transforme pas en renforcement.",
      'Compare-la aux autres séances de running des 7 derniers jours.',
      runningComparisonSummary(item, weekContext),
      'Termine par une recommandation claire pour la suite : repos, récupération active, pousser un peu plus demain, sortie facile, ou autre activité si c’est plus intelligent.'
    ].join(' ');
  }

  if (activityType === 'strength_training') {
    return [
      ...base,
      'Pour ce renforcement, priorise les conseils de nutrition, récupération, hydratation, sommeil, mobilité et hygiène de vie.',
      'Donne des repères simples pour les protéines, les glucides utiles après séance, la récupération 24-48 h et les signaux de fatigue à surveiller.',
      "Si les données nutrition ne sont pas disponibles, n'invente pas de repas et formule une recommandation prudente.",
      "Garde un ton de coach proche et motivant, pas une checklist."
    ].join(' ');
  }

  return [
    ...base,
    'Donne-moi une lecture claire : points positifs, vigilance récupération, et conseil concret pour la suite de la journée.'
  ].join(' ');
}

function distanceSummary(item: WorkoutHistoryItem): string {
  return item.distance_meters > 0 ? `, ${formatKilometers(item.distance_meters)} km` : '';
}

function formatKilometers(meters: number): string {
  return `${Math.round(meters / 100) / 10}`;
}

function workoutSortTimestamp(item: WorkoutHistoryItem): number {
  return parseWorkoutTime(item.end_time) ?? parseWorkoutTime(item.start_time) ?? 0;
}

function runningComparisonSummary(item: WorkoutHistoryItem, weekContext?: OverviewContext): string {
  const currentKey = workoutKey(item);
  const recentRuns = (weekContext?.workouts.history ?? [])
    .filter((workout) => ['running', 'running_treadmill'].includes(String(workout.activity_type || '').toLowerCase()))
    .filter((workout) => workoutKey(workout) !== currentKey)
    .sort((left, right) => new Date(right.end_time).getTime() - new Date(left.end_time).getTime())
    .slice(0, 5);

  if (recentRuns.length === 0) {
    return "Aucune autre séance running fiable n'est disponible sur 7 jours : compare surtout la charge perçue, le sommeil et la fraîcheur.";
  }

  const summaries = recentRuns.map((run) => {
    const distance = run.distance_meters > 0 ? `, ${formatKilometers(run.distance_meters)} km` : '';
    return `${run.date || run.start_time}: ${formatDuration(run.duration_minutes)}${distance}`;
  });
  return `Séances running des 7 derniers jours à comparer : ${summaries.join(' ; ')}.`;
}
