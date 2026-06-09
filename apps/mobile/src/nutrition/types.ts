export type MealStatus = 'draft' | 'uploading' | 'analyzing' | 'ready' | 'needs_review' | 'validated' | 'error';

export type Settings = {
  apiBaseUrl: string;
  pairingCode: string;
  deviceToken: string | null;
};

export type LocalPhoto = {
  uri: string;
  name: string;
  type: string;
};

export type NutritionMealItem = {
  id: string;
  name: string;
  detected_name?: string | null;
  barcode?: string | null;
  source?: 'ciqual' | 'openfoodfacts' | string | null;
  source_id?: string | null;
  portion_g: number;
  included: boolean;
  confidence?: string | null;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbohydrates_g?: number | null;
  fat_g?: number | null;
};

export type NutritionFoodReference = {
  id: string;
  source: 'ciqual' | 'openfoodfacts' | string;
  source_id: string;
  barcode?: string | null;
  name: string;
  energy_kcal_100g: number;
  protein_g_100g: number;
  carbohydrates_g_100g: number;
  fat_g_100g: number;
  dataset_version: string;
};

export type NutritionDatasetSourceStatus = {
  source: string;
  reference_count: number;
  dataset_versions: string[];
};

export type NutritionDatasetStatus = {
  ciqual_loaded: boolean;
  openfoodfacts_loaded: boolean;
  total_references: number;
  sources: NutritionDatasetSourceStatus[];
};

export type NutritionOllamaDiagnostic = {
  base_url: string;
  model: string;
  reachable: boolean;
  model_available: boolean;
  error_message?: string | null;
};

export type NutritionJobDiagnostic = {
  pending: number;
  running: number;
  failed: number;
};

export type NutritionDiagnostic = {
  api_status: string;
  datasets: NutritionDatasetStatus;
  ollama: NutritionOllamaDiagnostic;
  jobs: NutritionJobDiagnostic;
};

export type NutritionMealPhoto = {
  id: string;
  thumbnail_url?: string | null;
  original_filename?: string | null;
  purged: boolean;
};

export type NutritionAnalysisJob = {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | string;
  attempts: number;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
};

export type NutritionMeal = {
  id: string;
  status: MealStatus;
  meal_type?: string | null;
  consumed_at?: string;
  title?: string | null;
  photo_count?: number;
  photos?: NutritionMealPhoto[];
  items?: NutritionMealItem[];
  confidence?: string | null;
  validation_blocked?: boolean;
  kcal_min?: number | null;
  kcal_max?: number | null;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbohydrates_g?: number | null;
  fat_g?: number | null;
  model_name?: string | null;
  prompt_version?: string | null;
  dataset_versions?: Record<string, string> | null;
  source_trace?: Record<string, unknown> | null;
  analysis_job?: NutritionAnalysisJob | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type NutritionMealEdit = {
  id: string;
  portion_g?: number;
  included?: boolean;
  reference_id?: string;
};
