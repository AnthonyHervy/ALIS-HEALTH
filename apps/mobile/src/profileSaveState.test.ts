import { profileSaveButtonPresentation } from './profileSaveState';

test('labels the profile save button from dirty and saved state', () => {
  expect(profileSaveButtonPresentation(false)).toEqual({
    label: 'Enregistrer le profil',
    saved: false
  });

  expect(profileSaveButtonPresentation(true)).toEqual({
    label: 'Profil sauvegardé !',
    saved: true
  });
});
