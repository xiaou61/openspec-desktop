import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  ArtifactGraph,
  ArtifactProjection,
  ChangeProjection,
  ProjectRecord,
} from '@shared/contracts';
import type { ProjectScanResult } from '../domain/scanner';
import { HistoryStore } from '../history/history-store';
import { evaluateLifecycle } from '../lifecycle/evaluator';
import type { LifecycleContext } from '../lifecycle/lifecycle-service';
import { ChangeWorkStateService } from './change-work-state-service';
import { ChangeWorkStateStore } from './change-work-state-store';

function tasksArtifact(
  changeId: string,
  completed: number,
  total: number,
  hash: string,
  archived = false,
): ArtifactProjection {
  const archivePrefix = archived ? 'archive/' : '';
  return {
    type: 'tasks',
    relativePath: `changes/${archivePrefix}${changeId}/tasks.md`,
    sourcePath: `openspec/changes/${archivePrefix}${changeId}/tasks.md`,
    title: 'Tasks',
    headings: [],
    tasks: Array.from({ length: total }, (_, index) => ({
      id: `task-${index + 1}`,
      text: `Task ${index + 1}`,
      checked: index < completed,
      line: index + 1,
    })),
    taskTotals: { completed, total },
    rawContent: `${completed}/${total}`,
    contentHash: hash.repeat(64).slice(0, 64),
    parseHealth: 'ok',
    changeId,
    archived,
  };
}

function change(
  id: string,
  completed: number,
  total: number,
  hash: string,
  archived = false,
  extraArtifacts: ArtifactProjection[] = [],
): ChangeProjection {
  const artifacts = [tasksArtifact(id, completed, total, hash, archived), ...extraArtifacts];
  return {
    id,
    name: id,
    archived,
    stage: archived ? 'archived' : completed === total && total > 0 ? 'completed' : 'implementing',
    readiness: 'ready',
    artifacts,
    missingArtifacts: [],
    taskTotals: { completed, total },
    parseHealth: 'ok',
    validation: { source: 'structural', status: 'not-run' },
  };
}

function scan(
  changes: ChangeProjection[],
  scannedAt: string,
  specs: ArtifactProjection[] = [],
): ProjectScanResult {
  return {
    rootPath: 'C:/demo',
    openspecPath: 'C:/demo/openspec',
    available: true,
    scannedAt,
    specs,
    changes,
    files: [...changes.flatMap((entry) => entry.artifacts), ...specs],
    issues: [],
  };
}

function project(versionLabel = 'v1'): ProjectRecord {
  return {
    id: 'project-1',
    rootPath: 'C:/demo',
    displayName: 'Demo',
    versionLabel,
    versionMode: 'manual',
    versionSource: 'manual',
    groupId: null,
    order: 0,
    watcherEnabled: true,
    watcherState: 'watching',
    available: true,
    registeredAt: '2026-08-10T07:00:00.000Z',
  };
}

const graph: ArtifactGraph = {
  schemaName: 'spec-driven',
  source: 'openspec-cli',
  authoritative: true,
  applyRequires: ['tasks'],
  artifacts: [{ id: 'tasks', status: 'done', requires: [] }],
};

function lifecycleAssessment(context: LifecycleContext) {
  const task = context.change.artifacts.find((artifact) => artifact.type === 'tasks');
  const completed = task?.taskTotals.completed ?? 0;
  const total = task?.taskTotals.total ?? 0;
  const status = !task
    ? ('unknown' as const)
    : total === 0
      ? ('empty' as const)
      : completed === total
        ? ('complete' as const)
        : ('incomplete' as const);
  return evaluateLifecycle({
    projectId: context.projectId,
    changeId: context.change.id,
    archived: context.change.archived,
    projectAvailable: true,
    contentFingerprint: task?.contentHash ?? '0'.repeat(64),
    evaluatedAt: context.scan.scannedAt,
    artifactGraph: graph,
    taskGate: {
      applicable: true,
      status,
      completed,
      total,
      remaining: total - completed,
      ...(task ? { sourcePath: task.sourcePath } : {}),
    },
    validation: { status: 'not-run', source: 'validation-cache', diagnostics: [] },
    sync: {
      status: 'not-applicable',
      source: 'local-comparison',
      checkedAt: context.scan.scannedAt,
      capabilities: [],
      summary: { capabilityCount: 0, pendingCount: 0, syncedCount: 0, unknownCount: 0 },
    },
  });
}

