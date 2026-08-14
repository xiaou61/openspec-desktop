import { describe, expect, it } from 'vitest';
import type {
  ArtifactGraph,
  LifecycleTaskGate,
  SpecSyncAssessment,
  ValidationAssessment,
} from '@shared/contracts';
import { evaluateLifecycle, type LifecycleEvaluationInput } from './evaluator';

const checkedAt = '2026-08-10T08:00:00.000Z';

function completeGraph(): ArtifactGraph {
  return {
    schemaName: 'spec-driven',
    source: 'openspec-cli',
    authoritative: true,
    applyRequires: ['proposal', 'specs', 'design', 'tasks'],
    artifacts: [
      { id: 'proposal', status: 'done', requires: [] },
      { id: 'specs', status: 'done', requires: ['proposal'] },
      { id: 'design', status: 'done', requires: ['proposal'] },
      { id: 'tasks', status: 'done', requires: ['specs', 'design'] },
    ],
  };
}

function completeTasks(): LifecycleTaskGate {
  return {
    applicable: true,
    status: 'complete',
    completed: 4,
    total: 4,
    remaining: 0,
    sourcePath: 'openspec/changes/change-a/tasks.md',
  };
}

function validation(status: ValidationAssessment['status']): ValidationAssessment {
  return {
    status,
    source: 'validation-cache',
    diagnostics: [],
    ...(status === 'not-run' || status === 'running'
      ? {}
      : { checkedAt, fingerprint: 'a'.repeat(64) }),
  };
}

function sync(status: SpecSyncAssessment['status']): SpecSyncAssessment {
  return {
    status,
    source: 'local-comparison',
    checkedAt,
    capabilities: [],
    summary: {
      capabilityCount: 0,
      pendingCount: status === 'pending' ? 1 : 0,
      syncedCount: status === 'synced' ? 1 : 0,
      unknownCount: status === 'unknown' ? 1 : 0,
    },
  };
}

function input(overrides: Partial<LifecycleEvaluationInput> = {}): LifecycleEvaluationInput {
  return {
    projectId: 'project-1',
    changeId: 'change-a',
    archived: false,
    projectAvailable: true,
    contentFingerprint: 'b'.repeat(64),
    evaluatedAt: checkedAt,
    artifactGraph: completeGraph(),
    taskGate: completeTasks(),
    validation: validation('passed'),
    sync: sync('synced'),
    ...overrides,
  };
}

