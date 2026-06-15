import type { LanguagePreference } from './i18n';

export type WindowKey = '24h' | '7d' | '30d';

export type LifeBalanceScore = {
  slug: 'sleep' | 'recovery' | 'movement';
  label: string;
  value: number;
  tone: 'green' | 'orange' | 'red';
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
  contributors: Array<{
    key: string;
    label: string;
    value: string | number;
  }>;
};

export type LifeBalanceScores = {
  window: '24h';
  scores: LifeBalanceScore[];
};

export type CoachAction = {
  slug: string;
  label: string;
  priority: number;
  reason: string;
  action: string;
  tone: 'green' | 'orange' | 'red';
};

export type OverviewContext = {
  window: WindowKey;
  life_balance_scores?: LifeBalanceScores;
  sleep: {
    sessions: number;
    total_duration_minutes: number;
    average_duration_minutes?: number;
    deep_sleep_minutes: number;
    rem_sleep_minutes: number;
    light_sleep_minutes: number;
    awake_minutes: number;
    latest_sleep_start?: string | null;
    latest_sleep_end?: string | null;
    awakenings_count?: number;
    latest_sleep_awakenings_count?: number;
    average_bed_time?: string | null;
    average_wake_time?: string | null;
    source?: string | null;
  };
  nutrition: {
    meals: number;
    energy_kcal: number;
    average_daily_energy_kcal: number;
    protein_g: number;
    carbohydrates_g: number;
    fat_g: number;
    hydration_liters: number;
    latest_meal_at?: string | null;
  };
  workouts: {
    sessions: number;
    duration_minutes: number;
    calories: number;
    distance_meters: number;
    latest_workout_at?: string | null;
    source?: string | null;
    running_distance_meters?: number;
    history?: WorkoutHistoryItem[];
    by_activity_type?: Array<{
      activity_type: string;
      sessions: number;
      duration_minutes: number;
      calories: number;
      distance_meters: number;
    }>;
  };
  activity: {
    steps: number;
    active_calories_kcal: number;
    average_daily_active_calories_kcal?: number;
    distance_meters: number;
    step_records?: number;
    active_calorie_records?: number;
    distance_records?: number;
    average_daily_steps?: number;
    steps_estimated_days?: number;
    source?: string | null;
  };
  biometrics?: {
    hrv_records: number;
    hrv_rmssd_ms: number;
    latest_hrv_at?: string | null;
    heart_rate_records: number;
    average_heart_rate_bpm: number;
    heart_rate_min_bpm?: number;
    heart_rate_max_bpm?: number;
    latest_heart_rate_at?: string | null;
    resting_heart_rate_records: number;
    resting_heart_rate_bpm: number;
    latest_resting_heart_rate_at?: string | null;
    vo2_max_records?: number;
    vo2_max_ml_kg_min?: number;
    latest_vo2_max_at?: string | null;
  };
  training_load?: {
    score: number;
    status: 'low' | 'balanced' | 'high';
    label: string;
    recommendation: string;
    inputs: {
      average_sleep_minutes: number;
      workout_minutes: number;
      workout_sessions: number;
    };
  };
  series: DailySeriesItem[];
  coach_actions?: CoachAction[];
  detected_sources?: Record<string, string[]>;
  preferred_sources?: Record<string, string | null>;
  effective_sources?: Record<string, string | null>;
  source_badge?: string;
};

export type DailySeriesItem = {
  date: string;
  steps: number;
  active_calories_kcal: number;
  distance_meters: number;
  sleep_minutes: number;
  workout_minutes: number;
  workouts: number;
  energy_kcal: number;
  protein_g: number;
  carbohydrates_g: number;
  fat_g: number;
  hydration_liters: number;
  heart_rate_min_bpm?: number;
  heart_rate_max_bpm?: number;
  resting_heart_rate_bpm?: number;
  hrv_rmssd_ms?: number;
  vo2_max_ml_kg_min?: number;
  steps_estimated?: boolean;
  steps_recovered?: boolean;
};

export type WorkoutHistoryItem = {
  date: string;
  start_time: string;
  end_time: string;
  activity_type: string;
  duration_minutes: number;
  calories: number;
  distance_meters: number;
};

export type MorningContext = {
  status?: 'ready' | 'partial_today' | 'sleep_missing';
  title?: string;
  is_today_partial: boolean;
  recommended_context: 'today_so_far' | 'previous_day';
  message?: string | null;
  today_so_far: DailySeriesItem | Record<string, never>;
  previous_day: DailySeriesItem | Record<string, never>;
  last_night: {
    duration_minutes: number;
    start_time?: string | null;
    end_time?: string | null;
    awakenings_count: number;
    source?: string | null;
  };
  life_balance_scores?: LifeBalanceScores;
  coach_actions?: CoachAction[];
};

export type SyncRun = {
  id?: string;
  batch_id?: string | null;
  trigger: string;
  sync_mode?: string | null;
  status: string;
  records_received: number;
  duplicate?: boolean;
  data_start?: string | null;
  data_end?: string | null;
  network_type?: string | null;
  error_message?: string | null;
  created_at?: string;
};

