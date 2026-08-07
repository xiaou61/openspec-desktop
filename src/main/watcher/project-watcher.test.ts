import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ProjectWatcher, type WatcherProjection } from './project-watcher';
import { scanOpenSpecProject } from '../domain/scanner';

async function waitFor(condition: () => boolean, timeoutMs = 6000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('等待监听事件超时');
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

describe('ProjectWatcher', () => {
  it('settles rapid writes, suppresses identical content, and reconciles deletion/archive movement', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'openspec-watcher-'));
    const events: WatcherProjection[] = [];
    try {
      const tasksPath = join(root, 'openspec', 'changes', 'demo', 'tasks.md');
      await fs.mkdir(join(root, 'openspec', 'changes', 'demo'), { recursive: true });
      await fs.writeFile(tasksPath, '# Tasks\n- [ ] one\n');
      const watcher = new ProjectWatcher({
        project: { id: 'project-watcher', rootPath: root, watcherEnabled: true },
        settleMs: 40,
        batchMs: 30,
        retryMs: 100,
        onProjection: (event) => {
          events.push(event);
        },
      });
      await watcher.start();
      expect(events[0]?.reason).toBe('initial');
      const initialCount = events.length;

      await fs.writeFile(tasksPath, '# Tasks\n- [x] one\n');
      await fs.writeFile(tasksPath, '# Tasks\n- [x] one\n- [ ] two\n');
      await waitFor(() => events.length > initialCount);
      const changed = events.at(-1)!;
      expect(changed.snapshot.changes[0]?.taskTotals).toEqual({ completed: 1, total: 2 });
      expect(changed.affectedChangeIds).toContain('demo');
      const afterChangeCount = events.length;

      await fs.writeFile(tasksPath, '# Tasks\n- [x] one\n- [ ] two\n');
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(events.length).toBe(afterChangeCount);

      await fs.mkdir(join(root, 'openspec', 'changes', 'archive'), { recursive: true });
      await fs.rename(
        join(root, 'openspec', 'changes', 'demo'),
        join(root, 'openspec', 'changes', 'archive', '2026-08-07-demo'),
      );
      await waitFor(() =>
        events.some((event) => event.snapshot.changes.some((change) => change.archived)),
      );
      expect(events.at(-1)?.reason).toBe('events');
      await watcher.close();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps unavailable projects visible and retries when the directory returns', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'openspec-watcher-retry-'));
    const states: string[] = [];
    try {
      const watcher = new ProjectWatcher({
        project: { id: 'project-retry', rootPath: root, watcherEnabled: true },
        retryMs: 80,
        onState: (state) => {
          states.push(state);
        },
      });
      await watcher.start();
      expect(states).toContain('unavailable');
      await fs.mkdir(join(root, 'openspec', 'changes'), { recursive: true });
      await fs.writeFile(join(root, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
      await waitFor(() => states.includes('watching'));
      await watcher.close();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('waits for an in-flight reconciliation and does not publish after close', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'openspec-watcher-close-'));
    const events: WatcherProjection[] = [];
    let release!: () => void;
    let scanStarted = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await fs.mkdir(join(root, 'openspec', 'changes', 'demo'), { recursive: true });
      await fs.writeFile(join(root, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
      const watcher = new ProjectWatcher({
        project: { id: 'project-close', rootPath: root, watcherEnabled: true },
        scan: async (path, options) => {
          scanStarted = true;
          await gate;
          return scanOpenSpecProject(path, options);
        },
        onProjection: (event) => {
          events.push(event);
        },
      });
      const starting = watcher.start();
      await waitFor(() => scanStarted);
      let closed = false;
      const closing = watcher.close().then(() => {
        closed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(closed).toBe(false);
      release();
      await Promise.all([starting, closing]);
      expect(events).toHaveLength(0);
    } finally {
      release();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('closes while the filesystem watcher is still waiting to become ready', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'openspec-watcher-ready-close-'));
    const filesystemWatcher = new EventEmitter() as EventEmitter & { close: () => Promise<void> };
    filesystemWatcher.close = vi.fn(async () => undefined);
    let watcherCreated = false;
    let starting: Promise<void> | undefined;
    let closing: Promise<void> | undefined;
    try {
      await fs.mkdir(join(root, 'openspec', 'changes'), { recursive: true });
      await fs.writeFile(join(root, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
      const watcher = new ProjectWatcher({
        project: { id: 'project-ready-close', rootPath: root, watcherEnabled: true },
        watchFactory: (() => {
          watcherCreated = true;
          return filesystemWatcher;
        }) as never,
      });

      starting = watcher.start();
      await waitFor(() => watcherCreated);
      closing = watcher.close();
      const closedPromptly = await Promise.race([
        closing.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);

      expect(closedPromptly).toBe(true);
    } finally {
      filesystemWatcher.emit('ready');
      await Promise.allSettled(
        [starting, closing].filter((task): task is Promise<void> => Boolean(task)),
      );
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
