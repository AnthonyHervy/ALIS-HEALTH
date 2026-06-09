import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import {
  fetchPortalData,
  fetchAgentPrompt,
  fetchCoachGoals,
  fetchSourceConfig,
  overviewForWindow,
  registerPortal,
  saveSourcePreferences,
  saveAgentPrompt,
  saveCoachGoals,
  streamCoachChat,
  type CoachAdvicePayload,
  type CoachAction,
  type CoachChatMessage,
  type CoachGoal,
  type CoachGoals,
  type DashboardData,
  type AgentPrompt,
  type LifeBalanceScores,
  type MorningContext,
  type OverviewContext,
  type SourceConfig,
  type SyncRun,
  type SyncRunSummary,
  type WindowKey
} from './api';
import { parseCoachMarkdown } from './coachMarkdown';
import {
  activityIcon,
  buildDashboardCards,
  chartContextForWindow,
  formatActivityLabel,
  formatDailyValue,
  formatDataStatusSummary,
  formatDateLabel,
  formatDuration,
  formatFrenchLongDate,
  formatLifeBalanceDisplay,
  formatLifeBalanceTooltip,
  formatMissingAwareSleepDuration,
  formatParisDateTime,
  formatParisTime,
  formatSyncObservability,
  historyScrollClass,
  maxSeriesValue,
  sleepTone
} from './format';
import './styles.css';

const emptyContext: OverviewContext = {
  window: '7d',
  sleep: {
    sessions: 0,
    total_duration_minutes: 0,
    average_duration_minutes: 0,
    deep_sleep_minutes: 0,
    rem_sleep_minutes: 0,
    light_sleep_minutes: 0,
    awake_minutes: 0,
    awakenings_count: 0,
    latest_sleep_awakenings_count: 0,
    latest_sleep_start: null,
    latest_sleep_end: null,
    average_bed_time: null,
    average_wake_time: null,
    source: null
  },
  nutrition: {
    meals: 0,
    energy_kcal: 0,
    protein_g: 0,
    carbohydrates_g: 0,
    fat_g: 0,
    hydration_liters: 0
  },
  workouts: {
    sessions: 0,
    duration_minutes: 0,
    calories: 0,
    distance_meters: 0,
    latest_workout_at: null,
    source: null,
    running_distance_meters: 0,
    history: [],
    by_activity_type: []
  },
  activity: {
    steps: 0,
    active_calories_kcal: 0,
    distance_meters: 0,
    step_records: 0,
    active_calorie_records: 0,
    distance_records: 0,
    average_daily_steps: 0,
    steps_estimated_days: 0,
    source: null
  },
  training_load: {
    score: 0,
    status: 'low',
    label: 'Charge basse',
    recommendation: 'Aucune charge détectée.',
    inputs: {
      average_sleep_minutes: 0,
      workout_minutes: 0,
      workout_sessions: 0
    }
  },
  series: [],
  detected_sources: {},
  preferred_sources: {},
  effective_sources: {},
  source_badge: 'Auto'
};

const DOMAIN_LABELS: Record<string, string> = {
  activity: 'Activité / pas',
  sleep: 'Sommeil',
  workouts: 'Entraînements',
  nutrition: 'Nutrition'
};