describe('evaluateLifecycle', () => {
  it('keeps archive readiness to artifacts, tasks and strict validation without assurance fields', () => {
    const result = evaluateLifecycle(input());

    expect(result.archiveReadiness.status).toBe('ready');
    expect(result.archiveReadiness.gates.map((gate) => gate.id)).toEqual([
      'artifacts',
      'tasks',
      'validation',
    ]);
    expect(result.nextAction).toMatchObject({ kind: 'archive', targetNode: 'archive' });
  });

  it.each([
    ['not-run', 'run-validation'],
    ['stale', 'run-validation'],
    ['failed', 'fix-validation'],
    ['unavailable', 'run-validation'],
  ] as const)('keeps completed tasks blocked when validation is %s', (status, action) => {
    const result = evaluateLifecycle(input({ validation: validation(status) }));

    expect(result.taskGate.status).toBe('complete');
    expect(result.archiveReadiness.status).toBe('not-ready');
    expect(result.nextAction.kind).toBe(action);
  });

  it.each([
    ['pending', 'ready', 'archive'],
    ['unknown', 'ready', 'archive'],
    ['synced', 'ready', 'archive'],
    ['not-applicable', 'ready', 'archive'],
  ] as const)('keeps spec impact advisory when its state is %s', (status, readiness, action) => {
    const result = evaluateLifecycle(input({ sync: sync(status) }));

    expect(result.archiveReadiness.status).toBe(readiness);
    expect(result.nextAction.kind).toBe(action);
    expect(result.archiveReadiness.gates).toHaveLength(3);
    expect(result.nodes).toHaveLength(6);
  });

  it('keeps a safely previewed pending delta as advisory archive impact', () => {
    const result = evaluateLifecycle(input({ sync: sync('pending') }));

    expect(result.archiveReadiness.gates.map((gate) => gate.id)).toEqual([
      'artifacts',
      'tasks',
      'validation',
    ]);
    expect(result.nextAction).toMatchObject({ kind: 'archive', targetNode: 'archive' });
    expect(result.nextAction.description).toContain('1 个能力');
    expect(result.nodes.map((node) => node.id)).toEqual([
      'proposal',
      'specs',
      'design',
      'tasks',
      'validation',
      'archive',
    ]);
  });

  it('does not let an unavailable local spec preview block a validated archive', () => {
    const result = evaluateLifecycle(input({ sync: sync('unknown') }));

    expect(result.archiveReadiness.status).toBe('ready');
    expect(result.archiveReadiness.gates.map((gate) => gate.id)).not.toContain('sync');
    expect(result.blockers).toEqual([]);
    expect(result.nextAction).toMatchObject({ kind: 'archive', targetNode: 'archive' });
  });

  it.each([
    ['passed', 'complete', 'archive'],
    ['failed', 'blocked', 'fix-validation'],
    ['stale', 'blocked', 'run-validation'],
    ['unavailable', 'unavailable', 'run-validation'],
  ] as const)(
    'keeps the validation node and strict validation action when validation is %s',
    (status, nodeState, action) => {
      const result = evaluateLifecycle(input({ validation: validation(status) }));
      expect(result.nodes.find((node) => node.id === 'validation')).toMatchObject({
        state: nodeState,
      });
      expect(result.nextAction.kind).toBe(action);
    },
  );

  it('treats an omitted tasks artifact as not applicable when the schema does not require it', () => {
    const graph = completeGraph();
    graph.applyRequires = ['proposal', 'specs', 'design'];
    graph.artifacts = graph.artifacts.filter((artifact) => artifact.id !== 'tasks');
    const taskGate: LifecycleTaskGate = {
      applicable: false,
      status: 'not-applicable',
      completed: 0,
      total: 0,
      remaining: 0,
    };

    expect(evaluateLifecycle(input({ artifactGraph: graph, taskGate })).archiveReadiness.status).toBe(
      'ready',
    );
  });

  it('accepts conditionally skipped artifacts as satisfied', () => {
    const graph = completeGraph();
    graph.artifacts = graph.artifacts.map((artifact) =>
      artifact.id === 'design' ? { ...artifact, status: 'skipped' as const } : artifact,
    );

    expect(evaluateLifecycle(input({ artifactGraph: graph })).archiveReadiness.status).toBe(
      'ready',
    );
  });

  it('never lets completed metadata override unfinished tasks', () => {
    const taskGate: LifecycleTaskGate = {
      ...completeTasks(),
      status: 'incomplete',
      completed: 3,
      remaining: 1,
    };
    const result = evaluateLifecycle(input({ taskGate }));

    expect(result.archiveReadiness.status).toBe('not-ready');
    expect(result.nextAction.kind).toBe('continue-implementation');
    expect(result.nodes.find((node) => node.id === 'tasks')).toMatchObject({ state: 'current' });
    expect(result.nodes.find((node) => node.id === 'tasks')?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ summary: expect.stringContaining('3/4') }),
        expect.objectContaining({ summary: expect.stringContaining('1') }),
      ]),
    );
  });

  it('does not show a completed tasks node when the artifact is done but only 57/64 tasks are checked', () => {
    const result = evaluateLifecycle(
      input({
        taskGate: {
          ...completeTasks(),
          status: 'incomplete',
          completed: 57,
          total: 64,
          remaining: 7,
        },
      }),
    );

    expect(result.nodes.find((node) => node.id === 'tasks')).toMatchObject({ state: 'current' });
    expect(result.nextAction).toMatchObject({
      kind: 'continue-implementation',
      description: '还有 7 项任务未完成。',
    });
  });

  it('only completes the tasks node for a non-empty fully checked task list', () => {
    const result = evaluateLifecycle(
      input({ taskGate: { ...completeTasks(), completed: 57, total: 57, remaining: 0 } }),
    );

    expect(result.nodes.find((node) => node.id === 'tasks')).toMatchObject({ state: 'complete' });
  });

  it('treats a readable 0/0 task list as ready without blocking validation', () => {
    const taskGate: LifecycleTaskGate = {
      applicable: true,
      status: 'empty',
      completed: 0,
      total: 0,
      remaining: 0,
      sourcePath: 'openspec/changes/change-a/tasks.md',
    };
    const result = evaluateLifecycle(input({ taskGate, validation: validation('not-run') }));

    expect(result.nodes.find((node) => node.id === 'tasks')).toMatchObject({ state: 'ready' });
    expect(result.archiveReadiness.gates.find((gate) => gate.id === 'tasks')?.status).toBe('pass');
    expect(result.nextAction.kind).toBe('run-validation');
  });

  it('shows an unreadable required task list as unavailable', () => {
    const result = evaluateLifecycle(
      input({
        taskGate: {
          applicable: true,
          status: 'unknown',
          completed: 0,
          total: 0,
          remaining: 0,
          sourcePath: 'openspec/changes/change-a/tasks.md',
          message: '任务文件解析失败',
        },
      }),
    );

    expect(result.nodes.find((node) => node.id === 'tasks')).toMatchObject({
      state: 'unavailable',
    });
    expect(result.nextAction).toMatchObject({ kind: 'continue-implementation' });
  });

  it('uses archived identity as the terminal lifecycle fact', () => {
    const result = evaluateLifecycle(
      input({ archived: true, validation: validation('stale'), sync: sync('unknown') }),
    );

    expect(result.archiveReadiness.status).toBe('archived');
    expect(result.nextAction.kind).toBe('review-archive');
    expect(result.nodes.at(-1)?.state).toBe('archived');
  });

  it('prioritizes project availability and artifact blockers before every later gate', () => {
    const unavailable = evaluateLifecycle(input({ projectAvailable: false }));
    expect(unavailable.nextAction.kind).toBe('recover-project');

    const graph = completeGraph();
    graph.artifacts = graph.artifacts.map((artifact) =>
      artifact.id === 'specs' ? { ...artifact, status: 'blocked' as const } : artifact,
    );
    const blocked = evaluateLifecycle(
      input({
        artifactGraph: graph,
        taskGate: { ...completeTasks(), status: 'incomplete', completed: 3, remaining: 1 },
      }),
    );
    expect(blocked.nextAction.kind).toBe('complete-artifact');
  });

  it('preserves the real custom artifact id outside the fixed lifecycle track', () => {
    const graph: ArtifactGraph = {
      schemaName: 'custom',
      source: 'openspec-cli',
      authoritative: true,
      applyRequires: ['brief', 'deploy'],
      artifacts: [
        { id: 'brief', status: 'done', requires: [] },
        { id: 'deploy', status: 'blocked', requires: ['brief'] },
      ],
    };
    const result = evaluateLifecycle(
      input({
        artifactGraph: graph,
        taskGate: {
          applicable: false,
          status: 'not-applicable',
          completed: 0,
          total: 0,
          remaining: 0,
        },
      }),
    );

    expect(result.nextAction).toMatchObject({
      kind: 'complete-artifact',
      targetNode: 'proposal',
      targetArtifactId: 'deploy',
    });
  });
});
