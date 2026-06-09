import type { HealthBatchRequest } from '../types';

export const RAW_RECORD_TYPES = [
  'ActiveCaloriesBurned',
  'BasalBodyTemperature',
  'BasalMetabolicRate',
  'BloodGlucose',
  'BloodPressure',
  'BodyFat',
  'BodyTemperature',
  'BodyWaterMass',
  'BoneMass',
  'CervicalMucus',
  'CyclingPedalingCadence',
  'Distance',
  'ElevationGained',
  'ExerciseSession',
  'FloorsClimbed',
  'HeartRate',
  'HeartRateVariabilityRmssd',
  'Height',
  'Hydration',
  'LeanBodyMass',
  'MenstruationFlow',
  'MenstruationPeriod',
  'Nutrition',
  'OvulationTest',
  'OxygenSaturation',
  'Power',
  'RespiratoryRate',
  'RestingHeartRate',
  'SexualActivity',
  'SleepSession',
  'Speed',
  'Steps',
  'StepsCadence',
  'TotalCaloriesBurned',
  'Vo2Max',
  'Weight',
  'WheelchairPushes'
] as const;

export const SYNC_RECORD_TYPES = [
  'ActiveCaloriesBurned',
  'BloodGlucose',
  'BodyTemperature',
  'Distance',
  'ExerciseSession',
  'HeartRate',
  'HeartRateVariabilityRmssd',
  'Hydration',
  'Nutrition',
  'RestingHeartRate',
  'SleepSession',
  'Steps',
  'TotalCaloriesBurned',
  'Vo2Max',
  'Weight'
] as const;

const RAW_RECORD_TYPES_TO_PERSIST = new Set<string>([
  'ActiveCaloriesBurned',
  'Distance',
  'Steps',
  'TotalCaloriesBurned'
]);

const SLEEP_STAGES: Record<number, string> = {
  0: 'unknown',
  1: 'awake',
  2: 'sleeping',
  3: 'out_of_bed',
  4: 'light',
  5: 'deep',
  6: 'rem'
};

const EXERCISE_TYPES: Record<number, string> = {
  0: 'other',
  8: 'cycling',
  9: 'stationary_biking',
  48: 'pilates',
  53: 'rowing',
  56: 'running',
  57: 'running_treadmill',
  70: 'strength_training',
  73: 'swimming',
  74: 'swimming',
  79: 'walking',
  81: 'strength_training'
};

export function mapExerciseType(code: number): string {
  return EXERCISE_TYPES[code] ?? 'other';
}

function compactMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const value = metadata as Record<string, unknown>;
  const compact: Record<string, unknown> = {};
  for (const key of ['id', 'dataOrigin', 'clientRecordId']) {
    if (value[key] != null) {
      compact[key] = value[key];
    }
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function compactRawRecord(recordType: string, record: Record<string, any>) {
  const metadata = compactMetadata(record.metadata);
  const base = {
    startTime: record.startTime,
    endTime: record.endTime,
    ...(metadata ? { metadata } : {})
  };

  if (recordType === 'Steps') {
    return { ...base, count: record.count };
  }
  if (recordType === 'Distance') {
    return {
      ...base,
      distance: {
        inMeters: record.distance?.inMeters ?? 0
      }
    };
  }
  if (recordType === 'ActiveCaloriesBurned' || recordType === 'TotalCaloriesBurned') {
    return {
      ...base,
      energy: {
        inKilocalories: record.energy?.inKilocalories ?? 0
      }
    };
  }
  return { ...base, ...(metadata ? { metadata } : {}) };
}

function compactRawRecords(rawRecords: Record<string, any[]>) {
  const compact: Record<string, any[]> = {};
  for (const [recordType, records] of Object.entries(rawRecords)) {
    if (RAW_RECORD_TYPES_TO_PERSIST.has(recordType) && records.length > 0) {
      compact[recordType] = records.map((record) => compactRawRecord(recordType, record));
    }
  }
  return compact;
}

export function buildHealthBatchFromRawRecords(
  rawRecords: Record<string, any[]>,
  startTime: string,
  endTime: string
): HealthBatchRequest {
  const heartRate = rawRecords.HeartRate ?? [];
  const hrv = rawRecords.HeartRateVariabilityRmssd ?? [];
  const steps = rawRecords.Steps ?? [];
  const sleep = rawRecords.SleepSession ?? [];
  const workouts = rawRecords.ExerciseSession ?? [];
  const activeCalories = rawRecords.ActiveCaloriesBurned ?? [];
  const totalCalories = rawRecords.TotalCaloriesBurned ?? [];
  const distance = rawRecords.Distance ?? [];
  const glucose = rawRecords.BloodGlucose ?? [];
  const restingHeartRate = rawRecords.RestingHeartRate ?? [];
  const bodyTemperature = rawRecords.BodyTemperature ?? [];
  const vo2Max = rawRecords.Vo2Max ?? [];
  const weight = rawRecords.Weight ?? [];
  const nutrition = rawRecords.Nutrition ?? [];
  const hydration = rawRecords.Hydration ?? [];

  return {
    source_type: 'healthconnect',
    device_name: 'Android Device',
    data_start: startTime,
    data_end: endTime,
    raw_records: compactRawRecords(rawRecords),
    heart_rate: heartRate.flatMap((record) =>
      (record.samples ?? []).map((sample: any) => ({
        timestamp: sample.time,
        bpm: sample.beatsPerMinute,
        metadata: compactMetadata(record.metadata)
      }))
    ),
    hrv: hrv.map((record) => ({
      timestamp: record.time,
      rmssd_ms: record.heartRateVariabilityMillis,
      metadata: compactMetadata(record.metadata)
    })),
    steps: steps.map((record) => ({
      start_time: record.startTime,
      end_time: record.endTime,
      count: record.count,
      metadata: compactMetadata(record.metadata)
    })),
    sleep: sleep.map((record) => ({
      start_time: record.startTime,
      end_time: record.endTime,
      stages: (record.stages ?? []).map((stage: any) => ({
        stage: SLEEP_STAGES[stage.stage] ?? 'unknown',
        start_time: stage.startTime,
        end_time: stage.endTime
      })),
      metadata: compactMetadata(record.metadata)
    })),
    workouts: workouts.map((record) => ({
      start_time: record.startTime,
      end_time: record.endTime,
      activity_type: mapExerciseType(record.exerciseType),
      metadata: {
        ...(compactMetadata(record.metadata) ?? {}),
        exercise_type_code: record.exerciseType,
        exercise_type_name: mapExerciseType(record.exerciseType)
      }
    })),
    calories: [
      ...activeCalories.map((record) => ({
        start_time: record.startTime,
        end_time: record.endTime,
        calories: record.energy?.inKilocalories ?? 0,
        is_active: true,
        metadata: compactMetadata(record.metadata)
      })),
      ...totalCalories.map((record) => ({
        start_time: record.startTime,
        end_time: record.endTime,
        calories: record.energy?.inKilocalories ?? 0,
        is_active: false,
        metadata: compactMetadata(record.metadata)
      }))
    ],
    distance: distance.map((record) => ({
      start_time: record.startTime,
      end_time: record.endTime,
      meters: record.distance?.inMeters ?? 0,
      metadata: compactMetadata(record.metadata)
    })),
    blood_glucose: glucose.map((record) => ({
      timestamp: record.time,
      glucose_mg_dl: record.level?.inMilligramsPerDeciliter ?? 0,
      metadata: compactMetadata(record.metadata)
    })),
    resting_heart_rate: restingHeartRate.map((record) => ({
      timestamp: record.time,
      bpm: record.beatsPerMinute,
      metadata: compactMetadata(record.metadata)
    })),
    body_temperature: bodyTemperature.map((record) => ({
      timestamp: record.time,
      temperature_celsius: record.temperature?.inCelsius ?? 0,
      metadata: compactMetadata(record.metadata)
    })),
    vo2_max: vo2Max.map((record) => ({
      timestamp: record.time,
      ml_per_kg_min: record.vo2MillilitersPerMinuteKilogram ?? 0,
      metadata: compactMetadata(record.metadata)
    })),
    weight: weight.map((record) => ({
      timestamp: record.time,
      kg: record.weight?.inKilograms ?? 0,
      metadata: compactMetadata(record.metadata)
    })),
    nutrition: nutrition.map((record) => ({
      timestamp: record.startTime ?? record.endTime,
      meal_type: String(record.mealType ?? ''),
      name: record.name,
      energy_kcal: record.energy?.inKilocalories,
      protein_g: record.protein?.inGrams,
      carbohydrates_g: record.totalCarbohydrate?.inGrams,
      fat_g: record.totalFat?.inGrams,
      metadata: compactMetadata(record.metadata)
    })),
    hydration: hydration.map((record) => ({
      start_time: record.startTime,
      end_time: record.endTime,
      volume_liters: record.volume?.inLiters ?? 0,
      metadata: compactMetadata(record.metadata)
    }))
  };
}