export const DEFAULT_WINDOW: WindowKey = '24h';

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'coach' | 'config'>('overview');
  const [windowKey, setWindowKey] = useState<WindowKey>(DEFAULT_WINDOW);
  const [deviceToken, setDeviceToken] = useState(() => localStorage.getItem('healthconnect.portalToken') ?? '');
  const [pairingCode, setPairingCode] = useState('');
  const [context, setContext] = useState<OverviewContext>(emptyContext);
  const [chartContext, setChartContext] = useState<OverviewContext>(emptyContext);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [latestSyncRun, setLatestSyncRun] = useState<SyncRun | null>(null);
  const [syncSummary, setSyncSummary] = useState<SyncRunSummary | null>(null);
  const [sourceConfig, setSourceConfig] = useState<SourceConfig | null>(null);
  const [status, setStatus] = useState('Initialisation du portail...');
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [chartMetric, setChartMetric] = useState<'steps' | 'sleep' | 'workouts'>('steps');
  const [coachAdvice, setCoachAdvice] = useState<CoachAdvicePayload | null>(null);
  const [coachAdviceError, setCoachAdviceError] = useState<string | null>(null);
  const [coachMessages, setCoachMessages] = useState<CoachChatMessage[]>([]);
  const [coachInput, setCoachInput] = useState('');
  const [isCoachStreaming, setIsCoachStreaming] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [agentPrompt, setAgentPrompt] = useState<AgentPrompt | null>(null);
  const [draftAgentPrompt, setDraftAgentPrompt] = useState('');
  const [coachGoals, setCoachGoals] = useState<CoachGoals | null>(null);
  const [draftCoachGoals, setDraftCoachGoals] = useState<CoachGoal[]>([]);

  const cards = useMemo(() => buildDashboardCards(context), [context]);
  const maxSteps = useMemo(() => Math.max(10_000, maxSeriesValue(chartContext, 'steps')), [chartContext]);
  const maxSleep = useMemo(() => Math.max(420, maxSeriesValue(chartContext, 'sleep_minutes')), [chartContext]);
  const maxWorkout = useMemo(() => Math.max(60, maxSeriesValue(chartContext, 'workout_minutes')), [chartContext]);
  const sourceBadge = sourceConfig?.source_badge ?? context.source_badge ?? 'Auto';
  const sleepDetails = useMemo(
    () => buildSleepDetails(context, windowKey, dashboard?.morning_context),
    [context, windowKey, dashboard?.morning_context]
  );

  useEffect(() => {
    load(DEFAULT_WINDOW).catch((error) => setStatus(error instanceof Error ? error.message : 'Erreur inconnue'));
  }, []);

  async function load(nextWindow: WindowKey = windowKey, options: { refresh?: boolean } = {}) {
    setIsLoadingDashboard(true);
    setStatus(options.refresh ? 'Recalcul du snapshot santé...' : 'Chargement du dernier snapshot santé...');
    try {
      const payload = await fetchPortalData(nextWindow, localStorage, options);
      const nextOverview = overviewForWindow(payload.dashboard, nextWindow);
      const nextChartContext = chartContextForWindow(nextOverview, payload.dashboard.windows.week);
      localStorage.setItem('healthconnect.portalToken', payload.token);
      setDeviceToken(payload.token);
      setWindowKey(nextWindow);
      setDashboard(payload.dashboard);
      setContext(nextOverview);
      setChartContext(nextChartContext);
      setLatestSyncRun(payload.latestSyncRun);
      setSyncSummary(payload.syncSummary);
      setSourceConfig(payload.sourceConfig);
      const prompt = await fetchAgentPrompt(payload.token);
      const goals = await fetchCoachGoals(payload.token);
      setAgentPrompt(prompt);
      setDraftAgentPrompt(prompt.prompt);
      setCoachGoals(goals);
      setDraftCoachGoals(goals.goals);
      setCoachAdvice(buildLocalCoachAdvice(payload.dashboard, payload.dashboard.computed_at ?? payload.dashboard.generated_at));
      setCoachAdviceError(null);
      const staleSuffix = payload.dashboard.is_stale ? ' · mise à jour en arrière-plan' : '';
      setStatus(`Snapshot ${nextWindow} chargé : ${nextChartContext.series.length} jour(s) affiché(s). Calcul ${formatParisDateTime(payload.dashboard.computed_at ?? payload.dashboard.generated_at)}${staleSuffix}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Erreur inconnue');
      throw error;
    } finally {
      setIsLoadingDashboard(false);
    }
  }

  function selectWindow(nextWindow: WindowKey) {
    setWindowKey(nextWindow);
    if (!dashboard) {
      void load(nextWindow);
      return;
    }
    const nextOverview = overviewForWindow(dashboard, nextWindow);
    setContext(nextOverview);
    setChartContext(chartContextForWindow(nextOverview, dashboard.windows.week));
    setStatus(`Données ${nextWindow} en cache : ${nextOverview.series.length} jour(s) affiché(s).`);
  }

  async function pairAgain() {
    setStatus('Ré-appairage portail...');
    const token = await registerPortal(pairingCode);
    localStorage.setItem('healthconnect.portalToken', token);
    setDeviceToken(token);
    await load(windowKey);
  }

  async function clearToken() {
    localStorage.removeItem('healthconnect.portalToken');
    setDeviceToken('');
    setStatus('Token local effacé. Le prochain chargement relancera un appairage automatique.');
  }

  async function updateSource(domain: string, source: string) {
    if (!deviceToken) {
      return;
    }
    setStatus(`Mise à jour source ${DOMAIN_LABELS[domain] ?? domain}...`);
    const updated = await saveSourcePreferences(deviceToken, { [domain]: source || null });
    setSourceConfig(updated);
    await load(windowKey);
  }

  async function testApi() {
    if (!deviceToken) {
      await load(windowKey);
      return;
    }
    const config = await fetchSourceConfig(deviceToken);
    const prompt = await fetchAgentPrompt(deviceToken);
    const goals = await fetchCoachGoals(deviceToken);
    setSourceConfig(config);
    setAgentPrompt(prompt);
    setDraftAgentPrompt(prompt.prompt);
    setCoachGoals(goals);
    setDraftCoachGoals(goals.goals);
    setStatus('API joignable, configuration chargée.');
  }

  async function updateAgentPrompt() {
    if (!deviceToken || !draftAgentPrompt.trim()) {
      return;
    }
    setStatus('Enregistrement du prompt IA...');
    const saved = await saveAgentPrompt(deviceToken, draftAgentPrompt);
    setAgentPrompt(saved);
    setDraftAgentPrompt(saved.prompt);
    setStatus('Prompt du coach IA enregistré.');
  }

  function toggleCoachGoal(slug: string) {
    setDraftCoachGoals((goals) =>
      goals.map((goal) => (goal.slug === slug ? { ...goal, enabled: !goal.enabled } : goal))
    );
  }

  async function updateCoachGoals() {
    if (!deviceToken || draftCoachGoals.length === 0) {
      return;
    }
    setStatus('Enregistrement des priorités coach...');
    const saved = await saveCoachGoals(deviceToken, draftCoachGoals);
    setCoachGoals(saved);
    setDraftCoachGoals(saved.goals);
    setStatus('Priorités du coach IA enregistrées.');
  }

  function openCoachWithPrompt(prompt: string) {
    setActiveTab('coach');
    setCoachInput(prompt);
  }

  async function sendCoachMessage(message = coachInput.trim()) {
    if (!message || !deviceToken || isCoachStreaming) {
      return;
    }
    const userMessage: CoachChatMessage = { role: 'user', content: message };
    const assistantMessage: CoachChatMessage = { role: 'assistant', content: '' };
    const history = [...coachMessages, userMessage];
    setCoachMessages([...history, assistantMessage]);
    setCoachInput('');
    setCoachError(null);
    setIsCoachStreaming(true);
    try {
      await streamCoachChat({
        token: deviceToken,
        message,
        history: coachMessages,
        onDelta: (chunk) => {
          setCoachMessages((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') {
              next[next.length - 1] = { ...last, content: last.content + chunk };
            }
            return next;
          });
        }
      });
    } catch (error) {
      setCoachError(error instanceof Error ? error.message : 'Coach local indisponible');
    } finally {
      setIsCoachStreaming(false);
    }
  }

  return (
    <main className="page">
      <header className="header">
        <div>
          <p className="eyebrow">HealthConnect local</p>
          <h1>Tableau de bord santé</h1>
        </div>
        <div className="top-actions">
          <span className="source-pill">Source: {sourceBadge}</span>
          <button onClick={() => load(windowKey, { refresh: true })}>Actualiser</button>
        </div>
      </header>

      <nav className="main-tabs" aria-label="Sections portail">
        <button className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>Vue générale</button>
        <button className={activeTab === 'coach' ? 'active' : ''} onClick={() => setActiveTab('coach')}>Coach</button>
        <button className={activeTab === 'config' ? 'active' : ''} onClick={() => setActiveTab('config')}>Configuration</button>
      </nav>

      <section className="status">{status}</section>
      {isLoadingDashboard ? <section className="inline-loading" aria-live="polite">Mise à jour du snapshot...</section> : null}
      {dashboard ? <DataStatusPanel dashboard={dashboard} /> : null}

      {activeTab === 'overview' ? (
        <>
          <nav className="window-tabs" aria-label="Fenêtre de données">
            {(['24h', '7d', '30d'] as WindowKey[]).map((item) => (
              <button key={item} className={windowKey === item ? 'active' : ''} onClick={() => selectWindow(item)}>
                {item === '24h' ? "Aujourd'hui" : item === '7d' ? '7j' : '30j'}
              </button>
            ))}
          </nav>

          {windowKey === '24h' ? (
            <>
              <MorningNotice morningContext={dashboard?.morning_context} />
              <LifeBalancePanel context={context} morningContext={dashboard?.morning_context} />
              <CoachAdviceCard advice={coachAdvice} error={coachAdviceError} onOpenCoach={openCoachWithPrompt} />
              <TodaySummary context={context} morningContext={dashboard?.morning_context} />
            </>
          ) : null}

          <section className="cards">
            {cards.map((card) => (
              <article className="card" key={card.label}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <small>{card.detail}</small>
              </article>
            ))}
          </section>

          {windowKey === '30d' ? (
            <TabbedCharts
              context={context}
              chartContext={chartContext}
              chartMetric={chartMetric}
              setChartMetric={setChartMetric}
              maxSteps={maxSteps}
              maxSleep={maxSleep}
              maxWorkout={maxWorkout}
            />
          ) : (
            <section className="grid">
              <MetricChart title="Activité quotidienne" context={chartContext} metric="steps" max={maxSteps} compact={false} />
              <MetricChart title="Sommeil" context={chartContext} metric="sleep" max={maxSleep} compact={false} />
              <MetricChart title="Entraînements" context={chartContext} metric="workouts" max={maxWorkout} compact={false} />
            </section>
          )}

          <section className="grid details-grid">
            <article className="chart" aria-label="Détails sommeil">
              <h2>Détails sommeil</h2>
              <dl className="metrics">
                <Metric label={windowKey === '24h' ? 'Durée' : 'Durée moyenne'} value={formatDuration(sleepDetails.durationMinutes)} />
                <Metric label={windowKey === '24h' ? 'Coucher' : 'Heure de coucher moyenne'} value={sleepDetails.bedTime} />
                <Metric label={windowKey === '24h' ? 'Réveil' : 'Heure de réveil moyenne'} value={sleepDetails.wakeTime} />
                <Metric label="Réveils nocturnes" value={`${sleepDetails.awakenings}`} />
              </dl>
            </article>

            <article className="chart" aria-label="Détails entraînements">
              <h2>Détails entraînements</h2>
              <dl className="metrics">
                <Metric label="Sessions" value={`${context.workouts.sessions}`} />
                <Metric label="Temps total" value={formatDuration(context.workouts.duration_minutes)} />
                <Metric label="Running" value={`${Math.round((context.workouts.running_distance_meters ?? 0) / 100) / 10} km`} />
                <Metric label="Charge" value={`${context.training_load?.label ?? '-'} · ${context.training_load?.score ?? 0}/100`} />
              </dl>
              <p className={`load-note ${context.training_load?.status ?? 'low'}`}>{context.training_load?.recommendation}</p>
            </article>
          </section>

          <section className="grid">
            <article className="chart wide" aria-label="Historique entraînements">
              <h2>Historique d'entraînements</h2>
              <WorkoutHistory context={context} />
            </article>
          </section>
        </>
      ) : null}

      {activeTab === 'coach' ? (
        <CoachPage
          advice={coachAdvice}
          messages={coachMessages}
          input={coachInput}
          setInput={setCoachInput}
          isStreaming={isCoachStreaming}
          error={coachError}
          onPrompt={openCoachWithPrompt}
          onSubmit={sendCoachMessage}
        />
      ) : null}

      {activeTab === 'config' ? (
        <Configuration
          deviceToken={deviceToken}
          pairingCode={pairingCode}
          setPairingCode={setPairingCode}
          sourceConfig={sourceConfig}
          agentPrompt={agentPrompt}
          draftAgentPrompt={draftAgentPrompt}
          setDraftAgentPrompt={setDraftAgentPrompt}
          coachGoals={coachGoals}
          draftCoachGoals={draftCoachGoals}
          onToggleCoachGoal={toggleCoachGoal}
          syncSummary={syncSummary}
          latestSyncRun={latestSyncRun}
          onPairAgain={pairAgain}
          onClearToken={clearToken}
          onTestApi={testApi}
          onUpdateSource={updateSource}
          onUpdateAgentPrompt={updateAgentPrompt}
          onUpdateCoachGoals={updateCoachGoals}
        />
      ) : null}
    </main>
  );
}

function DataStatusPanel({ dashboard }: { dashboard: DashboardData }) {
  const summary = formatDataStatusSummary(dashboard.data_status);
  return (
    <section className={`data-status ${summary.tone}`} aria-label="État des données">
      <div>
        <strong>{summary.label}</strong>
        <span>{summary.detail}</span>
      </div>
      <div className="data-status-domains">
        {summary.domains.map((domain) => (
          <span key={domain.label} className={domain.tone}>
            <b>{domain.label}</b>
            {domain.value}
          </span>
        ))}
      </div>
    </section>
  );
}

function CoachAdviceCard({
  advice,
  error,
  onOpenCoach
}: {
  advice: CoachAdvicePayload | null;
  error: string | null;
  onOpenCoach: (prompt: string) => void;
}) {
  return (
    <section className="coach-advice-card">
      <div>
        <p className="eyebrow">Conseil du coach</p>
        <h2>{advice?.advice.title ?? 'Analyse locale en cours'}</h2>
        <p>{advice?.advice.summary ?? error ?? 'Le coach étudie vos données de sommeil, activité et entraînement.'}</p>
        {advice?.actions?.length ? <CoachActionList actions={advice.actions} /> : advice?.advice.action ? <strong>{advice.advice.action}</strong> : null}
      </div>
      <button onClick={() => onOpenCoach('Peux-tu approfondir le conseil du jour ?')}>Approfondir</button>
    </section>
  );
}

function CoachActionList({ actions }: { actions: CoachAction[] }) {
  return (
    <ul className="coach-actions">
      {actions.map((item) => (
        <li key={item.slug}>
          <strong>{item.label}</strong>
          <span>{item.action}</span>
        </li>
      ))}
    </ul>
  );
}

function buildLocalCoachAdvice(dashboard: DashboardData, generatedAt: string): CoachAdvicePayload {
  const context = dashboard.windows.last_24h;
  const morningContext = dashboard.morning_context;
  const actions = morningContext?.coach_actions?.length ? morningContext.coach_actions : context.coach_actions ?? [];
  const primaryAction = actions[0];
  const scores = (morningContext?.life_balance_scores?.scores ?? context.life_balance_scores?.scores) ?? [];
  const rankedScores = scores.filter((score) => !(score.slug === 'sleep' && formatLifeBalanceDisplay(score).unavailable));
  const weakest = rankedScores.length
    ? [...rankedScores].sort((left, right) => left.value - right.value)[0]
    : null;
  const sleepMinutes = context.sleep.average_duration_minutes ?? context.sleep.total_duration_minutes ?? 0;
  const workoutMinutes = context.workouts.duration_minutes ?? 0;
  const steps = context.activity.steps ?? 0;
  const label = weakest?.label ?? 'équilibre';
  const morningSummary = morningContext?.is_today_partial
    ? `Lecture matin : ${morningContext.last_night.duration_minutes > 0 ? `dernière nuit ${formatDuration(morningContext.last_night.duration_minutes)}` : 'dernière nuit non mesurée'}, hier ${(morningContext.previous_day as any).steps?.toLocaleString?.('fr-FR') ?? 0} pas et ${formatDuration(Number((morningContext.previous_day as any).workout_minutes ?? 0))} d'entraînement. Aujourd'hui reste partiel (${Number((morningContext.today_so_far as any).steps ?? 0).toLocaleString('fr-FR')} pas).`
    : null;
  return {
    version: 'healthconnect.coach.today_advice.local.v1',
    generated_at: generatedAt,
    model: 'snapshot-local',
    advice: {
      title: primaryAction ? primaryAction.label : weakest ? `Priorité ${label.toLowerCase()}` : 'Conseil prêt',
      summary: morningSummary ?? `Lecture instantanée du snapshot : ${sleepMinutes > 0 ? `${formatDuration(sleepMinutes)} de sommeil` : 'sommeil non mesuré'}, ${steps.toLocaleString('fr-FR')} pas, ${formatDuration(workoutMinutes)} d'entraînement.`,
      action: primaryAction?.action ?? weakest?.explanation ?? 'Posez une question au coach pour une analyse locale plus détaillée.'
    },
    actions,
    confidence: weakest ? weakest.confidence : 'low',
    context_window: '24h',
    fallback: true
  };
}

