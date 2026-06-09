import 'react-native-gesture-handler';
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  StatusBar as NativeStatusBar
} from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { StatusBar } from 'expo-status-bar';
import Sortable, { type SortableGridDragEndParams, type SortableGridRenderItem } from 'react-native-sortables';

import NutritionScreen from './src/nutrition/NutritionScreen';
import { createAlisApiClient } from './src/api';
import { createNutritionApiClient } from './src/nutrition/api';
import { DEFAULT_API_BASE_URL, DEFAULT_PAIRING_CODE } from './src/config';
import { parseCoachMarkdown } from './src/coachMarkdown';
import {
  biometricChartData,
  biometricSummary,
  chartContextForWindow,
  displayContextForWindow,
  lifeBalanceForToday,
  morningInsightForToday,
  nutritionInsight,
  todayCardioInsight,
  todayWorkoutPresentation,
  workoutCalorieInsight,
  sleepDetailsForToday,
  type BiometricMetric
} from './src/dashboard';
import { MAIN_TABS, type MainTab } from './src/navigation';
import { theme } from './src/theme';
import { headerTopPadding } from './src/layout';
import { DEFAULT_DASHBOARD_ORDER, mergeVisibleDashboardOrder, normalizeDashboardOrder, visibleDashboardBlocksForWindow, type DashboardBlockKey } from './src/dashboardLayout';
import { scorePanelInfoText } from './src/scoreInfo';
import { playCoachSound } from './src/coachAudio';
import { activeCoachGoals, inactiveCoachGoals, moveCoachGoalPriority, resequenceCoachGoals, toggleCoachGoalEnabled } from './src/coachGoals';
import { coachLoadingLabel, shouldShowCoachTyping } from './src/coachUi';
import { profileSaveButtonPresentation } from './src/profileSaveState';
import {
  DAILY_ANALYSIS_LOADING_LABEL,
  DAILY_ANALYSIS_PROMPT,
  WORKOUT_ANALYSIS_LOADING_LABEL,
  buildWorkoutAnalysisPrompt,
  latestWorkoutCandidate,
  selectWorkoutForAnalysis,
  workoutKey
} from './src/workoutCoach';
import {
  activityIcon,
  formatActivityLabel,
  formatDailyValue,
  formatDateLabel,
  formatDuration,
  formatFrenchLongDate,
  formatParisDateTime,
  formatParisTime,
  formatSyncObservability,
  maxSeriesValue,
  scoreColor,
  sleepTone
} from './src/format';
import {
  clearDeviceToken,
  loadDashboardOrder,
  loadLastWorkoutNotificationKey,
  loadSettings,
  loadUserProfile,
  saveDashboardOrder,
  saveLastWorkoutNotificationKey,
  saveUserProfile as persistUserProfile,
  saveSettings
} from './src/storage';
import { EMPTY_USER_PROFILE, buildCoachMessageWithProfile, normalizeUserProfile, sanitizeUserProfileDraft, type UserProfile, type UserSex } from './src/userProfile';
import { loadHealthSyncState, runManualHealthSync } from './src/healthSync';
import { healthSyncSummary } from './src/syncPresentation';
import {
  enqueueNativeBackgroundSync,
  getNativeBackgroundCursor,
  getNativeBackgroundStatus,
  saveNativeBackgroundSettings
} from './src/healthconnect/native/healthconnect-native';
import {
  addWorkoutAnalysisNotificationResponseListener,
  addMorningNotificationResponseListener,
  clearWorkoutAnalysisNotification,
  disableMorningNotification,
  enableMorningNotification,
  scheduleWorkoutAnalysisNotification
} from './src/notifications';
import { addNutritionNotificationResponseListener } from './src/nutrition/notifications';
import type { NutritionDatasetStatus, NutritionDiagnostic } from './src/nutrition/types';
import type { AgentPrompt, CoachChatMessage, CoachGoal, CoachGoals, DashboardData, LifeBalanceScore, OverviewContext, Settings, SyncRun, WindowKey, WorkoutHistoryItem } from './src/types';

type ChartMetric = 'steps' | 'sleep' | 'workouts' | BiometricMetric;
type CoachPhase = 'idle' | 'waking' | 'thinking' | 'streaming';

const api = createAlisApiClient();
const nutritionApi = createNutritionApiClient();

function nutritionSettingsIdentity(value: Settings): string {
  return `${value.apiBaseUrl}|${value.pairingCode}|${value.deviceToken ?? ''}`;
}

