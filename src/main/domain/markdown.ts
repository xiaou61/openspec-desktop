import { unified } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { toString } from 'mdast-util-to-string';
import { visit } from 'unist-util-visit';
import type { Heading as MdastHeading, ListItem as MdastListItem, Root } from 'mdast';
import type { Heading, TaskItem, TaskTotals } from '@shared/contracts';

export interface MarkdownProjection {
  title: string;
  headings: Heading[];
  tasks: TaskItem[];
  taskTotals: TaskTotals;
}

export type MarkdownParseResult =
  { ok: true; value: MarkdownProjection } | { ok: false; error: string };

function lineOf(node: unknown): number {
  const position = (node as { position?: { start?: { line?: number } } }).position;
  const line = position?.start?.line;
  return typeof line === 'number' && line > 0 ? line : 1;
}

function parseTree(rawContent: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(rawContent) as Root;
}

export function parseMarkdown(rawContent: string): MarkdownParseResult {
  try {
    const tree = parseTree(rawContent);
    const headings: Heading[] = [];
    const tasks: TaskItem[] = [];

    visit(tree, 'heading', (node) => {
      const heading = node as MdastHeading;
      headings.push({ depth: heading.depth, text: toString(heading), line: lineOf(heading) });
    });

    visit(tree, 'listItem', (node) => {
      const listItem = node as MdastListItem;
      if (typeof listItem.checked !== 'boolean') return;
      const taskIndex = tasks.length + 1;
      const text = toString(listItem).trim();
      if (!text) return;
      tasks.push({
        id: `task-${taskIndex}`,
        text,
        checked: listItem.checked,
        line: lineOf(listItem),
      });
    });

    const firstTitle =
      headings.find((heading) => heading.depth === 1)?.text ?? headings[0]?.text ?? '';
    const taskTotals: TaskTotals = {
      completed: tasks.filter((task) => task.checked).length,
      total: tasks.length,
    };
    return { ok: true, value: { title: firstTitle, headings, tasks, taskTotals } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Markdown 解析失败' };
  }
}