function MorningNotice({ morningContext }: { morningContext?: MorningContext }) {
  if (!morningContext?.message) {
    return null;
  }
  return (
    <section className={`morning-note ${morningContext.status ?? ''}`}>
      <strong>{morningContext.title ?? 'Lecture du matin'}</strong>
      <span>{morningContext.message}</span>
    </section>
  );
}

function CoachPage({
  advice,
  messages,
  input,
  setInput,
  isStreaming,
  error,
  onPrompt,
  onSubmit
}: {
  advice: CoachAdvicePayload | null;
  messages: CoachChatMessage[];
  input: string;
  setInput: (value: string) => void;
  isStreaming: boolean;
  error: string | null;
  onPrompt: (prompt: string) => void;
  onSubmit: (message?: string) => Promise<void>;
}) {
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const prompts = [
    'Comment optimiser ma récupération ?',
    'Pourquoi je me sens fatigué ?',
    'Comment mieux dormir ?',
    'Comment perdre 3 kg proprement ?',
    'Comment prendre en masse ?',
    "Puis-je pousser aujourd'hui ?"
  ];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, isStreaming, error]);

  return (
    <section className="coach-page">
      <div className="coach-brief">
        <div>
          <p className="eyebrow">Coach local · {advice?.model ?? 'modèle local'}</p>
          <h2>{advice?.advice.title ?? 'Votre coach HealthConnect'}</h2>
          <p>{advice?.advice.summary ?? 'Posez une question pour lancer une analyse locale avec vos fenêtres 24h, 7j et 30j.'}</p>
          {advice?.advice.action ? <strong>{advice.advice.action}</strong> : null}
        </div>
      </div>

      <div className="coach-prompts">
        {prompts.map((prompt) => (
          <button key={prompt} onClick={() => onPrompt(prompt)}>{prompt}</button>
        ))}
      </div>

      <div className="coach-chat" aria-live="polite">
        {messages.length === 0 ? (
          <p className="muted">Les réponses utilisent vos données dédupliquées et restent indicatives. Le coach ne pose pas de diagnostic médical.</p>
        ) : null}
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`coach-message ${message.role}`}>
            <span>{message.role === 'user' ? 'Vous' : 'Coach'}</span>
            {message.role === 'assistant' ? (
              <CoachMarkdown content={message.content || 'Analyse locale en cours...'} />
            ) : (
              <p>{message.content}</p>
            )}
          </div>
        ))}
        {error ? <p className="error-text">{error}</p> : null}
        <div ref={chatEndRef} aria-hidden="true" />
      </div>

      <form className="coach-input" onSubmit={(event) => { event.preventDefault(); void onSubmit(); }}>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Posez une question au coach local..." />
        <button disabled={isStreaming || !input.trim()}>{isStreaming ? 'Analyse...' : 'Envoyer'}</button>
      </form>
    </section>
  );
}

