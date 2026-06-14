import { languageFromLocale, normalizeLanguagePreference, resolveAppLanguage, t } from './i18n';

test('resolves English when system preference starts with en', () => {
  expect(resolveAppLanguage('system', ['en-US', 'fr-FR'])).toBe('en');
});

test('keeps French as fallback for unsupported system languages', () => {
  expect(languageFromLocale('es-ES')).toBe('fr');
  expect(resolveAppLanguage('system', ['de-DE'])).toBe('fr');
});

test('normalizes explicit language preferences', () => {
  expect(normalizeLanguagePreference('en')).toBe('en');
  expect(normalizeLanguagePreference('fr')).toBe('fr');
  expect(normalizeLanguagePreference('system')).toBe('system');
  expect(normalizeLanguagePreference('unknown')).toBe('system');
});

test('translates core shell and settings labels', () => {
  expect(t('fr', 'tabs.dashboard')).toBe("Aujourd'hui");
  expect(t('en', 'tabs.dashboard')).toBe('Today');
  expect(t('en', 'settings.languageTitle')).toBe('Language');
  expect(t('fr', 'settings.sourcesTitle')).toBe('Sources de données');
  expect(t('en', 'settings.sourcesTitle')).toBe('Data sources');
});

test('translates settings profile and advanced labels in English', () => {
  expect(t('en', 'settings.profileTitle')).toBe('Coach profile');
  expect(t('en', 'settings.firstName')).toBe('First name');
  expect(t('en', 'settings.male')).toBe('Male');
  expect(t('en', 'settings.unspecified')).toBe('Not specified');
  expect(t('en', 'settings.saveProfile')).toBe('Save profile');
  expect(t('en', 'settings.coachIdentityTitle')).toBe('AI coach identity');
  expect(t('en', 'settings.remove')).toBe('Remove');
  expect(t('en', 'settings.advancedTitle')).toBe('Advanced');
  expect(t('en', 'settings.lastManualSync')).toBe('Last manual sync');
  expect(t('en', 'settings.foodSources')).toBe('Food sources and local analysis.');
});
