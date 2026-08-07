import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HistoryStore } from './history-store';

describe('HistoryStore', () => {
  it('deduplicates exact content hashes and records task deltas', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-history-'));
    try {
      const history = new HistoryStore(userData, 'project-1', {
        revisionsPerArtifact: 50,
        activityPerProject: 1000,
      });
      const first = await history.recordRevision({
        relativePath: 'changes/demo/tasks.md',
        artifactType: 'tasks',
        content: '# Tasks\n- [ ] one\n',
        changeId: 'demo',
        projectVersion: 'v1',
        createdAt: '2026-08-07T00:00:00.000Z',
      });
      const duplicate = await history.recordRevision({
        relativePath: 'changes/demo/tasks.md',
        artifactType: 'tasks',
        content: '# Tasks\n- [ ] one\n',
        changeId: 'demo',
        projectVersion: 'v1',
      });
      const second = await history.recordRevision({
        relativePath: 'changes/demo/tasks.md',
        artifactType: 'tasks',
        content: '# Tasks\n- [x] one\n',
        changeId: 'demo',
        projectVersion: 'v1',
        taskDelta: { completed: 1, total: 0 },
        createdAt: '2026-08-07T00:01:00.000Z',
      });
      expect(first.created).toBe(true);
      expect(duplicate.created).toBe(false);
      expect(second.created).toBe(true);
      expect(second.activities.some((activity) => activity.kind === 'task-progress')).toBe(true);
      expect((await history.listRevisions('changes/demo/tasks.md')).items).toHaveLength(2);
      expect(await fs.readdir(join(userData, 'history', 'project-1', 'snapshots'))).toHaveLength(2);
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
    }
  });

  it('bounds revisions, paginates, compares lines, and clears only local history', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-history-retention-'));
    const source = await fs.mkdtemp(join(tmpdir(), 'openspec-history-source-'));
    try {
      const history = new HistoryStore(userData, 'project-2', {
        revisionsPerArtifact: 2,
        activityPerProject: 3,
      });
      await fs.mkdir(join(source, 'openspec', 'changes', 'demo'), { recursive: true });
      await fs.writeFile(join(source, 'openspec', 'changes', 'demo', 'tasks.md'), 'source');
      for (let index = 0; index < 4; index += 1) {
        await history.recordRevision({
          relativePath: 'changes/demo/tasks.md',
          artifactType: 'tasks',
          content: `line ${index}\n`,
          changeId: 'demo',
          projectVersion: 'v1',
          createdAt: `2026-08-07T00:0${index}:00.000Z`,
        });
      }
      const page = await history.listRevisions('changes/demo/tasks.md', { limit: 1 });
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBe('1');
      const all = await history.listRevisions('changes/demo/tasks.md', { limit: 10 });
      expect(all.items).toHaveLength(2);
      const comparison = await history.compareRevisions(all.items[1]!.id, all.items[0]!.id, 10);
      expect(
        comparison.hunks.some((hunk) => hunk.kind === 'added' || hunk.kind === 'removed'),
      ).toBe(true);
      await history.clearHistory();
      expect((await history.listRevisions('changes/demo/tasks.md')).items).toHaveLength(0);
      expect(
        await fs.readFile(join(source, 'openspec', 'changes', 'demo', 'tasks.md'), 'utf8'),
      ).toBe('source');
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
      await fs.rm(source, { recursive: true, force: true });
    }
  });
});