describe('ChangeWorkStateService', () => {
  it('persists and deduplicates reopened transitions across scans and restarts', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'work-state-service-'));
    const history = new HistoryStore(userData, 'project-1');
    await history.init();
    const getAssessment = vi.fn(async (context: LifecycleContext) => lifecycleAssessment(context));
    const store = new ChangeWorkStateStore(userData);
    const service = new ChangeWorkStateService({
      store,
      lifecycle: { getAssessment },
      historyForProject: async () => history,
    });
    const firstAt = '2026-08-10T08:00:00.000Z';
    await service.reconcile({
      project: project(),
      scan: scan([change('change-a', 57, 57, 'a')], firstAt),
    });
    expect(store.snapshot('project-1').active['change-a']).toMatchObject({
      iteration: 1,
      phase: 'completed',
    });

    const reopenedAt = '2026-08-10T09:00:00.000Z';
    const reopenedScan = scan([change('change-a', 57, 64, 'b')], reopenedAt);
    await service.reconcile({ project: project('v2'), scan: reopenedScan });
    const duplicate = await service.reconcile({
      project: project('v2'),
      scan: { ...reopenedScan, scannedAt: '2026-08-10T09:05:00.000Z' },
    });
    expect(duplicate.changedChangeIds).toEqual([]);
    expect(store.snapshot('project-1').active['change-a']).toMatchObject({
      iteration: 2,
      phase: 'reopened',
      reopenedEvents: [
        {
          reason: 'tasks-added',
          projectVersion: { label: 'v2' },
          delta: { completed: 0, total: 7 },
        },
      ],
    });
    const activity = await history.listActivity({ changeId: 'change-a' });
    expect(
      activity.items.filter((entry) => entry.summary.includes('进入第 2 轮实施')),
    ).toHaveLength(1);

    await store.flush();
    const restartedStore = new ChangeWorkStateStore(userData);
    const restarted = new ChangeWorkStateService({
      store: restartedStore,
      lifecycle: { getAssessment },
      historyForProject: async () => history,
    });
    await restarted.reconcile({ project: project('v2'), scan: reopenedScan });
    expect(restartedStore.snapshot('project-1').active['change-a']?.iteration).toBe(2);
    expect((await history.listActivity({ changeId: 'change-a' })).items).toHaveLength(
      activity.items.length,
    );
  });

  it('freezes archive moves, detects archive changes without active lifecycle calls, and survives pruning', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'work-state-service-'));
    const history = new HistoryStore(userData, 'project-1');
    await history.init();
    const getAssessment = vi.fn(async (context: LifecycleContext) => lifecycleAssessment(context));
    const lifecycle = { getAssessment };
    const store = new ChangeWorkStateStore(userData);
    const service = new ChangeWorkStateService({
      store,
      lifecycle,
      historyForProject: async () => history,
    });
    await service.reconcile({
      project: project(),
      scan: scan([change('change-a', 2, 2, 'a')], '2026-08-10T08:00:00.000Z'),
    });
    const archivedId = '2026-08-10-change-a';
    await service.reconcile({
      project: project(),
      scan: scan([change(archivedId, 2, 2, 'a', true)], '2026-08-10T09:00:00.000Z'),
    });
    expect(getAssessment).toHaveBeenCalledTimes(1);
    expect(store.snapshot('project-1').archived[archivedId]).toMatchObject({
      iteration: 1,
      archivedAt: expect.any(String),
      archiveIntegrity: { status: 'baseline' },
    });

    await service.reconcile({
      project: project(),
      scan: scan([change(archivedId, 2, 2, 'b', true)], '2026-08-10T10:00:00.000Z'),
    });
    expect(store.snapshot('project-1').archived[archivedId]?.archiveIntegrity?.status).toBe(
      'changed',
    );
    expect(
      (await history.listActivity({ changeId: archivedId })).items.filter(
        (entry) => entry.kind === 'archive-integrity',
      ),
    ).toHaveLength(1);

    await history.setRetention({ revisionsPerArtifact: 1, activityPerProject: 1 });
    expect(store.snapshot('project-1').archived[archivedId]?.iteration).toBe(1);
    await service.reconcile({
      project: project(),
      scan: scan([change(archivedId, 2, 2, 'a', true)], '2026-08-10T11:00:00.000Z'),
    });
    expect(store.snapshot('project-1').archived[archivedId]?.archiveIntegrity?.status).toBe(
      'restored',
    );
  });

  it('projects capability evolution into the same active work-state', async () => {
    const userData = await fs.mkdtemp(join(tmpdir(), 'work-state-service-'));
    const history = new HistoryStore(userData, 'project-1');
    await history.init();
    const store = new ChangeWorkStateStore(userData);
    const service = new ChangeWorkStateService({
      store,
      lifecycle: { getAssessment: async (context) => lifecycleAssessment(context) },
      historyForProject: async () => history,
    });
    const delta: ArtifactProjection = {
      ...tasksArtifact('change-a', 0, 0, 'c'),
      type: 'spec',
      relativePath: 'changes/change-a/specs/existing/spec.md',
      sourcePath: 'openspec/changes/change-a/specs/existing/spec.md',
    };
    const main: ArtifactProjection = {
      ...delta,
      relativePath: 'specs/existing/spec.md',
      sourcePath: 'openspec/specs/existing/spec.md',
      changeId: undefined,
    };
    const current = change('change-a', 0, 0, 'a', false, [delta]);

    await service.reconcile({
      project: project(),
      scan: scan([current], '2026-08-10T08:00:00.000Z', [main]),
    });

    expect(store.snapshot('project-1').active['change-a']?.evolution?.status).toBe('iteration');
  });
});
