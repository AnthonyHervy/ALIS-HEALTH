import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import { cleanBaseUrl, createNutritionApiClient } from './api';
import { DEFAULT_API_BASE_URL, DEFAULT_PAIRING_CODE } from './config';
import { notifyMealReady } from './notifications';
import { theme } from '../theme';
import {
  alisImpactLabel,
  analysisProgress,
  analysisStageRows,
  appendPhotos,
  buildJournalDaySections,
  buildReadyNotifications,
  confidenceInsight,
  MAX_PHOTOS_PER_MEAL,
  mealNextActionLabel,
  mealStatusLabel,
  mergeSelectedMeal,
  removePhoto,
  shouldRunNutritionPolling,
  toggleDraftIncluded,
  updateDraftPortion
} from './nutritionState';
import { loadLearnedFoodReferences, loadSettings, rememberFoodReference, saveSettings } from './storage';
import type { AppLanguage } from '../i18n';
import type {
  LocalPhoto,
  NutritionFoodReference,
  NutritionMeal,
  NutritionMealEdit,
  NutritionMealItem,
  Settings
} from './types';

type Screen = 'journal' | 'add' | 'review';
const FALLBACK_SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 }
};
const MEAL_TYPE_OPTIONS = [
  { key: 'breakfast' },
  { key: 'lunch' },
  { key: 'dinner' },
  { key: 'snack' }
] as const;
type MealTypeKey = (typeof MEAL_TYPE_OPTIONS)[number]['key'];
type NutritionCopyKey = keyof typeof nutritionCopy.fr;

const nutritionCopy = {
  fr: {
    addMeal: 'Ajouter un repas',
    journal: 'Journal',
    review: 'Revue',
    loadingJournal: 'Chargement du journal...',
    readyToCheck: 'Analyse prête à vérifier',
    readyCorrectionRequired: 'Analyse prête, correction requise',
    analysisErrorRetry: 'Analyse en erreur, relance possible',
    mealsInJournal: 'repas dans le journal',
    journalUnavailable: 'Journal indisponible',
    refreshImpossible: 'Actualisation impossible',
    noRecoveredPhoto: 'Aucune photo récupérée',
    recoveryUnavailable: 'Récupération photo indisponible',
    photoLimit: 'Limite de 8 photos atteinte',
    cameraUnavailable: 'Caméra indisponible',
    cameraPermissionNeeded: 'La permission caméra est nécessaire pour prendre une photo.',
    cameraPermissionDenied: 'Permission caméra refusée',
    noPhotoTaken: 'Aucune photo prise',
    cameraLaunchImpossible: 'Impossible de lancer la caméra.',
    noPhotoSelected: 'Aucune photo sélectionnée',
    galleryUnavailable: 'Galerie indisponible',
    galleryOpenImpossible: 'Impossible d’ouvrir la galerie.',
    addOnePhotoTitle: 'Ajoute au moins une photo',
    addOnePhotoBody: 'Photographie le repas, un emballage, une étiquette ou un code-barres visible.',
    sendingMeal: 'Envoi du repas...',
    localAnalysisStarted: 'Analyse lancée en local',
    sendImpossible: 'Envoi impossible',
    mealUnavailable: 'Repas indisponible',
    refreshingMeal: 'Actualisation du repas...',
    stillAnalyzing: 'Analyse toujours en cours',
    mealRecalculated: 'Repas recalculé',
    correctionImpossible: 'Correction impossible',
    mealValidated: 'Repas validé dans ALIS',
    validationImpossible: 'Validation impossible',
    localAnalysisRelaunched: 'Analyse relancée en local',
    reanalysisImpossible: "Relance de l'analyse impossible",
    mealDeleted: 'Repas supprimé',
    deletionImpossible: 'Suppression impossible',
    searchTooShort: 'Recherche trop courte',
    referencesFound: 'référence(s) trouvée(s)',
    nutritionSearchUnavailable: 'Recherche nutrition indisponible',
    foodMatched: 'Aliment associé à une source nutritionnelle',
    matchImpossible: 'Association impossible',
    noMealsTitle: 'Aucun repas analysé',
    noMealsBody: 'Ajoute plusieurs photos d’un repas, d’un emballage ou d’une étiquette.',
    validatedKcal: 'kcal validées',
    pendingMeals: 'repas à traiter',
    allUpToDate: 'Tout est à jour',
    validatedToday: 'kcal validées aujourd’hui',
    meal: 'Repas',
    delete: 'Supprimer',
    mealType: 'Type de repas',
    takePhoto: 'Prendre une photo',
    takePhotoHint: 'Ajoute le repas, puis reviens prendre l’emballage, l’étiquette ou le code-barres.',
    choosePhotos: 'Choisir des photos',
    choosePhotosHint: 'Sélection multiple depuis la galerie.',
    aiHints: "Indications pour l'IA",
    notesPlaceholder: 'Ex. riz, poulet, sauce creme, portion partagee...',
    barcodePlaceholder: 'Code-barres optionnel',
    aiHintsBody: "Utile si l'emballage n'est pas lisible ou si tu veux préciser un aliment.",
    selectedPhotos: 'photo(s) sélectionnée(s)',
    addPhotoHint: 'Ajoute au moins une photo pour lancer l’analyse.',
    photosReadyTitle: "Photos prêtes pour l'analyse locale",
    photosReadyBody: 'Ajoute le repas, un emballage, une étiquette ou un code-barres visible.',
    remove: 'Retirer',
    uploading: 'Envoi...',
    launchAnalysis: "Lancer l'analyse",
    noMealReviewTitle: 'Aucun repas à revoir',
    noMealReviewBody: 'Ajoute d’abord des photos ou ouvre un repas existant depuis le journal.',
    viewJournal: 'Voir le journal',
    backToJournal: 'Retour au journal',
    mealStudy: 'Étude du repas',
    step: 'Étape',
    autoUpdateHint: 'Tu peux revenir au journal, Nutrition se mettra à jour automatiquement.',
    refreshing: 'Actualisation...',
    refreshNow: 'Actualiser maintenant',
    rerunAnalysis: "Relancer l'analyse",
    deleteMeal: 'Supprimer ce repas',
    fixSourcesWarning: 'Corrige ou retire les aliments sans source fiable avant validation.',
    recalculate: 'Recalculer',
    validateInAlis: 'Valider dans ALIS',
    model: 'Modèle',
    sources: 'Sources',
    barcodeSeen: 'Code-barres vu',
    guidedReview: 'Revue guidée',
    reviewChecklist: 'Checklist revue',
    nutritionSources: 'Sources nutritionnelles',
    portions: 'Portions',
    missingSource: 'Source manquante',
    needsFix: 'À corriger',
    included: 'Inclus',
    removed: 'Retiré',
    fixFoodSource: 'Associe une source nutritionnelle ou retire cet aliment.',
    removeFood: 'Retirer cet aliment',
    quickSuggestions: 'Propositions rapides',
    learned: 'Appris',
    reuse: 'Réutiliser',
    searchFoodPlaceholder: 'Chercher CIQUAL ou Open Food Facts',
    search: 'Chercher',
    noSourceFound: 'Aucune source trouvée',
    genericSearchHint: 'Essaie un nom plus générique ou retire cet aliment.',
    bestMatch: 'Meilleur match',
    choose: 'Choisir',
    caloriesPending: 'Calories en attente',
    unknown: 'inconnu',
    jobQueued: 'en file d’attente',
    jobRunning: 'en cours',
    jobCompleted: 'terminé',
    jobFailed: 'échec'
  },
  en: {
    addMeal: 'Add meal',
    journal: 'Journal',
    review: 'Review',
    loadingJournal: 'Loading journal...',
    readyToCheck: 'Analysis ready to check',
    readyCorrectionRequired: 'Analysis ready, correction required',
    analysisErrorRetry: 'Analysis error, retry available',
    mealsInJournal: 'meals in the journal',
    journalUnavailable: 'Journal unavailable',
    refreshImpossible: 'Refresh failed',
    noRecoveredPhoto: 'No recovered photo',
    recoveryUnavailable: 'Photo recovery unavailable',
    photoLimit: '8-photo limit reached',
    cameraUnavailable: 'Camera unavailable',
    cameraPermissionNeeded: 'Camera permission is required to take a photo.',
    cameraPermissionDenied: 'Camera permission denied',
    noPhotoTaken: 'No photo taken',
    cameraLaunchImpossible: 'Unable to open the camera.',
    noPhotoSelected: 'No photo selected',
    galleryUnavailable: 'Gallery unavailable',
    galleryOpenImpossible: 'Unable to open the gallery.',
    addOnePhotoTitle: 'Add at least one photo',
    addOnePhotoBody: 'Photograph the meal, packaging, a label or a visible barcode.',
    sendingMeal: 'Sending meal...',
    localAnalysisStarted: 'Local analysis started',
    sendImpossible: 'Upload failed',
    mealUnavailable: 'Meal unavailable',
    refreshingMeal: 'Refreshing meal...',
    stillAnalyzing: 'Analysis still in progress',
    mealRecalculated: 'Meal recalculated',
    correctionImpossible: 'Correction failed',
    mealValidated: 'Meal validated in ALIS',
    validationImpossible: 'Validation failed',
    localAnalysisRelaunched: 'Local analysis restarted',
    reanalysisImpossible: 'Unable to rerun analysis',
    mealDeleted: 'Meal deleted',
    deletionImpossible: 'Deletion failed',
    searchTooShort: 'Search is too short',
    referencesFound: 'reference(s) found',
    nutritionSearchUnavailable: 'Nutrition search unavailable',
    foodMatched: 'Food linked to a nutrition source',
    matchImpossible: 'Association failed',
    noMealsTitle: 'No analyzed meal',
    noMealsBody: 'Add several photos of a meal, packaging or a label.',
    validatedKcal: 'validated kcal',
    pendingMeals: 'meals to process',
    allUpToDate: 'Everything is up to date',
    validatedToday: 'validated kcal today',
    meal: 'Meal',
    delete: 'Delete',
    mealType: 'Meal type',
    takePhoto: 'Take a photo',
    takePhotoHint: 'Add the meal, then come back for packaging, the label or barcode.',
    choosePhotos: 'Choose photos',
    choosePhotosHint: 'Multiple selection from your gallery.',
    aiHints: 'Notes for AI',
    notesPlaceholder: 'E.g. rice, chicken, cream sauce, shared portion...',
    barcodePlaceholder: 'Optional barcode',
    aiHintsBody: 'Useful if the packaging is unreadable or you want to clarify a food item.',
    selectedPhotos: 'selected photo(s)',
    addPhotoHint: 'Add at least one photo to start analysis.',
    photosReadyTitle: 'Photos ready for local analysis',
    photosReadyBody: 'Add the meal, packaging, a label or a visible barcode.',
    remove: 'Remove',
    uploading: 'Uploading...',
    launchAnalysis: 'Start analysis',
    noMealReviewTitle: 'No meal to review',
    noMealReviewBody: 'Add photos first or open an existing meal from the journal.',
    viewJournal: 'View journal',
    backToJournal: 'Back to journal',
    mealStudy: 'Meal review',
    step: 'Step',
    autoUpdateHint: 'You can return to the journal; Nutrition will update automatically.',
    refreshing: 'Refreshing...',
    refreshNow: 'Refresh now',
    rerunAnalysis: 'Rerun analysis',
    deleteMeal: 'Delete this meal',
    fixSourcesWarning: 'Fix or remove foods without a reliable source before validation.',
    recalculate: 'Recalculate',
    validateInAlis: 'Validate in ALIS',
    model: 'Model',
    sources: 'Sources',
    barcodeSeen: 'Barcode seen',
    guidedReview: 'Guided review',
    reviewChecklist: 'Review checklist',
    nutritionSources: 'Nutrition sources',
    portions: 'Portions',
    missingSource: 'Missing source',
    needsFix: 'To fix',
    included: 'Included',
    removed: 'Removed',
    fixFoodSource: 'Link a nutrition source or remove this food.',
    removeFood: 'Remove this food',
    quickSuggestions: 'Quick suggestions',
    learned: 'Learned',
    reuse: 'Reuse',
    searchFoodPlaceholder: 'Search CIQUAL or Open Food Facts',
    search: 'Search',
    noSourceFound: 'No source found',
    genericSearchHint: 'Try a more generic name or remove this food.',
    bestMatch: 'Best match',
    choose: 'Choose',
    caloriesPending: 'Calories pending',
    unknown: 'unknown',
    jobQueued: 'queued',
    jobRunning: 'running',
    jobCompleted: 'completed',
    jobFailed: 'failed'
  }
} as const;

