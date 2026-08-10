import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WatcherManager } from './watcher-manager';

async function waitFor(condition: () => boolean, timeoutMs = 6000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('等待 manager 事件超时');
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

describe('WatcherManager', () => {
  it('does not create a watcher after shutdown races with project startup', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'openspec-manager-shutdown-'));
    try {
      await fs.mkdir(join(root, 'openspec', 'changes'), { recursive: true });
      const manager = new WatcherManager();
      const startup = manager.startProject({
        id: 'shutdown-project',
        rootPath: root,
        displayName: 'Shutdown project',
        versionLabel: '',
        versionMode: 'automatic',
        versionSource: 'workspace',
        groupId: null,
        order: 0,
        watcherEnabled: true,
        watcherState: 'scanning',
        available: true,
        registeredAt: new Date().toISOString(),
      });

      await manager.closeAll();
      await startup;

      expect(manager.getSnapshot('shutdown-project')).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('connects settled projections to content-addressed history', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-manager-data-'));
    const root = await fs.mkdtemp(join(tmpdir(), 'openspec-manager-project-'));
    const events: string[] = [];
    try {
      const tasksPath = join(root, 'openspec', 'changes', 'demo', 'tasks.md');
      await fs.mkdir(join(root, 'openspec', 'changes', 'demo'), { recursive: true });
      await fs.writeFile(tasksPath, '# Tasks\n- [ ] one\n');
      const manager = new WatcherManager({
        userDataPath: userData,
        settleMs: 35,
        batchMs: 25,
        retryMs: 100,
        onProjection: (event) => {
          events.push(event.reason);
        },
      });
      await manager.startProject({
        id: 'manager-project',
        rootPath: root,
        displayName: 'Manager project',
        versionLabel: 'v1',
        versionMode: 'manual',
        versionSource: 'manual',
        groupId: null,
        order: 0,
        watcherEnabled: true,
        watcherState: 'scanning',
        available: true,
        registeredAt: new Date().toISOString(),
      });
      await fs.writeFile(tasksPath, '# Tasks\n- [x] one\n');
      await waitFor(() => events.length >= 2);
      const current = {
        id: 'manager-project',
        rootPath: root,
        displayName: 'Manager project',
        versionLabel: 'v2',
        versionMode: 'manual' as const,
        versionSource: 'manual' as const,
        groupId: null,
        order: 0,
        watcherEnabled: true,
        watcherState: 'watching' as const,
        available: true,
        registeredAt: new Date().toISOString(),
      };
      manager.updateProjectContext(current);
      await fs.writeFile(tasksPath, '# Tasks\n- [x] one\n- [ ] two\n');
      await waitFor(() => events.length >= 3);
      const history = manager.getHistory('manager-project');
      expect(history).toBeDefined();
      const revisions = (await history!.listRevisions('changes/demo/tasks.md')).items;
      expect(revisions.length).toBe(3);
      expect(revisions[0]?.projectVersion).toBe('v2');
      expect(revisions.some((revision) => revision.projectVersion === 'v1')).toBe(true);
      await manager.closeAll();
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
