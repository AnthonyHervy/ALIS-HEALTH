import type { LifeBalanceScore } from './types';

const CONFIDENCE_LABELS: Record<LifeBalanceScore['confidence'], string> = {
  high: 'Fiabilité élevée',
  medium: 'Fiabilité moyenne',
  low: 'Fiabilité faible'
};

export function scoreInfoText(score: LifeBalanceScore): { title: string; message: string } {
  const factors = score.contributors.length > 0
    ? `\n\nFacteurs utilisés :\n${score.contributors.map((item) => `- ${item.label} : ${item.value}`).join('\n')}`
    : '';
  return {
    title: score.label,
    message: `${CONFIDENCE_LABELS[score.confidence]}\n\n${score.explanation}${factors}`
  };
}

export function scorePanelInfoText(scores: LifeBalanceScore[], dailyInsight?: { title: string; message: string } | null): { title: string; message: string } {
  const dailyNote = dailyInsight?.message
    ? `${dailyInsight.title}\n${dailyInsight.message}\n\n`
    : '';
  return {
    title: 'Scores équilibre de vie',
    message: `${dailyNote}${scores.map((score) => {
      const factors = score.contributors.length > 0
        ? `\nFacteurs utilisés : ${score.contributors.map((item) => `${item.label} ${item.value}`).join(', ')}`
        : '';
      return `${score.label} - ${CONFIDENCE_LABELS[score.confidence]}\n${humanizeScoreExplanation(score.explanation)}${factors}`;
    }).join('\n\n')}`
  };
}

function humanizeScoreExplanation(value: string): string {
  return value
    .replace(/\bHRV\b/g, 'variabilité cardiaque')
    .replace(/sans variabilité cardiaque fiable/gi, 'sans mesure fiable de variabilité cardiaque récente');
}
