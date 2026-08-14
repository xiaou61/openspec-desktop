import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AppController } from './app-controller';
import { CatalogService } from './catalog/catalog-service';
import { CatalogStore } from './catalog/catalog-store';
import type { WatcherManager } from './watcher/watcher-manager';

function watcherStub(): WatcherManager {
  return {
    startProject: vi.fn(),
    stopProject: vi.fn(),
    rescanProject: vi.fn(),
    updateProjectContext: vi.fn(),
    getSnapshot: vi.fn(() => null),
    getHistory: vi.fn(),
    flush: vi.fn(),
  } as unknown as WatcherManager;
}

async function listRelativeFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listRelativeFiles(join(root, entry.name), relative)));
    } else {
      result.push(relative);
    }
  }
  return result;
}

async function makeController(userDataPath: string): Promise<AppController> {
  const catalog = new CatalogService(new CatalogStore(userDataPath));
  return new AppController({
    userDataPath,
    catalog,
    watchers: watcherStub(),
  });
}

describe('AppController legacy spec-assurance data retirement', () => {
  it('does not create userData/spec-assurance when no legacy data exists', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'app-controller-assurance-absent-'));
    try {
      const userDataPath = join(root, 'user-data');
      const controller = await makeController(userDataPath);
      await controller.initialize();
      await expect(fs.access(join(userDataPath, 'spec-assurance'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('leaves existing legacy assurance data untouched and opens the project normally', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'app-controller-assurance-valid-'));
    try {
      const userDataPath = join(root, 'user-data');
      const assuranceDirectory = join(userDataPath, 'spec-assurance');
      await fs.mkdir(assuranceDirectory, { recursive: true });
      await fs.writeFile(
        join(assuranceDirectory, 'index.json'),
        JSON.stringify({ schemaVersion: 1, projects: [] }, null, 2),
        'utf8',
      );
      const before = await listRelativeFiles(assuranceDirectory);
      const beforeStat = await fs.stat(join(assuranceDirectory, 'index.json'));

      const controller = await makeController(userDataPath);
      await controller.initialize();

      const after = await listRelativeFiles(assuranceDirectory);
      const afterStat = await fs.stat(join(assuranceDirectory, 'index.json'));
      expect(after).toEqual(before);
      expect(await fs.readFile(join(assuranceDirectory, 'index.json'), 'utf8')).toBe(
        JSON.stringify({ schemaVersion: 1, projects: [] }, null, 2),
      );
      expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
      expect(controller.getAppSnapshot().catalog.projects).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('does not migrate, back up, clear, or write when legacy assurance data is corrupt', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'app-controller-assurance-corrupt-'));
    try {
      const userDataPath = join(root, 'user-data');
      const assuranceDirectory = join(userDataPath, 'spec-assurance');
      await fs.mkdir(assuranceDirectory, { recursive: true });
      await fs.writeFile(join(assuranceDirectory, 'index.json'), '{ broken json', 'utf8');
      const before = await listRelativeFiles(assuranceDirectory);
      const beforeStat = await fs.stat(join(assuranceDirectory, 'index.json'));

      const controller = await makeController(userDataPath);
      await controller.initialize();

      const after = await listRelativeFiles(assuranceDirectory);
      const afterStat = await fs.stat(join(assuranceDirectory, 'index.json'));
      expect(after).toEqual(before);
      expect(await fs.readFile(join(assuranceDirectory, 'index.json'), 'utf8')).toBe(
        '{ broken json',
      );
      expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
      expect(controller.getAppSnapshot().catalog.projects).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
