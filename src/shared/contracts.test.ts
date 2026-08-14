import { describe, expect, it } from 'vitest';
import {
  artifactProjectionSchema,
  actionCenterSnapshotSchema,
  archiveGateSchema,
  catalogStateSchema,
  changeLifecycleAssessmentSchema,
  changeProjectionSchema,
  changeWorkStateSchema,
  codexHandoffSchema,
  codexProjectListSchema,
  implementationTaskObservationSchema,
  lifecycleBlockerSchema,
  lifecycleNextActionKindSchema,
  lifecycleNodeIdSchema,
  lifecycleNodeStateSchema,
  lifecycleTaskGateSchema,
  projectGroupSchema,
  projectRecordSchema,
  versionSourceSchema,
} from './contracts';
import {
  codexImportProjectsRequestSchema,
  openExternalRequestSchema,
  revealArtifactRequestSchema,
} from './ipc-contracts';

describe('shared contracts', () => {
  it('rejects unknown fields and unsafe paths at the serialization boundary', () => {
    expect(
      projectRecordSchema.safeParse({
        id: 'project-1',
        rootPath: 'C:/Projects/demo',
        displayName: 'Demo',
        versionLabel: 'v1',
        versionMode: 'manual',
        versionSource: 'manual',
        groupId: null,
        order: 0,
        watcherEnabled: true,
        watcherState: 'watching',
        available: true,
        registeredAt: new Date().toISOString(),
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      revealArtifactRequestSchema.safeParse({ projectId: 'project-1', sourcePath: '../secret.md' })
        .success,
    ).toBe(false);
  });

  it('accepts every version source and enforces the 120-character version boundary', () => {
    expect(versionSourceSchema.options).toEqual(['git-tag', 'package-json', 'manual', 'workspace']);
    const record = {
      id: 'project-1',
      rootPath: 'C:/Projects/demo',
      displayName: 'Demo',
      versionLabel: 'v'.repeat(120),
      versionMode: 'manual' as const,
      versionSource: 'manual' as const,
      versionResolvedAt: new Date().toISOString(),
      groupId: null,
      order: 0,
      watcherEnabled: true,
      watcherState: 'watching' as const,
      available: true,
      registeredAt: new Date().toISOString(),
    };

    expect(projectRecordSchema.safeParse(record).success).toBe(true);
    expect(
      projectRecordSchema.safeParse({ ...record, versionLabel: 'v'.repeat(121) }).success,
    ).toBe(false);
    for (const versionSource of versionSourceSchema.options) {
      expect(projectRecordSchema.safeParse({ ...record, versionSource }).success).toBe(true);
    }
  });

  it('only accepts HTTPS-compatible external URLs through the request schema', () => {
    expect(openExternalRequestSchema.safeParse({ url: 'https://example.com/docs' }).success).toBe(
      true,
    );
    expect(openExternalRequestSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
    expect(artifactProjectionSchema.safeParse({}).success).toBe(false);
  });

  it('bounds Codex candidate and import payloads at the serialization boundary', () => {
    expect(
      codexImportProjectsRequestSchema.safeParse({
        projects: [
          {
            rootPath: 'C:/Projects/demo',
            displayName: 'Demo',
            workspace: {
              id: 'workspace-1',
              rootPath: 'C:/Projects',
              displayName: 'Projects',
            },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      codexImportProjectsRequestSchema.safeParse({
        projects: [
          {
            rootPath: 'C:/Projects/demo',
            displayName: 'Demo',
            workspace: { id: 'workspace-1', rootPath: 'C:/Projects' },
          },
        ],
      }).success,
    ).toBe(false);
    expect(codexImportProjectsRequestSchema.safeParse({ projects: [] }).success).toBe(false);
    expect(
      codexImportProjectsRequestSchema.safeParse({
        projects: Array.from({ length: 51 }, (_, index) => ({
          rootPath: `C:/Projects/${index}`,
          displayName: `${index}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      codexProjectListSchema.safeParse({
        entries: [],
        summary: {
          source: 'primary',
          indexedRootCount: 0,
          workspaceCount: 0,
          repositoryCount: 0,
          openSpecProjectCount: 0,
          availableCount: 0,
          truncated: false,
          truncationReasons: [],
        },
        scannedAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });

  it('strictly validates hierarchical Codex discovery entries and their summaries', () => {
    const workspace = {
      kind: 'workspace' as const,
      id: 'workspace-1',
      displayName: 'Demo Workspace',
      rootPath: 'C:/Demo',
      source: 'local-project' as const,
      members: [
        {
          kind: 'openspec-project' as const,
          id: 'project-1',
          displayName: 'Frontend',
          rootPath: 'C:/Demo/web',
          status: 'available' as const,
        },
        {
          kind: 'repository' as const,
          id: 'repository-1',
          displayName: 'Backend',
          rootPath: 'C:/Demo/api',
          status: 'not-configured' as const,
          reason: '尚未配置 OpenSpec',
        },
      ],
      diagnostics: [
        {
          code: 'unreadable' as const,
          path: 'C:/Demo/unreadable',
          message: '目录不可读取',
        },
      ],
      truncated: false,
      truncationReasons: [],
      repositoryCount: 2,
      openSpecProjectCount: 1,
      availableCount: 1,
    };
    const list = {
      entries: [
        {
          kind: 'direct-project' as const,
          id: 'direct-1',
          displayName: 'Direct',
          rootPath: 'C:/Direct',
          source: 'saved-workspace' as const,
          status: 'already-added' as const,
          reason: '该项目已添加',
        },
        workspace,
      ],
      summary: {
        source: 'backup' as const,
        indexedRootCount: 2,
        workspaceCount: 1,
        repositoryCount: 3,
        openSpecProjectCount: 2,
        availableCount: 1,
        truncated: false,
        truncationReasons: [],
        message: '主索引不可用，已读取备份',
      },
      scannedAt: '2026-08-11T00:00:00.000Z',
    };

    expect(codexProjectListSchema.safeParse(list).success).toBe(true);
    expect(
      codexProjectListSchema.safeParse({
        ...list,
        entries: [
          {
            ...workspace,
            members: [{ ...workspace.members[1], status: 'available' }],
            repositoryCount: 1,
            openSpecProjectCount: 0,
            availableCount: 0,
          },
        ],
        summary: { ...list.summary, repositoryCount: 1, openSpecProjectCount: 0 },
      }).success,
    ).toBe(false);
    expect(
      codexProjectListSchema.safeParse({
        ...list,
        entries: [{ ...workspace, repositoryCount: 99 }],
        summary: {
          ...list.summary,
          repositoryCount: 99,
          openSpecProjectCount: 1,
          availableCount: 1,
        },
      }).success,
    ).toBe(false);
    expect(
      codexProjectListSchema.safeParse({
        ...list,
        entries: [
          {
            ...workspace,
            members: Array.from({ length: 501 }, (_, index) => ({
              kind: 'repository' as const,
              id: `repository-${index}`,
              displayName: `Repository ${index}`,
              rootPath: `C:/Demo/repository-${index}`,
              status: 'not-configured' as const,
              reason: '尚未配置 OpenSpec',
            })),
            diagnostics: [{ code: 'unreadable', message: 'x'.repeat(501) }],
            repositoryCount: 500,
            openSpecProjectCount: 0,
            availableCount: 0,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires explicit project-group kinds and normalized workspace source roots', () => {
    expect(
      projectGroupSchema.safeParse({ id: 'manual-1', name: 'Manual', order: 0, kind: 'manual' })
        .success,
    ).toBe(true);
    expect(
      projectGroupSchema.safeParse({
        id: 'workspace-1',
        name: 'Demo Workspace',
        order: 1,
        kind: 'codex-workspace',
        sourceRootPath: 'C:/Demo',
      }).success,
    ).toBe(true);
    expect(
      projectGroupSchema.safeParse({
        id: 'workspace-1',
        name: 'Demo Workspace',
        order: 1,
        kind: 'codex-workspace',
        sourceRootPath: 'C:/Demo/',
      }).success,
    ).toBe(false);
    expect(catalogStateSchema.safeParse({ schemaVersion: 2 }).success).toBe(false);
  });

  it('keeps legacy Change projections compatible while enforcing lifecycle responses', () => {
    const legacyChange = {
      id: 'change-a',
      name: 'change-a',
      archived: false,
      stage: 'completed',
      readiness: 'ready',
      artifacts: [],
      missingArtifacts: [],
      taskTotals: { completed: 2, total: 2 },
      parseHealth: 'ok',
      validation: { source: 'structural', status: 'not-run' },
    };
    expect(changeProjectionSchema.safeParse(legacyChange).success).toBe(true);

    const lifecycle = {
      schemaVersion: 1,
      projectId: 'project-1',
      changeId: 'change-a',
      archiveKey: 'active:change-a',
      archived: false,
      projectAvailable: true,
      contentFingerprint: 'a'.repeat(64),
      evaluatedAt: '2026-08-10T08:00:00.000Z',
      nodes: [
        {
          id: 'proposal',
          label: '提案',
          state: 'complete',
          source: 'openspec-cli',
          evidence: [],
        },
      ],
      artifactGraph: {
        schemaName: 'spec-driven',
        source: 'openspec-cli',
        authoritative: true,
        applyRequires: ['proposal'],
        artifacts: [{ id: 'proposal', status: 'done', requires: [] }],
      },
      taskGate: {
        applicable: false,
        status: 'not-applicable',
        completed: 0,
        total: 0,
        remaining: 0,
      },
      validation: { status: 'not-run', source: 'validation-cache', diagnostics: [] },
      sync: {
        status: 'not-applicable',
        source: 'local-comparison',
        checkedAt: '2026-08-10T08:00:00.000Z',
        capabilities: [],
        summary: { capabilityCount: 0, pendingCount: 0, syncedCount: 0, unknownCount: 0 },
      },
      archiveReadiness: { status: 'not-ready', gates: [] },
      nextAction: {
        kind: 'run-validation',
        targetNode: 'validation',
        title: '运行严格验证',
        description: '尚无有效验证结果',
      },
      blockers: [],
    };

    expect(changeLifecycleAssessmentSchema.safeParse(lifecycle).success).toBe(true);
    expect(
      changeLifecycleAssessmentSchema.safeParse({ ...lifecycle, unexpected: true }).success,
    ).toBe(false);
  });

  it('keeps advisory spec sync and legacy assurance gates outside lifecycle contracts', () => {
    expect(lifecycleNodeIdSchema.options).toEqual([
      'proposal',
      'specs',
      'design',
      'tasks',
      'validation',
      'archive',
    ]);
    expect(
      archiveGateSchema.safeParse({ id: 'sync', label: '规格影响', status: 'pass', evidence: [] })
        .success,
    ).toBe(false);
    expect(
      archiveGateSchema.safeParse({
        id: 'requirement-review',
        label: 'Requirement 审阅',
        status: 'pass',
        evidence: [],
      }).success,
    ).toBe(false);
    expect(lifecycleNextActionKindSchema.safeParse('inspect-sync').success).toBe(false);
    expect(lifecycleNextActionKindSchema.safeParse('resolve-assurance-conflict').success).toBe(
      false,
    );
    expect(
      lifecycleBlockerSchema.safeParse({
        code: 'sync-unknown',
        node: 'archive',
        title: '规格影响不可用',
        detail: '本地预览不可用',
        evidence: [],
      }).success,
    ).toBe(false);
    expect(
      lifecycleBlockerSchema.safeParse({
        code: 'assurance-conflict',
        node: 'archive',
        title: '规格冲突待裁决',
        detail: '冲突仍阻塞应用内归档建议',
        evidence: [],
      }).success,
    ).toBe(false);
  });

  it('accepts ready lifecycle nodes and empty task gates with strict state invariants', () => {
    expect(lifecycleNodeStateSchema.safeParse('ready').success).toBe(true);
    expect(
      lifecycleTaskGateSchema.safeParse({
        applicable: true,
        status: 'empty',
        completed: 0,
        total: 0,
        remaining: 0,
        sourcePath: 'openspec/changes/change-a/tasks.md',
      }).success,
    ).toBe(true);

    expect(
      lifecycleTaskGateSchema.safeParse({
        applicable: true,
        status: 'complete',
        completed: 0,
        total: 0,
        remaining: 0,
      }).success,
    ).toBe(false);
    expect(
      lifecycleTaskGateSchema.safeParse({
        applicable: true,
        status: 'empty',
        completed: 1,
        total: 1,
        remaining: 0,
      }).success,
    ).toBe(false);
    expect(
      lifecycleTaskGateSchema.safeParse({
        applicable: false,
        status: 'incomplete',
        completed: 0,
        total: 1,
        remaining: 1,
      }).success,
    ).toBe(false);
  });

  it('strictly bounds persisted implementation work-state evidence', () => {
    const observation = {
      status: 'incomplete',
      completed: 57,
      total: 64,
      remaining: 7,
      fingerprint: 'a'.repeat(64),
      observedAt: '2026-08-10T08:00:00.000Z',
      projectVersion: {
        label: 'v2.4.0',
        source: 'git-tag',
        capturedAt: '2026-08-10T08:00:00.000Z',
      },
    };
    expect(implementationTaskObservationSchema.safeParse(observation).success).toBe(true);
    expect(
      implementationTaskObservationSchema.safeParse({ ...observation, remaining: 8 }).success,
    ).toBe(false);
    expect(
      implementationTaskObservationSchema.safeParse({
        ...observation,
        fingerprint: '../not-a-fingerprint',
      }).success,
    ).toBe(false);
    expect(
      implementationTaskObservationSchema.safeParse({ ...observation, observedAt: 'yesterday' })
        .success,
    ).toBe(false);

    const state = {
      schemaVersion: 1,
      changeId: 'change-a',
      activeGeneration: 'b'.repeat(64),
      iteration: 1,
      phase: 'initial-in-progress',
      lastObservation: observation,
      completionMilestones: [],
      reopenedEvents: [],
      updatedAt: observation.observedAt,
    };
    expect(changeWorkStateSchema.safeParse(state).success).toBe(true);
    expect(changeWorkStateSchema.safeParse({ ...state, iteration: 0 }).success).toBe(false);
    expect(changeWorkStateSchema.safeParse({ ...state, unexpected: true }).success).toBe(false);
  });

  it('strictly validates action center identities and stale handoff boundaries', () => {
    const action = {
      actionKey: `ac1:${'a'.repeat(64)}`,
      evidenceFingerprint: 'b'.repeat(64),
      projectId: 'project-1',
      projectName: 'Demo',
      projectRoot: 'C:/Projects/demo',
      changeId: 'change-a',
      archived: false,
      actionType: 'continue-implementation',
      priority: 2,
      title: '继续实施任务',
      description: '还有 7 项任务未完成。',
      targetNode: 'tasks',
      evidence: [
        {
          source: 'structural',
          summary: '57/64 项任务已完成',
          checkedAt: '2026-08-10T08:00:00.000Z',
        },
      ],
      taskGate: {
        applicable: true,
        status: 'incomplete',
        completed: 57,
        total: 64,
        remaining: 7,
      },
    };
    const snapshot = {
      schemaVersion: 1,
      scope: { kind: 'all' },
      status: 'complete',
      generatedAt: '2026-08-10T08:00:00.000Z',
      projects: [
        {
          projectId: 'project-1',
          projectName: 'Demo',
          projectRoot: 'C:/Projects/demo',
          status: 'healthy',
          source: 'openspec-cli',
          checkedAt: '2026-08-10T08:00:00.000Z',
          diagnostics: [],
        },
      ],
      items: [action],
      diagnostics: [],
      summary: { projectCount: 1, actionCount: 1, degradedProjectCount: 0 },
    };
    expect(actionCenterSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      actionCenterSnapshotSchema.safeParse({
        ...snapshot,
        items: [{ ...action, actionKey: '../forged' }],
      }).success,
    ).toBe(false);
    expect(
      codexHandoffSchema.safeParse({
        schemaVersion: 1,
        actionKey: action.actionKey,
        evidenceFingerprint: action.evidenceFingerprint,
        generatedAt: snapshot.generatedAt,
        stale: true,
        title: '行动已更新',
        markdown: '当前证据已变化。',
        currentAction: action,
      }).success,
    ).toBe(true);
  });
});
