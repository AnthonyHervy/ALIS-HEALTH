export type UserSex = 'male' | 'female' | 'unspecified';

export type UserProfile = {
  firstName: string;
  sex: UserSex;
  age: string;
  weightKg: string;
  heightCm: string;
};

export const EMPTY_USER_PROFILE: UserProfile = {
  firstName: '',
  sex: 'unspecified',
  age: '',
  weightKg: '',
  heightCm: ''
};

const VALID_SEXES = new Set<UserSex>(['male', 'female', 'unspecified']);

export function normalizeUserProfile(input: Partial<UserProfile> | null | undefined): UserProfile {
  return {
    firstName: normalizeText(input?.firstName),
    sex: VALID_SEXES.has(input?.sex as UserSex) ? input?.sex as UserSex : 'unspecified',
    age: normalizeNumber(input?.age, { min: 1, max: 120, decimals: false }),
    weightKg: normalizeNumber(input?.weightKg, { min: 20, max: 350, decimals: true }),
    heightCm: normalizeNumber(input?.heightCm, { min: 80, max: 250, decimals: false })
  };
}

export function sanitizeUserProfileDraft(input: Partial<UserProfile> | null | undefined): UserProfile {
  return {
    firstName: normalizeText(input?.firstName),
    sex: VALID_SEXES.has(input?.sex as UserSex) ? input?.sex as UserSex : 'unspecified',
    age: sanitizeNumberDraft(input?.age, false),
    weightKg: sanitizeNumberDraft(input?.weightKg, true),
    heightCm: sanitizeNumberDraft(input?.heightCm, false)
  };
}

export function buildCoachProfileContext(profile: UserProfile): string {
  const normalized = normalizeUserProfile(profile);
  const details = [
    normalized.firstName ? `prénom ${normalized.firstName}` : null,
    normalized.sex === 'male' ? 'sexe homme' : normalized.sex === 'female' ? 'sexe femme' : null,
    normalized.age ? `âge ${normalized.age} ans` : null,
    normalized.weightKg ? `poids ${normalized.weightKg} kg` : null,
    normalized.heightCm ? `taille ${normalized.heightCm} cm` : null
  ].filter(Boolean);

  if (details.length === 0) {
    return '';
  }
  const firstNameInstruction = normalized.firstName ? " Si c'est naturel, appelle l'utilisateur par son prénom." : '';
  return `Profil utilisateur renseigné: ${details.join(', ')}.${firstNameInstruction}`;
}

export function buildCoachMessageWithProfile(message: string, profile: UserProfile): string {
  const context = buildCoachProfileContext(profile);
  return context ? `${context}\n\nDemande utilisateur: ${message}` : message;
}

function normalizeNumber(value: string | undefined, options: { min: number; max: number; decimals: boolean }): string {
  const normalized = String(value ?? '')
    .trim()
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  if (!normalized) {
    return '';
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < options.min || parsed > options.max) {
    return '';
  }

  if (!options.decimals) {
    return String(Math.round(parsed));
  }
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1).replace(/\.0$/, '');
}

function normalizeText(value: string | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

function sanitizeNumberDraft(value: string | undefined, decimals: boolean): string {
  const cleaned = String(value ?? '')
    .trim()
    .replace(',', '.')
    .replace(decimals ? /[^\d.]/g : /\D/g, '');
  if (!decimals) {
    return cleaned;
  }
  const [first, ...rest] = cleaned.split('.');
  return rest.length > 0 ? `${first}.${rest.join('')}` : first;
}
