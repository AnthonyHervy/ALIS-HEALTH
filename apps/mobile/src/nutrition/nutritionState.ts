import type { LocalPhoto, MealStatus, NutritionMeal, NutritionMealEdit } from './types';
import type { AppLanguage } from '../i18n';

export const MAX_PHOTOS_PER_MEAL = 8;

export type JournalDaySection = {
  key: string;
  title: string;
  meals: NutritionMeal[];
  validatedKcal: number;
  pendingCount: number;
  proteinG: number;
  carbohydratesG: number;
  fatG: number;
};

export type AnalysisStageRow = {
  label: string;
  state: string;
  detail: string;
};

export type AnalysisProgress = {
  currentStep: number;
  totalSteps: number;
  percent: number;
  title: string;
  detail: string;
  tone: 'active' | 'blocked' | 'complete' | 'error';
};

export function appendPhotos(existing: LocalPhoto[], next: LocalPhoto[], maxPhotos = MAX_PHOTOS_PER_MEAL): LocalPhoto[] {
  const seen = new Set(existing.map((photo) => photo.uri));
  return [...existing, ...next.filter((photo) => !seen.has(photo.uri))].slice(0, maxPhotos);
}

export function removePhoto(photos: LocalPhoto[], uri: string): LocalPhoto[] {
  return photos.filter((photo) => photo.uri !== uri);
}

export function mealStatusLabel(status: MealStatus, language: AppLanguage = 'fr'): string {
  switch (status) {
    case 'uploading':
      return language === 'en' ? 'Uploading' : 'Envoi en cours';
    case 'analyzing':
      return language === 'en' ? 'Analyzing' : 'Analyse en cours';
    case 'ready':
      return language === 'en' ? 'Ready to validate' : 'Prêt à valider';
    case 'needs_review':
      return language === 'en' ? 'Needs review' : 'À revoir';
    case 'validated':
      return language === 'en' ? 'Validated' : 'Validé';
    case 'error':
      return language === 'en' ? 'Error' : 'Erreur';
    default:
      return language === 'en' ? 'Draft' : 'Brouillon';
  }
}

export function mealNextActionLabel(meal: NutritionMeal, language: AppLanguage = 'fr'): string {
  if (meal.status === 'validated') {
    return language === 'en' ? 'Validated in ALIS' : 'Validé dans ALIS';
  }
  if (meal.status === 'ready' && meal.validation_blocked) {
    return language === 'en' ? 'Correction required before validation' : 'Correction requise avant validation';
  }
  if (meal.status === 'ready') {
    return language === 'en' ? 'Ready to validate' : 'Prêt à valider';
  }
  if (meal.status === 'needs_review') {
    return language === 'en' ? 'Review needed' : 'Revue nécessaire';
  }
  if (meal.status === 'error') {
    return language === 'en' ? 'Rerun analysis' : 'Analyse à relancer';
  }
  return language === 'en' ? 'Analysis in progress' : 'Analyse en cours';
}

export function buildReadyNotifications(previous: NutritionMeal[], current: NutritionMeal[]): string[] {
  const previousStatuses = new Map(previous.map((meal) => [meal.id, meal.status]));
  return current
    .filter((meal) => {
      const before = previousStatuses.get(meal.id);
      return before === 'analyzing' && (meal.status === 'ready' || meal.status === 'needs_review');
    })
    .map((meal) => meal.id);
}

export function shouldRunNutritionPolling(active: boolean, hasLoaded: boolean): boolean {
  return active && hasLoaded;
}

export function mergeSelectedMeal(selected: NutritionMeal | null, current: NutritionMeal[]): NutritionMeal | null {
  if (!selected) {
    return null;
  }
  return current.find((meal) => meal.id === selected.id) ?? selected;
}

export function updateDraftPortion(edits: NutritionMealEdit[], itemId: string, value: string): NutritionMealEdit[] {
  const parsed = Number(value.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return edits;
  }
  const existing = edits.find((edit) => edit.id === itemId);
  const remaining = edits.filter((edit) => edit.id !== itemId);
  return [...remaining, { ...(existing ?? { id: itemId, included: true }), portion_g: parsed }];
}

export function toggleDraftIncluded(edits: NutritionMealEdit[], itemId: string, included: boolean): NutritionMealEdit[] {
  const existing = edits.find((edit) => edit.id === itemId);
  const remaining = edits.filter((edit) => edit.id !== itemId);
  return [...remaining, { ...(existing ?? { id: itemId }), included }];
}

