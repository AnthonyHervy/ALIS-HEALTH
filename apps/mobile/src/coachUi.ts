export function shouldShowCoachTyping({
  isLatestAssistant,
  isStreaming,
  content,
  minimumVisibleCharacters = 48
}: {
  isLatestAssistant: boolean;
  isStreaming: boolean;
  content: string;
  minimumVisibleCharacters?: number;
}): boolean {
  if (!isLatestAssistant || !isStreaming) {
    return false;
  }
  const trimmed = content.trim();
  if (trimmed.length < minimumVisibleCharacters) {
    return true;
  }
  return !hasReadableCoachStructure(trimmed);
}

export function coachLoadingLabel(label?: string): string {
  const raw = String(label ?? '').trim();
  const normalized = raw.toLowerCase();
  if (normalized.includes('séance')) {
    return 'Analyse de la séance en cours';
  }
  if (normalized.includes('données')) {
    return 'Analyse des données en cours';
  }
  if (raw) {
    return raw;
  }
  return 'ALIS réfléchit';
}

function hasReadableCoachStructure(content: string): boolean {
  return /^###\s+\S+/m.test(content) || /^-\s+\S+/m.test(content);
}