function CoachMarkdown({ content }: { content: string }) {
  return (
    <div className="coach-markdown">
      {parseCoachMarkdown(content).map((block, index) => {
        if (block.type === 'heading') {
          return <h3 key={`${block.type}-${index}`}>{block.text}</h3>;
        }
        if (block.type === 'list') {
          return (
            <ul key={`${block.type}-${index}`}>
              {block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}
            </ul>
          );
        }
        return <p key={`${block.type}-${index}`}>{block.text}</p>;
      })}
    </div>
  );
}

function buildSleepDetails(context: OverviewContext, windowKey: WindowKey, morningContext?: MorningContext) {
  if (windowKey === '24h' && morningContext?.is_today_partial) {
    return {
      durationMinutes: morningContext.last_night.duration_minutes,
      bedTime: morningContext.last_night.start_time ? formatParisTime(morningContext.last_night.start_time) : '-',
      wakeTime: morningContext.last_night.end_time ? formatParisTime(morningContext.last_night.end_time) : '-',
      awakenings: morningContext.last_night.awakenings_count
    };
  }
  if (windowKey === '24h') {
    return {
      durationMinutes: context.sleep.average_duration_minutes ?? context.sleep.total_duration_minutes ?? 0,
      bedTime: context.sleep.latest_sleep_start ? formatParisTime(context.sleep.latest_sleep_start) : '-',
      wakeTime: context.sleep.latest_sleep_end ? formatParisTime(context.sleep.latest_sleep_end) : '-',
      awakenings: context.sleep.latest_sleep_awakenings_count ?? context.sleep.awakenings_count ?? 0
    };
  }
  return {
    durationMinutes: context.sleep.average_duration_minutes ?? 0,
    bedTime: context.sleep.average_bed_time ?? '-',
    wakeTime: context.sleep.average_wake_time ?? '-',
    awakenings: context.sleep.awakenings_count ?? 0
  };
}

