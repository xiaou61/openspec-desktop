import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CatalogStore } from './catalog-store';
import { CatalogService, CatalogValidationError } from './catalog-service';

async function projectFixture(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), prefix));
  await fs.mkdir(join(root, 'openspec', 'changes'), { recursive: true });
  await fs.writeFile(join(root, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  return root;
}

describe('CatalogService', () => {
  it('registers, groups, relocates, and unregisters without changing source files', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-service-data-'));
    const root = await projectFixture('openspec-service-project-');
    const relocated = await projectFixture('openspec-service-relocated-');
    const stopMonitoring = vi.fn();
    try {
      const service = new CatalogService(new CatalogStore(userData), { stopMonitoring });
      await service.init();
      const group = await service.createGroup('Personal');
      const project = await service.registerProject(root, {
        groupId: group.id,
        versionLabel: '2026.08',
      });
      expect(project.groupId).toBe(group.id);
      const before = await fs.readFile(join(root, 'openspec', 'config.yaml'), 'utf8');
      const updated = await service.relocateProject(project.id, relocated);
      expect(updated.rootPath).toBe(relocated);
      await service.unregisterProject(project.id);
      expect(stopMonitoring).toHaveBeenCalledWith(project.id);
      expect(await fs.readFile(join(root, 'openspec', 'config.yaml'), 'utf8')).toBe(before);
      expect(service.snapshot().projects).toHaveLength(0);
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(relocated, { recursive: true, force: true });
    }
  });

  it('moves projects to ungrouped when a non-empty group is removed', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-service-group-'));
    const root = await projectFixture('openspec-service-group-project-');
    try {
      const service = new CatalogService(new CatalogStore(userData));
      const group = await service.createGroup('Temporary');
      const project = await service.registerProject(root, { groupId: group.id });
      await service.removeGroup(group.id);
      expect(service.getProject(project.id).groupId).toBeNull();
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects invalid directories and duplicate registrations', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-service-invalid-'));
    const root = await projectFixture('openspec-service-duplicate-');
    const invalid = await fs.mkdtemp(join(tmpdir(), 'openspec-service-not-project-'));
    try {
      const service = new CatalogService(new CatalogStore(userData));
      await expect(service.registerProject(invalid)).rejects.toBeInstanceOf(CatalogValidationError);
      await service.registerProject(root);
      await expect(service.registerProject(root)).rejects.toBeInstanceOf(CatalogValidationError);
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(invalid, { recursive: true, force: true });
    }
  });
});
