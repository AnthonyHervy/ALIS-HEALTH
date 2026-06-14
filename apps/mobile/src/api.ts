import { normalizeApiBaseUrl } from './apiBaseUrl';
import { DEVICE_NAME } from './config';
import type { AppLanguage } from './i18n';
import type { AgentPrompt, CoachChatMessage, CoachGoals, CoachGoal, CoachStatus, DashboardData, Settings, SourceConfig } from './types';

type FetchLike = typeof fetch;
type SaveSettings = (settings: Partial<Settings>) => Promise<void> | void;

class UnauthorizedError extends Error {
  constructor() {
    super('ALIS API 401');
  }
}

export function cleanBaseUrl(value: string): string {
  return normalizeApiBaseUrl(value);
}

function languageHeader(language?: AppLanguage): Record<string, string> {
  return language ? { 'Accept-Language': language } : {};
}

async function readJson<T>(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<T> {
  const response = await fetchImpl(url, init);
  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    throw new Error(`ALIS API ${response.status}`);
  }
  return response.json();
}

async function registerDevice(fetchImpl: FetchLike, settings: Settings): Promise<string> {
  const payload = await readJson<{ device_token: string }>(
    fetchImpl,
    `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/auth/register`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pairing_code: settings.pairingCode,
        device_name: DEVICE_NAME
      })
    }
  );
  return payload.device_token;
}

async function ensureToken(fetchImpl: FetchLike, settings: Settings, save: SaveSettings): Promise<string> {
  if (settings.deviceToken) {
    return settings.deviceToken;
  }
  const token = await registerDevice(fetchImpl, settings);
  await save({ deviceToken: token });
  return token;
}

