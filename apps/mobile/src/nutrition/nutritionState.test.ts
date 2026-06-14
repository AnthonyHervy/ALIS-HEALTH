import {
  appendPhotos,
  alisImpactLabel,
  analysisProgress,
  analysisStageRows,
  buildReadyNotifications,
  buildJournalDaySections,
  confidenceInsight,
  mealNextActionLabel,
  mealStatusLabel,
  mergeSelectedMeal,
  removePhoto,
  shouldRunNutritionPolling,
  updateDraftPortion
} from './nutritionState';
import type { LocalPhoto, NutritionMeal } from './types';

const photoA: LocalPhoto = { uri: 'file:///meal.jpg', name: 'meal.jpg', type: 'image/jpeg' };
const photoB: LocalPhoto = { uri: 'file:///barcode.jpg', name: 'barcode.jpg', type: 'image/jpeg' };

test('supports multi-photo add and removal', () => {
  const selected = appendPhotos([photoA], [photoB]);

  expect(selected).toEqual([photoA, photoB]);
  expect(removePhoto(selected, photoA.uri)).toEqual([photoB]);
});

test('caps selected photos at the configured maximum', () => {
  const photos = Array.from({ length: 10 }, (_value, index) => ({
    uri: `file:///meal-${index}.jpg`,
    name: `meal-${index}.jpg`,
    type: 'image/jpeg'
  }));

  expect(appendPhotos([], photos, 8)).toHaveLength(8);
});

test('formats meal statuses for the journal', () => {
  expect(mealStatusLabel('analyzing')).toBe('Analyse en cours');
  expect(mealStatusLabel('ready')).toBe('Prêt à valider');
  expect(mealStatusLabel('needs_review')).toBe('À revoir');
  expect(mealStatusLabel('validated')).toBe('Validé');
  expect(mealStatusLabel('error')).toBe('Erreur');
  expect(mealStatusLabel('analyzing', 'en')).toBe('Analyzing');
  expect(mealStatusLabel('ready', 'en')).toBe('Ready to validate');
});

test('labels the next action for each meal state', () => {
  expect(mealNextActionLabel({ id: 'validated', status: 'validated' } as NutritionMeal)).toBe('Validé dans ALIS');
  expect(mealNextActionLabel({ id: 'blocked', status: 'ready', validation_blocked: true } as NutritionMeal)).toBe(
    'Correction requise avant validation'
  );
  expect(mealNextActionLabel({ id: 'ready', status: 'ready' } as NutritionMeal)).toBe('Prêt à valider');
  expect(mealNextActionLabel({ id: 'review', status: 'needs_review' } as NutritionMeal)).toBe('Revue nécessaire');
  expect(mealNextActionLabel({ id: 'error', status: 'error' } as NutritionMeal)).toBe('Analyse à relancer');
  expect(mealNextActionLabel({ id: 'uploading', status: 'uploading' } as NutritionMeal)).toBe('Analyse en cours');
  expect(mealNextActionLabel({ id: 'analyzing', status: 'analyzing' } as NutritionMeal)).toBe('Analyse en cours');
  expect(mealNextActionLabel({ id: 'draft', status: 'draft' } as NutritionMeal)).toBe('Analyse en cours');
  expect(mealNextActionLabel({ id: 'unknown', status: 'archived' } as unknown as NutritionMeal)).toBe('Analyse en cours');
  expect(mealNextActionLabel({ id: 'blocked-en', status: 'ready', validation_blocked: true } as NutritionMeal, 'en')).toBe(
    'Correction required before validation'
  );
});

test('detects newly ready meals for local notifications', () => {
  const previous: NutritionMeal[] = [{ id: 'meal-1', status: 'analyzing' } as NutritionMeal];
  const current: NutritionMeal[] = [{ id: 'meal-1', status: 'ready' } as NutritionMeal];

  expect(buildReadyNotifications(previous, current)).toEqual(['meal-1']);
});

test('builds review edits when a portion changes', () => {
  const edits = updateDraftPortion([], 'item-1', '200');

  expect(edits).toEqual([{ id: 'item-1', portion_g: 200, included: true }]);
});

test('preserves removal state when editing the portion of a removed item', () => {
  const edits = updateDraftPortion([{ id: 'item-1', included: false }], 'item-1', '200');

  expect(edits).toEqual([{ id: 'item-1', included: false, portion_g: 200 }]);
});

test('refreshes the selected meal from the latest polled journal list', () => {
  const selected = { id: 'meal-1', status: 'analyzing' } as NutritionMeal;
  const meals = [
    { id: 'meal-1', status: 'ready', energy_kcal: 420 } as NutritionMeal,
    { id: 'meal-2', status: 'analyzing' } as NutritionMeal
  ];

  expect(mergeSelectedMeal(selected, meals)).toEqual(meals[0]);
  expect(mergeSelectedMeal(null, meals)).toBeNull();
});

test('groups the journal into daily sections with validated kcal and meals to review', () => {
  const meals = [
    {
      id: 'validated-today',
      status: 'validated',
      consumed_at: '2026-05-31T11:30:00.000Z',
      energy_kcal: 520,
      protein_g: 32,
      carbohydrates_g: 50,
      fat_g: 18
    },
    {
      id: 'review-today',
      status: 'needs_review',
      consumed_at: '2026-05-31T18:30:00.000Z',
      energy_kcal: 300
    },
    {
      id: 'ready-yesterday',
      status: 'ready',
      consumed_at: '2026-05-30T18:30:00.000Z',
      energy_kcal: 410
    }
  ] as NutritionMeal[];

  const sections = buildJournalDaySections(meals, new Date('2026-05-31T20:00:00.000Z'));

  expect(sections).toHaveLength(2);
  expect(sections[0]).toMatchObject({
    title: "Aujourd'hui",
    validatedKcal: 520,
    pendingCount: 1,
    proteinG: 32,
    carbohydratesG: 50,
    fatG: 18
  });
  expect(sections[0].meals.map((meal) => meal.id)).toEqual(['review-today', 'validated-today']);
  expect(sections[1]).toMatchObject({ title: '30/05/2026', validatedKcal: 0, pendingCount: 1 });

  expect(buildJournalDaySections(meals, new Date('2026-05-31T20:00:00.000Z'), 'en')[0].title).toBe('Today');
});

