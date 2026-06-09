export type WindowKey = '24h' | '7d' | '30d';

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
    protein_g: number;
    carbohydrates_g: number;
    fat_g: number;
    hydration_liters: number;
  };
  workouts: {
    sessions: number;
    duration_minutes: number;
    calories: number;
    distance_meters: number;
    latest_workout_at?: string | null;
    source?: string | null;
    running_distance_meters?: number;
    history?: Array<{
      date: string;
      start_time: string;
      end_time: string;
      activity_type: string;
      duration_minutes: number;
      calories: number;
      distance_meters: number;
    }>;
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
    distance_meters: number;
    step_records?: number;
    active_calorie_records?: number;
    distance_records?: number;
    average_daily_steps?: number;
    steps_estimated_days?: number;
    source?: string | null;
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
  series: Array<{
    date: string;
    steps: number;
    active_calories_kcal: number;
    distance_meters: number;
    sleep_minutes: number;
    workout_minutes: number;
    workouts: number;
    energy_kcal: number;
    hydration_liters: number;
    steps_estimated?: boolean;
    steps_recovered?: boolean;
  }>;
  coach_actions?: CoachAction[];
  detected_sources?: Record<string, string[]>;
  preferred_sources?: Record<string, string | null>;
  effective_sources?: Record<string, string | null>;
  source_badge?: string;
};

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

