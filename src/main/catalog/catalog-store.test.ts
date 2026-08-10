import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CatalogStore, createDefaultCatalogState } from './catalog-store';

function createV1Catalog() {
  return {
    schemaVersion: 1 as const,
    groups: [{ id: 'group-1', name: '产品组', order: 0 }],
    projects: [
      {
        id: 'project-manual',
        rootPath: 'C:/Projects/manual',
        displayName: '手动版本项目',
        versionLabel: 'v1.2.3',
        groupId: 'group-1',
        order: 0,
        watcherEnabled: true,
        watcherState: 'watching' as const,
        available: true,
        registeredAt: '2026-08-08T10:00:00.000Z',
        lastScannedAt: '2026-08-08T10:01:00.000Z',
        lastActivityAt: '2026-08-08T10:02:00.000Z',
      },
      {
        id: 'project-workspace',
        rootPath: 'C:/Projects/workspace',
        displayName: '当前工作区项目',
        versionLabel: '',
        groupId: null,
        order: 1,
        watcherEnabled: false,
        watcherState: 'paused' as const,
        available: false,
        registeredAt: '2026-08-08T11:00:00.000Z',
        error: '项目目录不可用',
      },
    ],
    preferences: {
      selectedProjectId: 'project-manual',
      selectedChangeId: 'change-1',
      showArchived: true,
      windowBounds: { width: 1280, height: 760, x: 24, y: 36 },
    },
  };
}

describe('CatalogStore', () => {
  it('writes validated state atomically and reloads it', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-catalog-'));
    try {
      const store = new CatalogStore(userData);
      const state = createDefaultCatalogState();
      state.preferences.showArchived = true;
      await store.save(state);
      const loaded = await store.load();
      expect(loaded.state.preferences.showArchived).toBe(true);
      expect(loaded.state.schemaVersion).toBe(2);
      expect((await fs.readdir(userData)).some((name) => name.includes('.tmp-'))).toBe(false);
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
    }
  });

  it('moves corrupt JSON aside and returns a recoverable default', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-corrupt-'));
    try {
      await fs.writeFile(join(userData, 'catalog.json'), '{not-json');
      const result = await new CatalogStore(userData).load();
      expect(result.recoveredFromCorruption).toBe(true);
      expect(result.state.schemaVersion).toBe(2);
      expect(
        (await fs.readdir(userData)).some((name) => name.startsWith('catalog.json.corrupt-')),
      ).toBe(true);
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
    }
  });

  it('backs up and migrates a complete v1 catalog without losing project context', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-migrate-'));
    try {
      await fs.writeFile(
        join(userData, 'catalog.json'),
        `${JSON.stringify(createV1Catalog(), null, 2)}\n`,
      );

      const result = await new CatalogStore(userData).load();

      expect(result.recoveredFromCorruption).toBe(false);
      expect(result.recoveryMessage).toContain('v1');
      expect(result.state).toMatchObject({
        schemaVersion: 2,
        groups: [{ id: 'group-1', name: '产品组', order: 0 }],
        preferences: {
          selectedProjectId: 'project-manual',
          selectedChangeId: 'change-1',
          showArchived: true,
          windowBounds: { width: 1280, height: 760, x: 24, y: 36 },
        },
      });
      expect(result.state.projects[0]).toMatchObject({
        id: 'project-manual',
        versionLabel: 'v1.2.3',
        versionMode: 'manual',
        versionSource: 'manual',
        lastScannedAt: '2026-08-08T10:01:00.000Z',
        lastActivityAt: '2026-08-08T10:02:00.000Z',
      });
      expect(result.state.projects[1]).toMatchObject({
        id: 'project-workspace',
        versionLabel: '',
        versionMode: 'automatic',
        versionSource: 'workspace',
        error: '项目目录不可用',
      });

      const files = await fs.readdir(userData);
      expect(files.some((name) => name.startsWith('catalog.json.v1-backup-'))).toBe(true);
      expect(JSON.parse(await fs.readFile(join(userData, 'catalog.json'), 'utf8'))).toEqual(
        result.state,
      );
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
    }
  });

  it('keeps the recognizable v1 catalog recoverable when migration persistence fails', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-migrate-failure-'));
    try {
      const catalogPath = join(userData, 'catalog.json');
      const original = `${JSON.stringify(createV1Catalog(), null, 2)}\n`;
      await fs.writeFile(catalogPath, original);
      const store = new CatalogStore(userData);
      vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('磁盘已满'));

      const result = await store.load();

      expect(result.recoveredFromCorruption).toBe(true);
      expect(result.recoveryMessage).toContain('迁移失败');
      expect(result.state).toEqual(createDefaultCatalogState());
      expect(await fs.readFile(catalogPath, 'utf8')).toBe(original);
      expect(
        (await fs.readdir(userData)).some((name) => name.startsWith('catalog.json.corrupt-')),
      ).toBe(false);
    } finally {
      vi.restoreAllMocks();
      await fs.rm(userData, { recursive: true, force: true });
    }
  });
});
