export function profileSaveButtonPresentation(saved: boolean): { label: string; saved: boolean } {
  return {
    label: saved ? 'Profil sauvegardé !' : 'Enregistrer le profil',
    saved
  };
}
