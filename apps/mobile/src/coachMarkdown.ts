export type MarkdownBlock =
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'paragraph'; text: string };

export function parseCoachMarkdown(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let list: string[] = [];
  const normalized = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r\n/g, '\n');

  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ type: 'list', items: list });
      list = [];
    }
  };

  for (const rawLine of normalized.split('\n')) {
    const raw = rawLine.trim();
    const line = cleanMarkdownText(raw);
    if (!raw || !line) {
      flushList();
      continue;
    }
    if (isMarkdownTableSeparator(raw) || isMarkdownTableHeader(raw)) {
      flushList();
      continue;
    }
    if (isMarkdownTableRow(raw)) {
      flushList();
      const cells = raw
        .split('|')
        .map((cell) => cleanMarkdownText(cell.trim()))
        .filter(Boolean);
      if (cells.length > 0) {
        blocks.push({ type: 'paragraph', text: cells.join(' - ') });
      }
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      flushList();
      blocks.push({ type: 'heading', text: cleanMarkdownText(line.replace(/^#{1,4}\s+/, '')) });
      continue;
    }
    if (/^\*\*.+\*\*$/.test(raw)) {
      flushList();
      blocks.push({ type: 'heading', text: cleanMarkdownText(raw) });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      list.push(cleanMarkdownText(line.replace(/^[-*]\s+/, '')));
      continue;
    }
    flushList();
    blocks.push({ type: 'paragraph', text: line });
  }
  flushList();
  return blocks;
}

export function cleanMarkdownText(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMarkdownTableRow(line: string): boolean {
  return line.includes('|') && line.split('|').filter((cell) => cell.trim()).length >= 2;
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line);
}

function isMarkdownTableHeader(line: string): boolean {
  const lower = line.toLowerCase();
  return isMarkdownTableRow(line) && (
    lower.includes('domaine') ||
    lower.includes('recommendation') ||
    lower.includes('objectif') ||
    lower.includes('kpi')
  );
}
