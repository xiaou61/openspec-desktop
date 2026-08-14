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

  it('creates and reuses a source-identified workspace group after successful registration', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-service-workspace-'));
    const firstRoot = await projectFixture('openspec-workspace-first-');
    const secondRoot = await projectFixture('openspec-workspace-second-');
    const workspaceRoot = join(userData, 'workspace-root');
    try {
      const service = new CatalogService(new CatalogStore(userData));
      const first = await service.registerProjectInWorkspace(firstRoot, {
        sourceRootPath: workspaceRoot,
        displayName: 'Workspace',
      });
      expect(first.group.kind).toBe('codex-workspace');
      expect(first.project.groupId).toBe(first.group.id);
      await service.updateGroup(first.group.id, { name: 'Renamed workspace' });

      const second = await service.registerProjectInWorkspace(secondRoot, {
        sourceRootPath: `${workspaceRoot}${process.platform === 'win32' ? '\\' : '/'}`,
        displayName: 'Workspace from refresh',
      });
      expect(second.group.id).toBe(first.group.id);
      expect(second.group.name).toBe('Renamed workspace');
      expect(service.snapshot().groups).toHaveLength(1);
      expect(service.snapshot().projects.map((project) => project.groupId)).toEqual([
        first.group.id,
        first.group.id,
      ]);
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
      await fs.rm(firstRoot, { recursive: true, force: true });
      await fs.rm(secondRoot, { recursive: true, force: true });
    }
  });

  it('does not reuse a same-named manual group and does not leave an empty group on failure', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-service-workspace-manual-'));
    const root = await projectFixture('openspec-workspace-manual-project-');
    const workspaceRoot = join(userData, 'workspace-root');
    try {
      const service = new CatalogService(new CatalogStore(userData));
      const manual = await service.createGroup('Workspace');
      await expect(
        service.registerProjectInWorkspace(join(userData, 'missing'), {
          sourceRootPath: workspaceRoot,
          displayName: 'Workspace',
        }),
      ).rejects.toBeInstanceOf(CatalogValidationError);
      expect(service.snapshot().groups).toHaveLength(1);
      const imported = await service.registerProjectInWorkspace(root, {
        sourceRootPath: workspaceRoot,
        displayName: 'Workspace',
      });
      expect(imported.group.kind).toBe('codex-workspace');
      expect(imported.group.id).not.toBe(manual.id);
      expect(service.snapshot().groups).toHaveLength(2);
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('serializes concurrent workspace registrations and preserves an existing project group', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'openspec-service-workspace-concurrent-'));
    const firstRoot = await projectFixture('openspec-workspace-concurrent-first-');
    const secondRoot = await projectFixture('openspec-workspace-concurrent-second-');
    const thirdRoot = await projectFixture('openspec-workspace-concurrent-third-');
    const workspaceRoot = join(userData, 'workspace-root');
    try {
      const service = new CatalogService(new CatalogStore(userData));
      const manual = await service.createGroup('Manual');
      const existing = await service.registerProject(thirdRoot, { groupId: manual.id });
      await expect(
        service.registerProjectInWorkspace(thirdRoot, {
          sourceRootPath: workspaceRoot,
          displayName: 'Workspace',
        }),
      ).rejects.toBeInstanceOf(CatalogValidationError);
      expect(service.getProject(existing.id).groupId).toBe(manual.id);

      const results = await Promise.all([
        service.registerProjectInWorkspace(firstRoot, {
          sourceRootPath: workspaceRoot,
          displayName: 'Workspace',
        }),
        service.registerProjectInWorkspace(secondRoot, {
          sourceRootPath: workspaceRoot,
          displayName: 'Workspace',
        }),
      ]);
      expect(new Set(results.map((result) => result.group.id)).size).toBe(1);
      expect(
        service.snapshot().groups.filter((group) => group.kind === 'codex-workspace'),
      ).toHaveLength(1);
      const workspaceGroup = results[0].group;
      await service.removeGroup(workspaceGroup.id);
      expect(
        service.snapshot().projects.filter((project) => project.groupId === workspaceGroup.id),
      ).toHaveLength(0);
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
      await fs.rm(firstRoot, { recursive: true, force: true });
      await fs.rm(secondRoot, { recursive: true, force: true });
      await fs.rm(thirdRoot, { recursive: true, force: true });
    }
  });
});
