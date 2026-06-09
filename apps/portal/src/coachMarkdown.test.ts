import { expect, test } from 'vitest';

import { parseCoachMarkdown } from './coachMarkdown';

test('parses coach markdown headings lists and paragraphs', () => {
  const blocks = parseCoachMarkdown(
    [
      'Le modèle local répond.',
      '',
      '### Sommeil',
      '- Dernière nuit: 375 min.',
      '- Score Sommeil: 67.',
      '',
      'Action simple: dormir plus tôt.'
    ].join('\n')
  );

  expect(blocks).toEqual([
    { type: 'paragraph', text: 'Le modèle local répond.' },
    { type: 'heading', text: 'Sommeil' },
    { type: 'list', items: ['Dernière nuit: 375 min.', 'Score Sommeil: 67.'] },
    { type: 'paragraph', text: 'Action simple: dormir plus tôt.' }
  ]);
});
