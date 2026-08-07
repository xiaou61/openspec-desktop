import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AppController } from './app-controller';
import { CatalogService } from './catalog/catalog-service';
import { CatalogStore } from './catalog/catalog-store';
import type { WatcherManager } from './watcher/watcher-manager';

async function makeOpenSpecProject(parent: string, name: string): Promise<string> {
  const root = join(parent, name);
  await fs.mkdir(join(root, 'openspec', 'changes'), { recursive: true });
  await fs.writeFile(join(root, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  return root;
}

function watcherStub(): WatcherManager {
  return {
    startProject: vi.fn(),
    stopProject: vi.fn(),
    rescanProject: vi.fn(),
    getHistory: vi.fn(),
    flush: vi.fn(),
  } as unknown as WatcherManager;
}

describe('AppController Codex import', () => {
  it('imports valid candidates, preserves partial failures, and prevents duplicates', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'app-controller-codex-'));
    try {
      const codexHome = join(root, '.codex');
      const userDataPath = join(root, 'user-data');
      const valid = await makeOpenSpecProject(root, 'valid');
      const missing = join(root, 'missing');
      await fs.mkdir(codexHome);
      await fs.writeFile(
        join(codexHome, '.codex-global-state.json'),
        JSON.stringify({
          'local-projects': {
            valid: { id: 'valid', name: '有效项目', rootPaths: [valid], updatedAt: Date.now() },
            missing: {
              id: 'missing',
              name: '缺失项目',
              rootPaths: [missing],
              updatedAt: Date.now(),
            },
          },
          'project-order': ['valid', 'missing'],
        }),
      );
      const catalog = new CatalogService(new CatalogStore(userDataPath));
      const controller = new AppController({
        userDataPath,
        userHome: root,
        codexHome,
        catalog,
        watchers: watcherStub(),
      });
      await controller.initialize();

      const listed = await controller.listCodexProjects();
      expect(listed.candidates.map((candidate) => candidate.status)).toEqual([
        'available',
        'missing',
      ]);
      const imported = await controller.importCodexProjects({
        projects: [
          { rootPath: valid, displayName: '由渲染进程提供的名称' },
          { rootPath: missing, displayName: '缺失项目' },
        ],
      });
      expect(imported.items.map((item) => item.status)).toEqual(['imported', 'failed']);
      expect(imported.items[0]?.displayName).toBe('有效项目');
      expect(imported.snapshot.catalog.projects).toHaveLength(1);

      const duplicate = await controller.importCodexProjects({
        projects: [{ rootPath: valid, displayName: '有效项目' }],
      });
      expect(duplicate.items[0]?.status).toBe('already-added');
      expect(duplicate.snapshot.catalog.projects).toHaveLength(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a path that is not present in the current Codex index', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'app-controller-whitelist-'));
    try {
      const codexHome = join(root, '.codex');
      const userDataPath = join(root, 'user-data');
      await fs.mkdir(codexHome);
      await fs.writeFile(
        join(codexHome, '.codex-global-state.json'),
        JSON.stringify({ 'local-projects': {} }),
      );
      const controller = new AppController({
        userDataPath,
        userHome: root,
        codexHome,
        catalog: new CatalogService(new CatalogStore(userDataPath)),
        watchers: watcherStub(),
      });
      await controller.initialize();
      const result = await controller.importCodexProjects({
        projects: [{ rootPath: join(root, 'outside'), displayName: 'Outside' }],
      });
      expect(result.items[0]).toMatchObject({
        status: 'failed',
        error: '该目录不在当前 Codex 项目索引中',
      });
      expect(result.snapshot.catalog.projects).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
