import { EMPTY_USER_PROFILE, buildCoachMessageWithProfile, buildCoachProfileContext, normalizeUserProfile, sanitizeUserProfileDraft } from './userProfile';

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
    firstName: ' Anthony ',
    sex: 'female',
    age: ' 38 ans ',
    weightKg: ' 71,5 kg',
    heightCm: '  178 cm '
  })).toEqual({
    firstName: 'Anthony',
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
    firstName: 'Anthony',
    sex: 'male',
    age: '36',
    weightKg: '82',
    heightCm: ''
  })).toBe("Profil utilisateur renseigné: prénom Anthony, sexe homme, âge 36 ans, poids 82 kg. Si c'est naturel, appelle l'utilisateur par son prénom.");
});

test('builds the coach profile context in English when requested', () => {
  const profile = {
    firstName: 'Anthony',
    sex: 'male' as const,
    age: '36',
    weightKg: '82',
    heightCm: '184'
  };

  expect(buildCoachProfileContext(profile, 'en')).toBe(
    'User profile provided: first name Anthony, sex male, age 36 years, weight 82 kg, height 184 cm. If it feels natural, call the user by their first name.'
  );
  expect(buildCoachMessageWithProfile('How should I recover?', profile, 'en')).toBe(
    'User profile provided: first name Anthony, sex male, age 36 years, weight 82 kg, height 184 cm. If it feels natural, call the user by their first name.\n\nUser request: How should I recover?'
  );
});