function t(language: AppLanguage, key: NutritionCopyKey): string {
  return nutritionCopy[language][key];
}

const api = createNutritionApiClient({
  fetchImpl: ((input, init) => fetch(input, init)) as typeof fetch
});

function photoFromAsset(asset: ImagePicker.ImagePickerAsset): LocalPhoto {
  const name = asset.fileName || asset.uri.split('/').pop() || `meal-${Date.now()}.jpg`;
  return {
    uri: asset.uri,
    name,
    type: asset.mimeType || 'image/jpeg'
  };
}

function photosFromPickerResult(result: ImagePicker.ImagePickerResult): LocalPhoto[] {
  if (result.canceled || !Array.isArray(result.assets)) {
    return [];
  }
  return result.assets.map(photoFromAsset);
}

function isPickerResult(
  result: ImagePicker.ImagePickerResult | ImagePicker.ImagePickerErrorResult
): result is ImagePicker.ImagePickerResult {
  return 'canceled' in result;
}

function mealTypeOptionLabel(key: MealTypeKey, language: AppLanguage): string {
  const labels: Record<MealTypeKey, Record<AppLanguage, string>> = {
    breakfast: { fr: 'Petit-déj', en: 'Breakfast' },
    lunch: { fr: 'Déjeuner', en: 'Lunch' },
    dinner: { fr: 'Dîner', en: 'Dinner' },
    snack: { fr: 'Collation', en: 'Snack' }
  };
  return labels[key][language];
}

function formatKcal(meal: NutritionMeal, language: AppLanguage): string {
  if (typeof meal.kcal_min === 'number' && typeof meal.kcal_max === 'number') {
    return `${Math.round(meal.kcal_min)}-${Math.round(meal.kcal_max)} kcal`;
  }
  if (typeof meal.energy_kcal === 'number') {
    return `${Math.round(meal.energy_kcal)} kcal`;
  }
  return t(language, 'caloriesPending');
}

function formatMacros(meal: NutritionMeal, language: AppLanguage): string {
  const protein = Math.round(meal.protein_g || 0);
  const carbs = Math.round(meal.carbohydrates_g || 0);
  const fat = Math.round(meal.fat_g || 0);
  return language === 'en' ? `P ${protein} g · C ${carbs} g · F ${fat} g` : `P ${protein} g · G ${carbs} g · L ${fat} g`;
}

function sourceLabel(source: string | null | undefined, language: AppLanguage): string {
  if (source === 'ciqual') {
    return 'CIQUAL';
  }
  if (source === 'openfoodfacts') {
    return 'Open Food Facts';
  }
  return source || t(language, 'missingSource');
}

function mealTypeLabel(mealType: string | null | undefined, language: AppLanguage): string | null {
  if (!mealType) {
    return null;
  }
  const match = MEAL_TYPE_OPTIONS.find((option) => option.key === mealType);
  return match ? mealTypeOptionLabel(match.key, language) : mealType;
}

function formatDatasetVersions(datasetVersions: Record<string, string> | null | undefined, language: AppLanguage): string | null {
  const entries = Object.entries(datasetVersions ?? {});
  if (!entries.length) {
    return null;
  }
  return entries.map(([source, version]) => `${sourceLabel(source, language)} ${version}`).join(' · ');
}

function barcodeCandidates(meal: NutritionMeal): string[] {
  const rawCandidates = meal.source_trace?.barcode_candidates;
  if (!Array.isArray(rawCandidates)) {
    return [];
  }
  return rawCandidates.map((candidate) => String(candidate).trim()).filter(Boolean);
}

function analysisJobLabel(status: string | null | undefined, language: AppLanguage): string {
  switch (status) {
    case 'pending':
      return t(language, 'jobQueued');
    case 'running':
      return t(language, 'jobRunning');
    case 'completed':
      return t(language, 'jobCompleted');
    case 'failed':
      return t(language, 'jobFailed');
    default:
      return status || t(language, 'unknown');
  }
}

function analysisJobText(meal: NutritionMeal, language: AppLanguage): string | null {
  const job = meal.analysis_job;
  if (!job) {
    return null;
  }
  return `Job · ${analysisJobLabel(job.status, language)} · ${language === 'en' ? 'attempt' : 'tentative'} ${job.attempts}`;
}

export default function App({ embedded = false, active = true, language = 'fr' }: { embedded?: boolean; active?: boolean; language?: AppLanguage }) {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_SAFE_AREA_METRICS}>
      <NutritionApp embedded={embedded} active={active} language={language} />
    </SafeAreaProvider>
  );
}