function LifeBalancePanel({ context, morningContext }: { context: OverviewContext; morningContext?: MorningContext }) {
  const scoreSet: LifeBalanceScores | undefined = morningContext?.life_balance_scores ?? context.life_balance_scores;
  const scores = scoreSet?.scores ?? [];
  if (scores.length === 0) {
    return null;
  }
  return (
    <section className="life-balance" aria-label="Scores équilibre de vie">
      <div className="life-balance-title">
        <h2>Scores équilibre de vie</h2>
      </div>
      <div className="score-rings">
        {scores.map((score) => {
          const display = formatLifeBalanceDisplay(score);
          return (
          <article className={`score-ring-card ${score.tone} ${display.unavailable ? 'unavailable' : ''}`} key={score.slug} title={formatLifeBalanceTooltip(score)}>
            <div
              className="score-ring"
              style={{ '--score-value': display.unavailable ? '0%' : `${score.value}%` } as CSSProperties}
              aria-label={`${score.label} ${display.value}`}
            >
              <span>{display.value}</span>
            </div>
            <strong>{score.label}</strong>
            {display.meta ? <em>{display.meta}</em> : null}
          </article>
          );
        })}
      </div>
    </section>
  );
}

function TodaySummary({ context, morningContext }: { context: OverviewContext; morningContext?: MorningContext }) {
  const firstWorkout = context.workouts.history?.[0];
  const sleepMinutes = morningContext?.is_today_partial
    ? morningContext.last_night.duration_minutes
    : context.sleep.average_duration_minutes ?? context.sleep.total_duration_minutes;
  const sleepDisplay = formatMissingAwareSleepDuration(sleepMinutes);
  const sleepStart = morningContext?.is_today_partial ? morningContext.last_night.start_time : context.sleep.latest_sleep_start;
  const sleepEnd = morningContext?.is_today_partial ? morningContext.last_night.end_time : context.sleep.latest_sleep_end;
  const awakenings = morningContext?.is_today_partial
    ? morningContext.last_night.awakenings_count
    : context.sleep.latest_sleep_awakenings_count ?? context.sleep.awakenings_count ?? 0;
  return (
    <section className="today-strip" aria-label="Résumé aujourd'hui">
      <div className={`sleep-summary ${sleepTone(sleepMinutes)}`}>
        <span>Dernière nuit</span>
        <strong>{sleepDisplay.value}</strong>
        <small>
          {sleepDisplay.hasData && sleepStart && sleepEnd
            ? `${formatParisTime(sleepStart)} -> ${formatParisTime(sleepEnd)} · ${awakenings} réveil(s)`
            : sleepDisplay.detail}
        </small>
      </div>
      <div>
        <span>Pas depuis le réveil</span>
        <strong>{context.activity.steps.toLocaleString('fr-FR')}</strong>
        <small>{context.activity.steps_estimated_days ? 'estimation via distance' : `source ${context.activity.source ?? 'auto'}`}</small>
      </div>
      <div>
        <span>Sport aujourd'hui</span>
        <strong>{firstWorkout ? formatActivityLabel(firstWorkout.activity_type) : 'Aucun'}</strong>
        <small>{firstWorkout ? `${formatDuration(firstWorkout.duration_minutes)}${firstWorkout.distance_meters ? ` · ${Math.round(firstWorkout.distance_meters / 100) / 10} km` : ''}` : '-'}</small>
      </div>
    </section>
  );
}