function mealDate(meal: NutritionMeal): Date {
  const value = meal.consumed_at || meal.created_at || meal.updated_at;
  const parsed = value ? new Date(value) : new Date(0);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayTitle(date: Date, now: Date, language: AppLanguage): string {
  if (dayKey(date) === dayKey(now)) {
    return language === 'en' ? 'Today' : "Aujourd'hui";
  }
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function isPendingMeal(meal: NutritionMeal): boolean {
  return meal.status === 'uploading' || meal.status === 'analyzing' || meal.status === 'ready' || meal.status === 'needs_review' || meal.status === 'error';
}

export function buildJournalDaySections(meals: NutritionMeal[], now = new Date(), language: AppLanguage = 'fr'): JournalDaySection[] {
  const grouped = new Map<string, JournalDaySection>();
  for (const meal of meals) {
    const date = mealDate(meal);
    const key = dayKey(date);
    const existing =
      grouped.get(key) ??
      ({
        key,
        title: dayTitle(date, now, language),
        meals: [],
        validatedKcal: 0,
        pendingCount: 0,
        proteinG: 0,
        carbohydratesG: 0,
        fatG: 0
      } satisfies JournalDaySection);
    existing.meals.push(meal);
    if (meal.status === 'validated') {
      existing.validatedKcal += Math.round(meal.energy_kcal || 0);
      existing.proteinG += Math.round(meal.protein_g || 0);
      existing.carbohydratesG += Math.round(meal.carbohydrates_g || 0);
      existing.fatG += Math.round(meal.fat_g || 0);
    } else if (isPendingMeal(meal)) {
      existing.pendingCount += 1;
    }
    grouped.set(key, existing);
  }
  return [...grouped.values()]
    .map((section) => ({
      ...section,
      meals: [...section.meals].sort((a, b) => mealDate(b).getTime() - mealDate(a).getTime())
    }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

export function confidenceInsight(meal: NutritionMeal, language: AppLanguage = 'fr'): string {
  const confidence = meal.confidence || 'en attente';
  const prefix = language === 'en'
    ? confidence === 'low' ? 'Low confidence' : confidence === 'medium' ? 'Medium confidence' : confidence === 'high' ? 'High confidence' : 'Confidence pending'
    : confidence === 'low' ? 'Confiance basse' : confidence === 'medium' ? 'Confiance moyenne' : confidence === 'high' ? 'Confiance haute' : 'Confiance en attente';
  const includedItems = meal.items?.filter((item) => item.included) ?? [];
  const missingSources = includedItems.filter((item) => !item.source).length;
  if (missingSources > 0) {
    return `${prefix} · ${language === 'en' ? 'missing nutrition source' : 'source nutritionnelle manquante'}`;
  }
  if (meal.validation_blocked) {
    return `${prefix} · ${language === 'en' ? 'validation blocked' : 'validation bloquée'}`;
  }
  if (meal.analysis_job?.status === 'failed' || meal.status === 'error') {
    return `${prefix} · ${language === 'en' ? 'AI analysis failed' : 'analyse IA en échec'}`;
  }
  if (includedItems.some((item) => item.confidence === 'low')) {
    return `${prefix} · ${language === 'en' ? 'ambiguous food or portion' : 'aliment ou portion ambiguë'}`;
  }
  if (includedItems.length === 0 && meal.status !== 'validated') {
    return `${prefix} · ${language === 'en' ? 'no usable food item' : 'aucun aliment exploitable'}`;
  }
  return `${prefix} · ${language === 'en' ? 'nutrition sources checked' : 'sources nutritionnelles vérifiées'}`;
}

export function analysisStageRows(meal: NutritionMeal, language: AppLanguage = 'fr'): AnalysisStageRow[] {
  const includedItems = meal.items?.filter((item) => item.included) ?? [];
  const missingSources = includedItems.filter((item) => !item.source).length;
  const jobStatus = meal.analysis_job?.status;
  const visionState =
    jobStatus === 'failed' || meal.status === 'error'
      ? language === 'en' ? 'Error' : 'Erreur'
      : jobStatus === 'completed' || meal.status === 'ready' || meal.status === 'needs_review' || meal.status === 'validated'
        ? 'OK'
        : meal.status === 'analyzing' || meal.status === 'uploading'
          ? language === 'en' ? 'In progress' : 'En cours'
          : language === 'en' ? 'Pending' : 'En attente';
  const waiting = language === 'en' ? 'Pending' : 'En attente';
  return [
    {
      label: 'Photos',
      state: (meal.photo_count ?? meal.photos?.length ?? 0) > 0 ? 'OK' : waiting,
      detail: language === 'en'
        ? `${meal.photo_count ?? meal.photos?.length ?? 0} photo(s) received`
        : `${meal.photo_count ?? meal.photos?.length ?? 0} photo(s) reçue(s)`
    },
    {
      label: language === 'en' ? 'Vision AI' : 'IA vision',
      state: visionState,
      detail: visionState === 'OK'
        ? language === 'en' ? 'analysis complete' : 'analyse terminée'
        : visionState === 'Erreur' || visionState === 'Error'
          ? language === 'en' ? 'rerun analysis' : 'analyse à relancer'
          : language === 'en' ? 'analysis in progress' : 'analyse en cours'
    },
    {
      label: 'Sources',
      state: missingSources > 0 ? language === 'en' ? 'To fix' : 'À corriger' : includedItems.length > 0 ? 'OK' : waiting,
      detail:
        missingSources > 0
          ? language === 'en'
            ? `${missingSources} food item${missingSources > 1 ? 's' : ''} without source`
            : `${missingSources} aliment${missingSources > 1 ? 's' : ''} sans source`
          : includedItems.length > 0
            ? language === 'en'
              ? `${includedItems.length} sourced food item${includedItems.length > 1 ? 's' : ''}`
              : `${includedItems.length} aliment${includedItems.length > 1 ? 's' : ''} sourcé${includedItems.length > 1 ? 's' : ''}`
            : language === 'en' ? 'no usable food item' : 'aucun aliment exploitable'
    },
    {
      label: 'Validation',
      state: meal.status === 'validated' ? 'OK' : meal.validation_blocked ? language === 'en' ? 'Blocked' : 'Bloquée' : meal.status === 'ready' ? language === 'en' ? 'Ready' : 'Prête' : waiting,
      detail:
        meal.status === 'validated'
          ? language === 'en' ? 'sent to ALIS' : 'envoyé à ALIS'
          : meal.validation_blocked
            ? language === 'en' ? 'fix sources before ALIS' : 'corrige les sources avant ALIS'
            : meal.status === 'ready'
              ? language === 'en' ? 'validation available' : 'validation disponible'
              : language === 'en' ? 'waiting for result' : 'attente du résultat'
    }
  ];
}

export function analysisProgress(meal: NutritionMeal, language: AppLanguage = 'fr'): AnalysisProgress {
  const job = meal.analysis_job;
  const attempts = job?.attempts ? ` · ${language === 'en' ? 'attempt' : 'tentative'} ${job.attempts}` : '';
  const totalSteps = 4;
  if (meal.status === 'uploading') {
    return {
      currentStep: 1,
      totalSteps,
      percent: 25,
      title: language === 'en' ? 'Uploading photos' : 'Envoi des photos',
      detail: language === 'en'
        ? `${meal.photo_count ?? meal.photos?.length ?? 0} photo(s) sent to local analysis`
        : `${meal.photo_count ?? meal.photos?.length ?? 0} photo(s) vers l'analyse locale`,
      tone: 'active'
    };
  }
  if (meal.status === 'error' || job?.status === 'failed') {
    return {
      currentStep: 2,
      totalSteps,
      percent: 50,
      title: language === 'en' ? 'Analysis error' : 'Analyse en erreur',
      detail: job?.error_message || meal.error_message || (language === 'en' ? 'You can rerun it from review' : 'Relance possible depuis la revue'),
      tone: 'error'
    };
  }
  if (meal.status === 'analyzing') {
    if (job?.status === 'running') {
      return {
        currentStep: 3,
        totalSteps,
        percent: 75,
        title: language === 'en' ? 'Local analysis in progress' : 'Analyse locale en cours',
        detail: `${language === 'en' ? 'Local analysis' : 'Analyse locale'}${attempts}`,
        tone: 'active'
      };
    }
    return {
      currentStep: 2,
      totalSteps,
      percent: 50,
      title: language === 'en' ? 'Queued' : 'En file d’attente',
      detail: `${language === 'en' ? 'Local analysis' : 'Analyse locale'}${attempts}`,
      tone: 'active'
    };
  }
  if (meal.status === 'needs_review' || meal.validation_blocked) {
    return {
      currentStep: 4,
      totalSteps,
      percent: 100,
      title: language === 'en' ? 'Correction required' : 'Correction requise',
      detail: language === 'en' ? 'A source or portion blocks ALIS validation' : 'Une source ou une portion bloque la validation ALIS',
      tone: 'blocked'
    };
  }
  if (meal.status === 'validated') {
    return {
      currentStep: 4,
      totalSteps,
      percent: 100,
      title: language === 'en' ? 'Validated in ALIS' : 'Validé dans ALIS',
      detail: language === 'en' ? 'ALIS and Coach can use this meal' : 'ALIS et Coach peuvent utiliser ce repas',
      tone: 'complete'
    };
  }
  if (meal.status === 'ready') {
    return {
      currentStep: 4,
      totalSteps,
      percent: 100,
      title: language === 'en' ? 'Ready to validate' : 'Prêt à valider',
      detail: language === 'en' ? 'Check the foods and validate in ALIS' : 'Vérifie les aliments et valide dans ALIS',
      tone: 'complete'
    };
  }
  return {
    currentStep: 0,
    totalSteps,
    percent: 0,
    title: language === 'en' ? 'Draft' : 'Brouillon',
    detail: language === 'en' ? 'Add photos to start analysis' : 'Ajoute des photos pour lancer l’analyse',
    tone: 'active'
  };
}

export function alisImpactLabel(meal: NutritionMeal, language: AppLanguage = 'fr'): string {
  if (meal.status === 'validated') {
    return language === 'en' ? 'ALIS · sent to ALIS and Coach' : 'ALIS · transmis à ALIS et Coach';
  }
  if (meal.status === 'ready' && !meal.validation_blocked) {
    return language === 'en' ? 'ALIS · ready, waiting for validation' : 'ALIS · prêt, en attente de validation';
  }
  if (meal.status === 'needs_review' || meal.validation_blocked) {
    return language === 'en' ? 'ALIS · not sent, correction required' : 'ALIS · non transmis, correction requise';
  }
  return language === 'en' ? 'ALIS · not sent' : 'ALIS · non transmis';
}
