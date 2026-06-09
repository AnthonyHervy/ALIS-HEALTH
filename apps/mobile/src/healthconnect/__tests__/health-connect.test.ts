import { buildHealthBatchFromRawRecords, mapExerciseType } from '../services/health-connect';

test('maps Health Connect exercise constants used by Garmin and Google sources', () => {
  expect(mapExerciseType(48)).toBe('pilates');
  expect(mapExerciseType(70)).toBe('strength_training');
  expect(mapExerciseType(73)).toBe('swimming');
  expect(mapExerciseType(74)).toBe('swimming');
  expect(mapExerciseType(79)).toBe('walking');
});

test('builds broad HealthConnect batch from raw records', () => {
  const batch = buildHealthBatchFromRawRecords(
    {
      Nutrition: [
        {
          startTime: '2026-05-19T10:00:00.000Z',
          mealType: 2,
          energy: { inKilocalories: 600 },
          protein: { inGrams: 30 }
        }
      ],
      Hydration: [
        {
          startTime: '2026-05-19T09:00:00.000Z',
          endTime: '2026-05-19T12:00:00.000Z',
          volume: { inLiters: 1.2 }
        }
      ],
      ExerciseSession: [
        {
          startTime: '2026-05-19T11:00:00.000Z',
          endTime: '2026-05-19T11:45:00.000Z',
          exerciseType: 74,
          metadata: { id: 'swim-garmin', dataOrigin: 'com.garmin.android.apps.connectmobile' }
        }
      ],
      Weight: [{ time: '2026-05-19T07:00:00.000Z', weight: { inKilograms: 78 } }]
    },
    '2026-05-19T00:00:00.000Z',
    '2026-05-19T12:00:00.000Z'
  );

  expect(batch.nutrition?.[0].energy_kcal).toBe(600);
  expect(batch.hydration?.[0].volume_liters).toBe(1.2);
  expect(batch.workouts?.[0].activity_type).toBe('swimming');
  expect(batch.workouts?.[0].metadata).toMatchObject({
    exercise_type_code: 74,
    exercise_type_name: 'swimming'
  });
  expect(batch.weight?.[0].kg).toBe(78);
  expect(batch.raw_records?.Nutrition).toBeUndefined();
});

test('preserves data origins on normalized activity and biometric records', () => {
  const garminMetadata = { id: 'steps-garmin', dataOrigin: 'com.garmin.android.apps.connectmobile' };
  const batch = buildHealthBatchFromRawRecords(
    {
      Steps: [
        {
          startTime: '2026-06-02T10:00:00.000Z',
          endTime: '2026-06-02T10:20:00.000Z',
          count: 3504,
          metadata: garminMetadata
        }
      ],
      ActiveCaloriesBurned: [
        {
          startTime: '2026-06-02T10:00:00.000Z',
          endTime: '2026-06-02T10:20:00.000Z',
          energy: { inKilocalories: 210 },
          metadata: garminMetadata
        }
      ],
      Distance: [
        {
          startTime: '2026-06-02T10:00:00.000Z',
          endTime: '2026-06-02T10:20:00.000Z',
          distance: { inMeters: 494 },
          metadata: garminMetadata
        }
      ],
      HeartRate: [
        {
          metadata: garminMetadata,
          samples: [{ time: '2026-06-02T10:10:00.000Z', beatsPerMinute: 152 }]
        }
      ],
      HeartRateVariabilityRmssd: [
        {
          time: '2026-06-02T05:30:00.000Z',
          heartRateVariabilityMillis: 44,
          metadata: { id: 'hrv-ultrahuman', dataOrigin: 'com.ultrahuman.android' }
        }
      ]
    },
    '2026-06-02T00:00:00.000Z',
    '2026-06-02T12:00:00.000Z'
  );

  expect(batch.steps?.[0].metadata).toEqual(garminMetadata);
  expect(batch.calories?.[0].metadata).toEqual(garminMetadata);
  expect(batch.distance?.[0].metadata).toEqual(garminMetadata);
  expect(batch.heart_rate?.[0].metadata).toEqual(garminMetadata);
  expect(batch.hrv?.[0].metadata).toEqual({ id: 'hrv-ultrahuman', dataOrigin: 'com.ultrahuman.android' });
});