function workoutKeyFromUrl(url: string | null): string | null | undefined {
  if (!url || !url.includes('workout-analysis')) {
    return undefined;
  }
  const match = url.match(/[?&](?:workoutKey|workout)=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>({
    apiBaseUrl: DEFAULT_API_BASE_URL,
    pairingCode: DEFAULT_PAIRING_CODE,
    deviceToken: null,
    notificationsEnabled: true
  });
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [windowKey, setWindowKey] = useState<WindowKey>('24h');
  const [tab, setTab] = useState<MainTab>('dashboard');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('steps');
  const [dashboardOrder, setDashboardOrder] = useState<DashboardBlockKey[]>(normalizeDashboardOrder(DEFAULT_DASHBOARD_ORDER));
  const [status, setStatus] = useState('Initialisation ALIS...');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [chatMessages, setChatMessages] = useState<CoachChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [coachStreaming, setCoachStreaming] = useState(false);
  const [coachPhase, setCoachPhase] = useState<CoachPhase>('idle');
  const [draftApiUrl, setDraftApiUrl] = useState(DEFAULT_API_BASE_URL);
  const [draftPairingCode, setDraftPairingCode] = useState(DEFAULT_PAIRING_CODE);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [agentPrompt, setAgentPrompt] = useState<AgentPrompt | null>(null);
  const [coachGoals, setCoachGoals] = useState<CoachGoals | null>(null);
  const [draftCoachGoals, setDraftCoachGoals] = useState<CoachGoal[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>(EMPTY_USER_PROFILE);
  const [draftUserProfile, setDraftUserProfile] = useState<UserProfile>(EMPTY_USER_PROFILE);
  const [profileSaved, setProfileSaved] = useState(false);
  const [lastHealthSyncAt, setLastHealthSyncAt] = useState<string | null>(null);
  const [lastBackgroundStatus, setLastBackgroundStatus] = useState<string | null>(null);
  const [healthSyncing, setHealthSyncing] = useState(false);
  const [nutritionDatasetStatus, setNutritionDatasetStatus] = useState<NutritionDatasetStatus | null>(null);
  const [nutritionDiagnostics, setNutritionDiagnostics] = useState<NutritionDiagnostic | null>(null);
  const [nutritionDiagnosticsLoading, setNutritionDiagnosticsLoading] = useState(false);
  const nutritionDiagnosticsRequestRef = useRef(0);
  const settingsRef = useRef(settings);
  const dashboardRef = useRef<DashboardData | null>(null);
  const lastHealthSyncAtRef = useRef<string | null | undefined>(undefined);
  const lastWorkoutNotificationKeyRef = useRef<string | null>(null);
  const workoutNotificationReadyRef = useRef(false);
  const workoutAnalysisHandlerRef = useRef<(key?: string | null) => void>(() => undefined);
  const pendingWorkoutAnalysisKeyRef = useRef<string | null | undefined>(undefined);
  settingsRef.current = settings;
  dashboardRef.current = dashboard;

  const context = dashboard ? displayContextForWindow(dashboard, windowKey) : null;
  const todayContext = dashboard?.windows.last_24h ?? null;
  const nutritionSettingsKey = useMemo(
    () => nutritionSettingsIdentity(settings),
    [settings.apiBaseUrl, settings.pairingCode, settings.deviceToken]
  );
  const nutritionSettingsKeyRef = useRef(nutritionSettingsKey);
  nutritionSettingsKeyRef.current = nutritionSettingsKey;

  useEffect(() => {
    Promise.all([loadSettings(), loadDashboardOrder(), loadLastWorkoutNotificationKey(), loadUserProfile()])
      .then(async ([loaded, savedDashboardOrder, lastWorkoutNotificationKey, savedUserProfile]) => {
        setSettings(loaded);
        setDashboardOrder(savedDashboardOrder);
        lastWorkoutNotificationKeyRef.current = lastWorkoutNotificationKey;
        setUserProfile(savedUserProfile);
        setDraftUserProfile(savedUserProfile);
        setDraftApiUrl(loaded.apiBaseUrl);
        setDraftPairingCode(loaded.pairingCode);
        await restoreHealthSyncState(loaded);
        if (loaded.notificationsEnabled) {
          void syncMorningNotifications(loaded);
        }
        return loadDashboard(loaded, false);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Erreur de chargement';
        setDashboardError(message);
        setStatus(message);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const morningSubscription = addMorningNotificationResponseListener(() => {
      setTab('dashboard');
      setWindowKey('24h');
    });
    const nutritionSubscription = addNutritionNotificationResponseListener(() => {
      setTab('nutrition');
    });
    const workoutSubscription = addWorkoutAnalysisNotificationResponseListener((key) => {
      workoutAnalysisHandlerRef.current(key);
    });

    return () => {
      morningSubscription.remove();
      nutritionSubscription.remove();
      workoutSubscription.remove();
    };
  }, []);

  useEffect(() => {
    const handleUrl = (url: string | null) => {
      const key = workoutKeyFromUrl(url);
      if (key !== undefined) {
        workoutAnalysisHandlerRef.current(key);
      }
    };
    void Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => subscription.remove();
  }, []);

  async function persistSettings(next: Partial<Settings>, base = settings) {
    const merged = { ...base, ...next };
    settingsRef.current = merged;
    setSettings(merged);
    await saveSettings(next);
    return merged;
  }

  function clearNutritionDiagnosticsState() {
    setNutritionDiagnostics(null);
    setNutritionDatasetStatus(null);
  }

  function invalidateNutritionDiagnostics() {
    nutritionDiagnosticsRequestRef.current += 1;
    setNutritionDiagnosticsLoading(false);
    clearNutritionDiagnosticsState();
  }

  async function loadDashboard(nextSettings = settings, refresh = false) {
    setStatus(refresh ? 'Recalcul du snapshot...' : 'Chargement du snapshot...');
    setDashboardError(null);
    try {
      const result = await api.fetchDashboard(
        nextSettings,
        async (next) => {
          await persistSettings(next, nextSettings);
        },
        { refresh }
      );
      setDashboard(result.dashboard);
      dashboardRef.current = result.dashboard;
      void maybeScheduleWorkoutAnalysis(result.dashboard);
      if (pendingWorkoutAnalysisKeyRef.current !== undefined) {
        startWorkoutAnalysis(pendingWorkoutAnalysisKeyRef.current);
      }
      const healthSyncCursor = lastHealthSyncAtRef.current;
      if (healthSyncCursor !== undefined) {
        void saveNativeBackgroundSettings(nextSettings.apiBaseUrl, result.token, healthSyncCursor);
      }
      const prompt = await api.fetchAgentPrompt(
        { ...nextSettings, deviceToken: result.token },
        async (next) => {
          await persistSettings(next, nextSettings);
        }
      );
      setAgentPrompt(prompt.agentPrompt);
      const goals = await api.fetchCoachGoals(
        { ...nextSettings, deviceToken: result.token },
        async (next) => {
          await persistSettings(next, nextSettings);
        }
      );
      setCoachGoals(goals.coachGoals);
      setDraftCoachGoals(goals.coachGoals.goals);
      setStatus(`Mis à jour · ${formatParisDateTime(result.dashboard.computed_at ?? result.dashboard.generated_at)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dashboard indisponible';
      setDashboardError(message);
      setStatus(message);
      throw error;
    }
  }

  async function updateDashboardOrder(nextOrder: DashboardBlockKey[]) {
    const normalized = normalizeDashboardOrder(nextOrder);
    setDashboardOrder(normalized);
    await saveDashboardOrder(normalized);
  }

  function reorderVisibleHomeBlocks(nextVisibleOrder: DashboardBlockKey[]) {
    const next = mergeVisibleDashboardOrder(dashboardOrder, windowKey, nextVisibleOrder);
    void updateDashboardOrder(next);
  }

  async function maybeScheduleWorkoutAnalysis(nextDashboard: DashboardData) {
    const candidate = latestWorkoutCandidate(nextDashboard.windows.last_24h, lastWorkoutNotificationKeyRef.current);
    if (!workoutNotificationReadyRef.current) {
      workoutNotificationReadyRef.current = true;
      if (!lastWorkoutNotificationKeyRef.current && candidate) {
        lastWorkoutNotificationKeyRef.current = candidate.key;
        await saveLastWorkoutNotificationKey(candidate.key);
        return;
      }
    }
    if (!candidate || !settingsRef.current.notificationsEnabled) {
      void clearWorkoutAnalysisNotification();
      return;
    }
    try {
      await scheduleWorkoutAnalysisNotification(candidate.item);
      lastWorkoutNotificationKeyRef.current = candidate.key;
      await saveLastWorkoutNotificationKey(candidate.key);
    } catch {
      // Notification permission or platform issues should not block dashboard refresh.
    }
  }

  function startDailyCoachAnalysis() {
    setTab('coach');
    void sendCoachMessage(DAILY_ANALYSIS_PROMPT, {
      hiddenUser: true,
      loadingLabel: DAILY_ANALYSIS_LOADING_LABEL
    });
  }

  function startWorkoutAnalysis(key?: string | null) {
    const currentDashboard = dashboardRef.current;
    if (!currentDashboard) {
      pendingWorkoutAnalysisKeyRef.current = key ?? null;
      setTab('coach');
      return;
    }
    pendingWorkoutAnalysisKeyRef.current = undefined;
    const history = [
      ...(currentDashboard.windows.last_24h.workouts.history ?? []),
      ...(currentDashboard.windows.week.workouts.history ?? [])
    ];
    const workout = selectWorkoutForAnalysis(history, key);
    if (workout) {
      const keyToSave = workoutKey(workout);
      lastWorkoutNotificationKeyRef.current = keyToSave;
      void saveLastWorkoutNotificationKey(keyToSave);
    }
    const prompt = workout
      ? buildWorkoutAnalysisPrompt(workout, currentDashboard.windows.week)
      : 'Analyse ma dernière séance reçue aujourd’hui avec mon sommeil, ma récupération, mon activité et mon profil.';
    setTab('coach');
    void sendCoachMessage(prompt, {
      hiddenUser: true,
      loadingLabel: WORKOUT_ANALYSIS_LOADING_LABEL
    });
  }

  async function loadNutritionDiagnostics(nextSettings = settings) {
    const requestId = nutritionDiagnosticsRequestRef.current + 1;
    nutritionDiagnosticsRequestRef.current = requestId;
    let requestSettingsKey = nutritionSettingsIdentity(nextSettings);
    const isCurrentDiagnosticsRequest = () =>
      nutritionDiagnosticsRequestRef.current === requestId && nutritionSettingsKeyRef.current === requestSettingsKey;

    setNutritionDiagnosticsLoading(true);
    setStatus('Diagnostic Nutrition...');
    try {
      const result = await nutritionApi.fetchDiagnostics(nextSettings, async (next) => {
        if (!isCurrentDiagnosticsRequest()) {
          return;
        }
        const merged = await persistSettings(next, settingsRef.current);
        requestSettingsKey = nutritionSettingsIdentity(merged);
        nutritionSettingsKeyRef.current = requestSettingsKey;
      });
      if (!isCurrentDiagnosticsRequest()) {
        return;
      }
      setNutritionDiagnostics(result.diagnostics);
      setNutritionDatasetStatus(result.diagnostics.datasets);
      setStatus('Diagnostic Nutrition terminé.');
    } catch (error) {
      if (!isCurrentDiagnosticsRequest()) {
        return;
      }
      clearNutritionDiagnosticsState();
      setStatus(error instanceof Error ? error.message : 'Diagnostic Nutrition indisponible');
    } finally {
      if (isCurrentDiagnosticsRequest()) {
        setNutritionDiagnosticsLoading(false);
      }
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadDashboard(settings, true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Actualisation impossible');
    } finally {
      setRefreshing(false);
    }
  }

  function currentHealthSyncCursor() {
    return lastHealthSyncAtRef.current === undefined ? lastHealthSyncAt : lastHealthSyncAtRef.current;
  }

  async function restoreHealthSyncState(baseSettings = settings) {
    const syncState = await loadHealthSyncState({ getNativeBackgroundStatus, getNativeBackgroundCursor });
    lastHealthSyncAtRef.current = syncState.lastSyncAt;
    setLastHealthSyncAt(syncState.lastSyncAt);
    setLastBackgroundStatus(syncState.lastBackgroundStatus);
    await enqueueNativeBackgroundSync();
    if (baseSettings.deviceToken && syncState.lastSyncAt) {
      await saveNativeBackgroundSettings(baseSettings.apiBaseUrl, baseSettings.deviceToken, syncState.lastSyncAt);
    }
    return syncState;
  }

  async function syncHealthNow() {
    if (!settings.deviceToken || healthSyncing) {
      setStatus(settings.deviceToken ? 'Synchronisation déjà en cours.' : 'Appareil non appairé. Chargez ALIS une première fois.');
      return;
    }
    const healthSyncCursor = currentHealthSyncCursor();
    setHealthSyncing(true);
    setStatus(healthSyncCursor ? `Synchronisation des données santé depuis ${formatParisDateTime(healthSyncCursor)}...` : 'Première synchronisation des données santé...');
    try {
      const result = await runManualHealthSync({
        settings,
        lastSyncAt: healthSyncCursor
      });
      lastHealthSyncAtRef.current = result.dataEnd;
      setLastHealthSyncAt(result.dataEnd);
      const modeLabel = result.syncMode === 'incremental' ? 'incrémentale' : result.syncMode === 'initial_full_history' ? 'historique complet' : 'initiale 30 jours';
      setStatus(`Synchronisation ${modeLabel} terminée : ${result.syncedRecordCount} enregistrements envoyés.`);
      await loadDashboard(settings, true);
      await restoreHealthSyncState(settings);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Synchronisation mobile impossible');
    } finally {
      setHealthSyncing(false);
    }
  }

  async function saveConfiguration() {
    invalidateNutritionDiagnostics();
    const next = await persistSettings({
      apiBaseUrl: draftApiUrl.trim() || DEFAULT_API_BASE_URL,
      pairingCode: draftPairingCode.trim() || DEFAULT_PAIRING_CODE,
      deviceToken: null
    });
    setStatus('Configuration enregistrée, ré-appairage...');
    await loadDashboard(next, false);
  }

  async function clearTokenAndReload() {
    invalidateNutritionDiagnostics();
    await clearDeviceToken();
    const next = await persistSettings({ deviceToken: null });
    setStatus('Token effacé.');
    await loadDashboard(next, false);
  }

  async function syncMorningNotifications(base = settings) {
    const result = await enableMorningNotification();
    if (!result.enabled) {
      await persistSettings({ notificationsEnabled: false }, base);
      setStatus('Notifications refusées par Android.');
    }
    return result;
  }

  async function toggleNotifications(enabled: boolean) {
    if (enabled) {
      const next = await persistSettings({ notificationsEnabled: true });
      const result = await syncMorningNotifications(next);
      if (result.enabled) {
        setStatus('Notification quotidienne programmée à 10h30.');
      }
      return;
    }

    await disableMorningNotification();
    await persistSettings({ notificationsEnabled: false });
    setStatus('Notification quotidienne désactivée.');
  }

  function updateDraftUserProfileField(key: keyof UserProfile, value: string | UserSex) {
    setProfileSaved(false);
    setDraftUserProfile((current) => sanitizeUserProfileDraft({ ...current, [key]: value }));
  }

  async function saveCoachProfile() {
    const normalized = normalizeUserProfile(draftUserProfile);
    await persistUserProfile(normalized);
    setUserProfile(normalized);
    setDraftUserProfile(normalized);
    setProfileSaved(true);
    setStatus('Profil sauvegardé !');
  }

  function setCoachGoalEnabled(slug: string, enabled: boolean) {
    setDraftCoachGoals((goals) => toggleCoachGoalEnabled(goals, slug, enabled));
  }

  function moveCoachGoal(slug: string, direction: 'up' | 'down') {
    setDraftCoachGoals((goals) => moveCoachGoalPriority(goals, slug, direction));
  }

  async function updateCoachGoals() {
    if (draftCoachGoals.length === 0) {
      return;
    }
    setStatus('Enregistrement des priorités coach...');
    const orderedGoals = resequenceCoachGoals(draftCoachGoals);
    const saved = await api.saveCoachGoals(settings, async (next) => {
      await persistSettings(next);
    }, orderedGoals);
    setCoachGoals(saved.coachGoals);
    setDraftCoachGoals(saved.coachGoals.goals);
    setStatus('Priorités du coach IA enregistrées.');
  }

  async function sendCoachMessage(
    prompt = chatInput.trim(),
    options: { hiddenUser?: boolean; loadingLabel?: string } = {}
  ) {
    if (!prompt || coachStreaming) {
      return;
    }
    const coachPrompt = buildCoachMessageWithProfile(prompt, userProfile);
    const userMessage: CoachChatMessage = { role: 'user', content: prompt, hidden: options.hiddenUser };
    const assistantMessage: CoachChatMessage = { role: 'assistant', content: '', loadingLabel: options.loadingLabel };
    setChatMessages((current) => options.hiddenUser ? [...current, assistantMessage] : [...current, userMessage, assistantMessage]);
    if (!options.hiddenUser) {
      void playCoachSound('send');
    }
    setChatInput('');
    setCoachStreaming(true);
    setCoachPhase('waking');
    let replySoundPlayed = false;
    const visibleHistory = chatMessages
      .filter((message) => !message.hidden)
      .map(({ role, content }) => ({ role, content }));
    try {
      try {
        const status = await api.fetchCoachStatus(settings, async (next) => {
          await persistSettings(next);
        });
        setCoachPhase(status.status.loaded ? 'thinking' : 'waking');
      } catch {
        setCoachPhase('thinking');
      }
      await api.streamCoachChat({
        settings,
        save: async (next) => {
          await persistSettings(next);
        },
        message: coachPrompt,
        history: visibleHistory,
        onDelta: (chunk) => {
          setCoachPhase('streaming');
          if (!replySoundPlayed && !options.hiddenUser) {
            replySoundPlayed = true;
            void playCoachSound('reply');
          }
          setChatMessages((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') {
              next[next.length - 1] = { ...last, content: `${last.content}${chunk}` };
            }
            return next;
          });
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Coach indisponible';
      setChatMessages((current) => {
        const next = [...current];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && !last.content) {
          next[next.length - 1] = { ...last, content: `Le Coach IA est indisponible pour le moment.\n\n${message}` };
        }
        return next;
      });
    } finally {
      setCoachStreaming(false);
      setCoachPhase('idle');
    }
  }

  workoutAnalysisHandlerRef.current = startWorkoutAnalysis;

  const showDashboardTimestamp = tab === 'dashboard' && windowKey === '24h';
  const headerStatus = status.startsWith('Mis à jour') && !showDashboardTimestamp ? '' : status;
  const headerLoading = Boolean(headerStatus) && (loading || refreshing || healthSyncing || nutritionDiagnosticsLoading);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <View style={[styles.shell, { paddingTop: headerTopPadding(Platform.OS, NativeStatusBar.currentHeight) }]}>
          <Header tab={tab} status={headerStatus} loading={headerLoading} />
          <View style={styles.contentArea}>
            {tab === 'dashboard' ? (
              <ScrollView
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                contentContainerStyle={styles.scrollContent}
              >
                {dashboard && context && todayContext ? (
                  <DashboardScreen
                    dashboard={dashboard}
                    context={context}
                    todayContext={todayContext}
                    windowKey={windowKey}
                    setWindowKey={setWindowKey}
                    chartMetric={chartMetric}
                    setChartMetric={setChartMetric}
                    syncingHealth={healthSyncing}
                    lastHealthSyncAt={lastHealthSyncAt}
                    lastBackgroundStatus={lastBackgroundStatus}
                    onSyncHealth={syncHealthNow}
                    dashboardOrder={dashboardOrder}
                    onReorderVisible={reorderVisibleHomeBlocks}
                    onAnalyzeToday={startDailyCoachAnalysis}
                  />
                ) : !loading && dashboardError ? (
                  <ErrorState
                    message={dashboardError}
                    apiUrl={settings.apiBaseUrl}
                    onRetry={() => loadDashboard(settings, false).catch(() => undefined)}
                    onConfig={() => setTab('config')}
                  />
                ) : (
                  <LoadingState label="Chargement de vos données santé..." />
                )}
              </ScrollView>
            ) : null}
            <View style={[styles.tabPane, tab !== 'nutrition' && styles.tabPaneHidden]}>
              <NutritionScreen key={nutritionSettingsKey} embedded active={tab === 'nutrition'} />
            </View>
            {tab === 'coach' ? (
              <CoachScreen
                messages={chatMessages}
                input={chatInput}
                setInput={setChatInput}
                isStreaming={coachStreaming}
                coachPhase={coachPhase}
                send={sendCoachMessage}
              />
            ) : null}
            {tab === 'config' ? (
              <ConfigurationScreen
                settings={settings}
                apiUrl={draftApiUrl}
                setApiUrl={setDraftApiUrl}
                pairingCode={draftPairingCode}
                setPairingCode={setDraftPairingCode}
                dashboard={dashboard}
                notificationsEnabled={settings.notificationsEnabled}
                toggleNotifications={toggleNotifications}
                agentPrompt={agentPrompt}
                coachGoals={coachGoals}
                draftCoachGoals={draftCoachGoals}
                draftUserProfile={draftUserProfile}
                profileSaved={profileSaved}
                setDraftUserProfileField={updateDraftUserProfileField}
                saveCoachProfile={saveCoachProfile}
                setCoachGoalEnabled={setCoachGoalEnabled}
                moveCoachGoal={moveCoachGoal}
                updateCoachGoals={updateCoachGoals}
                nutritionDatasetStatus={nutritionDatasetStatus}
                nutritionDiagnostics={nutritionDiagnostics}
                nutritionDiagnosticsLoading={nutritionDiagnosticsLoading}
                loadNutritionDiagnostics={loadNutritionDiagnostics}
                saveConfiguration={saveConfiguration}
                clearToken={clearTokenAndReload}
                testApi={() => loadDashboard(settings, false)}
              />
            ) : null}
          </View>
          <MainTabs tab={tab} setTab={setTab} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Header({ tab, status, loading }: { tab: MainTab; status: string; loading: boolean }) {
  const titles: Record<MainTab, string> = {
    dashboard: "Aujourd'hui",
    nutrition: 'Nutrition',
    coach: 'Coach IA',
    config: 'Paramètres'
  };
  return (
    <View style={styles.header}>
      <View style={styles.headerTitleBlock}>
        <Text style={styles.eyebrow}>ALIS</Text>
        <Text style={styles.title} numberOfLines={1}>{titles[tab]}</Text>
      </View>
      <View style={styles.statusPill}>
        {loading ? <ActivityIndicator size="small" color={theme.colors.brand} /> : null}
        <Text style={styles.statusText} numberOfLines={2}>{status}</Text>
      </View>
    </View>
  );
}

function MainTabs({ tab, setTab }: { tab: MainTab; setTab: (tab: MainTab) => void }) {
  return (
    <View style={styles.bottomTabs}>
      {MAIN_TABS.map(({ key, label, icon }) => (
        <Pressable key={key} onPress={() => setTab(key)} style={[styles.tabButton, tab === key && styles.tabButtonActive]}>
          <Text style={[styles.tabIcon, tab === key && styles.tabTextActive]}>{icon}</Text>
          <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function DashboardScreen({
  dashboard,
  context,
  todayContext,
  windowKey,
  setWindowKey,
  chartMetric,
  setChartMetric,
  syncingHealth,
  lastHealthSyncAt,
  lastBackgroundStatus,
  onSyncHealth,
  dashboardOrder,
  onReorderVisible,
  onAnalyzeToday
}: {
  dashboard: DashboardData;
  context: OverviewContext;
  todayContext: OverviewContext;
  windowKey: WindowKey;
  setWindowKey: (window: WindowKey) => void;
  chartMetric: ChartMetric;
  setChartMetric: (metric: ChartMetric) => void;
  syncingHealth: boolean;
  lastHealthSyncAt: string | null;
  lastBackgroundStatus: string | null;
  onSyncHealth: () => void;
  dashboardOrder: DashboardBlockKey[];
  onReorderVisible: (order: DashboardBlockKey[]) => void;
  onAnalyzeToday: () => void;
}) {
  const sleepDetails = sleepDetailsForToday(dashboard);
  const scores = lifeBalanceForToday(dashboard)?.scores ?? [];
  const morningInsight = morningInsightForToday(dashboard);
  const chartContext = chartContextForWindow(context, dashboard.windows.week);
  const visibleOrder = useMemo(() => visibleDashboardBlocksForWindow(dashboardOrder, windowKey), [dashboardOrder, windowKey]);
  const handleDragEnd = (params: SortableGridDragEndParams<DashboardBlockKey>) => {
    onReorderVisible(params.data);
  };
  const renderBlock = (key: DashboardBlockKey) => {
    if (key === 'scores' && windowKey === '24h') {
      return <ScorePanel scores={scores} dailyInsight={morningInsight} />;
    }
    if (key === 'morning' && windowKey === '24h' && morningInsight) {
      return <MorningCard title={morningInsight.title} message={morningInsight.message} status={morningInsight.status} />;
    }
    if (key === 'sync') {
      return (
        <HealthSyncCard
          syncing={syncingHealth}
          latestRun={dashboard.latest_sync_run}
          lastHealthSyncAt={lastHealthSyncAt}
          lastBackgroundStatus={lastBackgroundStatus}
          onSync={onSyncHealth}
        />
      );
    }
    if (key === 'coach' && windowKey === '24h') {
      return <DailyCoachCta onOpen={onAnalyzeToday} />;
    }
    if (key === 'today' && windowKey === '24h') {
      return <TodayStrip context={todayContext} sleepDetails={sleepDetails} />;
    }
    if (key === 'summary') {
      return <SummaryCards context={context} />;
    }
    if (key === 'charts') {
      return windowKey === '30d' ? (
        <>
          <Segmented
            value={chartMetric}
            options={[
              ['steps', 'Activité'],
              ['sleep', 'Sommeil'],
              ['workouts', 'Sport']
            ]}
            onChange={setChartMetric}
          />
          <ChartCard title={chartTitle(chartMetric)} context={context} metric={chartMetric} large />
          <BiometricTrendCards context={context} large />
        </>
      ) : (
        <>
          <ChartCard title="Activité quotidienne" context={chartContext} metric="steps" />
          <ChartCard title="Sommeil" context={chartContext} metric="sleep" />
          <ChartCard title="Sport" context={chartContext} metric="workouts" />
          {windowKey !== '24h' ? <BiometricTrendCards context={chartContext} /> : null}
        </>
      );
    }
    if (key === 'sleepDetails') {
      return <SleepDetails context={context} windowKey={windowKey} sleepDetails={sleepDetails} />;
    }
    if (key === 'workoutDetails') {
      return <WorkoutDetails context={context} />;
    }
    if (key === 'workoutHistory') {
      return <WorkoutHistory context={context} />;
    }
    return null;
  };
  const renderSortableBlock: SortableGridRenderItem<DashboardBlockKey> = ({ item }) => {
    const block = renderBlock(item);
    return block ? <DashboardBlockShell>{block}</DashboardBlockShell> : <View />;
  };
  return (
    <View style={styles.stack}>
      <Segmented
        value={windowKey}
        options={[
          ['24h', "Aujourd'hui"],
          ['7d', '7j'],
          ['30d', '30j']
        ]}
        onChange={setWindowKey}
      />
      <Sortable.Layer>
        <View style={styles.sortableGridWrap}>
          <Sortable.Grid
            columns={1}
            data={visibleOrder}
            renderItem={renderSortableBlock}
            keyExtractor={(key) => key}
            rowGap={12}
            strategy="insert"
            dragActivationDelay={320}
            dragActivationFailOffset={12}
            activeItemScale={1.015}
            inactiveItemOpacity={0.72}
            showDropIndicator
            dropIndicatorStyle={styles.sortableDropIndicator}
            onDragEnd={handleDragEnd}
          />
        </View>
      </Sortable.Layer>
    </View>
  );
}

function HealthSyncCard({
  syncing,
  latestRun,
  lastHealthSyncAt,
  lastBackgroundStatus,
  onSync
}: {
  syncing: boolean;
  latestRun: SyncRun | null;
  lastHealthSyncAt: string | null;
  lastBackgroundStatus: string | null;
  onSync: () => void;
}) {
  const summary = healthSyncSummary({ syncing, latestRun, lastHealthSyncAt, lastBackgroundStatus });
  return (
    <View style={[styles.syncCard, summary.freshnessTone ? syncCardToneStyle(summary.freshnessTone) : null]}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{summary.title}</Text>
          <View style={styles.syncFreshnessRow}>
            <Text style={[styles.syncMoment, summary.freshnessTone ? syncMomentToneStyle(summary.freshnessTone) : null]}>{summary.detail}</Text>
            {summary.freshnessLabel ? (
              <Text style={[styles.syncFreshnessPill, syncPillToneStyle(summary.freshnessTone)]}>{summary.freshnessLabel}</Text>
            ) : null}
          </View>
        </View>
        <Pressable style={[styles.syncActionButton, syncing && styles.disabledButton]} disabled={syncing} onPress={onSync}>
          <Text style={styles.primaryButtonText}>{summary.action}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function DashboardBlockShell({
  children
}: {
  children: ReactNode;
}) {
  return (
    <View style={styles.dashboardBlockShell}>
      {children}
    </View>
  );
}

function syncCardToneStyle(tone: 'success' | 'warning' | 'danger') {
  if (tone === 'success') {
    return styles.syncCard_success;
  }
  if (tone === 'warning') {
    return styles.syncCard_warning;
  }
  return styles.syncCard_danger;
}

function syncMomentToneStyle(tone: 'success' | 'warning' | 'danger') {
  if (tone === 'success') {
    return styles.syncMoment_success;
  }
  if (tone === 'warning') {
    return styles.syncMoment_warning;
  }
  return styles.syncMoment_danger;
}

function syncPillToneStyle(tone?: 'success' | 'warning' | 'danger') {
  if (tone === 'success') {
    return styles.syncFreshnessPill_success;
  }
  if (tone === 'warning') {
    return styles.syncFreshnessPill_warning;
  }
  if (tone === 'danger') {
    return styles.syncFreshnessPill_danger;
  }
  return null;
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (value: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map(([key, label]) => (
        <Pressable key={key} style={[styles.segmentButton, value === key && styles.segmentButtonActive]} onPress={() => onChange(key)}>
          <Text style={[styles.segmentText, value === key && styles.segmentTextActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function MorningCard({ title, message, status }: { title: string; message: string; status: string }) {
  return (
    <View style={[styles.morningCard, status === 'sleep_missing' && styles.morningCardWarning]}>
      <Text style={styles.morningTitle}>{title}</Text>
      <Text style={styles.morningText}>{message}</Text>
    </View>
  );
}

function ScorePanel({ scores, dailyInsight }: { scores: NonNullable<ReturnType<typeof lifeBalanceForToday>>['scores']; dailyInsight?: ReturnType<typeof morningInsightForToday> }) {
  if (scores.length === 0) {
    return null;
  }
  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle}>Scores équilibre de vie</Text>
        <Pressable
          accessibilityLabel="Information sur les scores"
          style={styles.scorePanelInfoButton}
          onPress={() => {
            const info = scorePanelInfoText(scores, dailyInsight);
            Alert.alert(info.title, info.message);
          }}
        >
          <Text style={styles.scoreInfoText}>i</Text>
        </Pressable>
      </View>
      <View style={styles.scoreRow}>
        {scores.map((score) => (
          <View key={score.slug} style={styles.scoreItem}>
            <ScoreRing value={score.value} color={scoreColor(score.tone)} unavailable={scoreUnavailable(score)} />
            <Text style={styles.scoreLabel}>{score.label}</Text>
            {scoreUnavailable(score) ? <Text style={styles.scoreMeta}>Absence de données</Text> : score.confidence === 'low' ? <Text style={styles.scoreMeta}>Fiabilité faible</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function scoreUnavailable(score: LifeBalanceScore): boolean {
  return score.contributors.length === 0 && /absence|aucune/i.test(score.explanation);
}

function ScoreRing({ value, color, unavailable }: { value: number; color: string; unavailable?: boolean }) {
  const radius = 31;
  const stroke = 7;
  const circumference = 2 * Math.PI * radius;
  const progress = unavailable ? 0 : Math.max(0, Math.min(100, value));
  const ringColor = unavailable ? '#cbd5e1' : color;
  return (
    <View style={styles.scoreRing}>
      <Svg width={80} height={80} viewBox="0 0 80 80">
        <Circle cx={40} cy={40} r={radius} stroke="#e5e7eb" strokeWidth={stroke} fill="none" />
        {!unavailable ? (
          <Circle
            cx={40}
            cy={40}
            r={radius}
            stroke={ringColor}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - progress / 100)}
            rotation="-90"
            origin="40,40"
          />
        ) : null}
      </Svg>
      <Text style={[styles.scoreValue, { color: ringColor }]}>{unavailable ? '--' : `${Math.round(value)}%`}</Text>
    </View>
  );
}

function DailyCoachCta({ onOpen }: { onOpen: () => void }) {
  return (
    <Pressable style={styles.dailyCoachButton} onPress={onOpen}>
      <Text style={styles.dailyCoachText}>Faire étudier mes données du jour</Text>
      <View style={styles.dailyCoachIcon}>
        <Text style={styles.dailyCoachIconText}>✦</Text>
      </View>
    </Pressable>
  );
}

function TodayStrip({ context, sleepDetails }: { context: OverviewContext; sleepDetails: ReturnType<typeof sleepDetailsForToday> }) {
  const hasSleep = sleepDetails.durationMinutes > 0;
  const workout = todayWorkoutPresentation(context);
  const cardio = todayCardioInsight(context);
  return (
    <View style={styles.todayGrid}>
      <MetricTile
        label="Dernière nuit"
        value={hasSleep ? formatDuration(sleepDetails.durationMinutes) : '--'}
        detail={hasSleep && sleepDetails.startTime && sleepDetails.endTime ? `${formatParisDateTime(sleepDetails.startTime)} -> ${formatParisTime(sleepDetails.endTime)} · ${sleepDetails.awakenings} réveil(s)` : 'Absence de données sommeil'}
        tone={hasSleep ? sleepTone(sleepDetails.durationMinutes) : undefined}
      />
      <MetricTile
        label="Pas depuis le réveil"
        value={context.activity.steps.toLocaleString('fr-FR')}
        detail={context.activity.source ? `source ${context.activity.source}` : 'source auto'}
      />
      <MetricTile
        label="Sport aujourd'hui"
        value={workout.value}
        detail={workout.detail}
      />
      {workout.calorie ? (
        <MetricTile
          label={workout.calorie.label}
          value={workout.calorie.value}
          detail={context.window === '24h' ? "d'après les données reçues" : 'moyenne de la fenêtre'}
          tone="success"
        />
      ) : null}
      {cardio ? (
        <MetricTile
          label={cardio.label}
          value={cardio.value}
          detail={cardio.detail}
          tone="info"
        />
      ) : null}
    </View>
  );
}

function SummaryCards({ context }: { context: OverviewContext }) {
  const isToday = context.window === '24h';
  const activityValue = isToday ? context.activity.steps : context.activity.average_daily_steps ?? Math.round(context.activity.steps / Math.max(1, context.series.length));
  const sleepMinutes = context.sleep.average_duration_minutes ?? context.sleep.total_duration_minutes ?? 0;
  return (
    <View style={styles.summaryGrid}>
      <MetricTile label="Sommeil" value={sleepMinutes > 0 ? formatDuration(sleepMinutes) : '--'} detail={sleepMinutes > 0 ? isToday ? 'dernière nuit mesurée' : 'durée moyenne' : 'absence de données'} />
      <MetricTile label="Sport" value={formatDuration(context.workouts.duration_minutes)} detail={`${context.workouts.sessions} session(s)`} />
      <MetricTile label="Activité" value={activityValue.toLocaleString('fr-FR')} detail={isToday ? 'pas' : 'pas / jour'} />
    </View>
  );
}

function NutritionDetails({ context, onAskCoach }: { context: OverviewContext; onAskCoach: () => void }) {
  const insight = nutritionInsight(context);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>ALIS Nutrition</Text>
          <Text style={styles.cardTitle}>{insight.title}</Text>
        </View>
        <Pressable style={styles.secondaryButton} onPress={onAskCoach}>
          <Text style={styles.secondaryButtonText}>Coach</Text>
        </Pressable>
      </View>
      <View style={styles.nutritionFocusRow}>
        <View style={styles.flex}>
          <Text style={styles.metricLabel}>Calories</Text>
          <Text style={styles.nutritionEnergyValue}>{insight.energy}</Text>
          <Text style={styles.metricDetail}>{insight.meals}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.metricLabel}>Hydratation</Text>
          <Text style={styles.nutritionEnergyValue}>{insight.hydration}</Text>
          <Text style={styles.metricDetail}>sur la fenêtre</Text>
        </View>
      </View>
      <DetailRow label="Macros" value={insight.macros} />
      <DetailRow label="Moyenne" value={insight.average} />
      <DetailRow label="Dernier repas" value={insight.latestMeal} />
      <Text style={styles.muted}>Seuls les repas validés dans Nutrition alimentent ALIS et Coach.</Text>
    </View>
  );
}

function MetricTile({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'danger' | 'warning' | 'success' | 'info' }) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, tone ? styles[`tone_${tone}`] : null]}>{value}</Text>
      <Text style={styles.metricDetail} numberOfLines={3}>{detail}</Text>
    </View>
  );
}

function ChartCard({ title, context, metric, large = false }: { title: string; context: OverviewContext; metric: ChartMetric; large?: boolean }) {
  const data = chartData(context, metric);
  const max = chartMax(context, metric);
  const references = metric === 'steps'
    ? [
        { value: 7500, color: '#ca8a04', label: '7 500' },
        { value: 10000, color: '#16a34a', label: '10 000' }
      ]
    : metric === 'sleep'
      ? [{ value: 420, color: '#2563eb', label: '7 h' }]
      : [];
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <BarChart data={data} max={max} metric={metric} references={references} large={large} />
    </View>
  );
}

function BiometricTrendCards({ context, large = false }: { context: OverviewContext; large?: boolean }) {
  return (
    <>
      <BiometricSummaryCard context={context} metric="hrv" large={large} />
      <BiometricSummaryCard context={context} metric="vo2" large={large} />
    </>
  );
}

function BiometricSummaryCard({ context, metric, large = false }: { context: OverviewContext; metric: BiometricMetric; large?: boolean }) {
  const summary = biometricSummary(context, metric);
  return (
    <View style={[styles.card, large && styles.biometricCardLarge]}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle}>{summary.title}</Text>
        {summary.sampleCount > 0 ? <Text style={styles.biometricSampleCount}>{summary.sampleCount} j</Text> : null}
      </View>
      {summary.sampleCount === 0 ? (
        <Text style={styles.empty}>{summary.emptyLabel}</Text>
      ) : (
        <>
          <View style={styles.biometricStatsRow}>
            <BiometricStat label="Intervalle" value={summary.interval} />
            <BiometricStat label="Moyenne" value={summary.average} />
            <BiometricStat label="Médiane" value={summary.median} />
          </View>
          {metric === 'vo2' ? <Text style={styles.metricDetail}>valeurs en ml/kg/min</Text> : null}
        </>
      )}
    </View>
  );
}

function BiometricStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.biometricStat}>
      <Text style={styles.biometricStatLabel}>{label}</Text>
      <Text style={styles.biometricStatValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function chartTitle(metric: ChartMetric) {
  if (metric === 'steps') {
    return 'Activité quotidienne';
  }
  if (metric === 'sleep') {
    return 'Sommeil';
  }
  if (metric === 'hrv') {
    return 'Variabilité cardiaque';
  }
  if (metric === 'vo2') {
    return 'VO2 max';
  }
  return 'Sport';
}

function chartData(context: OverviewContext, metric: ChartMetric) {
  if (metric === 'steps') {
    return context.series.map((day) => ({
      date: day.date,
      value: day.steps,
      label: formatDailyValue(day.steps, 'pas'),
      recovered: Boolean(day.steps_recovered || day.steps_estimated)
    }));
  }
  if (metric === 'sleep') {
    return context.series.map((day) => ({ date: day.date, value: day.sleep_minutes, label: formatDailyValue(day.sleep_minutes, 'sleep') }));
  }
  if (metric === 'hrv' || metric === 'vo2') {
    return biometricChartData(context, metric);
  }
  return context.series.map((day) => ({ date: day.date, value: day.workout_minutes, label: formatDailyValue(day.workout_minutes, 'min') }));
}

function chartMax(context: OverviewContext, metric: ChartMetric) {
  if (metric === 'steps') {
    return Math.max(10000, maxSeriesValue(context, 'steps'));
  }
  if (metric === 'sleep') {
    return Math.max(420, maxSeriesValue(context, 'sleep_minutes'));
  }
  if (metric === 'hrv') {
    return Math.max(80, maxSeriesValue(context, 'hrv_rmssd_ms'));
  }
  if (metric === 'vo2') {
    return Math.max(60, maxSeriesValue(context, 'vo2_max_ml_kg_min'));
  }
  return Math.max(60, maxSeriesValue(context, 'workout_minutes'));
}

function BarChart({
  data,
  max,
  metric,
  references,
  large
}: {
  data: Array<{ date: string; value: number; label: string; recovered?: boolean }>;
  max: number;
  metric: ChartMetric;
  references: Array<{ value: number; color: string; label: string }>;
  large: boolean;
}) {
  const width = 320;
  const height = large ? 220 : 160;
  const bottom = 28;
  const top = 12;
  const usableHeight = height - bottom - top;
  const gap = data.length > 12 ? 3 : 8;
  const barWidth = Math.max(4, (width - gap * Math.max(0, data.length - 1)) / Math.max(1, data.length));
  const color = metric === 'sleep'
    ? '#1e3a8a'
    : metric === 'workouts'
      ? '#991b1b'
      : metric === 'hrv'
        ? '#7c3aed'
        : metric === 'vo2'
          ? '#0891b2'
          : '#15803d';
  if (data.length === 0) {
    return <Text style={styles.empty}>Aucune donnée.</Text>;
  }
  if ((metric === 'hrv' || metric === 'vo2') && !data.some((item) => item.value > 0)) {
    return <Text style={styles.empty}>Aucune donnée sur cette période.</Text>;
  }
  return (
    <View style={styles.chartWrap}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {references.map((ref) => {
          const y = top + usableHeight - Math.min(1, ref.value / max) * usableHeight;
          return (
            <Fragment key={ref.label}>
              <Line x1={0} y1={y} x2={width} y2={y} stroke={ref.color} strokeWidth={1.5} strokeDasharray="5 5" />
              <SvgText x={width - 4} y={y - 4} fill={ref.color} fontSize={10} textAnchor="end">{ref.label}</SvgText>
            </Fragment>
          );
        })}
        {data.map((item, index) => {
          const x = index * (barWidth + gap);
          const barHeight = Math.max(3, Math.min(1, item.value / max) * usableHeight);
          const y = top + usableHeight - barHeight;
          const showDateLabel = data.length <= 8 || (large && (index % 5 === 0 || index === data.length - 1));
          return (
            <Fragment key={item.date}>
              <Rect x={x} y={y} width={barWidth} height={barHeight} rx={3} fill={color} opacity={0.88} />
              {item.recovered ? (
                <Circle cx={x + barWidth / 2} cy={Math.max(top + 6, y - 5)} r={3.5} fill="#0f766e" stroke="#ffffff" strokeWidth={1.5} />
              ) : null}
              {showDateLabel ? (
                <SvgText x={x + barWidth / 2} y={height - 8} fill="#64748b" fontSize={9} textAnchor="middle">{formatDateLabel(item.date).replace('.', '')}</SvgText>
              ) : null}
            </Fragment>
          );
        })}
      </Svg>
      <Text style={styles.chartHint}>{data[data.length - 1]?.label ?? ''}</Text>
      {data.some((item) => item.recovered) && metric === 'steps' ? (
        <Text style={styles.chartQualityHint}>point vert : donnée corrigée</Text>
      ) : null}
    </View>
  );
}

function SleepDetails({ context, windowKey, sleepDetails }: { context: OverviewContext; windowKey: WindowKey; sleepDetails: ReturnType<typeof sleepDetailsForToday> }) {
  const duration = windowKey === '24h' ? sleepDetails.durationMinutes : context.sleep.average_duration_minutes ?? 0;
  const bed = windowKey === '24h' ? sleepDetails.startTime ? formatParisTime(sleepDetails.startTime) : '-' : context.sleep.average_bed_time ?? '-';
  const wake = windowKey === '24h' ? sleepDetails.endTime ? formatParisTime(sleepDetails.endTime) : '-' : context.sleep.average_wake_time ?? '-';
  const awakenings = windowKey === '24h' ? sleepDetails.awakenings : context.sleep.awakenings_count ?? 0;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Détails sommeil</Text>
      <DetailRow label={windowKey === '24h' ? 'Durée' : 'Durée moyenne'} value={formatDuration(duration)} />
      <DetailRow label={windowKey === '24h' ? 'Coucher' : 'Coucher moyen'} value={bed} />
      <DetailRow label={windowKey === '24h' ? 'Réveil' : 'Réveil moyen'} value={wake} />
      <DetailRow label="Réveils nocturnes" value={`${awakenings}`} />
    </View>
  );
}

function WorkoutDetails({ context }: { context: OverviewContext }) {
  const calorieInsight = workoutCalorieInsight(context);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Détails sport</Text>
      <DetailRow label="Sessions" value={`${context.workouts.sessions}`} />
      <DetailRow label="Temps total" value={formatDuration(context.workouts.duration_minutes)} />
      <DetailRow label="Running" value={`${Math.round((context.workouts.running_distance_meters ?? 0) / 100) / 10} km`} />
      {calorieInsight ? <DetailRow label={calorieInsight.label} value={calorieInsight.value} /> : null}
      <DetailRow label="Charge" value={`${context.training_load?.label ?? '-'} · ${context.training_load?.score ?? 0}/100`} />
      <Text style={styles.bodyText}>{context.training_load?.recommendation ?? ''}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function WorkoutHistory({ context }: { context: OverviewContext }) {
  const history = context.workouts.history ?? [];
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Historique sport</Text>
      {context.window === '30d' ? <Text style={styles.muted}>Faire défiler pour voir tout l'historique.</Text> : null}
      {history.length === 0 ? <Text style={styles.empty}>Aucun entraînement sur cette fenêtre.</Text> : null}
      {history.slice(0, context.window === '30d' ? 30 : 12).map((item) => (
        <WorkoutRow key={`${item.start_time}-${item.activity_type}`} item={item} />
      ))}
    </View>
  );
}

function WorkoutRow({ item }: { item: WorkoutHistoryItem }) {
  return (
    <View style={styles.workoutRow}>
      <View style={styles.workoutIcon}>
        <Text style={styles.workoutIconText}>{activityIcon(item.activity_type)}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.workoutDate}>{formatFrenchLongDate(item.date)}</Text>
        <Text style={styles.workoutText}>
          {formatActivityLabel(item.activity_type)} · {formatDuration(item.duration_minutes)}
          {item.activity_type === 'running' && item.distance_meters ? ` · ${Math.round(item.distance_meters / 100) / 10} km` : ''}
        </Text>
      </View>
    </View>
  );
}

function CoachScreen({
  messages,
  input,
  setInput,
  isStreaming,
  coachPhase,
  send
}: {
  messages: CoachChatMessage[];
  input: string;
  setInput: (value: string) => void;
  isStreaming: boolean;
  coachPhase: CoachPhase;
  send: (message?: string) => Promise<void>;
}) {
  const scrollRef = useRef<ScrollView | null>(null);
  const prompts = [
    'Comment optimiser ma récupération ?',
    'Pourquoi je me sens fatigué ?',
    'Comment mieux dormir ?',
    "Puis-je pousser aujourd'hui ?"
  ];
  const visibleMessages = messages.filter((message) => !message.hidden);
  return (
    <View style={styles.coachShell}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {visibleMessages.length === 0 ? (
          <View style={styles.coachWelcomePanel}>
            <Text style={styles.coachWelcomeTitle}>Coach IA</Text>
            <Text style={styles.coachWelcomeText}>Je peux regarder tes données du jour et te répondre simplement, comme dans une conversation.</Text>
          </View>
        ) : null}
        <View style={styles.promptGrid}>
          {prompts.map((prompt) => (
            <Pressable key={prompt} style={styles.promptButton} onPress={() => send(prompt)}>
              <Text style={styles.promptText}>{prompt}</Text>
            </Pressable>
          ))}
        </View>
        {visibleMessages.length === 0 ? <Text style={styles.muted}>Les réponses restent indicatives et ne remplacent pas un avis médical.</Text> : null}
        {visibleMessages.map((message, index) => (
          <ChatBubble
            key={`${message.role}-${index}`}
            message={message}
            loading={shouldShowCoachTyping({
              isLatestAssistant: index === visibleMessages.length - 1 && message.role === 'assistant',
              isStreaming,
              content: message.content
            })}
            loadingLabel={message.loadingLabel ?? (coachPhase === 'waking' ? 'Réveil du modèle IA en cours' : 'Génération de la réponse')}
          />
        ))}
      </ScrollView>
      <View style={styles.chatInputBar}>
        <TextInput value={input} onChangeText={setInput} placeholder="Écris au coach..." style={styles.chatInput} multiline />
        <Pressable disabled={isStreaming || !input.trim()} style={[styles.sendButton, (!input.trim() || isStreaming) && styles.disabledButton]} onPress={() => send()}>
          {isStreaming ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.sendButtonText}>➜</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function ChatBubble({ message, loading, loadingLabel }: { message: CoachChatMessage; loading: boolean; loadingLabel: string }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.chatBubble, isUser ? styles.chatBubbleUser : styles.chatBubbleCoach, loading && styles.chatBubbleLoading]}>
      <Text style={[styles.chatRole, isUser && styles.chatRoleUser]}>{isUser ? 'Vous' : 'Coach'}</Text>
      {loading ? (
        <View style={styles.typingRow}>
          <Text style={[styles.bodyText, styles.typingLabel]} numberOfLines={1}>{coachLoadingLabel(loadingLabel)}</Text>
          <ActivityIndicator size="small" color={theme.colors.brand} style={styles.typingSpinner} />
        </View>
      ) : isUser ? (
        <Text style={styles.chatUserText}>{message.content}</Text>
      ) : (
        <MarkdownText content={message.content} />
      )}
    </View>
  );
}

function MarkdownText({ content }: { content: string }) {
  return (
    <View>
      {parseCoachMarkdown(content).map((block, index) => {
        if (block.type === 'heading') {
          return <Text key={`${block.type}-${index}`} style={styles.markdownHeading}>{block.text}</Text>;
        }
        if (block.type === 'list') {
          return (
            <View key={`${block.type}-${index}`} style={styles.markdownList}>
              {block.items.map((item, itemIndex) => <Text key={`${item}-${itemIndex}`} style={styles.bodyText}>• {item}</Text>)}
            </View>
          );
        }
        return <Text key={`${block.type}-${index}`} style={styles.bodyText}>{block.text}</Text>;
      })}
    </View>
  );
}

function ConfigurationScreen({
  settings,
  apiUrl,
  setApiUrl,
  pairingCode,
  setPairingCode,
  dashboard,
  notificationsEnabled,
  toggleNotifications,
  agentPrompt,
  coachGoals,
  draftCoachGoals,
  draftUserProfile,
  profileSaved,
  setDraftUserProfileField,
  saveCoachProfile,
  setCoachGoalEnabled,
  moveCoachGoal,
  updateCoachGoals,
  nutritionDatasetStatus,
  nutritionDiagnostics,
  nutritionDiagnosticsLoading,
  loadNutritionDiagnostics,
  saveConfiguration,
  clearToken,
  testApi
}: {
  settings: Settings;
  apiUrl: string;
  setApiUrl: (value: string) => void;
  pairingCode: string;
  setPairingCode: (value: string) => void;
  dashboard: DashboardData | null;
  notificationsEnabled: boolean;
  toggleNotifications: (enabled: boolean) => Promise<void>;
  agentPrompt: AgentPrompt | null;
  coachGoals: CoachGoals | null;
  draftCoachGoals: CoachGoal[];
  draftUserProfile: UserProfile;
  profileSaved: boolean;
  setDraftUserProfileField: (key: keyof UserProfile, value: string | UserSex) => void;
  saveCoachProfile: () => Promise<void>;
  setCoachGoalEnabled: (slug: string, enabled: boolean) => void;
  moveCoachGoal: (slug: string, direction: 'up' | 'down') => void;
  updateCoachGoals: () => Promise<void>;
  nutritionDatasetStatus: NutritionDatasetStatus | null;
  nutritionDiagnostics: NutritionDiagnostic | null;
  nutritionDiagnosticsLoading: boolean;
  loadNutritionDiagnostics: () => Promise<void>;
  saveConfiguration: () => Promise<void>;
  clearToken: () => Promise<void>;
  testApi: () => Promise<void>;
}) {
  const sync = formatSyncObservability(dashboard?.sync_summary);
  const enabledGoals = activeCoachGoals(draftCoachGoals);
  const disabledGoals = inactiveCoachGoals(draftCoachGoals);
  const profileButton = profileSaveButtonPresentation(profileSaved);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Notifications</Text>
        <View style={styles.settingRow}>
          <View style={styles.flex}>
            <Text style={styles.metricLabel}>Rappel du matin</Text>
            <Text style={styles.metricDetail}>Tous les jours à 10h30, ouvre directement l'onglet Aujourd'hui.</Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={(value) => {
              void toggleNotifications(value);
            }}
            trackColor={{ false: '#cbd5e1', true: '#93c5fd' }}
            thumbColor={notificationsEnabled ? '#0f4f65' : '#f8fafc'}
          />
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Profil pour le coach</Text>
        <Text style={styles.metricDetail}>Ces infos aident ALIS à contextualiser ses conseils, sans modifier l'identité interne du coach.</Text>
        <Text style={styles.inputLabel}>Prénom</Text>
        <TextInput
          value={draftUserProfile.firstName}
          onChangeText={(value) => setDraftUserProfileField('firstName', value)}
          autoCapitalize="words"
          placeholder="Optionnel"
          style={styles.input}
        />
        <Text style={styles.inputLabel}>Sexe</Text>
        <View style={styles.choiceRow}>
          {[
            ['male', 'Homme'],
            ['female', 'Femme'],
            ['unspecified', 'Non précisé']
          ].map(([value, label]) => (
            <Pressable
              key={value}
              style={[styles.choiceButton, draftUserProfile.sex === value && styles.choiceButtonActive]}
              onPress={() => setDraftUserProfileField('sex', value as UserSex)}
            >
              <Text style={[styles.choiceButtonText, draftUserProfile.sex === value && styles.choiceButtonTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.profileGrid}>
          <View style={styles.profileField}>
            <Text style={styles.inputLabel}>Âge</Text>
            <TextInput
              value={draftUserProfile.age}
              onChangeText={(value) => setDraftUserProfileField('age', value)}
              keyboardType="number-pad"
              placeholder="ans"
              style={styles.input}
            />
          </View>
          <View style={styles.profileField}>
            <Text style={styles.inputLabel}>Poids</Text>
            <TextInput
              value={draftUserProfile.weightKg}
              onChangeText={(value) => setDraftUserProfileField('weightKg', value)}
              keyboardType="decimal-pad"
              placeholder="kg"
              style={styles.input}
            />
          </View>
          <View style={styles.profileField}>
            <Text style={styles.inputLabel}>Taille</Text>
            <TextInput
              value={draftUserProfile.heightCm}
              onChangeText={(value) => setDraftUserProfileField('heightCm', value)}
              keyboardType="number-pad"
              placeholder="cm"
              style={styles.input}
            />
          </View>
        </View>
        <Pressable style={[styles.primaryButton, profileButton.saved && styles.savedProfileButton]} onPress={saveCoachProfile}>
          <Text style={styles.primaryButtonText}>{profileButton.label}</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Identité du coach IA</Text>
        <Text style={styles.metricDetail}>ALIS garde un ton clair, prudent, humain et encourageant. Cette identité est gérée par l'application.</Text>
        <DetailRow label="Identité" value={agentPrompt?.is_default === false ? 'ALIS personnalisée' : 'ALIS par défaut'} />
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Priorités du coach</Text>
        <Text style={styles.metricDetail}>{coachGoals?.is_default ? 'Priorités par défaut actives.' : 'Priorités personnalisées actives.'} Le coach les lit de haut en bas.</Text>
        <View style={styles.goalList}>
          {enabledGoals.map((goal, index) => (
            <View key={goal.slug} style={styles.goalRow}>
              <View style={styles.goalRank}>
                <Text style={styles.goalRankText}>{index + 1}</Text>
              </View>
              <Text style={styles.goalLabel}>{goal.label}</Text>
              <View style={styles.goalActions}>
                <Pressable
                  disabled={index === 0}
                  style={[styles.goalIconButton, index === 0 && styles.disabledButton]}
                  onPress={() => moveCoachGoal(goal.slug, 'up')}
                >
                  <Text style={styles.goalIconText}>↑</Text>
                </Pressable>
                <Pressable
                  disabled={index === enabledGoals.length - 1}
                  style={[styles.goalIconButton, index === enabledGoals.length - 1 && styles.disabledButton]}
                  onPress={() => moveCoachGoal(goal.slug, 'down')}
                >
                  <Text style={styles.goalIconText}>↓</Text>
                </Pressable>
                <Pressable style={styles.removeGoalButton} onPress={() => setCoachGoalEnabled(goal.slug, false)}>
                  <Text style={styles.removeGoalText}>Retirer</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
        {disabledGoals.length > 0 ? (
          <View style={styles.hiddenGoals}>
            <Text style={styles.inputLabel}>Masquées</Text>
            <View style={styles.hiddenGoalGrid}>
              {disabledGoals.map((goal) => (
                <Pressable key={goal.slug} style={styles.hiddenGoalButton} onPress={() => setCoachGoalEnabled(goal.slug, true)}>
                  <Text style={styles.hiddenGoalText}>+ {goal.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <Pressable disabled={draftCoachGoals.length === 0} style={[styles.primaryButton, draftCoachGoals.length === 0 && styles.disabledButton]} onPress={updateCoachGoals}>
          <Text style={styles.primaryButtonText}>Enregistrer les priorités</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Pressable style={styles.advancedHeader} onPress={() => setAdvancedOpen((isOpen) => !isOpen)}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Avancé</Text>
            <Text style={styles.metricDetail}>Connexion, synchronisation et diagnostics.</Text>
          </View>
          <Text style={styles.advancedChevron}>{advancedOpen ? '-' : '+'}</Text>
        </Pressable>
        {advancedOpen ? (
          <View style={styles.advancedContent}>
            <View style={styles.advancedSection}>
              <Text style={styles.advancedSectionTitle}>Connexion API</Text>
              <Text style={styles.inputLabel}>URL API</Text>
              <TextInput value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" autoCorrect={false} style={styles.input} />
              <Text style={styles.inputLabel}>Pairing code</Text>
              <TextInput value={pairingCode} onChangeText={setPairingCode} autoCapitalize="none" autoCorrect={false} style={styles.input} />
              <View style={styles.configButtons}>
                <Pressable style={styles.primaryButton} onPress={saveConfiguration}>
                  <Text style={styles.primaryButtonText}>Enregistrer</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={testApi}>
                  <Text style={styles.secondaryButtonText}>Tester API</Text>
                </Pressable>
              </View>
              <Pressable style={styles.dangerButton} onPress={clearToken}>
                <Text style={styles.dangerButtonText}>Effacer le token</Text>
              </Pressable>
            </View>

            <View style={styles.advancedSection}>
              <Text style={styles.advancedSectionTitle}>État</Text>
              <DetailRow label="Token" value={settings.deviceToken ? 'Présent' : 'Absent'} />
              <DetailRow label="Source" value={dashboard?.source_config.source_badge ?? '-'} />
              <DetailRow label="Dernière synchronisation" value={dashboard?.latest_sync_run?.created_at ? formatParisDateTime(dashboard.latest_sync_run.created_at) : '-'} />
              <DetailRow label="Dernier calcul" value={dashboard?.computed_at ? formatParisDateTime(dashboard.computed_at) : '-'} />
            </View>

            <View style={styles.advancedSection}>
              <Text style={styles.advancedSectionTitle}>Synchronisation</Text>
              <DetailRow label="Dernière manuelle" value={sync.lastManual} />
              <DetailRow label="Dernière arrière-plan" value={sync.lastBackground} />
              <DetailRow label="Prochain passage estimé" value={sync.nextBackground} />
              <DetailRow label="Enregistrements reçus" value={sync.records} />
              <DetailRow label="Runs" value={sync.runs} />
              <DetailRow label="Réseau" value={sync.network} />
              <Text style={sync.latestError === 'Aucune erreur récente' ? styles.muted : styles.errorText}>{sync.latestError}</Text>
            </View>

            <View style={styles.advancedSection}>
              <View style={styles.cardHeaderRow}>
                <View style={styles.flex}>
                  <Text style={styles.advancedSectionTitle}>Nutrition</Text>
                  <Text style={styles.metricDetail}>Sources alimentaires et analyse locale.</Text>
                </View>
                <Pressable
                  style={[styles.secondaryButton, nutritionDiagnosticsLoading && styles.disabledButton]}
                  disabled={nutritionDiagnosticsLoading}
                  onPress={() => {
                    void loadNutritionDiagnostics();
                  }}
                >
                  <Text style={styles.secondaryButtonText}>{nutritionDiagnosticsLoading ? '...' : 'Diagnostic'}</Text>
                </Pressable>
              </View>
              <DetailRow label="CIQUAL" value={nutritionDatasetStatus?.ciqual_loaded ? 'Présent' : '-'} />
              <DetailRow label="Open Food Facts" value={nutritionDatasetStatus?.openfoodfacts_loaded ? 'Présent' : '-'} />
              <DetailRow label="Références" value={nutritionDatasetStatus?.total_references != null ? `${nutritionDatasetStatus.total_references}` : '-'} />
              <DetailRow label="Ollama" value={nutritionDiagnostics?.ollama.reachable ? 'OK' : '-'} />
              <DetailRow label="Jobs" value={nutritionDiagnostics ? `${nutritionDiagnostics.jobs.pending} attente · ${nutritionDiagnostics.jobs.running} cours · ${nutritionDiagnostics.jobs.failed} erreur` : '-'} />
              {nutritionDiagnostics?.ollama.error_message ? <Text style={styles.errorText}>{nutritionDiagnostics.ollama.error_message}</Text> : null}
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <View style={styles.loadingState}>
      <ActivityIndicator color="#0f4f65" />
      <Text style={styles.bodyText}>{label}</Text>
    </View>
  );
}

function ErrorState({ message, apiUrl, onRetry, onConfig }: { message: string; apiUrl: string; onRetry: () => void; onConfig: () => void }) {
  return (
    <View style={styles.errorState}>
      <Text style={styles.eyebrow}>Connexion indisponible</Text>
      <Text style={styles.cardTitle}>Impossible de charger ALIS</Text>
      <Text style={styles.bodyText}>{message}</Text>
      <Text style={styles.muted}>API configuree : {apiUrl}</Text>
      <View style={styles.configButtons}>
        <Pressable style={styles.primaryButton} onPress={onRetry}>
          <Text style={styles.primaryButtonText}>Réessayer</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={onConfig}>
          <Text style={styles.secondaryButtonText}>Configuration</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  keyboard: {
    flex: 1
  },
  shell: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 8
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    marginBottom: 10
  },
  headerTitleBlock: {
    flexShrink: 1,
    minWidth: 0
  },
  eyebrow: {
    color: theme.colors.brandAlt,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase'
  },
  title: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 30
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 20,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    justifyContent: 'flex-end'
  },
  statusText: {
    color: '#475569',
    fontSize: 12,
    flexShrink: 1,
    textAlign: 'right'
  },
  contentArea: {
    flex: 1
  },
  tabPane: {
    flex: 1
  },
  tabPaneHidden: {
    display: 'none'
  },
  bottomTabs: {
    flexDirection: 'row',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbe5ee',
    backgroundColor: '#ffffff',
    padding: 6,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8
  },
  tabButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2
  },
  tabButtonActive: {
    backgroundColor: theme.colors.brand
  },
  tabIcon: {
    color: '#64748b',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 20
  },
  tabText: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '900'
  },
  tabTextActive: {
    color: '#ffffff'
  },
  scrollContent: {
    paddingBottom: 18
  },
  stack: {
    gap: 12,
    width: '100%',
    alignSelf: 'stretch'
  },
  sortableGridWrap: {
    width: '100%',
    alignSelf: 'stretch'
  },
  dashboardBlockShell: {
    width: '100%',
    alignSelf: 'stretch',
    gap: 6
  },
  sortableDropIndicator: {
    minHeight: 56,
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#0f766e',
    backgroundColor: '#e8f5f2'
  },
  dashboardBlockShellEditing: {
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.brand,
    padding: 5,
    backgroundColor: '#f8fafc'
  },
  dashboardBlockLifted: {
    zIndex: 5,
    shadowColor: '#0f172a',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5
  },
  reorderBar: {
    minHeight: 36,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.brand,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  reorderHint: {
    color: theme.colors.surface,
    fontSize: 12,
    fontWeight: '900',
    flex: 1
  },
  reorderControls: {
    flexDirection: 'row',
    gap: 6
  },
  reorderButton: {
    width: 32,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)'
  },
  reorderButtonText: {
    color: theme.colors.surface,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 20
  },
  reorderDoneButton: {
    minWidth: 36,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface
  },
  reorderDoneText: {
    color: theme.colors.brand,
    fontSize: 12,
    fontWeight: '900'
  },
  segmented: {
    flexDirection: 'row',
    gap: 8
  },
  segmentButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center'
  },
  segmentButtonActive: {
    backgroundColor: theme.colors.brand,
    borderColor: theme.colors.brand
  },
  segmentText: {
    color: theme.colors.textSoft,
    fontWeight: '800'
  },
  segmentTextActive: {
    color: theme.colors.surface
  },
  card: {
    width: '100%',
    alignSelf: 'stretch',
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    gap: 10
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900'
  },
  syncCard: {
    width: '100%',
    alignSelf: 'stretch',
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderLeftWidth: 4,
    padding: 12,
    gap: 8,
    backgroundColor: theme.colors.surface
  },
  syncCard_success: {
    borderColor: theme.colors.success,
    backgroundColor: theme.colors.successSoft
  },
  syncCard_warning: {
    borderColor: theme.colors.warning,
    backgroundColor: theme.colors.warningSoft
  },
  syncCard_danger: {
    borderColor: theme.colors.danger,
    backgroundColor: theme.colors.dangerSoft
  },
  syncFreshnessRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8
  },
  syncMoment: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '900'
  },
  syncMoment_success: {
    color: theme.colors.success
  },
  syncMoment_warning: {
    color: theme.colors.warning
  },
  syncMoment_danger: {
    color: theme.colors.danger
  },
  syncFreshnessPill: {
    borderRadius: theme.radii.pill,
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '900'
  },
  syncFreshnessPill_success: {
    color: theme.colors.success,
    backgroundColor: '#dcfce7'
  },
  syncFreshnessPill_warning: {
    color: theme.colors.warning,
    backgroundColor: '#fef3c7'
  },
  syncFreshnessPill_danger: {
    color: theme.colors.danger,
    backgroundColor: '#fee2e2'
  },
  bodyText: {
    color: theme.colors.textSoft,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1
  },
  morningCard: {
    borderRadius: theme.radii.md,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.info,
    backgroundColor: theme.colors.infoSoft,
    padding: 13,
    gap: 4
  },
  morningCardWarning: {
    borderLeftColor: theme.colors.warning,
    backgroundColor: theme.colors.warningSoft
  },
  morningTitle: {
    color: theme.colors.info,
    fontWeight: '900'
  },
  morningText: {
    color: theme.colors.info,
    lineHeight: 19
  },
  scoreRow: {
    flexDirection: 'row',
    gap: 10
  },
  scoreItem: {
    flex: 1,
    alignItems: 'center',
    gap: 7,
    position: 'relative'
  },
  scorePanelInfoButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center'
  },
  scoreInfoText: {
    color: theme.colors.brand,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 16
  },
  scoreRing: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center'
  },
  scoreValue: {
    position: 'absolute',
    fontWeight: '900',
    fontSize: 16
  },
  scoreLabel: {
    color: theme.colors.textSoft,
    fontWeight: '800',
    textAlign: 'center',
    fontSize: 12
  },
  scoreMeta: {
    color: theme.colors.muted,
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 13
  },
  dailyCoachButton: {
    width: '100%',
    alignSelf: 'stretch',
    minHeight: 66,
    borderRadius: theme.radii.md,
    backgroundColor: '#102a3a',
    borderWidth: 1,
    borderColor: '#60d8c4',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#0f4f65',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4
  },
  dailyCoachIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radii.pill,
    backgroundColor: '#b7fff0',
    alignItems: 'center',
    justifyContent: 'center'
  },
  dailyCoachIconText: {
    color: '#0f4f65',
    fontSize: 23,
    fontWeight: '900',
    lineHeight: 26
  },
  dailyCoachText: {
    color: theme.colors.surface,
    fontSize: 17,
    fontWeight: '900',
    flex: 1,
    lineHeight: 22
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  flex: {
    flex: 1
  },
  secondaryButton: {
    minHeight: 40,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14
  },
  secondaryButtonText: {
    color: theme.colors.brand,
    fontWeight: '900'
  },
  primaryButton: {
    minHeight: 42,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14
  },
  primaryButtonText: {
    color: theme.colors.surface,
    fontWeight: '900'
  },
  syncActionButton: {
    minHeight: 38,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  dangerButton: {
    minHeight: 42,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dangerButtonText: {
    color: theme.colors.danger,
    fontWeight: '900'
  },
  todayGrid: {
    gap: 10
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  nutritionFocusRow: {
    flexDirection: 'row',
    gap: 10
  },
  nutritionEnergyValue: {
    color: '#0f172a',
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 25
  },
  metricTile: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 92,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    justifyContent: 'space-between'
  },
  metricLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800'
  },
  metricValue: {
    color: '#0f172a',
    fontSize: 24,
    fontWeight: '900'
  },
  metricDetail: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 16
  },
  tone_danger: {
    color: '#b91c1c'
  },
  tone_warning: {
    color: '#d97706'
  },
  tone_success: {
    color: '#16a34a'
  },
  tone_info: {
    color: '#0891b2'
  },
  chartWrap: {
    alignItems: 'center',
    gap: 2
  },
  chartHint: {
    color: '#64748b',
    fontSize: 12
  },
  chartQualityHint: {
    color: '#0f766e',
    fontSize: 11
  },
  biometricCardLarge: {
    paddingVertical: 16
  },
  biometricSampleCount: {
    minWidth: 40,
    borderRadius: theme.radii.pill,
    overflow: 'hidden',
    backgroundColor: '#ecfeff',
    color: '#0891b2',
    fontSize: 12,
    fontWeight: '900',
    paddingHorizontal: 9,
    paddingVertical: 4,
    textAlign: 'center'
  },
  biometricStatsRow: {
    flexDirection: 'row',
    gap: 8
  },
  biometricStat: {
    flex: 1,
    minHeight: 72,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 10,
    justifyContent: 'space-between'
  },
  biometricStatLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800'
  },
  biometricStatValue: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '900'
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 4
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  detailLabel: {
    color: '#64748b',
    fontWeight: '700',
    flexShrink: 1,
    minWidth: 0
  },
  detailValue: {
    color: '#0f172a',
    fontWeight: '900',
    flexShrink: 1,
    maxWidth: '58%',
    minWidth: 0,
    textAlign: 'right'
  },
  muted: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 19
  },
  empty: {
    color: '#64748b',
    fontStyle: 'italic'
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19
  },
  workoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#edf2f7'
  },
  workoutIcon: {
    width: 48,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#eef6f8',
    alignItems: 'center',
    justifyContent: 'center'
  },
  workoutIconText: {
    color: '#0f4f65',
    fontSize: 11,
    fontWeight: '900'
  },
  workoutDate: {
    color: '#0f172a',
    fontWeight: '900'
  },
  workoutText: {
    color: '#475569'
  },
  coachShell: {
    flex: 1
  },
  coachWelcomePanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b8ebe0',
    backgroundColor: '#ecfdf8',
    padding: 14,
    gap: 6,
    marginBottom: 12
  },
  coachWelcomeTitle: {
    color: '#0f4f65',
    fontSize: 18,
    fontWeight: '900'
  },
  coachWelcomeText: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 20
  },
  promptGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10
  },
  promptButton: {
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe5ee',
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  promptText: {
    color: '#0f4f65',
    fontWeight: '800'
  },
  chatBubble: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    maxWidth: '88%'
  },
  chatBubbleUser: {
    backgroundColor: '#0f4f65',
    borderColor: '#0f4f65',
    alignSelf: 'flex-end'
  },
  chatBubbleCoach: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe5ee',
    alignSelf: 'flex-start'
  },
  chatBubbleLoading: {
    minWidth: 230
  },
  chatRole: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 5
  },
  chatRoleUser: {
    color: '#bfe3ec'
  },
  chatUserText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700'
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    maxWidth: '100%',
    minHeight: 32
  },
  typingLabel: {
    flex: 1,
    minWidth: 0,
    color: '#475569',
    fontWeight: '700'
  },
  typingSpinner: {
    flexShrink: 0
  },
  markdownHeading: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 4,
    marginBottom: 4
  },
  markdownList: {
    gap: 3,
    marginVertical: 4
  },
  chatInputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#dbe5ee',
    backgroundColor: theme.colors.background
  },
  chatInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#0f172a'
  },
  sendButton: {
    width: 44,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: '#0f4f65',
    justifyContent: 'center',
    alignItems: 'center'
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 22,
    textAlign: 'center',
    includeFontPadding: false
  },
  disabledButton: {
    opacity: 0.5
  },
  savedProfileButton: {
    backgroundColor: '#16a34a'
  },
  inputLabel: {
    color: '#64748b',
    fontWeight: '800',
    marginTop: 4
  },
  input: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    color: '#0f172a'
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  choiceButton: {
    flexGrow: 1,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  choiceButtonActive: {
    borderColor: '#0f4f65',
    backgroundColor: '#e8f5f2'
  },
  choiceButtonText: {
    color: '#475569',
    fontWeight: '900'
  },
  choiceButtonTextActive: {
    color: '#0f4f65'
  },
  profileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  profileField: {
    minWidth: '30%',
    flexGrow: 1
  },
  goalList: {
    gap: 8
  },
  goalRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#dbe5ee',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 10
  },
  goalRank: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f4f65'
  },
  goalRankText: {
    color: '#ffffff',
    fontWeight: '900'
  },
  goalLabel: {
    flex: 1,
    minWidth: 0,
    color: '#0f172a',
    fontWeight: '900'
  },
  goalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  goalIconButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc'
  },
  goalIconText: {
    color: '#0f4f65',
    fontSize: 16,
    fontWeight: '900',
    includeFontPadding: false
  },
  removeGoalButton: {
    minHeight: 30,
    borderRadius: 8,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2'
  },
  removeGoalText: {
    color: '#b91c1c',
    fontWeight: '900',
    fontSize: 12
  },
  hiddenGoals: {
    gap: 8
  },
  hiddenGoalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  hiddenGoalButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  hiddenGoalText: {
    color: '#475569',
    fontWeight: '800'
  },
  advancedHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  advancedChevron: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
    backgroundColor: '#f1f5f9',
    color: '#0f4f65',
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 32,
    textAlign: 'center'
  },
  advancedContent: {
    gap: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0'
  },
  advancedSection: {
    gap: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f7'
  },
  advancedSectionTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '900'
  },
  configButtons: {
    flexDirection: 'row',
    gap: 8
  },
  loadingState: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12
  },
  errorState: {
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fff7f7',
    borderRadius: 10,
    padding: 18,
    gap: 10
  }
});
