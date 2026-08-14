import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  changeWorkStateSchema,
  type ArtifactProjection,
  type CatalogState,
  type ChangeLifecycleAssessment,
  type ChangeProjection,
  type ProjectRecord,
} from '@shared/contracts';
import type { ProjectScanResult } from '../domain/scanner';
import { evaluateLifecycle } from '../lifecycle/evaluator';
import type { LifecycleContext } from '../lifecycle/lifecycle-service';
import { ChangeWorkStateStore } from '../work-state/change-work-state-store';
import { ActionCenterService } from './action-center-service';

const now = '2026-08-10T08:00:00.000Z';

function project(id: string, rootPath: string, available = true): ProjectRecord {
  return {
    id,
    rootPath,
    displayName: id,
    versionLabel: 'v1',
    versionMode: 'manual',
    versionSource: 'manual',
    groupId: null,
    order: 0,
    watcherEnabled: true,
    watcherState: available ? 'watching' : 'unavailable',
    available,
    registeredAt: now,
    ...(available ? {} : { error: '项目目录不可用' }),
  };
}

function tasks(
  changeId: string,
  completed: number,
  total: number,
  hash: string,
): ArtifactProjection {
  return {
    type: 'tasks',
    relativePath: `changes/${changeId}/tasks.md`,
    sourcePath: `openspec/changes/${changeId}/tasks.md`,
    title: 'Tasks',
    headings: [],
    tasks: [],
    taskTotals: { completed, total },
    rawContent: `${completed}/${total}`,
    contentHash: hash.repeat(64).slice(0, 64),
    parseHealth: 'ok',
    changeId,
    archived: false,
  };
}

function change(
  id: string,
  completed: number,
  total: number,
  hash: string,
  options: Partial<ChangeProjection> = {},
): ChangeProjection {
  return {
    id,
    name: id,
    archived: false,
    stage: completed === total && total > 0 ? 'completed' : 'implementing',
    readiness: 'ready',
    artifacts: [tasks(id, completed, total, hash)],
    missingArtifacts: [],
    taskTotals: { completed, total },
    parseHealth: 'ok',
    validation: { source: 'structural', status: 'not-run' },
    ...options,
  };
}

function scan(rootPath: string, changes: ChangeProjection[]): ProjectScanResult {
  return {
    rootPath,
    openspecPath: join(rootPath, 'openspec'),
    available: true,
    scannedAt: now,
    specs: [],
    changes,
    files: changes.flatMap((entry) => entry.artifacts),
    issues: [],
  };
}

function assessment(context: LifecycleContext): ChangeLifecycleAssessment {
  const task = context.change.artifacts.find((artifact) => artifact.type === 'tasks')!;
  const custom = context.change.id === 'custom-change';
  const completed = task.taskTotals.completed;
  const total = task.taskTotals.total;
  return evaluateLifecycle({
    projectId: context.projectId,
    changeId: context.change.id,
    archived: false,
    projectAvailable: true,
    contentFingerprint: task.contentHash!,
    evaluatedAt: now,
    artifactGraph: custom
      ? {
          schemaName: 'custom',
          source: 'openspec-cli',
          authoritative: true,
          applyRequires: ['brief', 'deploy'],
          artifacts: [
            { id: 'brief', status: 'done', requires: [] },
            { id: 'deploy', status: 'blocked', requires: ['brief'] },
          ],
        }
      : {
          schemaName: 'spec-driven',
          source: 'openspec-cli',
          authoritative: true,
          applyRequires: ['tasks'],
          artifacts: [{ id: 'tasks', status: 'done', requires: [] }],
        },
    taskGate: custom
      ? { applicable: false, status: 'not-applicable', completed: 0, total: 0, remaining: 0 }
      : {
          applicable: true,
          status: completed === total ? 'complete' : 'incomplete',
          completed,
          total,
          remaining: total - completed,
          sourcePath: task.sourcePath,
        },
    validation: { status: 'not-run', source: 'validation-cache', diagnostics: [] },
    sync: {
      status: 'not-applicable',
      source: 'local-comparison',
      checkedAt: now,
      capabilities: [],
      summary: { capabilityCount: 0, pendingCount: 0, syncedCount: 0, unknownCount: 0 },
    },
  });
}