export type MorningContext = {
  status?: 'ready' | 'partial_today' | 'sleep_missing';
  title?: string;
  is_today_partial: boolean;
  recommended_context: 'today_so_far' | 'previous_day';
  message?: string | null;
  today_so_far: OverviewContext['series'][number] | Record<string, never>;
  previous_day: OverviewContext['series'][number] | Record<string, never>;
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

export type SourcePreferences = Partial<Record<'activity' | 'sleep' | 'workouts' | 'nutrition', string | null>>;

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

export type DashboardData = {
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
  data_status?: DataStatus;
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

export type CoachChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browserBaseUrl =
  typeof window === 'undefined'
    ? 'http://localhost:8010'
    : '';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? browserBaseUrl;
const PORTAL_PAIRING_CODE = import.meta.env.VITE_PORTAL_PAIRING_CODE ?? '';
const PORTAL_TOKEN_KEY = 'healthconnect.portalToken';

class UnauthorizedError extends Error {
  constructor() {
    super('HealthConnect API 401');
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 30000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`HealthConnect API inaccessible: ${API_BASE_URL}`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function readJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithTimeout(input, init);
  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    throw new Error(`HealthConnect API ${response.status}`);
  }
  return response.json();
}

export async function registerPortal(pairingCode: string): Promise<string> {
  const payload = await readJson<{ device_token: string }>(`${API_BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      pairing_code: pairingCode,
      device_name: 'HealthConnect Portal'
    })
  });
  return payload.device_token;
}

export async function fetchOverview(window: WindowKey, deviceToken: string): Promise<OverviewContext> {
  return readJson(`${API_BASE_URL}/api/v1/context/overview?window=${window}`, {
    headers: {
      Authorization: `Bearer ${deviceToken}`
    }
  });
}

export async function fetchDashboardData(deviceToken: string): Promise<DashboardData> {
  return readJson(`${API_BASE_URL}/api/v1/context/dashboard`, {
    headers: {
      Authorization: `Bearer ${deviceToken}`
    }
  });
}

export async function refreshDashboardData(deviceToken: string): Promise<DashboardData> {
  return readJson(`${API_BASE_URL}/api/v1/context/dashboard/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deviceToken}`
    }
  });
}

export async function fetchLatestSyncRun(deviceToken: string): Promise<SyncRun | null> {
  return readJson(`${API_BASE_URL}/api/v1/sync-runs/latest`, {
    headers: {
      Authorization: `Bearer ${deviceToken}`
    }
  });
}

export async function fetchSyncRunSummary(deviceToken: string): Promise<SyncRunSummary> {
  return readJson(`${API_BASE_URL}/api/v1/sync-runs/summary`, {
    headers: {
      Authorization: `Bearer ${deviceToken}`
    }
  });
}

export async function fetchSourceConfig(deviceToken: string): Promise<SourceConfig> {
  return readJson(`${API_BASE_URL}/api/v1/config/sources`, {
    headers: {
      Authorization: `Bearer ${deviceToken}`
    }
  });
}

export async function saveSourcePreferences(deviceToken: string, preferences: SourcePreferences): Promise<SourceConfig> {
  return readJson(`${API_BASE_URL}/api/v1/config/source-preferences`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${deviceToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ preferences })
  });
}

export async function fetchAgentPrompt(deviceToken: string): Promise<AgentPrompt> {
  return readJson(`${API_BASE_URL}/api/v1/config/agent-prompt`, {
    headers: {
      Authorization: `Bearer ${deviceToken}`
    }
  });
}

export async function saveAgentPrompt(deviceToken: string, prompt: string): Promise<AgentPrompt> {
  return readJson(`${API_BASE_URL}/api/v1/config/agent-prompt`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${deviceToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt })
  });
}

export async function fetchCoachGoals(deviceToken: string): Promise<CoachGoals> {
  return readJson(`${API_BASE_URL}/api/v1/config/coach-goals`, {
    headers: {
      Authorization: `Bearer ${deviceToken}`
    }
  });
}

export async function saveCoachGoals(deviceToken: string, goals: CoachGoal[]): Promise<CoachGoals> {
  return readJson(`${API_BASE_URL}/api/v1/config/coach-goals`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${deviceToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ goals })
  });
}

export async function fetchCoachTodayAdvice(deviceToken: string): Promise<CoachAdvicePayload> {
  return readJson(`${API_BASE_URL}/api/v1/coach/today-advice`, {
    headers: {
      Authorization: `Bearer ${deviceToken}`
    }
  });
}

function parseSseEvents(buffer: string): Array<{ event: string; data: string }> {
  return buffer
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1] ?? 'message';
      const data = block.match(/^data: (.*)$/m)?.[1] ?? '{}';
      return { event, data };
    });
}

export async function streamCoachChat({
  token,
  message,
  history,
  mode = 'coach',
  onDelta
}: {
  token: string;
  message: string;
  history: CoachChatMessage[];
  mode?: 'coach' | 'plan';
  onDelta: (chunk: string) => void;
}): Promise<void> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/coach/chat/stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message, mode, history })
  });
  if (!response.ok || !response.body) {
    throw new Error(`HealthConnect Coach API ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    pending += decoder.decode(value, { stream: true });
    const completeUntil = pending.lastIndexOf('\n\n');
    if (completeUntil < 0) {
      continue;
    }
    const ready = pending.slice(0, completeUntil);
    pending = pending.slice(completeUntil + 2);
    for (const event of parseSseEvents(ready)) {
      if (event.event === 'delta') {
        const parsed = JSON.parse(event.data);
        if (typeof parsed.text === 'string') {
          onDelta(parsed.text);
        }
      }
      if (event.event === 'error') {
        const parsed = JSON.parse(event.data);
        throw new Error(parsed.message || 'Erreur coach local');
      }
    }
  }
}

export async function ensurePortalToken(storage: TokenStorage = localStorage): Promise<string> {
  const stored = storage.getItem(PORTAL_TOKEN_KEY);
  if (stored) {
    return stored;
  }
  const token = await registerPortal(PORTAL_PAIRING_CODE);
  storage.setItem(PORTAL_TOKEN_KEY, token);
  return token;
}

export async function fetchPortalData(
  _window: WindowKey,
  storage: TokenStorage = localStorage,
  options: { refresh?: boolean } = {}
) {
  let token = await ensurePortalToken(storage);
  try {
    return { token, ...(await fetchPortalDataWithToken(_window, token, options)) };
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      throw error;
    }
    storage.removeItem(PORTAL_TOKEN_KEY);
    token = await ensurePortalToken(storage);
    return { token, ...(await fetchPortalDataWithToken(_window, token, options)) };
  }
}

async function fetchPortalDataWithToken(window: WindowKey, token: string, options: { refresh?: boolean } = {}) {
  const dashboard = options.refresh ? await refreshDashboardData(token) : await fetchDashboardData(token);
  return {
    dashboard,
    overview: overviewForWindow(dashboard, window),
    latestSyncRun: dashboard.latest_sync_run,
    syncSummary: dashboard.sync_summary,
    sourceConfig: dashboard.source_config
  };
}

export function overviewForWindow(dashboard: DashboardData, window: WindowKey): OverviewContext {
  if (window === '24h') {
    return dashboard.windows.last_24h;
  }
  if (window === '30d') {
    return dashboard.windows.month;
  }
  return dashboard.windows.week;
}
