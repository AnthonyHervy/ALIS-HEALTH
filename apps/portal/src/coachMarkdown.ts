export type CoachMarkdownBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

export function parseCoachMarkdown(content: string): CoachMarkdownBlock[] {
  const blocks: CoachMarkdownBlock[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: 'list', items: listItems });
      listItems = [];
    }
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', text: heading[1] });
      continue;
    }

    const item = line.match(/^[-*]\s+(.+)$/);
    if (item) {
      flushParagraph();
      listItems.push(item[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}
