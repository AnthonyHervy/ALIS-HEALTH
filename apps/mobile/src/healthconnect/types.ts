export type HealthBatchRequest = {
  source_type: 'healthconnect';
  device_name?: string;
  device_id?: string;
  data_start: string;
  data_end: string;
  sync_trigger?: 'manual' | 'background' | 'portal' | 'unknown';
  sync_mode?: 'initial_full_history' | 'initial_30d' | 'incremental';
  network_type?: string;
  heart_rate?: Array<{ timestamp: string; bpm: number; metadata?: Record<string, unknown> }>;
  hrv?: Array<{ timestamp: string; rmssd_ms: number; metadata?: Record<string, unknown> }>;
  steps?: Array<{ start_time: string; end_time: string; count: number; metadata?: Record<string, unknown> }>;
  sleep?: Array<{
    start_time: string;
    end_time: string;
    stages?: Array<{ stage: string; start_time: string; end_time: string }>;
    metadata?: Record<string, unknown>;
  }>;
  workouts?: Array<{
    start_time: string;
    end_time: string;
    activity_type: string;
    distance_meters?: number;
    calories?: number;
    avg_heart_rate?: number;
    max_heart_rate?: number;
    metadata?: Record<string, unknown>;
  }>;
  calories?: Array<{ start_time: string; end_time: string; calories: number; is_active: boolean; metadata?: Record<string, unknown> }>;
  distance?: Array<{ start_time: string; end_time: string; meters: number; metadata?: Record<string, unknown> }>;
  blood_glucose?: Array<{ timestamp: string; glucose_mg_dl: number; metadata?: Record<string, unknown> }>;
  resting_heart_rate?: Array<{ timestamp: string; bpm: number; metadata?: Record<string, unknown> }>;
  body_temperature?: Array<{ timestamp: string; temperature_celsius: number; metadata?: Record<string, unknown> }>;
  vo2_max?: Array<{ timestamp: string; ml_per_kg_min: number; metadata?: Record<string, unknown> }>;
  weight?: Array<{ timestamp: string; kg: number; metadata?: Record<string, unknown> }>;
  nutrition?: Array<{
    timestamp: string;
    meal_type?: string;
    name?: string;
    energy_kcal?: number;
    protein_g?: number;
    carbohydrates_g?: number;
    fat_g?: number;
    metadata?: Record<string, unknown>;
  }>;
  hydration?: Array<{ start_time: string; end_time: string; volume_liters: number; metadata?: Record<string, unknown> }>;
  raw_records?: Record<string, Array<Record<string, unknown>>>;
};

export type SyncDecision = {
  shouldSync: boolean;
  reason: 'unconfigured' | 'initial_sync_required' | 'fresh' | 'sync_due';
  windowStartAt: string | null;
  windowEndAt: string | null;
};
