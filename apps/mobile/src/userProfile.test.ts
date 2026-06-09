import { EMPTY_USER_PROFILE, buildCoachProfileContext, normalizeUserProfile, sanitizeUserProfileDraft } from './userProfile';

test('keeps partial numeric profile input while the user is typing', () => {
  expect(sanitizeUserProfileDraft({
    weightKg: '7',
    heightCm: '1',
    age: '3'
  })).toEqual({
    ...EMPTY_USER_PROFILE,
    age: '3',
    weightKg: '7',
    heightCm: '1'
  });
});

test('normalizes the local user profile entered in settings', () => {
  expect(normalizeUserProfile({
    firstName: ' Alex ',
    sex: 'female',
    age: ' 38 ans ',
    weightKg: ' 71,5 kg',
    heightCm: '  178 cm '
  })).toEqual({
    firstName: 'Alex',
    sex: 'female',
    age: '38',
    weightKg: '71.5',
    heightCm: '178'
  });
});

test('ignores invalid profile values and keeps unspecified sex by default', () => {
  expect(normalizeUserProfile({
    sex: 'custom',
    firstName: '   ',
    age: '-',
    weightKg: 'abc',
    heightCm: '9999'
  } as never)).toEqual(EMPTY_USER_PROFILE);
});

test('builds a concise coach context from filled profile fields', () => {
  expect(buildCoachProfileContext({
    firstName: 'Alex',
    sex: 'male',
    age: '36',
    weightKg: '82',
    heightCm: ''
  })).toBe("Profil utilisateur renseigné: prénom Alex, sexe homme, âge 36 ans, poids 82 kg. Si c'est naturel, appelle l'utilisateur par son prénom.");
});