export type SyncRunSummary = {
  total_runs: number;
  success_runs: number;
  error_runs: number;
  duplicate_runs: number;
  records_received: number;
  last_success_at?: string | null;
  last_manual_at?: string | null;
  last_background_at?: string | null;
  latest_network_type?: string | null;
  recent_runs: SyncRun[];
};

export type DataDomainStatus = {
  status: 'measured' | 'missing' | 'estimated' | 'corrected' | 'none';
  confidence: 'high' | 'medium' | 'low';
  source?: string | null;
  label: string;
  explanation: string;
};

export type DataStatus = {
  freshness: {
    status: 'fresh' | 'stale' | 'empty';
    label: string;
    explanation: string;
    computed_at?: string | null;
    last_success_at?: string | null;
    last_manual_at?: string | null;
    last_background_at?: string | null;
    latest_run_status?: string | null;
    records_received: number;
    is_stale: boolean;
  };
  domains: Record<'sleep' | 'activity' | 'workouts' | 'nutrition', DataDomainStatus>;
};

export type SourceConfig = {
  detected_sources: Record<string, string[]>;
  preferred_sources: Record<string, string | null>;
  effective_sources: Record<string, string | null>;
  source_badge: string;
};

export type SourceDiagnosticMetric = {
  metric: string;
  label: string;
  domain: string;
  unit?: string | null;
  status: 'received' | 'not_received';
  selected_source?: string | null;
  selected_source_label: string;
  selected_value?: number | null;
  selected_records: number;
  latest_received_at?: string | null;
  sources: Array<{
    source: string;
    source_label: string;
    total: number;
    records: number;
    latest_received_at?: string | null;
    selected: boolean;
  }>;
};

export type SourceDiagnostics = {
  generated_at?: string;
  domains: Record<string, {
    selected_source?: string | null;
    selected_source_label: string;
    metrics: Record<string, SourceDiagnosticMetric>;
  }>;
};

export type ReliabilityStatus = 'measured' | 'partial' | 'corrected' | 'missing' | 'conflict';
export type ReliabilityConfidence = 'high' | 'medium' | 'low';

export type MetricReliabilitySummary = {
  metric: string;
  domain: 'activity' | 'sleep' | 'workouts' | 'biometrics' | 'nutrition';
  status: ReliabilityStatus;
  confidence: ReliabilityConfidence;
  selected_source?: string | null;
  selected_source_label: string;
  selected_value?: number | null;
  unit?: string | null;
  latest_received_at?: string | null;
  badge_label: string;
  user_explanation: string;
  coach_reason: string;
  sources: ReadonlyArray<{
    source: string;
    source_label: string;
    value?: number | null;
    unit?: string | null;
    latest_received_at?: string | null;
    selected: boolean;
    note?: string | null;
  }>;
};

export type DataReliabilitySummary = {
  generated_at?: string | null;
  metrics: Record<string, MetricReliabilitySummary>;
};

export type CoachSummary = {
  version: string;
  generated_at?: string;
  windows: Record<string, Record<string, unknown>>;
  source_reliability?: Record<string, Record<string, unknown>>;
  data_limitations?: string[];
};

export type DashboardData = {
  snapshot_version?: string;
  snapshot_status?: 'fresh' | 'stale' | 'empty' | 'refreshing';
  snapshot_freshness?: {
    status: 'fresh' | 'stale' | 'empty' | 'refreshing';
    computed_at?: string | null;
    source_sync_run_id?: string | null;
    latest_sync_run_id?: string | null;
    is_stale: boolean;
  };
  generated_at: string;
  computed_at?: string;
  source_sync_run_id?: string | null;
  is_stale?: boolean;
  morning_context?: MorningContext;
  windows: {
    last_24h: OverviewContext;
    week: OverviewContext;
    month: OverviewContext;
  };
  latest_sync_run: SyncRun | null;
  sync_summary: SyncRunSummary;
  source_config: SourceConfig;
  source_diagnostics?: SourceDiagnostics;
  data_reliability?: DataReliabilitySummary;
  coach_summary?: CoachSummary;
  data_status?: DataStatus;
};

export type CoachChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  hidden?: boolean;
  loadingLabel?: string;
};

export type CoachAdvicePayload = {
  version: string;
  generated_at: string;
  model: string;
  advice: {
    title: string;
    summary: string;
    action: string;
  };
  actions?: CoachAction[];
  confidence: 'high' | 'medium' | 'low';
  context_window: '24h';
  fallback: boolean;
};

export type AgentPrompt = {
  prompt: string;
  is_default: boolean;
  updated_at?: string | null;
};

export type CoachGoal = {
  slug: string;
  label: string;
  priority: number;
  enabled: boolean;
};

export type CoachGoals = {
  goals: CoachGoal[];
  is_default: boolean;
  updated_at?: string | null;
};

export type CoachStatus = {
  model: string;
  loaded: boolean;
  load_duration_ms?: number | null;
  first_token_latency_ms?: number | null;
  keep_alive: string;
  context_tokens: number;
  think: string;
};

export type Settings = {
  apiBaseUrl: string;
  pairingCode: string;
  deviceToken: string | null;
  notificationsEnabled: boolean;
  language: LanguagePreference;
};
