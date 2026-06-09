import type { LocalPhoto, MealStatus, NutritionMeal, NutritionMealEdit } from './types';

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

export function mealStatusLabel(status: MealStatus): string {
  switch (status) {
    case 'uploading':
      return 'Envoi en cours';
    case 'analyzing':
      return 'Analyse en cours';
    case 'ready':
      return 'Prêt à valider';
    case 'needs_review':
      return 'À revoir';
    case 'validated':
      return 'Validé';
    case 'error':
      return 'Erreur';
    default:
      return 'Brouillon';
  }
}

export function mealNextActionLabel(meal: NutritionMeal): string {
  if (meal.status === 'validated') {
    return 'Validé dans ALIS';
  }
  if (meal.status === 'ready' && meal.validation_blocked) {
    return 'Correction requise avant validation';
  }
  if (meal.status === 'ready') {
    return 'Prêt à valider';
  }
  if (meal.status === 'needs_review') {
    return 'Revue nécessaire';
  }
  if (meal.status === 'error') {
    return 'Analyse à relancer';
  }
  return 'Analyse en cours';
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

function dayTitle(date: Date, now: Date): string {
  if (dayKey(date) === dayKey(now)) {
    return "Aujourd'hui";
  }
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function isPendingMeal(meal: NutritionMeal): boolean {
  return meal.status === 'uploading' || meal.status === 'analyzing' || meal.status === 'ready' || meal.status === 'needs_review' || meal.status === 'error';
}

export function buildJournalDaySections(meals: NutritionMeal[], now = new Date()): JournalDaySection[] {
  const grouped = new Map<string, JournalDaySection>();
  for (const meal of meals) {
    const date = mealDate(meal);
    const key = dayKey(date);
    const existing =
      grouped.get(key) ??
      ({
        key,
        title: dayTitle(date, now),
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

export function confidenceInsight(meal: NutritionMeal): string {
  const confidence = meal.confidence || 'en attente';
  const prefix = confidence === 'low' ? 'Confiance basse' : confidence === 'medium' ? 'Confiance moyenne' : confidence === 'high' ? 'Confiance haute' : 'Confiance en attente';
  const includedItems = meal.items?.filter((item) => item.included) ?? [];
  const missingSources = includedItems.filter((item) => !item.source).length;
  if (missingSources > 0) {
    return `${prefix} · source nutritionnelle manquante`;
  }
  if (meal.validation_blocked) {
    return `${prefix} · validation bloquée`;
  }
  if (meal.analysis_job?.status === 'failed' || meal.status === 'error') {
    return `${prefix} · analyse IA en échec`;
  }
  if (includedItems.some((item) => item.confidence === 'low')) {
    return `${prefix} · aliment ou portion ambiguë`;
  }
  if (includedItems.length === 0 && meal.status !== 'validated') {
    return `${prefix} · aucun aliment exploitable`;
  }
  return `${prefix} · sources nutritionnelles vérifiées`;
}

export function analysisStageRows(meal: NutritionMeal): AnalysisStageRow[] {
  const includedItems = meal.items?.filter((item) => item.included) ?? [];
  const missingSources = includedItems.filter((item) => !item.source).length;
  const jobStatus = meal.analysis_job?.status;
  const visionState =
    jobStatus === 'failed' || meal.status === 'error'
      ? 'Erreur'
      : jobStatus === 'completed' || meal.status === 'ready' || meal.status === 'needs_review' || meal.status === 'validated'
        ? 'OK'
        : meal.status === 'analyzing' || meal.status === 'uploading'
          ? 'En cours'
          : 'En attente';
  return [
    {
      label: 'Photos',
      state: (meal.photo_count ?? meal.photos?.length ?? 0) > 0 ? 'OK' : 'En attente',
      detail: `${meal.photo_count ?? meal.photos?.length ?? 0} photo(s) reçue(s)`
    },
    {
      label: 'IA vision',
      state: visionState,
      detail: visionState === 'OK' ? 'analyse terminée' : visionState === 'Erreur' ? 'analyse à relancer' : 'analyse en cours'
    },
    {
      label: 'Sources',
      state: missingSources > 0 ? 'À corriger' : includedItems.length > 0 ? 'OK' : 'En attente',
      detail:
        missingSources > 0
          ? `${missingSources} aliment${missingSources > 1 ? 's' : ''} sans source`
          : includedItems.length > 0
            ? `${includedItems.length} aliment${includedItems.length > 1 ? 's' : ''} sourcé${includedItems.length > 1 ? 's' : ''}`
            : 'aucun aliment exploitable'
    },
    {
      label: 'Validation',
      state: meal.status === 'validated' ? 'OK' : meal.validation_blocked ? 'Bloquée' : meal.status === 'ready' ? 'Prête' : 'En attente',
      detail:
        meal.status === 'validated'
          ? 'envoyé à ALIS'
          : meal.validation_blocked
            ? 'corrige les sources avant ALIS'
            : meal.status === 'ready'
              ? 'validation disponible'
              : 'attente du résultat'
    }
  ];
}

export function analysisProgress(meal: NutritionMeal): AnalysisProgress {
  const job = meal.analysis_job;
  const attempts = job?.attempts ? ` · tentative ${job.attempts}` : '';
  const totalSteps = 4;
  if (meal.status === 'uploading') {
    return {
      currentStep: 1,
      totalSteps,
      percent: 25,
      title: 'Envoi des photos',
      detail: `${meal.photo_count ?? meal.photos?.length ?? 0} photo(s) vers l'analyse locale`,
      tone: 'active'
    };
  }
  if (meal.status === 'error' || job?.status === 'failed') {
    return {
      currentStep: 2,
      totalSteps,
      percent: 50,
      title: 'Analyse en erreur',
      detail: job?.error_message || meal.error_message || 'Relance possible depuis la revue',
      tone: 'error'
    };
  }
  if (meal.status === 'analyzing') {
    if (job?.status === 'running') {
      return {
        currentStep: 3,
        totalSteps,
        percent: 75,
        title: 'Analyse locale en cours',
        detail: `Analyse locale${attempts}`,
        tone: 'active'
      };
    }
    return {
      currentStep: 2,
      totalSteps,
      percent: 50,
      title: 'En file d’attente',
      detail: `Analyse locale${attempts}`,
      tone: 'active'
    };
  }
  if (meal.status === 'needs_review' || meal.validation_blocked) {
    return {
      currentStep: 4,
      totalSteps,
      percent: 100,
      title: 'Correction requise',
      detail: 'Une source ou une portion bloque la validation ALIS',
      tone: 'blocked'
    };
  }
  if (meal.status === 'validated') {
    return {
      currentStep: 4,
      totalSteps,
      percent: 100,
      title: 'Validé dans ALIS',
      detail: 'ALIS et Coach peuvent utiliser ce repas',
      tone: 'complete'
    };
  }
  if (meal.status === 'ready') {
    return {
      currentStep: 4,
      totalSteps,
      percent: 100,
      title: 'Prêt à valider',
      detail: 'Vérifie les aliments et valide dans ALIS',
      tone: 'complete'
    };
  }
  return {
    currentStep: 0,
    totalSteps,
    percent: 0,
    title: 'Brouillon',
    detail: 'Ajoute des photos pour lancer l’analyse',
    tone: 'active'
  };
}

export function alisImpactLabel(meal: NutritionMeal): string {
  if (meal.status === 'validated') {
    return 'ALIS · transmis à ALIS et Coach';
  }
  if (meal.status === 'ready' && !meal.validation_blocked) {
    return 'ALIS · prêt, en attente de validation';
  }
  if (meal.status === 'needs_review' || meal.validation_blocked) {
    return 'ALIS · non transmis, correction requise';
  }
  return 'ALIS · non transmis';
}
