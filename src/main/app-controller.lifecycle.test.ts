import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactGraph } from '@shared/contracts';
import { AppController } from './app-controller';
import { CatalogService } from './catalog/catalog-service';
import { CatalogStore } from './catalog/catalog-store';
import { scanOpenSpecProject } from './domain/scanner';
import { LifecycleService } from './lifecycle/lifecycle-service';
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

async function writeChange(root: string, relative: string): Promise<void> {
  const directory = join(root, 'openspec', 'changes', relative);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(join(directory, 'proposal.md'), '# Proposal\n');
  await fs.writeFile(join(directory, 'design.md'), '# Design\n');
  await fs.writeFile(join(directory, 'tasks.md'), '- [x] Done\n');
  await fs.writeFile(join(directory, '.openspec.yaml'), 'skip_specs: true\n');
}

const graph: ArtifactGraph = {
  schemaName: 'spec-driven',
  source: 'openspec-cli',
  authoritative: true,
  applyRequires: ['proposal', 'design', 'tasks'],
  artifacts: [
    { id: 'proposal', status: 'done', requires: [] },
    { id: 'design', status: 'done', requires: ['proposal'] },
    { id: 'tasks', status: 'done', requires: ['design'] },
  ],
};

describe('AppController lifecycle identity', () => {
  it('resolves exact project/current/archive identities and validates only current Changes', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'app-controller-lifecycle-'));
    try {
      const projectRoot = join(root, 'project');
      const otherRoot = join(root, 'other');
      await fs.mkdir(join(projectRoot, 'openspec'), { recursive: true });
      await fs.mkdir(join(otherRoot, 'openspec'), { recursive: true });
      await fs.writeFile(join(projectRoot, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
      await fs.writeFile(join(otherRoot, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
      await writeChange(projectRoot, 'same-name');
      await writeChange(projectRoot, join('archive', 'same-name'));
      await writeChange(projectRoot, join('archive', 'archived-only'));

      const userDataPath = join(root, 'user-data');
      const catalog = new CatalogService(new CatalogStore(userDataPath));
      const status = vi.fn(async () => graph);
      const validate = vi.fn(async (_root, _id, options) => ({
        status: 'passed' as const,
        source: 'openspec-cli' as const,
        checkedAt: options.checkedAt,
        fingerprint: options.fingerprint,
        diagnostics: [],
      }));
      const lifecycle = new LifecycleService({
        userDataPath,
        cli: { status, validate },
      });
      const controller = new AppController({
        userDataPath,
        catalog,
        watchers: watcherStub(),
        lifecycle,
      });
      expect((controller as unknown as { projectInsights?: unknown }).projectInsights).toBeUndefined();
      const send = vi.fn();
      controller.subscribe({
        webContents: { isDestroyed: () => false, send },
      } as Parameters<AppController['subscribe']>[0]);
      await controller.initialize();
      await controller.registerProject({ rootPath: projectRoot });
      await controller.registerProject({ rootPath: otherRoot });
      const [project, other] = controller.getAppSnapshot().catalog.projects;
      const scan = await scanOpenSpecProject(projectRoot);
      await controller.handleProjection({
        projectId: project!.id,
        snapshot: scan,
        affectedChangeIds: ['same-name', 'archived-only'],
        reason: 'initial',
        emittedAt: new Date().toISOString(),
      });

      const current = await controller.getChangeLifecycle({
        projectId: project!.id,
        changeId: 'same-name',
        archived: false,
      });
      const archived = await controller.getChangeLifecycle({
        projectId: project!.id,
        changeId: 'same-name',
        archived: true,
      });
      expect(current.archiveKey).toBe('active:same-name');
      expect(current.workState).toMatchObject({ iteration: 1, phase: 'completed' });
      expect(archived.archiveKey).toBe('archive:same-name');
      expect(archived.archiveReadiness.status).toBe('archived');

      const validated = await controller.runChangeValidation({
        projectId: project!.id,
        changeId: 'same-name',
      });
      expect(validated.validation.status).toBe('passed');
      expect(validate).toHaveBeenCalledOnce();

      const tasksPath = join(projectRoot, 'openspec', 'changes', 'same-name', 'tasks.md');
      await fs.writeFile(tasksPath, '- [x] Done\n- [ ] Follow up\n');
      const firstSave = await scanOpenSpecProject(projectRoot);
      await controller.handleProjection({
        projectId: project!.id,
        snapshot: firstSave,
        affectedChangeIds: ['same-name'],
        reason: 'events',
        emittedAt: new Date().toISOString(),
      });
      const stale = await controller.getChangeLifecycle({
        projectId: project!.id,
        changeId: 'same-name',
        archived: false,
      });
      expect(stale.validation.status).toBe('stale');
      expect(stale.contentFingerprint).not.toBe(validated.contentFingerprint);
      expect(stale.workState).toMatchObject({ iteration: 2, phase: 'reopened' });

      await controller.handleProjection({
        projectId: project!.id,
        snapshot: firstSave,
        affectedChangeIds: ['same-name'],
        reason: 'events',
        emittedAt: new Date().toISOString(),
      });
      const reopenedActivity = await controller.listActivity({
        projectId: project!.id,
        changeId: 'same-name',
        limit: 100,
      });
      expect(
        reopenedActivity.items.filter((entry) => entry.summary.includes('进入第 2 轮实施')),
      ).toHaveLength(1);

      await fs.writeFile(tasksPath, '- [x] Done\n- [x] Follow up\n- [ ] Final check\n');
      const secondSave = await scanOpenSpecProject(projectRoot);
      await controller.handleProjection({
        projectId: project!.id,
        snapshot: secondSave,
        affectedChangeIds: ['same-name'],
        reason: 'events',
        emittedAt: new Date().toISOString(),
      });
      const latest = await controller.getChangeLifecycle({
        projectId: project!.id,
        changeId: 'same-name',
        archived: false,
      });
      expect(latest.contentFingerprint).not.toBe(stale.contentFingerprint);
      expect(latest.taskGate.remaining).toBe(1);
      expect(latest.workState?.iteration).toBe(2);
      expect(
        controller
          .getAppSnapshot()
          .projects.find((entry) => entry.project.id === project!.id)
          ?.changes.find((entry) => entry.id === 'same-name' && !entry.archived)?.workState
          ?.iteration,
      ).toBe(2);

      await expect(
        controller.runChangeValidation({ projectId: project!.id, changeId: 'archived-only' }),
      ).rejects.toThrow('当前 Change 不存在');
      await expect(
        controller.getChangeLifecycle({
          projectId: other!.id,
          changeId: 'same-name',
          archived: false,
        }),
      ).rejects.toThrow('当前 Change 不存在');
      await expect(
        controller.getChangeLifecycle({
          projectId: 'missing-project',
          changeId: 'same-name',
          archived: false,
        }),
      ).rejects.toThrow('项目不存在');

      await controller.clearHistory({ projectId: project!.id, confirm: true });
      expect(
        controller
          .getAppSnapshot()
          .projects.find((entry) => entry.project.id === project!.id)
          ?.changes.find((entry) => entry.id === 'same-name' && !entry.archived)?.workState,
      ).toBeUndefined();
      await controller.handleProjection({
        projectId: project!.id,
        snapshot: firstSave,
        affectedChangeIds: ['same-name'],
        reason: 'events',
        emittedAt: new Date().toISOString(),
      });
      const afterClear = await controller.getChangeLifecycle({
        projectId: project!.id,
        changeId: 'same-name',
        archived: false,
      });
      expect(afterClear.workState).toMatchObject({ iteration: 1, phase: 'initial-in-progress' });
      expect(afterClear.workState?.reopenedEvents).toEqual([]);
      expect(send).toHaveBeenCalledTimes(6);
      expect(send).toHaveBeenCalledWith(
        'projection:updated',
        expect.objectContaining({
          type: 'project-updated',
          projectId: project!.id,
          changeIds: ['same-name'],
        }),
      );
      for (const [, event] of send.mock.calls) {
        expect(new Set(event.changeIds).size).toBe(event.changeIds.length);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe('AppController validation concurrency', () => {
  it('rejects a second validation for the same Change and runs the CLI once', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'app-controller-validation-concurrency-'));
    try {
      const projectRoot = join(root, 'project');
      await fs.mkdir(join(projectRoot, 'openspec'), { recursive: true });
      await fs.writeFile(join(projectRoot, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
      await writeChange(projectRoot, 'same-name');

      const userDataPath = join(root, 'user-data');
      const catalog = new CatalogService(new CatalogStore(userDataPath));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const validate = vi.fn(async (_root, _id, options) => {
        await gate;
        return {
          status: 'passed' as const,
          source: 'openspec-cli' as const,
          checkedAt: options.checkedAt,
          fingerprint: options.fingerprint,
          diagnostics: [],
        };
      });
      const lifecycle = new LifecycleService({
        userDataPath,
        cli: {
          status: vi.fn(async () => graph),
          validate,
        },
      });
      const controller = new AppController({
        userDataPath,
        catalog,
        watchers: watcherStub(),
        lifecycle,
      });
      await controller.initialize();
      await controller.registerProject({ rootPath: projectRoot });
      const project = controller.getAppSnapshot().catalog.projects[0]!;
      const scan = await scanOpenSpecProject(projectRoot);
      await controller.handleProjection({
        projectId: project.id,
        snapshot: scan,
        affectedChangeIds: ['same-name'],
        reason: 'initial',
        emittedAt: new Date().toISOString(),
      });

      const request = { projectId: project.id, changeId: 'same-name' };
      const first = controller.runChangeValidation(request);
      await Promise.resolve();
      await expect(controller.runChangeValidation(request)).rejects.toThrow('验证已在运行中');
      release();
      await expect(first).resolves.toMatchObject({
        validation: { status: 'passed' },
      });
      expect(validate).toHaveBeenCalledOnce();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});