test('keeps raw payloads compact by excluding bulky biometric samples', () => {
  const garminMetadata = { id: 'steps-garmin', dataOrigin: 'com.garmin.android.apps.connectmobile' };
  const batch = buildHealthBatchFromRawRecords(
    {
      Steps: [
        {
          startTime: '2026-06-02T10:00:00.000Z',
          endTime: '2026-06-02T10:20:00.000Z',
          count: 3504,
          metadata: garminMetadata
        }
      ],
      HeartRate: [
        {
          metadata: garminMetadata,
          samples: Array.from({ length: 2000 }, (_, index) => ({
            time: `2026-06-02T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
            beatsPerMinute: 90 + (index % 80)
          }))
        }
      ],
      HeartRateVariabilityRmssd: [
        {
          time: '2026-06-02T05:30:00.000Z',
          heartRateVariabilityMillis: 44,
          metadata: { id: 'hrv-ultrahuman', dataOrigin: 'com.ultrahuman.android' }
        }
      ]
    },
    '2026-06-02T00:00:00.000Z',
    '2026-06-02T12:00:00.000Z'
  );

  expect(batch.raw_records?.Steps).toHaveLength(1);
  expect(batch.raw_records?.HeartRate).toBeUndefined();
  expect(batch.raw_records?.HeartRateVariabilityRmssd).toBeUndefined();
  expect(batch.heart_rate).toHaveLength(2000);
  expect(batch.hrv).toHaveLength(1);
});

test('trims persisted raw activity records to the fields needed for source-aware aggregates', () => {
  const metadata = {
    id: 'steps-garmin',
    clientRecordId: 'client-steps-garmin',
    dataOrigin: 'com.garmin.android.apps.connectmobile',
    hugeNativePayload: 'x'.repeat(5000)
  };
  const batch = buildHealthBatchFromRawRecords(
    {
      Steps: [
        {
          startTime: '2026-06-02T10:00:00.000Z',
          endTime: '2026-06-02T10:20:00.000Z',
          count: 3504,
          metadata,
          samples: Array.from({ length: 200 }, (_, index) => ({ index }))
        }
      ],
      Distance: [
        {
          startTime: '2026-06-02T10:00:00.000Z',
          endTime: '2026-06-02T10:20:00.000Z',
          distance: { inMeters: 494, inFeet: 1620 },
          metadata,
          route: 'x'.repeat(5000)
        }
      ],
      TotalCaloriesBurned: [
        {
          startTime: '2026-06-02T10:00:00.000Z',
          endTime: '2026-06-02T10:20:00.000Z',
          energy: { inKilocalories: 210, inJoules: 878_640 },
          metadata,
          extra: 'x'.repeat(5000)
        }
      ]
    },
    '2026-06-02T00:00:00.000Z',
    '2026-06-02T12:00:00.000Z'
  );

  expect(batch.raw_records?.Steps?.[0]).toEqual({
    startTime: '2026-06-02T10:00:00.000Z',
    endTime: '2026-06-02T10:20:00.000Z',
    count: 3504,
    metadata: {
      id: 'steps-garmin',
      clientRecordId: 'client-steps-garmin',
      dataOrigin: 'com.garmin.android.apps.connectmobile'
    }
  });
  expect(batch.raw_records?.Distance?.[0]).toEqual({
    startTime: '2026-06-02T10:00:00.000Z',
    endTime: '2026-06-02T10:20:00.000Z',
    distance: { inMeters: 494 },
    metadata: {
      id: 'steps-garmin',
      clientRecordId: 'client-steps-garmin',
      dataOrigin: 'com.garmin.android.apps.connectmobile'
    }
  });
  expect(batch.raw_records?.TotalCaloriesBurned?.[0]).toEqual({
    startTime: '2026-06-02T10:00:00.000Z',
    endTime: '2026-06-02T10:20:00.000Z',
    energy: { inKilocalories: 210 },
    metadata: {
      id: 'steps-garmin',
      clientRecordId: 'client-steps-garmin',
      dataOrigin: 'com.garmin.android.apps.connectmobile'
    }
  });
  expect(JSON.stringify(batch.raw_records)).not.toContain('hugeNativePayload');
  expect(JSON.stringify(batch.raw_records)).not.toContain('samples');
  expect(JSON.stringify(batch.raw_records)).not.toContain('route');
});