test('explains confidence with the most actionable reason first', () => {
  const meal = {
    id: 'meal-1',
    status: 'needs_review',
    confidence: 'low',
    validation_blocked: true,
    items: [{ id: 'item-1', name: 'Sauce', included: true, source: null, portion_g: 40 }]
  } as NutritionMeal;

  expect(confidenceInsight(meal)).toBe('Confiance basse · source nutritionnelle manquante');
  expect(confidenceInsight(meal, 'en')).toBe('Low confidence · missing nutrition source');
});

test('builds analysis stage rows for upload, vision, sources and validation', () => {
  const rows = analysisStageRows({
    id: 'meal-1',
    status: 'needs_review',
    photo_count: 2,
    analysis_job: { id: 'job-1', status: 'completed', attempts: 1 },
    validation_blocked: true,
    items: [
      { id: 'item-1', name: 'Riz', included: true, source: 'ciqual', portion_g: 120 },
      { id: 'item-2', name: 'Sauce', included: true, source: null, portion_g: 40 }
    ]
  } as NutritionMeal);

  expect(rows).toEqual([
    { label: 'Photos', state: 'OK', detail: '2 photo(s) reçue(s)' },
    { label: 'IA vision', state: 'OK', detail: 'analyse terminée' },
    { label: 'Sources', state: 'À corriger', detail: '1 aliment sans source' },
    { label: 'Validation', state: 'Bloquée', detail: 'corrige les sources avant ALIS' }
  ]);

  expect(analysisStageRows({
    id: 'meal-1',
    status: 'needs_review',
    photo_count: 2,
    analysis_job: { id: 'job-1', status: 'completed', attempts: 1 },
    validation_blocked: true,
    items: [{ id: 'item-1', name: 'Sauce', included: true, source: null, portion_g: 40 }]
  } as NutritionMeal, 'en')).toEqual([
    { label: 'Photos', state: 'OK', detail: '2 photo(s) received' },
    { label: 'Vision AI', state: 'OK', detail: 'analysis complete' },
    { label: 'Sources', state: 'To fix', detail: '1 food item without source' },
    { label: 'Validation', state: 'Blocked', detail: 'fix sources before ALIS' }
  ]);
});

test('builds action-oriented progress for meals being analyzed', () => {
  expect(
    analysisProgress({
      id: 'uploading',
      status: 'uploading',
      photo_count: 2
    } as NutritionMeal)
  ).toMatchObject({
    currentStep: 1,
    totalSteps: 4,
    percent: 25,
    title: 'Envoi des photos',
    detail: "2 photo(s) vers l'analyse locale",
    tone: 'active'
  });

  expect(
    analysisProgress({
      id: 'running',
      status: 'analyzing',
      photo_count: 2,
      analysis_job: { id: 'job-1', status: 'running', attempts: 2 }
    } as NutritionMeal)
  ).toMatchObject({
    currentStep: 3,
    percent: 75,
    title: 'Analyse locale en cours',
    detail: 'Analyse locale · tentative 2',
    tone: 'active'
  });
});

test('builds terminal progress for ready, review, validated and failed meals', () => {
  expect(analysisProgress({ id: 'ready', status: 'ready' } as NutritionMeal)).toMatchObject({
    currentStep: 4,
    percent: 100,
    title: 'Prêt à valider',
    tone: 'complete'
  });
  expect(analysisProgress({ id: 'review', status: 'needs_review', validation_blocked: true } as NutritionMeal)).toMatchObject({
    currentStep: 4,
    percent: 100,
    title: 'Correction requise',
    tone: 'blocked'
  });
  expect(analysisProgress({ id: 'validated', status: 'validated' } as NutritionMeal)).toMatchObject({
    currentStep: 4,
    percent: 100,
    title: 'Validé dans ALIS',
    detail: 'ALIS et Coach peuvent utiliser ce repas',
    tone: 'complete'
  });
  expect(
    analysisProgress({
      id: 'failed',
      status: 'error',
      analysis_job: { id: 'job-1', status: 'failed', attempts: 3, error_message: 'Ollama unavailable' }
    } as NutritionMeal)
  ).toMatchObject({
    currentStep: 2,
    percent: 50,
    title: 'Analyse en erreur',
    detail: 'Ollama unavailable',
    tone: 'error'
  });
});

test('labels ALIS impact from meal validation state', () => {
  expect(alisImpactLabel({ id: 'meal-1', status: 'validated' } as NutritionMeal)).toBe('ALIS · transmis à ALIS et Coach');
  expect(alisImpactLabel({ id: 'meal-2', status: 'ready' } as NutritionMeal)).toBe('ALIS · prêt, en attente de validation');
  expect(alisImpactLabel({ id: 'meal-3', status: 'needs_review' } as NutritionMeal)).toBe('ALIS · non transmis, correction requise');
});

test('only runs Nutrition polling when visible and initially loaded', () => {
  expect(shouldRunNutritionPolling(false, false)).toBe(false);
  expect(shouldRunNutritionPolling(true, false)).toBe(false);
  expect(shouldRunNutritionPolling(false, true)).toBe(false);
  expect(shouldRunNutritionPolling(true, true)).toBe(true);
});