function catalog(projects: ProjectRecord[]): Pick<{ snapshot(): CatalogState }, 'snapshot'> {
  return {
    snapshot: () => ({
      schemaVersion: 3,
      groups: [],
      projects,
      preferences: {
        selectedProjectId: projects[0]?.id ?? null,
        selectedChangeId: null,
        showArchived: false,
        windowBounds: { width: 1280, height: 800 },
      },
    }),
  };
}

describe('ActionCenterService', () => {
  it('isolates partial projects, limits lifecycle concurrency, caches health and preserves structural tasks', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'action-center-'));
    const userData = join(root, 'user-data');
    const projects = Array.from({ length: 7 }, (_, index) =>
      project(`project-${index + 1}`, join(root, `project-${index + 1}`)),
    );
    const scans = new Map(
      projects.map((entry, index) => [
        entry.id,
        scan(entry.rootPath, [
          change(`change-${index + 1}`, index === 0 ? 57 : 1, index === 0 ? 64 : 2, `${index + 1}`),
        ]),
      ]),
    );
    let active = 0;
    let maximum = 0;
    const getAssessment = vi.fn(async (context: LifecycleContext) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (context.projectId === 'project-2') throw new Error('status incompatible');
      return assessment(context);
    });
    const doctor = vi.fn(async (projectRoot: string) => {
      if (projectRoot.endsWith('project-2')) throw new Error('doctor timeout');
      return { healthy: true, rootSource: 'nearest', relations: [], diagnostics: [] };
    });
    const context = vi.fn(async () => ({
      rootRole: 'openspec_root',
      rootSource: 'nearest',
      members: [],
      diagnostics: [],
    }));
    const service = new ActionCenterService({
      catalog: catalog(projects),
      getScan: (projectId) => scans.get(projectId) ?? null,
      lifecycle: { getAssessment },
      cli: { doctor, context, instructions: vi.fn() },
      workStateStore: new ChangeWorkStateStore(userData),
      now: () => new Date(now),
    });

    const first = await service.getActionCenter({});
    expect(first.status).toBe('partial');
    expect(maximum).toBeLessThanOrEqual(4);
    expect(maximum).toBeGreaterThan(1);
    expect(first.items[0]).toMatchObject({
      projectId: 'project-2',
      actionType: 'project-health',
      priority: 0,
    });
    expect(first.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: 'project-1',
          actionType: 'continue-implementation',
          taskGate: expect.objectContaining({ completed: 57, total: 64 }),
        }),
        expect.objectContaining({
          projectId: 'project-2',
          changeId: 'change-2',
          actionType: 'continue-implementation',
          evidence: [expect.objectContaining({ source: 'structural' })],
        }),
      ]),
    );

    const second = await service.getActionCenter({});
    expect(second.items.map((item) => item.actionKey)).toEqual(
      first.items.map((item) => item.actionKey),
    );
    expect(doctor).toHaveBeenCalledTimes(projects.length);
    await service.getActionCenter({ refresh: true });
    expect(doctor).toHaveBeenCalledTimes(projects.length * 2);
  });

  it('restarts an in-flight aggregation when a project projection is invalidated', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'action-center-race-'));
    const currentProject = project('project-1', join(root, 'project-1'));
    let currentChange = change('expanded-change', 57, 57, '1');
    let releaseProbe!: () => void;
    let markProbeStarted!: () => void;
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve;
    });
    const probeBlocked = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const doctor = vi.fn(async () => {
      if (doctor.mock.calls.length === 1) {
        markProbeStarted();
        await probeBlocked;
      }
      return { healthy: true, rootSource: 'nearest' as const, relations: [], diagnostics: [] };
    });
    const service = new ActionCenterService({
      catalog: catalog([currentProject]),
      getScan: () => scan(currentProject.rootPath, [currentChange]),
      lifecycle: { getAssessment: async (input) => assessment(input) },
      cli: {
        doctor,
        context: async () => ({
          rootRole: 'openspec_root',
          rootSource: 'nearest',
          members: [],
          diagnostics: [],
        }),
        instructions: vi.fn(),
      },
      workStateStore: new ChangeWorkStateStore(join(root, 'user-data')),
      now: () => new Date(now),
    });

    const pending = service.getActionCenter({});
    await probeStarted;
    currentChange = change('expanded-change', 57, 64, '2');
    service.invalidate(currentProject.id);
    releaseProbe();

    const result = await pending;
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeId: 'expanded-change',
          actionType: 'continue-implementation',
          taskGate: expect.objectContaining({ completed: 57, total: 64, remaining: 7 }),
        }),
      ]),
    );
    expect(doctor).toHaveBeenCalledTimes(2);
  });

  it('handles empty ranges, custom artifacts, evolution and archive anomalies in stable order', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'action-center-'));
    const userData = join(root, 'user-data');
    const currentProject = project('project-1', join(root, 'project-1'));
    const evolution = {
      status: 'iteration' as const,
      assessedAt: now,
      capabilities: [
        {
          capabilityPath: 'existing',
          targetPath: 'specs/existing/spec.md',
          status: 'existing' as const,
        },
      ],
    };
    const archiveState = changeWorkStateSchema.parse({
      schemaVersion: 1,
      changeId: 'archive-change',
      activeGeneration: 'a'.repeat(64),
      iteration: 1,
      phase: 'observing',
      completionMilestones: [],
      reopenedEvents: [],
      archiveIntegrity: {
        status: 'changed',
        baselineFingerprint: 'b'.repeat(64),
        currentFingerprint: 'c'.repeat(64),
        observedAt: now,
        incident: 1,
        changedAt: now,
        lastEventKey: 'd'.repeat(64),
      },
      archivedAt: now,
      updatedAt: now,
    });
    const changes = [
      change('custom-change', 0, 0, '1'),
      change('iteration-change', 1, 2, '2', { evolution }),
      change('archive-change', 0, 0, '3', {
        archived: true,
        stage: 'archived',
        workState: archiveState,
      }),
      change('ordinary-archive', 0, 0, '4', { archived: true, stage: 'archived' }),
    ];
    const service = new ActionCenterService({
      catalog: catalog([currentProject]),
      getScan: () => scan(currentProject.rootPath, changes),
      lifecycle: { getAssessment: async (input) => assessment(input) },
      cli: {
        doctor: async () => ({
          healthy: true,
          rootSource: 'nearest',
          relations: [],
          diagnostics: [],
        }),
        context: async () => ({
          rootRole: 'openspec_root',
          rootSource: 'nearest',
          members: [],
          diagnostics: [],
        }),
        instructions: vi.fn(),
      },
      workStateStore: new ChangeWorkStateStore(userData),
      now: () => new Date(now),
    });

    const result = await service.getActionCenter({ projectId: 'project-1' });
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetArtifactId: 'deploy', priority: 1 }),
        expect.objectContaining({
          changeId: 'iteration-change',
          evolution: expect.objectContaining({ status: 'iteration' }),
        }),
        expect.objectContaining({ changeId: 'archive-change', actionType: 'archive-integrity' }),
      ]),
    );
    expect(result.items.some((item) => item.changeId === 'ordinary-archive')).toBe(false);

    const emptyService = new ActionCenterService({
      catalog: catalog([currentProject]),
      getScan: () => scan(currentProject.rootPath, [changes[3]!]),
      lifecycle: { getAssessment: async (input) => assessment(input) },
      cli: {
        doctor: async () => ({
          healthy: true,
          rootSource: 'nearest',
          relations: [],
          diagnostics: [],
        }),
        context: async () => ({
          rootRole: 'openspec_root',
          rootSource: 'nearest',
          members: [],
          diagnostics: [],
        }),
        instructions: vi.fn(),
      },
      workStateStore: new ChangeWorkStateStore(join(root, 'empty-user-data')),
      now: () => new Date(now),
    });
    expect((await emptyService.getActionCenter({ projectId: 'project-1' })).items).toEqual([]);
  });

  it('builds handoff lazily, rejects stale evidence and leaves project files unchanged', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'action-center-'));
    const projectRoot = join(root, 'project');
    const userData = join(root, 'user-data');
    const tasksPath = join(projectRoot, 'openspec', 'changes', 'custom-change', 'tasks.md');
    await fs.mkdir(join(tasksPath, '..'), { recursive: true });
    await fs.writeFile(tasksPath, '- [ ] Task\n', 'utf8');
    const before = createHash('sha256')
      .update(await fs.readFile(tasksPath))
      .digest('hex');
    const currentProject = project('project-1', projectRoot);
    let currentChange = change('custom-change', 0, 0, '1');
    const instructions = vi.fn(async () => ({
      changeId: 'custom-change',
      target: 'deploy',
      schemaName: 'custom',
      dependencies: [{ id: 'brief', done: true }],
      contextFiles: [
        {
          artifactId: 'deploy',
          paths: ['openspec/changes/custom-change/deploy.md'],
        },
      ],
      instruction: 'Continue the deploy artifact.',
    }));
    const service = new ActionCenterService({
      catalog: catalog([currentProject]),
      getScan: () => scan(projectRoot, [currentChange]),
      lifecycle: { getAssessment: async (input) => assessment(input) },
      cli: {
        doctor: async () => ({
          healthy: true,
          rootSource: 'nearest',
          relations: [],
          diagnostics: [],
        }),
        context: async () => ({
          rootRole: 'openspec_root',
          rootSource: 'nearest',
          members: [],
          diagnostics: [],
        }),
        instructions,
      },
      workStateStore: new ChangeWorkStateStore(userData),
      now: () => new Date(now),
    });
    const snapshot = await service.getActionCenter({});
    const item = snapshot.items.find((entry) => entry.changeId === 'custom-change')!;
    expect(instructions).not.toHaveBeenCalled();

    const handoff = await service.buildCodexHandoff({
      actionKey: item.actionKey,
      evidenceFingerprint: item.evidenceFingerprint,
    });
    expect(handoff.stale).toBe(false);
    expect(handoff.markdown).toContain('openspec/changes/custom-change/deploy.md');
    expect(handoff.markdown.length).toBeLessThanOrEqual(12_000);
    expect(instructions).toHaveBeenCalledWith(projectRoot, 'custom-change', 'deploy');
    expect(
      createHash('sha256')
        .update(await fs.readFile(tasksPath))
        .digest('hex'),
    ).toBe(before);

    currentChange = change('custom-change', 0, 0, '2');
    const stale = await service.buildCodexHandoff({
      actionKey: item.actionKey,
      evidenceFingerprint: item.evidenceFingerprint,
    });
    expect(stale).toMatchObject({ stale: true, currentAction: { changeId: 'custom-change' } });

    await expect(
      service.buildCodexHandoff({
        actionKey: `ac1:${'f'.repeat(64)}`,
        evidenceFingerprint: item.evidenceFingerprint,
      }),
    ).rejects.toThrow('行动不存在或已失效');

    currentChange = { ...currentChange, archived: true };
    await expect(
      service.buildCodexHandoff({
        actionKey: item.actionKey,
        evidenceFingerprint: stale.evidenceFingerprint,
      }),
    ).rejects.toThrow('行动不存在或已失效');
    expect(
      createHash('sha256')
        .update(await fs.readFile(tasksPath))
        .digest('hex'),
    ).toBe(before);
  });
});