export function createAlisApiClient({ fetchImpl = fetch }: { fetchImpl?: FetchLike } = {}) {
  async function fetchDashboard(
    settings: Settings,
    save: SaveSettings,
    options: { refresh?: boolean; language?: AppLanguage } = {}
  ): Promise<{ dashboard: DashboardData; token: string }> {
    let token = await ensureToken(fetchImpl, settings, save);
    try {
      return {
        token,
        dashboard: await requestDashboard(fetchImpl, settings.apiBaseUrl, token, options.refresh, options.language)
      };
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        throw error;
      }
      token = await registerDevice(fetchImpl, { ...settings, deviceToken: null });
      await save({ deviceToken: token });
      return {
        token,
        dashboard: await requestDashboard(fetchImpl, settings.apiBaseUrl, token, options.refresh, options.language)
      };
    }
  }

  async function fetchSourceConfig(settings: Settings, save: SaveSettings): Promise<{ config: SourceConfig; token: string }> {
    let token = await ensureToken(fetchImpl, settings, save);
    try {
      return {
        token,
        config: await readJson<SourceConfig>(fetchImpl, `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/config/sources`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      };
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        throw error;
      }
      token = await registerDevice(fetchImpl, { ...settings, deviceToken: null });
      await save({ deviceToken: token });
      return {
        token,
        config: await readJson<SourceConfig>(fetchImpl, `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/config/sources`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      };
    }
  }

  async function fetchAgentPrompt(settings: Settings, save: SaveSettings): Promise<{ agentPrompt: AgentPrompt; token: string }> {
    let token = await ensureToken(fetchImpl, settings, save);
    try {
      return {
        token,
        agentPrompt: await readJson<AgentPrompt>(fetchImpl, `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/config/agent-prompt`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      };
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        throw error;
      }
      token = await registerDevice(fetchImpl, { ...settings, deviceToken: null });
      await save({ deviceToken: token });
      return {
        token,
        agentPrompt: await readJson<AgentPrompt>(fetchImpl, `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/config/agent-prompt`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      };
    }
  }

  async function saveAgentPrompt(settings: Settings, save: SaveSettings, prompt: string): Promise<{ agentPrompt: AgentPrompt; token: string }> {
    const token = await ensureToken(fetchImpl, settings, save);
    return {
      token,
      agentPrompt: await readJson<AgentPrompt>(fetchImpl, `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/config/agent-prompt`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt })
      })
    };
  }

  async function fetchCoachGoals(settings: Settings, save: SaveSettings): Promise<{ coachGoals: CoachGoals; token: string }> {
    let token = await ensureToken(fetchImpl, settings, save);
    try {
      return {
        token,
        coachGoals: await readJson<CoachGoals>(fetchImpl, `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/config/coach-goals`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      };
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        throw error;
      }
      token = await registerDevice(fetchImpl, { ...settings, deviceToken: null });
      await save({ deviceToken: token });
      return {
        token,
        coachGoals: await readJson<CoachGoals>(fetchImpl, `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/config/coach-goals`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      };
    }
  }

  async function saveCoachGoals(settings: Settings, save: SaveSettings, goals: CoachGoal[]): Promise<{ coachGoals: CoachGoals; token: string }> {
    const token = await ensureToken(fetchImpl, settings, save);
    return {
      token,
      coachGoals: await readJson<CoachGoals>(fetchImpl, `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/config/coach-goals`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ goals })
      })
    };
  }

  async function fetchCoachStatus(settings: Settings, save: SaveSettings): Promise<{ status: CoachStatus; token: string }> {
    let token = await ensureToken(fetchImpl, settings, save);
    try {
      return {
        token,
        status: await readJson<CoachStatus>(fetchImpl, `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/coach/status`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      };
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        throw error;
      }
      token = await registerDevice(fetchImpl, { ...settings, deviceToken: null });
      await save({ deviceToken: token });
      return {
        token,
        status: await readJson<CoachStatus>(fetchImpl, `${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/coach/status`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      };
    }
  }

  async function streamCoachChat({
    settings,
    save,
    message,
    history,
    language,
    onDelta
  }: {
    settings: Settings;
    save: SaveSettings;
    message: string;
    history: CoachChatMessage[];
    language?: AppLanguage;
    onDelta: (chunk: string) => void;
  }): Promise<string> {
    const token = await ensureToken(fetchImpl, settings, save);
    const response = await fetchImpl(`${cleanBaseUrl(settings.apiBaseUrl)}/api/v1/coach/chat/stream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...languageHeader(language)
      },
      body: JSON.stringify({ message, mode: 'coach', history, ...(language ? { language } : {}) })
    });
    if (!response.ok) {
      throw new Error(`ALIS Coach API ${response.status}`);
    }

    let fullText = '';
    const body = response.body as unknown as { getReader?: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } } | null;
    if (body?.getReader) {
      const reader = body.getReader();
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
        for (const chunk of parseSseText(ready, language)) {
          fullText += chunk;
          onDelta(chunk);
        }
      }
      return fullText;
    }

    const text = await response.text();
    for (const chunk of parseSseText(text, language)) {
      fullText += chunk;
      onDelta(chunk);
    }
    return fullText;
  }

  return { fetchDashboard, fetchSourceConfig, fetchAgentPrompt, saveAgentPrompt, fetchCoachGoals, saveCoachGoals, fetchCoachStatus, streamCoachChat };
}

async function requestDashboard(fetchImpl: FetchLike, apiBaseUrl: string, token: string, refresh = false, language?: AppLanguage): Promise<DashboardData> {
  return readJson<DashboardData>(
    fetchImpl,
    `${cleanBaseUrl(apiBaseUrl)}/api/v1/context/dashboard${refresh ? '/refresh' : ''}`,
    {
      method: refresh ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...languageHeader(language) }
    }
  );
}

export function parseSseText(text: string, language: AppLanguage = 'fr'): string[] {
  return text
    .split('\n\n')
    .filter(Boolean)
    .flatMap((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1] ?? 'message';
      if (event === 'error') {
        const data = block.match(/^data: (.*)$/m)?.[1] ?? '{}';
        const parsed = JSON.parse(data);
        throw new Error(parsed.message || (language === 'en' ? 'AI Coach error' : 'Erreur Coach IA'));
      }
      if (event !== 'delta') {
        return [];
      }
      const data = block.match(/^data: (.*)$/m)?.[1] ?? '{}';
      const parsed = JSON.parse(data);
      return typeof parsed.text === 'string' ? [parsed.text] : [];
    });
}
