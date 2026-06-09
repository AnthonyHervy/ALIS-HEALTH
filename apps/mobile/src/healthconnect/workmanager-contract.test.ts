import { workManagerContract } from './native/workmanager-contract';
import { readFileSync } from 'fs';
import { join } from 'path';

test('keeps the native hourly background sync contract in ALIS_FINAL', () => {
  expect(workManagerContract).toEqual({
    uniqueName: 'healthconnect-background-sync',
    repeatIntervalHours: 1,
    requiredNetworkType: 'ANY_CONNECTED_NETWORK',
    sleepLookbackHours: 48
  });
});

test('native background sync includes heart and recovery signals', () => {
  const worker = readFileSync(
    join(__dirname, '../../android/app/src/main/java/local/alis/app/HealthConnectSyncWorker.kt'),
    'utf8'
  );

  expect(worker).toContain('HeartRateRecord');
  expect(worker).toContain('HeartRateVariabilityRmssdRecord');
  expect(worker).toContain('RestingHeartRateRecord');
  expect(worker).toContain('Vo2MaxRecord');
  expect(worker).toContain('.put("heart_rate"');
  expect(worker).toContain('.put("hrv"');
  expect(worker).toContain('.put("resting_heart_rate"');
  expect(worker).toContain('.put("vo2_max"');
});

test('native background sync includes activity energy and distance signals', () => {
  const worker = readFileSync(
    join(__dirname, '../../android/app/src/main/java/local/alis/app/HealthConnectSyncWorker.kt'),
    'utf8'
  );

  expect(worker).toContain('ActiveCaloriesBurnedRecord');
  expect(worker).toContain('TotalCaloriesBurnedRecord');
  expect(worker).toContain('DistanceRecord');
  expect(worker).toContain('.put("calories"');
  expect(worker).toContain('.put("distance"');
});

test('native workout notifications dedupe source variants of the same workout', () => {
  const worker = readFileSync(
    join(__dirname, '../../android/app/src/main/java/local/alis/app/HealthConnectSyncWorker.kt'),
    'utf8'
  );

  expect(worker).toContain('WORKOUT_ANALYSIS_NOTIFICATION_ID');
  expect(worker).toContain('notificationManager.notify(WORKOUT_ANALYSIS_NOTIFICATION_ID, notification)');
  expect(worker).toContain('stableWorkoutKey');
  expect(worker).toContain('legacyWorkoutKey');
  expect(worker).toContain('isAlreadyNotifiedWorkout');
  expect(worker).toContain('"cycling", "stationary_biking", "spinning" -> "RPM"');
});

test('native background sync recognizes swimming as a training workout', () => {
  const worker = readFileSync(
    join(__dirname, '../../android/app/src/main/java/local/alis/app/HealthConnectSyncWorker.kt'),
    'utf8'
  );

  expect(worker).toContain('EXERCISE_TYPE_SWIMMING_OPEN_WATER');
  expect(worker).toContain('EXERCISE_TYPE_SWIMMING_POOL');
  expect(worker).toContain('"swimming"');
  expect(worker).toContain('"swimming" -> "NATATION"');
});

test('native workout notifications ignore ambiguous non-training records', () => {
  const worker = readFileSync(
    join(__dirname, '../../android/app/src/main/java/local/alis/app/HealthConnectSyncWorker.kt'),
    'utf8'
  );

  expect(worker).toContain('TRAINING_ACTIVITY_TYPES');
  expect(worker).toContain('NOTIFIABLE_WORKOUT_ORIGINS');
  expect(worker).toContain('MAX_WORKOUT_NOTIFICATION_AGE');
  expect(worker).toContain('isNotifiableWorkout');
  expect(worker).toContain('if (!isNotifiableWorkout(workout, now)) return');
  expect(worker).toContain('!in TRAINING_ACTIVITY_TYPES');
  expect(worker).toContain('com.garmin.android.apps.connectmobile');
});
