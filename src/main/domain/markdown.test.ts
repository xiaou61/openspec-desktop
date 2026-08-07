import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
  it('extracts headings, GFM tasks, totals, and keeps raw content separate', () => {
    const raw = '# Ship it\n\n## Checklist\n\n- [x] Parse files\n- [ ] Show progress\n';
    const result = parseMarkdown(raw);

    expect(result).toEqual({
      ok: true,
      value: {
        title: 'Ship it',
        headings: [
          { depth: 1, text: 'Ship it', line: 1 },
          { depth: 2, text: 'Checklist', line: 3 },
        ],
        tasks: [
          { id: 'task-1', text: 'Parse files', checked: true, line: 5 },
          { id: 'task-2', text: 'Show progress', checked: false, line: 6 },
        ],
        taskTotals: { completed: 1, total: 2 },
      },
    });
  });

  it('returns a stable empty projection for ordinary Markdown', () => {
    const result = parseMarkdown('plain text');
    expect(result).toEqual({
      ok: true,
      value: { title: '', headings: [], tasks: [], taskTotals: { completed: 0, total: 0 } },
    });
  });
});
