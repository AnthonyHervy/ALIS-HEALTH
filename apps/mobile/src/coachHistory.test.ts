import { coachHistoryForRequest, normalizeCoachChatHistory } from './coachHistory';

test('normalizes coach chat history for local persistence', () => {
  expect(normalizeCoachChatHistory([
    { role: 'user', content: ' Analyse mes donnees ', hidden: true },
    { role: 'assistant', content: '', loadingLabel: 'Generation' },
    { role: 'assistant', content: 'On garde une sortie facile aujourd’hui.' },
    { role: 'user', content: '   ' }
  ])).toEqual([
    { role: 'user', content: 'Analyse mes donnees', hidden: true },
    { role: 'assistant', content: 'On garde une sortie facile aujourd’hui.' }
  ]);
});

test('keeps hidden coach prompts in request history while dropping transient messages', () => {
  expect(coachHistoryForRequest([
    { role: 'user', content: 'Analyse mes donnees', hidden: true },
    { role: 'assistant', content: 'Bonne récupération ce matin.' },
    { role: 'assistant', content: '', loadingLabel: 'Generation' }
  ])).toEqual([
    { role: 'user', content: 'Analyse mes donnees' },
    { role: 'assistant', content: 'Bonne récupération ce matin.' }
  ]);
});
