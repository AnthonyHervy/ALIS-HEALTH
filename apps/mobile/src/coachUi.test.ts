import { coachLoadingLabel, shouldShowCoachTyping } from './coachUi';

test('keeps the coach typing state while the first streamed token is too short', () => {
  expect(shouldShowCoachTyping({
    isLatestAssistant: true,
    isStreaming: true,
    content: 'R'
  })).toBe(true);
  expect(shouldShowCoachTyping({
    isLatestAssistant: true,
    isStreaming: true,
    content: 'Génération'
  })).toBe(true);
});

test('shows the assistant content once enough text has streamed or streaming is done', () => {
  expect(shouldShowCoachTyping({
    isLatestAssistant: true,
    isStreaming: true,
    content: 'Réponse en cours avec assez de caractères, mais pas encore structurée.'
  })).toBe(true);
  expect(shouldShowCoachTyping({
    isLatestAssistant: true,
    isStreaming: true,
    content: '### Récupération\n- On va garder une journée douce et utile.'
  })).toBe(false);
  expect(shouldShowCoachTyping({
    isLatestAssistant: true,
    isStreaming: false,
    content: 'R'
  })).toBe(false);
});

test('uses a stable short loading label instead of streamed token text', () => {
  expect(coachLoadingLabel()).toBe('ALIS réfléchit');
  expect(coachLoadingLabel('Génération de la réponse')).toBe('ALIS réfléchit');
  expect(coachLoadingLabel("J'étudie vos données du jour pour vous conseiller au mieux ...")).toBe('Analyse des données en cours');
});
