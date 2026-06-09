import { parseCoachMarkdown } from './coachMarkdown';

test('parses coach markdown headings lists and paragraphs', () => {
  expect(parseCoachMarkdown('### Sommeil\n- **Nuit courte**\n- Couche-toi plus tôt\n\nHydratation.')).toEqual([
    { type: 'heading', text: 'Sommeil' },
    { type: 'list', items: ['Nuit courte', 'Couche-toi plus tôt'] },
    { type: 'paragraph', text: 'Hydratation.' }
  ]);
});

test('cleans html breaks and markdown tables for mobile rendering', () => {
  expect(parseCoachMarkdown('**Plan**\n| Domaine | Recommendation | Objectif / KPI |\n|---|---|---|\n| **Sommeil** | Allonger<br>Stabiliser | Score **70** |')).toEqual([
    { type: 'heading', text: 'Plan' },
    { type: 'paragraph', text: 'Sommeil - Allonger' },
    { type: 'paragraph', text: 'Stabiliser - Score 70' }
  ]);
});