function NutritionApp({ embedded, active, language }: { embedded: boolean; active: boolean; language: AppLanguage }) {
  const [settings, setSettings] = useState<Settings>({
    apiBaseUrl: DEFAULT_API_BASE_URL,
    pairingCode: DEFAULT_PAIRING_CODE,
    deviceToken: null
  });
  const [meals, setMeals] = useState<NutritionMeal[]>([]);
  const [selectedMeal, setSelectedMeal] = useState<NutritionMeal | null>(null);
  const [screen, setScreen] = useState<Screen>('journal');
  const [selectedPhotos, setSelectedPhotos] = useState<LocalPhoto[]>([]);
  const [selectedMealType, setSelectedMealType] = useState<MealTypeKey>('lunch');
  const [mealNotes, setMealNotes] = useState('');
  const [barcodeHint, setBarcodeHint] = useState('');
  const [edits, setEdits] = useState<NutritionMealEdit[]>([]);
  const [foodSearchTerms, setFoodSearchTerms] = useState<Record<string, string>>({});
  const [foodSearchResults, setFoodSearchResults] = useState<Record<string, NutritionFoodReference[]>>({});
  const [foodSearchCompleted, setFoodSearchCompleted] = useState<Record<string, boolean>>({});
  const [autoSearchKeys, setAutoSearchKeys] = useState<Record<string, boolean>>({});
  const [learnedFoodReferences, setLearnedFoodReferences] = useState<Record<string, NutritionFoodReference[]>>({});
  const [status, setStatus] = useState(language === 'en' ? 'Initializing Nutrition...' : 'Initialisation Nutrition...');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [refreshingMeal, setRefreshingMeal] = useState(false);
  const [searchingFood, setSearchingFood] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const previousMealsRef = useRef<NutritionMeal[]>([]);
  const selectedMealRef = useRef<NutritionMeal | null>(null);
  const hasLoadedRef = useRef(false);

  const sortedMeals = useMemo(
    () => [...meals].sort((a, b) => String(b.consumed_at || '').localeCompare(String(a.consumed_at || ''))),
    [meals]
  );
  const reviewFallbackMeal = useMemo(
    () =>
      selectedMeal ||
      sortedMeals.find((meal) => meal.status === 'ready' || meal.status === 'needs_review' || meal.status === 'error') ||
      sortedMeals[0] ||
      null,
    [selectedMeal, sortedMeals]
  );

  useEffect(() => {
    if (!active || hasLoadedRef.current) {
      return;
    }
    setLoading(true);
    loadSettings()
      .then(async (loaded) => {
        setSettings(loaded);
        await recoverPendingPickerResults();
        await loadMealList(loaded, false);
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : language === 'en' ? 'Configuration unavailable' : 'Configuration indisponible'))
      .finally(() => {
        hasLoadedRef.current = true;
        setHasLoaded(true);
        setLoading(false);
      });
  }, [active]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && hasLoadedRef.current) {
        void recoverPendingPickerResults();
      }
    });
    return () => subscription.remove();
  }, [active]);

  useEffect(() => {
    if (!shouldRunNutritionPolling(active, hasLoaded)) {
      return undefined;
    }
    const timer = setInterval(() => {
      void loadMealList(settings, true).catch(() => undefined);
    }, 8000);
    return () => clearInterval(timer);
  }, [active, hasLoaded, settings.apiBaseUrl, settings.pairingCode, settings.deviceToken]);

  useEffect(() => {
    selectedMealRef.current = selectedMeal;
  }, [selectedMeal]);

  useEffect(() => {
    if (!selectedMeal || searchingFood) {
      return;
    }
    if (selectedMeal.status === 'uploading' || selectedMeal.status === 'analyzing' || selectedMeal.status === 'error') {
      return;
    }
    const item = (selectedMeal.items ?? []).find((mealItem) => {
      const key = `${selectedMeal.id}:${mealItem.id}`;
      const query = (foodSearchTerms[mealItem.id] || mealItem.detected_name || mealItem.name || '').trim();
      return (
        mealItem.included &&
        !mealItem.source &&
        query.length >= 2 &&
        !autoSearchKeys[key] &&
        !foodSearchCompleted[mealItem.id] &&
        (foodSearchResults[mealItem.id] ?? []).length === 0
      );
    });
    if (!item) {
      return;
    }
    const key = `${selectedMeal.id}:${item.id}`;
    setAutoSearchKeys((current) => ({ ...current, [key]: true }));
    void searchFoodReferences(item.id);
  }, [autoSearchKeys, foodSearchCompleted, foodSearchResults, foodSearchTerms, searchingFood, selectedMeal]);

  async function persistSettings(next: Partial<Settings>, base = settings) {
    const merged = { ...base, ...next };
    setSettings(merged);
    await saveSettings(next);
    return merged;
  }

  async function loadMealList(nextSettings = settings, quiet = false) {
    if (!quiet) {
      setStatus(t(language, 'loadingJournal'));
    }
    try {
      const result = await api.listMeals(nextSettings, async (next) => {
        await persistSettings(next, nextSettings);
      });
      const readyIds = previousMealsRef.current.length
        ? buildReadyNotifications(previousMealsRef.current, result.meals)
        : [];
      previousMealsRef.current = result.meals;
      setMeals(result.meals);
      const currentSelected = selectedMealRef.current;
      const mergedSelected = mergeSelectedMeal(currentSelected, result.meals);
      selectedMealRef.current = mergedSelected;
      setSelectedMeal(mergedSelected);
      if (quiet && currentSelected && mergedSelected && currentSelected.id === mergedSelected.id) {
        if (currentSelected.status === 'analyzing' && mergedSelected.status === 'ready') {
          setStatus(t(language, 'readyToCheck'));
        } else if (currentSelected.status === 'analyzing' && mergedSelected.status === 'needs_review') {
          setStatus(t(language, 'readyCorrectionRequired'));
        } else if (currentSelected.status === 'analyzing' && mergedSelected.status === 'error') {
          setStatus(t(language, 'analysisErrorRetry'));
        }
      }
      if (readyIds.length > 0) {
        await notifyMealReady(undefined, language);
      }
      if (!quiet) {
        setStatus(`${result.meals.length} ${t(language, 'mealsInJournal')}`);
      }
    } catch (error) {
      if (!quiet) {
        setStatus(error instanceof Error ? error.message : t(language, 'journalUnavailable'));
      }
      throw error;
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadMealList(settings, false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(language, 'refreshImpossible'));
    } finally {
      setRefreshing(false);
    }
  }

  function addPickedPhotos(photos: LocalPhoto[], emptyMessage: string) {
    if (photos.length === 0) {
      setStatus(emptyMessage);
      return;
    }
    setSelectedPhotos((current) => appendPhotos(current, photos));
    setStatus(language === 'en' ? `${photos.length} photo(s) added to the meal` : `${photos.length} photo(s) ajoutée(s) au repas`);
    setScreen('add');
  }

  async function recoverPendingPickerResults() {
    try {
      const pendingResults = (await ImagePicker.getPendingResultAsync()) ?? [];
      const recoveredPhotos = pendingResults.flatMap((result) => (isPickerResult(result) ? photosFromPickerResult(result) : []));
      if (recoveredPhotos.length > 0) {
        addPickedPhotos(recoveredPhotos, t(language, 'noRecoveredPhoto'));
      }
      return recoveredPhotos.length;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(language, 'recoveryUnavailable'));
      return 0;
    }
  }

  async function takePhoto() {
    if (selectedPhotos.length >= MAX_PHOTOS_PER_MEAL) {
      setStatus(t(language, 'photoLimit'));
      return;
    }
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert(t(language, 'cameraUnavailable'), t(language, 'cameraPermissionNeeded'));
        setStatus(t(language, 'cameraPermissionDenied'));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        exif: false,
        cameraType: ImagePicker.CameraType.back
      });
      addPickedPhotos(photosFromPickerResult(result), t(language, 'noPhotoTaken'));
    } catch (error) {
      const recoveredCount = await recoverPendingPickerResults();
      if (recoveredCount > 0) {
        return;
      }
      setStatus(error instanceof Error ? error.message : t(language, 'cameraUnavailable'));
      Alert.alert(t(language, 'cameraUnavailable'), error instanceof Error ? error.message : t(language, 'cameraLaunchImpossible'));
    }
  }

  async function choosePhotos() {
    const remainingSlots = MAX_PHOTOS_PER_MEAL - selectedPhotos.length;
    if (remainingSlots <= 0) {
      setStatus(t(language, 'photoLimit'));
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
        quality: 0.85,
        exif: false
      });
      addPickedPhotos(photosFromPickerResult(result), t(language, 'noPhotoSelected'));
    } catch (error) {
      const recoveredCount = await recoverPendingPickerResults();
      if (recoveredCount > 0) {
        return;
      }
      setStatus(error instanceof Error ? error.message : t(language, 'galleryUnavailable'));
      Alert.alert(t(language, 'galleryUnavailable'), error instanceof Error ? error.message : t(language, 'galleryOpenImpossible'));
    }
  }

  async function uploadMeal() {
    if (!selectedPhotos.length) {
      Alert.alert(t(language, 'addOnePhotoTitle'), t(language, 'addOnePhotoBody'));
      return;
    }
    setUploading(true);
    setStatus(t(language, 'sendingMeal'));
    try {
      const result = await api.createMeal(settings, persistSettings, selectedPhotos, {
        consumedAt: new Date().toISOString(),
        mealType: selectedMealType,
        notes: mealNotes,
        barcode: barcodeHint
      });
      setSelectedPhotos([]);
      setMealNotes('');
      setBarcodeHint('');
      setFoodSearchTerms({});
      setFoodSearchResults({});
      setFoodSearchCompleted({});
      setLearnedFoodReferences({});
      setSelectedMeal(result.meal);
      selectedMealRef.current = result.meal;
      await loadLearnedReferencesForMeal(result.meal);
      setScreen('review');
      await loadMealList({ ...settings, deviceToken: result.token }, true);
      setStatus(t(language, 'localAnalysisStarted'));
    } catch (error) {
      const message = error instanceof Error ? error.message : t(language, 'sendImpossible');
      setStatus(message);
      Alert.alert(t(language, 'sendImpossible'), message);
    } finally {
      setUploading(false);
    }
  }

  async function openMeal(meal: NutritionMeal) {
    setSelectedMeal(meal);
    selectedMealRef.current = meal;
    setEdits([]);
    setFoodSearchTerms({});
    setFoodSearchResults({});
    setFoodSearchCompleted({});
    setLearnedFoodReferences({});
    setScreen('review');
    try {
      const result = await api.fetchMeal(settings, persistSettings, meal.id);
      setSelectedMeal(result.meal);
      selectedMealRef.current = result.meal;
      await loadLearnedReferencesForMeal(result.meal);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(language, 'mealUnavailable'));
    }
  }

  async function refreshSelectedMeal() {
    if (!selectedMeal) {
      return;
    }
    setRefreshingMeal(true);
    setStatus(t(language, 'refreshingMeal'));
    try {
      const result = await api.fetchMeal(settings, persistSettings, selectedMeal.id);
      setSelectedMeal(result.meal);
      selectedMealRef.current = result.meal;
      await loadLearnedReferencesForMeal(result.meal);
      await loadMealList({ ...settings, deviceToken: result.token }, true);
      if (result.meal.status === 'ready') {
        setStatus(t(language, 'readyToCheck'));
      } else if (result.meal.status === 'needs_review') {
        setStatus(t(language, 'readyCorrectionRequired'));
      } else if (result.meal.status === 'error') {
        setStatus(t(language, 'analysisErrorRetry'));
      } else {
        setStatus(t(language, 'stillAnalyzing'));
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(language, 'refreshImpossible'));
    } finally {
      setRefreshingMeal(false);
    }
  }

  async function applyEdits() {
    if (!selectedMeal || edits.length === 0) {
      return;
    }
    setSavingReview(true);
    try {
      const result = await api.updateMeal(settings, persistSettings, selectedMeal.id, edits);
      setSelectedMeal(result.meal);
      selectedMealRef.current = result.meal;
      await loadLearnedReferencesForMeal(result.meal);
      setEdits([]);
      await loadMealList({ ...settings, deviceToken: result.token }, true);
      setStatus(t(language, 'mealRecalculated'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(language, 'correctionImpossible'));
    } finally {
      setSavingReview(false);
    }
  }

  async function validateMeal() {
    if (!selectedMeal) {
      return;
    }
    setSavingReview(true);
    try {
      const result = await api.validateMeal(settings, persistSettings, selectedMeal.id);
      setSelectedMeal(result.meal);
      selectedMealRef.current = result.meal;
      await loadMealList({ ...settings, deviceToken: result.token }, true);
      setStatus(t(language, 'mealValidated'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(language, 'validationImpossible'));
    } finally {
      setSavingReview(false);
    }
  }

  async function reanalyzeMeal() {
    if (!selectedMeal) {
      return;
    }
    setSavingReview(true);
    try {
      const result = await api.reanalyzeMeal(settings, persistSettings, selectedMeal.id);
      setSelectedMeal(result.meal);
      selectedMealRef.current = result.meal;
      setEdits([]);
      await loadLearnedReferencesForMeal(result.meal);
      await loadMealList({ ...settings, deviceToken: result.token }, true);
      setStatus(t(language, 'localAnalysisRelaunched'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(language, 'reanalysisImpossible'));
    } finally {
      setSavingReview(false);
    }
  }

  async function deleteMeal() {
    if (!selectedMeal) {
      return;
    }
    await deleteMealById(selectedMeal.id, { savingReview: true });
  }

  async function deleteMealById(mealId: string, options: { savingReview?: boolean } = {}) {
    if (options.savingReview) {
      setSavingReview(true);
    }
    try {
      const result = await api.deleteMeal(settings, persistSettings, mealId);
      if (selectedMealRef.current?.id === mealId) {
        setSelectedMeal(null);
        selectedMealRef.current = null;
      }
      setEdits([]);
      setFoodSearchTerms({});
      setFoodSearchResults({});
      setFoodSearchCompleted({});
      setLearnedFoodReferences({});
      setScreen('journal');
      await loadMealList({ ...settings, deviceToken: result.token }, true);
      setStatus(t(language, 'mealDeleted'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(language, 'deletionImpossible'));
    } finally {
      if (options.savingReview) {
        setSavingReview(false);
      }
    }
  }

  function updateFoodSearchTerm(itemId: string, value: string) {
    setFoodSearchTerms((current) => ({ ...current, [itemId]: value }));
    setFoodSearchResults((current) => ({ ...current, [itemId]: [] }));
    setFoodSearchCompleted((current) => ({ ...current, [itemId]: false }));
  }

  async function searchFoodReferences(itemId: string) {
    const item = selectedMeal?.items?.find((mealItem) => mealItem.id === itemId);
    const query = (foodSearchTerms[itemId] || item?.detected_name || item?.name || '').trim();
    if (query.length < 2) {
      setStatus(t(language, 'searchTooShort'));
      return;
    }
    setSearchingFood(true);
    try {
      const result = await api.searchFoodReferences(settings, persistSettings, query);
      setFoodSearchResults((current) => ({ ...current, [itemId]: result.foods }));
      setFoodSearchCompleted((current) => ({ ...current, [itemId]: true }));
      setStatus(`${result.foods.length} ${t(language, 'referencesFound')}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(language, 'nutritionSearchUnavailable'));
    } finally {
      setSearchingFood(false);
    }
  }

  async function matchFoodReference(itemId: string, reference: NutritionFoodReference) {
    if (!selectedMeal) {
      return;
    }
    setSavingReview(true);
    try {
      const result = await api.updateMeal(settings, persistSettings, selectedMeal.id, [
        { id: itemId, reference_id: reference.id, included: true }
      ]);
      const item = selectedMeal.items?.find((mealItem) => mealItem.id === itemId);
      await rememberFoodReference(item?.detected_name || item?.name || reference.name, reference);
      setSelectedMeal(result.meal);
      selectedMealRef.current = result.meal;
      setEdits((current) => current.filter((edit) => edit.id !== itemId));
      setFoodSearchResults((current) => ({ ...current, [itemId]: [] }));
      setFoodSearchCompleted((current) => ({ ...current, [itemId]: false }));
      setFoodSearchTerms((current) => ({ ...current, [itemId]: reference.name }));
      await loadLearnedReferencesForMeal(result.meal);
      await loadMealList({ ...settings, deviceToken: result.token }, true);
      setStatus(t(language, 'foodMatched'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t(language, 'matchImpossible'));
    } finally {
      setSavingReview(false);
    }
  }

  function openReviewTab() {
    if (reviewFallbackMeal) {
      void openMeal(reviewFallbackMeal);
      return;
    }
    setScreen('review');
  }

  async function loadLearnedReferencesForMeal(meal: NutritionMeal | null) {
    const entries = await Promise.all(
      (meal?.items ?? []).map(async (item) => {
        const query = item.detected_name || item.name;
        return [item.id, await loadLearnedFoodReferences(query)] as const;
      })
    );
    setLearnedFoodReferences(Object.fromEntries(entries.filter(([, references]) => references.length > 0)));
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {!embedded ? <StatusBar style="dark" /> : null}
      {!embedded ? (
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>ALIS</Text>
            <Text style={styles.title}>Nutrition</Text>
          </View>
          <Pressable
            accessibilityLabel={t(language, 'addMeal')}
            style={[styles.primaryIconButton, uploading && styles.disabledButton]}
            disabled={uploading}
            onPress={() => setScreen('add')}
          >
            <Text style={styles.primaryIconText}>+</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.embeddedActionRow}>
          <Text style={styles.embeddedStatus} numberOfLines={2}>{status}</Text>
          <Pressable
            accessibilityLabel={t(language, 'addMeal')}
            style={[styles.primaryIconButton, uploading && styles.disabledButton]}
            disabled={uploading}
            onPress={() => setScreen('add')}
          >
            <Text style={styles.primaryIconText}>+</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.tabs}>
        <Pressable style={[styles.tab, screen === 'journal' && styles.tabActive]} onPress={() => setScreen('journal')}>
          <Text style={[styles.tabText, screen === 'journal' && styles.tabTextActive]}>{t(language, 'journal')}</Text>
        </Pressable>
        <Pressable style={[styles.tab, screen === 'review' && styles.tabActive]} onPress={openReviewTab}>
          <Text style={[styles.tabText, screen === 'review' && styles.tabTextActive]}>{t(language, 'review')}</Text>
        </Pressable>
      </View>

      {!embedded ? <Text style={styles.status}>{status}</Text> : null}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#0f766e" />
        </View>
      ) : screen === 'add' ? (
        <AddScreen
          photos={selectedPhotos}
          mealType={selectedMealType}
          notes={mealNotes}
          barcode={barcodeHint}
          uploading={uploading}
          onMealTypeChange={setSelectedMealType}
          onNotesChange={setMealNotes}
          onBarcodeChange={setBarcodeHint}
          onTakePhoto={takePhoto}
          onChoosePhotos={choosePhotos}
          onRemovePhoto={(uri) => setSelectedPhotos((current) => removePhoto(current, uri))}
          onUpload={uploadMeal}
          language={language}
        />
      ) : screen === 'review' && selectedMeal ? (
        <ReviewScreen
          meal={selectedMeal}
          settings={settings}
          edits={edits}
          foodSearchTerms={foodSearchTerms}
          foodSearchResults={foodSearchResults}
          foodSearchCompleted={foodSearchCompleted}
          learnedFoodReferences={learnedFoodReferences}
          searchingFood={searchingFood}
          saving={savingReview}
          refreshing={refreshingMeal}
          onBack={() => setScreen('journal')}
          onPortionChange={(itemId, value) => setEdits((current) => updateDraftPortion(current, itemId, value))}
          onIncludedChange={(itemId, included) => setEdits((current) => toggleDraftIncluded(current, itemId, included))}
          onFoodSearchTermChange={updateFoodSearchTerm}
          onSearchFoodReference={searchFoodReferences}
          onMatchFoodReference={matchFoodReference}
          onApply={applyEdits}
          onValidate={validateMeal}
          onReanalyze={reanalyzeMeal}
          onDelete={deleteMeal}
          onRefresh={refreshSelectedMeal}
          language={language}
        />
      ) : screen === 'review' ? (
        <ReviewEmptyScreen onAdd={() => setScreen('add')} onJournal={() => setScreen('journal')} language={language} />
      ) : (
        <JournalScreen
          meals={sortedMeals}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onOpenMeal={openMeal}
          onDeleteMeal={deleteMealById}
          language={language}
        />
      )}
    </SafeAreaView>
  );
}

function JournalScreen({
  meals,
  refreshing,
  onRefresh,
  onOpenMeal,
  onDeleteMeal,
  language
}: {
  meals: NutritionMeal[];
  refreshing: boolean;
  onRefresh: () => void;
  onOpenMeal: (meal: NutritionMeal) => void;
  onDeleteMeal: (mealId: string) => void;
  language: AppLanguage;
}) {
  const daySections = buildJournalDaySections(meals, new Date(), language);
  return (
    <ScrollView
      style={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      keyboardShouldPersistTaps="handled"
    >
      {meals.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{t(language, 'noMealsTitle')}</Text>
          <Text style={styles.secondaryText}>{t(language, 'noMealsBody')}</Text>
        </View>
      ) : (
        daySections.map((section) => (
          <View key={section.key} style={styles.daySection}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayTitle}>{section.title}</Text>
              <Text style={styles.daySummary}>
                {section.validatedKcal} {t(language, 'validatedKcal')} · P {section.proteinG} g · {language === 'en' ? 'C' : 'G'} {section.carbohydratesG} g · {language === 'en' ? 'F' : 'L'} {section.fatG} g
              </Text>
              {section.pendingCount > 0 ? (
                <Text style={styles.pendingText}>{section.pendingCount} {t(language, 'pendingMeals')}</Text>
              ) : (
                <Text style={styles.validatedText}>{t(language, 'allUpToDate')}</Text>
              )}
              {section.title === (language === 'en' ? 'Today' : "Aujourd'hui") ? (
                <Text style={styles.alisSummary}>ALIS · {section.validatedKcal} {t(language, 'validatedToday')}</Text>
              ) : null}
            </View>
            {section.meals.map((meal) => {
              const jobText = analysisJobText(meal, language);
              const canQuickDelete = meal.status === 'error';
              return (
                <Pressable key={meal.id} style={styles.mealRow} onPress={() => onOpenMeal(meal)}>
                  <View style={styles.mealRowTop}>
                    <Text style={styles.mealTitle}>{meal.title || mealTypeLabel(meal.meal_type, language) || t(language, 'meal')}</Text>
                    <Text style={[styles.badge, badgeStyle(meal.status)]}>{mealStatusLabel(meal.status, language)}</Text>
                  </View>
                  <Text style={styles.kcalText}>{formatKcal(meal, language)}</Text>
                  <Text style={styles.secondaryText}>
                    {meal.photo_count ?? 0} photo(s) · {confidenceInsight(meal, language)}
                  </Text>
                  <Text style={styles.journalAlisText}>{alisImpactLabel(meal, language)}</Text>
                  <Text style={styles.mealNextAction}>{mealNextActionLabel(meal, language)}</Text>
                  {jobText ? <Text style={styles.journalJobText}>{jobText}</Text> : null}
                  {meal.status === 'error' && meal.error_message ? <Text style={styles.journalErrorText}>{meal.error_message}</Text> : null}
                  {canQuickDelete ? (
                    <Pressable
                      style={styles.inlineDangerButton}
                      onPress={(event) => {
                        event?.stopPropagation?.();
                        onDeleteMeal(meal.id);
                      }}
                    >
                      <Text style={styles.inlineDangerButtonText}>{t(language, 'delete')}</Text>
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))
      )}
    </ScrollView>
  );
}

function AddScreen({
  photos,
  mealType,
  notes,
  barcode,
  uploading,
  onMealTypeChange,
  onNotesChange,
  onBarcodeChange,
  onTakePhoto,
  onChoosePhotos,
  onRemovePhoto,
  onUpload,
  language
}: {
  photos: LocalPhoto[];
  mealType: MealTypeKey;
  notes: string;
  barcode: string;
  uploading: boolean;
  onMealTypeChange: (mealType: MealTypeKey) => void;
  onNotesChange: (value: string) => void;
  onBarcodeChange: (value: string) => void;
  onTakePhoto: () => void;
  onChoosePhotos: () => void;
  onRemovePhoto: (uri: string) => void;
  onUpload: () => void;
  language: AppLanguage;
}) {
  const canUpload = photos.length > 0 && !uploading;
  return (
    <ScrollView style={styles.content}>
      <Text style={styles.sectionTitle}>{t(language, 'mealType')}</Text>
      <View style={styles.mealTypeGrid}>
        {MEAL_TYPE_OPTIONS.map((option) => {
          const selected = mealType === option.key;
          return (
            <Pressable
              key={option.key}
              style={[styles.mealTypeChip, selected && styles.mealTypeChipActive]}
              onPress={() => onMealTypeChange(option.key)}
            >
              <Text style={[styles.mealTypeText, selected && styles.mealTypeTextActive]}>{mealTypeOptionLabel(option.key, language)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actionGrid}>
        <Pressable style={styles.actionButton} onPress={onTakePhoto}>
          <Text style={styles.actionTitle}>{t(language, 'takePhoto')}</Text>
          <Text style={styles.actionHint}>{t(language, 'takePhotoHint')}</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={onChoosePhotos}>
          <Text style={styles.actionTitle}>{t(language, 'choosePhotos')}</Text>
          <Text style={styles.actionHint}>{t(language, 'choosePhotosHint')}</Text>
        </Pressable>
      </View>

      <View style={styles.aiHintPanel}>
        <Text style={styles.sectionTitle}>{t(language, 'aiHints')}</Text>
        <TextInput
          style={styles.notesInput}
          value={notes}
          onChangeText={onNotesChange}
          placeholder={t(language, 'notesPlaceholder')}
          multiline
          textAlignVertical="top"
        />
        <TextInput
          style={styles.barcodeInput}
          value={barcode}
          onChangeText={onBarcodeChange}
          placeholder={t(language, 'barcodePlaceholder')}
          keyboardType="number-pad"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.secondaryText}>{t(language, 'aiHintsBody')}</Text>
      </View>

      <Text style={styles.sectionTitle}>
        {photos.length}/{MAX_PHOTOS_PER_MEAL} {t(language, 'selectedPhotos')}
      </Text>
      {photos.length === 0 ? (
        <Text style={styles.addHintText}>{t(language, 'addPhotoHint')}</Text>
      ) : (
        <View style={styles.addReadyPanel}>
          <Text style={styles.addReadyTitle}>{t(language, 'photosReadyTitle')}</Text>
          <Text style={styles.secondaryText}>{t(language, 'photosReadyBody')}</Text>
        </View>
      )}
      <View style={styles.photoGrid}>
        {photos.map((photo) => (
          <Pressable key={photo.uri} style={styles.photoTile} onPress={() => onRemovePhoto(photo.uri)}>
            <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
            <Text style={styles.photoRemove}>{t(language, 'remove')}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={[styles.primaryButton, !canUpload && styles.disabledButton]} disabled={!canUpload} onPress={onUpload}>
        <Text style={styles.primaryButtonText}>{uploading ? t(language, 'uploading') : t(language, 'launchAnalysis')}</Text>
      </Pressable>
    </ScrollView>
  );
}

function ReviewEmptyScreen({ onAdd, onJournal, language }: { onAdd: () => void; onJournal: () => void; language: AppLanguage }) {
  return (
    <View style={[styles.content, styles.emptyReviewContent]}>
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>{t(language, 'noMealReviewTitle')}</Text>
        <Text style={styles.secondaryText}>{t(language, 'noMealReviewBody')}</Text>
      </View>
      <Pressable style={styles.primaryButton} onPress={onAdd}>
        <Text style={styles.primaryButtonText}>{t(language, 'addMeal')}</Text>
      </Pressable>
      <Pressable style={styles.secondaryButton} onPress={onJournal}>
        <Text style={styles.secondaryButtonText}>{t(language, 'viewJournal')}</Text>
      </Pressable>
    </View>
  );
}

function ReviewScreen({
  meal,
  settings,
  edits,
  foodSearchTerms,
  foodSearchResults,
  foodSearchCompleted,
  learnedFoodReferences,
  searchingFood,
  saving,
  refreshing,
  onBack,
  onPortionChange,
  onIncludedChange,
  onFoodSearchTermChange,
  onSearchFoodReference,
  onMatchFoodReference,
  onApply,
  onValidate,
  onReanalyze,
  onDelete,
  onRefresh,
  language
}: {
  meal: NutritionMeal;
  settings: Settings;
  edits: NutritionMealEdit[];
  foodSearchTerms: Record<string, string>;
  foodSearchResults: Record<string, NutritionFoodReference[]>;
  foodSearchCompleted: Record<string, boolean>;
  learnedFoodReferences: Record<string, NutritionFoodReference[]>;
  searchingFood: boolean;
  saving: boolean;
  refreshing: boolean;
  onBack: () => void;
  onPortionChange: (itemId: string, value: string) => void;
  onIncludedChange: (itemId: string, included: boolean) => void;
  onFoodSearchTermChange: (itemId: string, value: string) => void;
  onSearchFoodReference: (itemId: string) => void;
  onMatchFoodReference: (itemId: string, reference: NutritionFoodReference) => void;
  onApply: () => void;
  onValidate: () => void;
  onReanalyze: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  language: AppLanguage;
}) {
  const canValidate = meal.status === 'ready' && !meal.validation_blocked;
  const isAnalyzing = meal.status === 'analyzing' || meal.status === 'uploading';
  const isError = meal.status === 'error';
  const canReviewItems = !isAnalyzing && !isError;
  const canReanalyze = meal.status !== 'validated';
  const canDelete = meal.status !== 'validated';
  const progress = analysisProgress(meal, language);
  const reviewMealTitle = meal.title || mealTypeLabel(meal.meal_type, language) || t(language, 'meal');
  return (
    <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onBack}>
        <Text style={styles.linkText}>{t(language, 'backToJournal')}</Text>
      </Pressable>
      <View style={styles.summaryBand}>
        <Text style={styles.sectionTitle}>{t(language, 'mealStudy')}</Text>
        <Text style={styles.summaryMealType}>{reviewMealTitle}</Text>
        <Text style={styles.summaryKcal}>{formatKcal(meal, language)}</Text>
        <Text style={styles.secondaryText}>
          {mealStatusLabel(meal.status, language)} · {confidenceInsight(meal, language)}
        </Text>
        <Text style={styles.macroText}>{formatMacros(meal, language)}</Text>
        <Text style={styles.impactText}>{alisImpactLabel(meal, language)}</Text>
        <AnalysisTrace meal={meal} language={language} />
        {meal.error_message ? <Text style={styles.errorText}>{meal.error_message}</Text> : null}
        <AnalysisJobPanel meal={meal} language={language} />
      </View>

      <ReviewDiagnosticPanel meal={meal} language={language} />

      {(meal.photos || []).length ? (
        <View style={styles.thumbnailStrip}>
          {(meal.photos || []).map((photo) =>
            photo.thumbnail_url ? (
              <Image
                key={photo.id}
                source={{
                  uri: `${cleanBaseUrl(settings.apiBaseUrl)}${photo.thumbnail_url}`,
                  headers: settings.deviceToken ? { Authorization: `Bearer ${settings.deviceToken}` } : undefined
                }}
                style={styles.reviewThumbnail}
              />
            ) : null
          )}
        </View>
      ) : null}

      {isAnalyzing ? (
        <View style={styles.statePanel}>
          <ActivityIndicator color="#0f766e" />
          <Text style={styles.stateTitle}>{progress.title}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress.percent}%` }]} />
          </View>
          <Text style={styles.secondaryText}>
            {t(language, 'step')} {progress.currentStep}/{progress.totalSteps} · {progress.detail}
          </Text>
          <Text style={styles.secondaryText}>{t(language, 'autoUpdateHint')}</Text>
          <Pressable style={[styles.secondaryButton, refreshing && styles.disabledButton]} disabled={refreshing} onPress={onRefresh}>
            <Text style={styles.secondaryButtonText}>{refreshing ? t(language, 'refreshing') : t(language, 'refreshNow')}</Text>
          </Pressable>
        </View>
      ) : null}

      {isError ? (
        <View style={styles.statePanel}>
          <Text style={styles.stateTitle}>{t(language, 'rerunAnalysis')}</Text>
          <Text style={styles.secondaryText}>{language === 'en' ? 'The local AI did not return a usable review for this meal.' : 'L’IA locale n’a pas rendu une étude exploitable pour ce repas.'}</Text>
          <Pressable style={[styles.secondaryButton, saving && styles.disabledButton]} disabled={saving} onPress={onReanalyze}>
            <Text style={styles.secondaryButtonText}>{t(language, 'rerunAnalysis')}</Text>
          </Pressable>
        </View>
      ) : null}

      {canDelete && (isAnalyzing || isError) ? (
        <Pressable style={[styles.dangerButton, saving && styles.disabledButton]} disabled={saving} onPress={onDelete}>
          <Text style={styles.dangerButtonText}>{t(language, 'deleteMeal')}</Text>
        </Pressable>
      ) : null}

      {canReviewItems
        ? (meal.items || []).map((item) => (
            <MealItemEditor
              key={item.id}
              item={item}
              edited={edits.find((edit) => edit.id === item.id)}
              searchTerm={foodSearchTerms[item.id] ?? item.detected_name ?? item.name}
              searchResults={foodSearchResults[item.id] ?? []}
              searchCompleted={foodSearchCompleted[item.id] ?? false}
              learnedReferences={learnedFoodReferences[item.id] ?? []}
              searchingFood={searchingFood}
              onPortionChange={onPortionChange}
              onIncludedChange={onIncludedChange}
              onFoodSearchTermChange={onFoodSearchTermChange}
              onSearchFoodReference={onSearchFoodReference}
              onMatchFoodReference={onMatchFoodReference}
              language={language}
            />
          ))
        : null}

      {canReviewItems && meal.validation_blocked ? (
        <Text style={styles.warningText}>{t(language, 'fixSourcesWarning')}</Text>
      ) : null}

      {canReviewItems ? (
        <View style={styles.reviewActions}>
          {canReanalyze ? (
            <Pressable style={[styles.secondaryButton, saving && styles.disabledButton]} disabled={saving} onPress={onReanalyze}>
              <Text style={styles.secondaryButtonText}>{t(language, 'rerunAnalysis')}</Text>
            </Pressable>
          ) : null}
          <Pressable style={[styles.secondaryButton, saving && styles.disabledButton]} disabled={saving || edits.length === 0} onPress={onApply}>
            <Text style={styles.secondaryButtonText}>{t(language, 'recalculate')}</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryButton, (!canValidate || saving) && styles.disabledButton]}
            disabled={!canValidate || saving}
            onPress={onValidate}
          >
            <Text style={styles.primaryButtonText}>{t(language, 'validateInAlis')}</Text>
          </Pressable>
          {canDelete ? (
            <Pressable style={[styles.dangerButton, saving && styles.disabledButton]} disabled={saving} onPress={onDelete}>
              <Text style={styles.dangerButtonText}>{t(language, 'deleteMeal')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function AnalysisTrace({ meal, language }: { meal: NutritionMeal; language: AppLanguage }) {
  const datasetVersions = formatDatasetVersions(meal.dataset_versions, language);
  const barcodes = barcodeCandidates(meal);
  if (!meal.model_name && !meal.prompt_version && !datasetVersions && barcodes.length === 0) {
    return null;
  }
  return (
    <View style={styles.tracePanel}>
      {meal.model_name ? <Text style={styles.traceText}>{t(language, 'model')} · {meal.model_name}</Text> : null}
      {meal.prompt_version ? <Text style={styles.traceText}>Prompt · {meal.prompt_version}</Text> : null}
      {datasetVersions ? <Text style={styles.traceText}>{t(language, 'sources')} · {datasetVersions}</Text> : null}
      {barcodes.length ? <Text style={styles.traceText}>{t(language, 'barcodeSeen')} · {barcodes.join(', ')}</Text> : null}
    </View>
  );
}

function AnalysisJobPanel({ meal, language }: { meal: NutritionMeal; language: AppLanguage }) {
  const job = meal.analysis_job;
  if (!job) {
    return null;
  }
  return (
    <View style={styles.jobPanel}>
      <Text style={styles.jobText}>{analysisJobText(meal, language)}</Text>
      {job.error_message ? <Text style={styles.jobErrorText}>{job.error_message}</Text> : null}
    </View>
  );
}

function ReviewDiagnosticPanel({ meal, language }: { meal: NutritionMeal; language: AppLanguage }) {
  const rows = analysisStageRows(meal, language);
  return (
    <View style={styles.reviewGuidePanel}>
      <Text style={styles.sectionTitle}>{t(language, 'guidedReview')}</Text>
      <Text style={styles.stageText}>{confidenceInsight(meal, language)}</Text>
      {rows.map((row) => (
        <Text key={row.label} style={styles.stageText}>
          {row.label} · {row.state} · {row.detail}
        </Text>
      ))}
      <View style={styles.reviewChecklist}>
        <Text style={styles.checklistTitle}>{t(language, 'reviewChecklist')}</Text>
        <Text style={styles.secondaryText}>1. {t(language, 'nutritionSources')}</Text>
        <Text style={styles.secondaryText}>2. {t(language, 'portions')}</Text>
        <Text style={styles.secondaryText}>3. Validation ALIS</Text>
      </View>
    </View>
  );
}

function MealItemEditor({
  item,
  edited,
  searchTerm,
  searchResults,
  searchCompleted,
  learnedReferences,
  searchingFood,
  onPortionChange,
  onIncludedChange,
  onFoodSearchTermChange,
  onSearchFoodReference,
  onMatchFoodReference,
  language
}: {
  item: NutritionMealItem;
  edited?: NutritionMealEdit;
  searchTerm: string;
  searchResults: NutritionFoodReference[];
  searchCompleted: boolean;
  learnedReferences: NutritionFoodReference[];
  searchingFood: boolean;
  onPortionChange: (itemId: string, value: string) => void;
  onIncludedChange: (itemId: string, included: boolean) => void;
  onFoodSearchTermChange: (itemId: string, value: string) => void;
  onSearchFoodReference: (itemId: string) => void;
  onMatchFoodReference: (itemId: string, reference: NutritionFoodReference) => void;
  language: AppLanguage;
}) {
  const included = edited?.included ?? item.included;
  const missingSource = included && !item.source;
  return (
    <View style={[styles.itemRow, missingSource && styles.itemRowNeedsSource, !included && styles.itemRowMuted]}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemTitle}>{item.name}</Text>
        <View style={styles.itemHeaderActions}>
          {missingSource ? <Text style={styles.itemNeedsSourceBadge}>{t(language, 'needsFix')}</Text> : null}
          <Pressable onPress={() => onIncludedChange(item.id, !included)}>
            <Text style={styles.itemToggle}>{included ? t(language, 'included') : t(language, 'removed')}</Text>
          </Pressable>
        </View>
      </View>
      <Text style={[styles.secondaryText, missingSource && styles.itemMissingSourceText]}>
        {sourceLabel(item.source, language)}
        {item.barcode ? ` · ${item.barcode}` : ''}
      </Text>
      {missingSource ? <Text style={styles.itemGuidanceText}>{t(language, 'fixFoodSource')}</Text> : null}
      {missingSource ? (
        <Pressable style={styles.itemRemoveButton} onPress={() => onIncludedChange(item.id, false)}>
          <Text style={styles.itemRemoveButtonText}>{t(language, 'removeFood')}</Text>
        </Pressable>
      ) : null}
      {learnedReferences.length > 0 ? (
        <View style={styles.learnedPanel}>
          <Text style={styles.learnedTitle}>{t(language, 'quickSuggestions')}</Text>
          {learnedReferences.map((reference) => (
            <Pressable key={reference.id} style={styles.learnedResult} onPress={() => onMatchFoodReference(item.id, reference)}>
              <View style={styles.matchResultHeader}>
                <Text style={styles.matchResultTitle}>{reference.name}</Text>
                <Text style={styles.bestMatchBadge}>{t(language, 'learned')}</Text>
              </View>
              <Text style={styles.secondaryText}>
                {sourceLabel(reference.source, language)} · {Math.round(reference.energy_kcal_100g)} kcal/100g
              </Text>
              <Pressable style={styles.chooseMatchButton} onPress={() => onMatchFoodReference(item.id, reference)}>
                <Text style={styles.chooseMatchButtonText}>{t(language, 'reuse')}</Text>
              </Pressable>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.matchPanel}>
        <View style={styles.matchInputRow}>
          <TextInput
            style={styles.matchInput}
            value={searchTerm}
            onChangeText={(value) => onFoodSearchTermChange(item.id, value)}
            placeholder={t(language, 'searchFoodPlaceholder')}
            autoCapitalize="none"
          />
          <Pressable
            style={[styles.compactButton, searchingFood && styles.disabledButton]}
            disabled={searchingFood}
            onPress={() => onSearchFoodReference(item.id)}
          >
            <Text style={styles.compactButtonText}>{t(language, 'search')}</Text>
          </Pressable>
        </View>
        {searchCompleted && searchResults.length === 0 ? (
          <View style={styles.emptyMatchPanel}>
            <Text style={styles.emptyMatchTitle}>{t(language, 'noSourceFound')}</Text>
            <Text style={styles.secondaryText}>{t(language, 'genericSearchHint')}</Text>
          </View>
        ) : null}
        {searchResults.map((reference, index) => (
          <Pressable key={reference.id} style={styles.matchResult} onPress={() => onMatchFoodReference(item.id, reference)}>
            <View style={styles.matchResultHeader}>
              <Text style={styles.matchResultTitle}>{reference.name}</Text>
              {index === 0 ? <Text style={styles.bestMatchBadge}>{t(language, 'bestMatch')}</Text> : null}
            </View>
            <Text style={styles.secondaryText}>
              {sourceLabel(reference.source, language)} · {Math.round(reference.energy_kcal_100g)} kcal/100g
            </Text>
            <Pressable style={styles.chooseMatchButton} onPress={() => onMatchFoodReference(item.id, reference)}>
              <Text style={styles.chooseMatchButtonText}>{t(language, 'choose')}</Text>
            </Pressable>
          </Pressable>
        ))}
      </View>
      <View style={styles.portionRow}>
        <TextInput
          style={styles.portionInput}
          keyboardType="numeric"
          defaultValue={String(Math.round(item.portion_g))}
          onChangeText={(value) => onPortionChange(item.id, value)}
        />
        <Text style={styles.secondaryText}>g · {Math.round(item.energy_kcal || 0)} kcal</Text>
      </View>
    </View>
  );
}

function badgeStyle(status: NutritionMeal['status']) {
  if (status === 'validated') {
    return styles.badgeGreen;
  }
  if (status === 'ready') {
    return styles.badgeBlue;
  }
  if (status === 'needs_review' || status === 'error') {
    return styles.badgeOrange;
  }
  return styles.badgeNeutral;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  header: {
    paddingTop: 2,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  embeddedActionRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8
  },
  embeddedStatus: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700'
  },
  eyebrow: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0
  },
  title: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0
  },
  primaryIconButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center'
  },
  primaryIconText: {
    color: '#ffffff',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '500'
  },
  tabs: {
    flexDirection: 'row',
    padding: 4,
    backgroundColor: '#e7eef5',
    borderRadius: 8
  },
  tab: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6
  },
  tabActive: {
    backgroundColor: '#ffffff'
  },
  tabText: {
    color: '#52635f',
    fontWeight: '700'
  },
  tabTextActive: {
    color: theme.colors.brand
  },
  status: {
    marginTop: 10,
    color: '#52635f',
    fontSize: 13
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  content: {
    flex: 1,
    paddingTop: 16,
    paddingBottom: 18
  },
  emptyReviewContent: {
    gap: 12
  },
  emptyState: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 18,
    borderWidth: 1,
    borderColor: '#d9e5e0'
  },
  emptyTitle: {
    color: '#10231f',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6
  },
  secondaryText: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18
  },
  mealRow: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#d9e5e0'
  },
  daySection: {
    marginBottom: 10
  },
  dayHeader: {
    backgroundColor: '#eef6f3',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfe1dc',
    padding: 12,
    marginBottom: 10,
    gap: 3
  },
  dayTitle: {
    color: '#10231f',
    fontSize: 17,
    fontWeight: '800'
  },
  daySummary: {
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18
  },
  pendingText: {
    color: theme.colors.warning,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17
  },
  validatedText: {
    color: theme.colors.success,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17
  },
  alisSummary: {
    color: '#52635f',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17
  },
  mealRowTop: {
    minHeight: 30,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start'
  },
  mealTitle: {
    color: '#10231f',
    fontSize: 17,
    fontWeight: '800',
    flex: 1
  },
  kcalText: {
    color: '#0f766e',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 6,
    marginBottom: 2
  },
  journalJobText: {
    color: '#10231f',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    marginTop: 8
  },
  journalAlisText: {
    color: '#52635f',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    marginTop: 5
  },
  mealNextAction: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 17,
    marginTop: 6
  },
  journalErrorText: {
    color: '#9a3412',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4
  },
  inlineDangerButton: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: 8,
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    justifyContent: 'center',
    marginTop: 10,
    paddingHorizontal: 12
  },
  inlineDangerButtonText: {
    color: '#be123c',
    fontSize: 13,
    fontWeight: '800'
  },
  badge: {
    overflow: 'hidden',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: '800'
  },
  badgeGreen: {
    color: '#166534',
    backgroundColor: '#dcfce7'
  },
  badgeBlue: {
    color: '#075985',
    backgroundColor: '#e0f2fe'
  },
  badgeOrange: {
    color: '#9a3412',
    backgroundColor: '#ffedd5'
  },
  badgeNeutral: {
    color: '#475569',
    backgroundColor: '#f1f5f9'
  },
  sectionTitle: {
    color: '#10231f',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10
  },
  addHintText: {
    color: '#64748b',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14
  },
  addReadyPanel: {
    backgroundColor: '#eef6f3',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfe1dc',
    marginBottom: 14,
    padding: 12
  },
  addReadyTitle: {
    color: '#0f766e',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 3
  },
  actionGrid: {
    gap: 12,
    marginBottom: 18
  },
  aiHintPanel: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e5e0',
    padding: 14,
    marginBottom: 18,
    gap: 10
  },
  notesInput: {
    minHeight: 92,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfe1dc',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#10231f',
    fontSize: 14,
    lineHeight: 19
  },
  barcodeInput: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfe1dc',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    color: '#10231f',
    fontSize: 15,
    fontWeight: '800'
  },
  mealTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18
  },
  mealTypeChip: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfe1dc',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center'
  },
  mealTypeChipActive: {
    backgroundColor: '#0f766e',
    borderColor: '#0f766e'
  },
  mealTypeText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '800'
  },
  mealTypeTextActive: {
    color: '#ffffff'
  },
  actionButton: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#d9e5e0'
  },
  actionTitle: {
    color: '#10231f',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 4
  },
  actionHint: {
    color: '#64748b',
    lineHeight: 19
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 18
  },
  photoTile: {
    width: '31%',
    minWidth: 94,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d9e5e0'
  },
  photoPreview: {
    width: '100%',
    aspectRatio: 1
  },
  photoRemove: {
    textAlign: 'center',
    color: '#b45309',
    fontWeight: '800',
    paddingVertical: 7,
    fontSize: 12
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: theme.colors.brandAlt,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 24
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 16
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: '#eef6f3',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  secondaryButtonText: {
    color: '#0f766e',
    fontWeight: '800',
    fontSize: 15
  },
  dangerButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 12
  },
  dangerButtonText: {
    color: '#be123c',
    fontWeight: '800',
    fontSize: 15
  },
  disabledButton: {
    opacity: 0.45
  },
  linkText: {
    color: '#0f766e',
    fontWeight: '800',
    marginBottom: 12
  },
  summaryBand: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#d9e5e0',
    marginBottom: 12
  },
  summaryMealType: {
    color: '#334155',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8
  },
  summaryKcal: {
    color: '#0f766e',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 4
  },
  macroText: {
    color: '#10231f',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 8
  },
  impactText: {
    color: '#52635f',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    marginTop: 8
  },
  tracePanel: {
    borderTopWidth: 1,
    borderTopColor: '#d9e5e0',
    gap: 4,
    marginTop: 12,
    paddingTop: 10
  },
  traceText: {
    color: '#52635f',
    fontSize: 12,
    lineHeight: 17
  },
  jobPanel: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e5e0',
    gap: 4,
    marginTop: 10,
    padding: 10
  },
  jobText: {
    color: '#10231f',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17
  },
  jobErrorText: {
    color: '#9a3412',
    fontSize: 12,
    lineHeight: 17
  },
  errorText: {
    color: '#9a3412',
    backgroundColor: '#ffedd5',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    lineHeight: 18
  },
  statePanel: {
    backgroundColor: '#eef6f3',
    borderRadius: 8,
    padding: 14,
    gap: 10,
    marginBottom: 12
  },
  progressTrack: {
    backgroundColor: '#d9e5e0',
    borderRadius: 999,
    height: 8,
    overflow: 'hidden'
  },
  progressFill: {
    backgroundColor: '#0f766e',
    borderRadius: 999,
    height: 8
  },
  reviewGuidePanel: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e5e0',
    padding: 14,
    gap: 6,
    marginBottom: 12
  },
  stageText: {
    color: '#10231f',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700'
  },
  reviewChecklist: {
    borderTopWidth: 1,
    borderTopColor: '#d9e5e0',
    gap: 4,
    marginTop: 8,
    paddingTop: 10
  },
  checklistTitle: {
    color: '#10231f',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 2
  },
  stateTitle: {
    color: '#10231f',
    fontSize: 16,
    fontWeight: '800'
  },
  itemRow: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e5e0',
    padding: 14,
    marginBottom: 10
  },
  itemRowNeedsSource: {
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb'
  },
  itemRowMuted: {
    opacity: 0.55
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 4
  },
  itemTitle: {
    color: '#10231f',
    fontSize: 16,
    fontWeight: '800',
    flex: 1
  },
  itemHeaderActions: {
    alignItems: 'flex-end',
    gap: 6
  },
  itemNeedsSourceBadge: {
    color: '#92400e',
    backgroundColor: '#fde68a',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  itemToggle: {
    color: '#0f766e',
    fontWeight: '800'
  },
  itemMissingSourceText: {
    color: '#92400e',
    fontWeight: '800'
  },
  itemGuidanceText: {
    color: '#92400e',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6
  },
  itemRemoveButton: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fbbf24',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  itemRemoveButtonText: {
    color: '#92400e',
    fontSize: 13,
    fontWeight: '800'
  },
  matchPanel: {
    marginTop: 12,
    gap: 8
  },
  learnedPanel: {
    gap: 8,
    marginTop: 12
  },
  learnedTitle: {
    color: '#10231f',
    fontSize: 14,
    fontWeight: '800'
  },
  learnedResult: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    padding: 10
  },
  matchInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center'
  },
  matchInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 10,
    backgroundColor: '#f8fafc',
    color: '#10231f'
  },
  compactButton: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#eef6f3',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  compactButtonText: {
    color: '#0f766e',
    fontWeight: '800',
    fontSize: 13
  },
  matchResult: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9e5e0',
    backgroundColor: '#f8fafc',
    padding: 10
  },
  matchResultHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    justifyContent: 'space-between'
  },
  matchResultTitle: {
    color: '#10231f',
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
    marginBottom: 2
  },
  bestMatchBadge: {
    backgroundColor: '#dbeafe',
    borderRadius: 8,
    color: '#075985',
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  chooseMatchButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#0f766e',
    borderRadius: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  chooseMatchButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800'
  },
  emptyMatchPanel: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderRadius: 8,
    borderWidth: 1,
    padding: 10
  },
  emptyMatchTitle: {
    color: '#9a3412',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2
  },
  portionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10
  },
  portionInput: {
    width: 86,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 10,
    backgroundColor: '#f8fafc',
    color: '#10231f',
    fontWeight: '700'
  },
  warningText: {
    color: '#9a3412',
    backgroundColor: '#ffedd5',
    padding: 12,
    borderRadius: 8,
    lineHeight: 18,
    marginBottom: 12
  },
  reviewActions: {
    gap: 10,
    marginBottom: 30
  },
  thumbnailStrip: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12
  },
  reviewThumbnail: {
    width: 76,
    height: 76,
    borderRadius: 8,
    backgroundColor: '#e2e8f0'
  }
});