function Configuration(props: {
  deviceToken: string;
  pairingCode: string;
  setPairingCode: (value: string) => void;
  sourceConfig: SourceConfig | null;
  agentPrompt: AgentPrompt | null;
  draftAgentPrompt: string;
  setDraftAgentPrompt: (value: string) => void;
  coachGoals: CoachGoals | null;
  draftCoachGoals: CoachGoal[];
  onToggleCoachGoal: (slug: string) => void;
  syncSummary: SyncRunSummary | null;
  latestSyncRun: SyncRun | null;
  onPairAgain: () => Promise<void>;
  onClearToken: () => Promise<void>;
  onTestApi: () => Promise<void>;
  onUpdateSource: (domain: string, source: string) => Promise<void>;
  onUpdateAgentPrompt: () => Promise<void>;
  onUpdateCoachGoals: () => Promise<void>;
}) {
  const sync = formatSyncObservability(props.syncSummary);
  return (
    <>
      <section className="config-grid">
        <article className="chart">
          <h2>Accès portail</h2>
          <dl className="metrics">
            <Metric label="Token local" value={props.deviceToken ? 'Présent' : 'Absent'} />
            <Metric label="Dernière sync" value={props.latestSyncRun?.created_at ? formatParisDateTime(props.latestSyncRun.created_at) : '-'} />
            <Metric label="Dernière manuelle" value={sync.lastManual} />
            <Metric label="Dernière arrière-plan" value={sync.lastBackground} />
            <Metric label="Prochain passage estimé" value={sync.nextBackground} />
          </dl>
          <div className="config-actions">
            <input value={props.pairingCode} onChange={(event) => props.setPairingCode(event.target.value)} />
            <button onClick={props.onPairAgain}>Ré-appairer</button>
            <button onClick={props.onClearToken}>Effacer le token</button>
            <button onClick={props.onTestApi}>Tester API</button>
          </div>
        </article>

        <article className="chart">
          <h2>Sources par domaine</h2>
          <div className="source-selectors">
            {Object.keys(DOMAIN_LABELS).map((domain) => {
              const detected = props.sourceConfig?.detected_sources[domain] ?? [];
              const effective = props.sourceConfig?.effective_sources[domain] ?? '';
              return (
                <label key={domain}>
                  <span>{DOMAIN_LABELS[domain]}</span>
                  <select value={effective} onChange={(event) => props.onUpdateSource(domain, event.target.value)}>
                    {detected.length === 0 ? <option value="">Auto</option> : null}
                    {detected.map((source) => (
                      <option key={source} value={source}>{source}</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </article>

        <article className="chart agent-prompt-card">
          <h2>Identité du coach IA</h2>
          <p className="muted">
            {props.agentPrompt?.is_default ? 'Prompt par défaut actif.' : 'Prompt personnalisé actif.'}
          </p>
          <textarea
            value={props.draftAgentPrompt}
            onChange={(event) => props.setDraftAgentPrompt(event.target.value)}
            rows={18}
            aria-label="Prompt du coach IA"
          />
          <button onClick={props.onUpdateAgentPrompt} disabled={!props.draftAgentPrompt.trim()}>
            Enregistrer le prompt IA
          </button>
        </article>

        <article className="chart">
          <h2>Priorités du coach</h2>
          <p className="muted">
            {props.coachGoals?.is_default ? 'Priorités par défaut actives.' : 'Priorités personnalisées actives.'}
          </p>
          <div className="coach-goals">
            {props.draftCoachGoals.map((goal) => (
              <button
                key={goal.slug}
                className={goal.enabled ? 'enabled' : ''}
                onClick={() => props.onToggleCoachGoal(goal.slug)}
              >
                <span>{goal.priority}</span>
                {goal.label}
              </button>
            ))}
          </div>
          <button onClick={props.onUpdateCoachGoals} disabled={props.draftCoachGoals.length === 0}>
            Enregistrer les priorités
          </button>
        </article>
      </section>

      {props.syncSummary ? (
        <section className="chart" aria-label="Historique synchronisations">
          <h2>Historique syncs</h2>
          <section className="sync-health">
            <Metric label="Runs" value={`${props.syncSummary.total_runs}`} />
            <Metric label="Succès" value={`${props.syncSummary.success_runs}`} />
            <Metric label="Doublons" value={`${props.syncSummary.duplicate_runs}`} />
            <Metric label="Records reçus" value={sync.records} />
            <Metric label="Réseau" value={sync.network} />
            <Metric label="Dernière erreur" value={sync.latestError} />
          </section>
          <div className="sync-list">
            {props.syncSummary.recent_runs.map((run) => (
              <div className="sync-row" key={run.id ?? `${run.created_at}-${run.batch_id}`}>
                <strong>{run.created_at ? formatParisDateTime(run.created_at) : '-'}</strong>
                <span>{run.trigger} · {run.sync_mode ?? 'mode inconnu'} · {run.records_received.toLocaleString('fr-FR')} records{run.duplicate ? ' · doublon' : ''}</span>
                <small>{run.network_type ?? '-'} · {run.status}{run.error_message ? ` · ${run.error_message}` : ''}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function TabbedCharts({
  chartContext,
  chartMetric,
  setChartMetric,
  maxSteps,
  maxSleep,
  maxWorkout
}: {
  context: OverviewContext;
  chartContext: OverviewContext;
  chartMetric: 'steps' | 'sleep' | 'workouts';
  setChartMetric: (metric: 'steps' | 'sleep' | 'workouts') => void;
  maxSteps: number;
  maxSleep: number;
  maxWorkout: number;
}) {
  const tabs = [
    { key: 'steps' as const, label: 'Activité quotidienne' },
    { key: 'sleep' as const, label: 'Sommeil' },
    { key: 'workouts' as const, label: 'Entraînements' }
  ];
  return (
    <article className="chart chart-large" aria-label="Graphique 30 jours">
      <nav className="chart-tabs" aria-label="Graphiques">
        {tabs.map((tab) => (
          <button key={tab.key} className={chartMetric === tab.key ? 'active' : ''} onClick={() => setChartMetric(tab.key)}>
            {tab.label}
          </button>
        ))}
      </nav>
      <h2>{tabs.find((tab) => tab.key === chartMetric)?.label ?? 'Graphique'}</h2>
      <DailyBars
        data={chartConfig(chartContext, chartMetric).data}
        max={chartMetric === 'steps' ? maxSteps : chartMetric === 'sleep' ? maxSleep : maxWorkout}
        unit={chartConfig(chartContext, chartMetric).unit}
        tone={chartConfig(chartContext, chartMetric).tone}
        compact={false}
        referenceLines={chartConfig(chartContext, chartMetric).referenceLines}
      />
    </article>
  );
}

function MetricChart({
  title,
  context,
  metric,
  max,
  compact
}: {
  title: string;
  context: OverviewContext;
  metric: 'steps' | 'sleep' | 'workouts';
  max: number;
  compact: boolean;
}) {
  const config = chartConfig(context, metric);

  return (
    <article className="chart" aria-label={title}>
      <h2>{title}</h2>
      <DailyBars data={config.data} max={max} unit={config.unit} tone={config.tone} compact={compact} referenceLines={config.referenceLines} />
    </article>
  );
}

function chartConfig(context: OverviewContext, metric: 'steps' | 'sleep' | 'workouts') {
  return {
    steps: {
      unit: 'pas',
      tone: 'activity',
      data: context.series.map((day) => ({
        date: day.date,
        value: day.steps,
        recovered: Boolean(day.steps_recovered || day.steps_estimated)
      })),
      referenceLines: [
        { value: 7500, className: 'warning', label: '7 500 pas' },
        { value: 10000, className: 'success', label: '10 000 pas' }
      ]
    },
    sleep: {
      unit: 'sleep',
      tone: 'sleep',
      data: context.series.map((day) => ({ date: day.date, value: day.sleep_minutes })),
      referenceLines: [{ value: 420, className: 'sleep', label: '7 h sommeil' }]
    },
    workouts: {
      unit: 'min',
      tone: 'workout',
      data: context.series.map((day) => ({ date: day.date, value: day.workout_minutes })),
      referenceLines: []
    }
  }[metric];
}

function WorkoutHistory({ context }: { context: OverviewContext }) {
  const history = context.workouts.history ?? [];
  if (history.length === 0) {
    return <p className="empty">Aucun entraînement sur cette fenêtre.</p>;
  }
  return (
    <div className="workout-history-shell">
      {context.window === '30d' ? <p className="scroll-hint">Faire défiler pour voir tout l'historique</p> : null}
      <div className={historyScrollClass(context.window)}>
        {history.map((item) => (
          <div className="activity-type" key={`${item.start_time}-${item.activity_type}`}>
            <b>{activityIcon(item.activity_type)}</b>
            <strong>{formatFrenchLongDate(item.date)}</strong>
            <span>
              {formatActivityLabel(item.activity_type)} · {formatDuration(item.duration_minutes)}
              {item.activity_type === 'running' && item.distance_meters ? ` · ${Math.round(item.distance_meters / 100) / 10} km` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function DailyBars({
  data,
  max,
  unit,
  tone,
  compact = false,
  referenceLines = []
}: {
  data: Array<{ date: string; value: number; recovered?: boolean }>;
  max: number;
  unit: string;
  tone: string;
  compact?: boolean;
  referenceLines?: Array<{ value: number; className: string; label: string }>;
}) {
  if (data.length === 0) {
    return <p className="empty">Aucune donnée sur cette fenêtre.</p>;
  }

  return (
    <>
      <div className={`daily-bars ${compact ? 'compact' : ''} ${tone}`}>
        <div className="reference-layer">
          {referenceLines.map((line) => (
            <span
              key={`${line.className}-${line.value}`}
              className={`reference-line ${line.className}`}
              style={{ bottom: `${Math.min(100, (line.value / max) * 100)}%` }}
            />
          ))}
        </div>
        {data.map((day) => {
          const height = Math.max(6, Math.min(100, (day.value / max) * 100));
          const label = `${formatDateLabel(day.date)} · ${formatDailyValue(day.value, unit)}${day.recovered ? ' · corrigé depuis les données normalisées' : ''}`;
          return (
            <div className={`daily-column ${day.recovered ? 'recovered' : ''}`} key={day.date} title={label}>
              <div className="daily-bar-wrap">
                <div className="daily-bar" style={{ height: `${height}%` }} />
                {day.recovered ? <span className="daily-quality-dot" aria-label="Donnée corrigée" /> : null}
              </div>
              {!compact ? <span>{formatDateLabel(day.date)}</span> : null}
              {!compact ? <strong>{formatDailyValue(day.value, unit)}</strong> : null}
            </div>
          );
        })}
      </div>
      {referenceLines.length > 0 ? (
        <div className="chart-legend">
          {referenceLines.map((line) => (
            <span key={line.label} className={line.className}>{line.label}</span>
          ))}
          {data.some((day) => day.recovered) ? <span className="recovered">corrigé si source partielle</span> : null}
        </div>
      ) : null}
    </>
  );
}
