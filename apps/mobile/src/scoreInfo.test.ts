import { scorePanelInfoText } from './scoreInfo';
import type { LifeBalanceScore } from './types';

test('explains all score reliabilities from one card-level info action', () => {
  const recovery: LifeBalanceScore = {
    slug: 'recovery',
    label: 'Récupération',
    value: 90,
    tone: 'green',
    confidence: 'low',
    explanation: 'Fiabilité faible : estimation sans mesure fiable de variabilité cardiaque récente.',
    contributors: [
      { key: 'sleep_score', label: 'Score sommeil', value: 92 },
      { key: 'workout_minutes', label: 'Charge du jour', value: 44 }
    ]
  };
  const sleep: LifeBalanceScore = {
    slug: 'sleep',
    label: 'Sommeil',
    value: 82,
    tone: 'green',
    confidence: 'medium',
    explanation: 'Durée et continuité favorables.',
    contributors: [{ key: 'duration_minutes', label: 'Durée', value: 455 }]
  };

  const info = scorePanelInfoText([sleep, recovery]);

  expect(info.title).toBe('Scores équilibre de vie');
  expect(info.message).toContain('Sommeil - Fiabilité moyenne');
  expect(info.message).toContain('Récupération - Fiabilité faible');
  expect(info.message).toContain('variabilité cardiaque');
  expect(info.message).toContain('Facteurs utilisés : Score sommeil 92, Charge du jour 44');
  expect(info.message).not.toContain('HRV');
});

test('folds the daily reading note into the score info panel', () => {
  const scores: LifeBalanceScore[] = [
    {
      slug: 'movement',
      label: 'Mouvement',
      value: 84,
      tone: 'green',
      confidence: 'high',
      explanation: 'Les données récentes sont exploitables.',
      contributors: [{ key: 'steps', label: 'Pas', value: 9210 }]
    }
  ];

  const info = scorePanelInfoText(scores, {
    title: 'Données du jour',
    message: 'Les données récentes sont exploitables pour la lecture du jour.'
  });

  expect(info.message).toContain('Données du jour');
  expect(info.message).toContain('Les données récentes sont exploitables pour la lecture du jour.');
});
