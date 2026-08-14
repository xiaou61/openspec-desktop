import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ActionCenterSnapshot,
  AppSnapshot,
  ChangeLifecycleAssessment,
  ProjectionEvent,
} from '@shared/contracts';
import type { DesktopApi } from '@shared/desktop-api';
import { App } from './App';
import { sortChangesByRecentActivity } from './change-order';

function fixture(): AppSnapshot {
  const tasks = {
    type: 'tasks' as const,
    relativePath: 'changes/demo/tasks.md',
    sourcePath: 'openspec/changes/demo/tasks.md',
    title: 'Tasks',
    headings: [{ depth: 1, text: 'Tasks', line: 1 }],
    tasks: [{ id: 'task-1', text: 'Watch files', checked: false, line: 3 }],
    taskTotals: { completed: 0, total: 1 },
    rawContent: '# Tasks\n\n- [ ] Watch files\n\n<script>window.bad = true</script>\n',
    contentHash: 'a'.repeat(64),
    size: 80,
    lastModifiedAt: '2026-08-07T01:00:00.000Z',
    parseHealth: 'ok' as const,
    archived: false,
    changeId: 'demo',
  };
  const change = {
    id: 'demo',
    name: 'demo',
    archived: false,
    stage: 'implementing' as const,
    readiness: 'ready' as const,
    artifacts: [tasks],
    missingArtifacts: [] as Array<'proposal' | 'spec' | 'design' | 'tasks'>,
    taskTotals: { completed: 0, total: 1 },
    parseHealth: 'ok' as const,
    lastActivityAt: '2026-08-07T01:00:00.000Z',
    validation: { source: 'structural' as const, status: 'not-run' as const },
  };
  const project = {
    id: 'project-1',
    rootPath: 'C:/Projects/demo',
    displayName: 'Demo project',
    versionLabel: 'v1',
    versionMode: 'manual' as const,
    versionSource: 'manual' as const,
    groupId: null,
    order: 0,
    watcherEnabled: true,
    watcherState: 'watching' as const,
    available: true,
    registeredAt: '2026-08-07T00:00:00.000Z',
  };
  return {
    catalog: {
      schemaVersion: 3,
      groups: [],
      projects: [project],
      preferences: {
        selectedProjectId: project.id,
        selectedChangeId: change.id,
        showArchived: false,
        windowBounds: { width: 1440, height: 900 },
      },
    },
    projects: [
      { project, groups: [], changes: [change], specs: [], scannedAt: '2026-08-07T01:00:00.000Z' },
    ],
  };
}

function lifecycleFixture(): ChangeLifecycleAssessment {
  const checkedAt = '2026-08-10T08:00:00.000Z';
  const evidence = (summary: string) => ({ source: 'openspec-cli' as const, summary });
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    changeId: 'demo',
    archiveKey: 'active:demo',
    archived: false,
    projectAvailable: true,
    contentFingerprint: 'b'.repeat(64),
    evaluatedAt: checkedAt,
    nodes: (
      [
        ['proposal', '提案', 'complete', 'openspec-cli'],
        ['specs', '规格', 'complete', 'openspec-cli'],
        ['design', '设计', 'complete', 'openspec-cli'],
        ['tasks', '任务', 'complete', 'openspec-cli'],
        ['validation', '验证', 'blocked', 'validation-cache'],
        ['archive', '归档', 'blocked', 'directory'],
      ] as const
    ).map(([id, label, state, source]) => ({
      id: id as ChangeLifecycleAssessment['nodes'][number]['id'],
      label,
      state: state as ChangeLifecycleAssessment['nodes'][number]['state'],
      source: source as ChangeLifecycleAssessment['nodes'][number]['source'],
      evidence: [
        { source: source as ChangeLifecycleAssessment['nodes'][number]['source'], summary: label },
      ],
    })),
    artifactGraph: {
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
    },
    taskGate: {
      applicable: true,
      status: 'complete',
      completed: 1,
      total: 1,
      remaining: 0,
      sourcePath: 'openspec/changes/demo/tasks.md',
    },
    validation: {
      status: 'failed',
      source: 'validation-cache',
      checkedAt,
      fingerprint: 'a'.repeat(64),
      diagnostics: [
        {
          severity: 'error',
          message: '任务格式无效',
          relativePath: 'openspec/changes/demo/tasks.md',
          line: 3,
        },
      ],
    },
    sync: {
      status: 'pending',
      source: 'local-comparison',
      checkedAt,
      capabilities: [
        {
          capabilityPath: 'demo',
          status: 'pending',
          sourcePath: 'openspec/changes/demo/specs/demo/spec.md',
          targetPath: 'openspec/specs/demo/spec.md',
          operationCounts: { added: 1, modified: 0, removed: 0, renamed: 0 },
          requirements: ['Create demo'],
          scenarios: ['Success'],
          conflicts: [],
        },
      ],
      summary: { capabilityCount: 1, pendingCount: 1, syncedCount: 0, unknownCount: 0 },
    },
    archiveReadiness: {
      status: 'not-ready',
      gates: [
        { id: 'artifacts', label: '所需工件', status: 'pass', evidence: [evidence('工件完成')] },
        { id: 'tasks', label: '任务门槛', status: 'pass', evidence: [evidence('任务完成')] },
        { id: 'validation', label: '严格验证', status: 'fail', evidence: [evidence('验证失败')] },
      ],
    },
    nextAction: {
      kind: 'fix-validation',
      targetNode: 'validation',
      title: '修复严格验证问题',
      description: '修复诊断后重新验证。',
    },
    blockers: [
      {
        code: 'validation-failed',
        node: 'validation',
        title: '严格验证未通过',
        detail: '任务格式无效',
        evidence: [evidence('验证失败')],
      },
    ],
  };
}

function actionCenterFixture(): ActionCenterSnapshot {
  const now = '2026-08-10T08:00:00.000Z';
  return {
    schemaVersion: 1,
    scope: { kind: 'all' },
    status: 'complete',
    generatedAt: now,
    projects: [
      {
        projectId: 'project-1',
        projectName: 'Demo project',
        projectRoot: 'C:/Projects/demo',
        status: 'healthy',
        source: 'openspec-cli',
        checkedAt: now,
        diagnostics: [],
      },
    ],
    items: [
      {
        actionKey: `ac1:${'a'.repeat(64)}`,
        evidenceFingerprint: 'b'.repeat(64),
        projectId: 'project-1',
        projectName: 'Demo project',
        projectRoot: 'C:/Projects/demo',
        changeId: 'demo',
        archived: false,
        actionType: 'continue-implementation',
        priority: 2,
        title: '继续实施剩余 1 项任务',
        description: '当前完成 0/1。',
        targetNode: 'tasks',
        evidence: [
          {
            source: 'structural',
            summary: '任务 0/1，剩余 1',
            relativePath: 'openspec/changes/demo/tasks.md',
            checkedAt: now,
          },
        ],
        taskGate: {
          applicable: true,
          status: 'incomplete',
          completed: 0,
          total: 1,
          remaining: 1,
        },
      },
    ],
    diagnostics: [],
    summary: { projectCount: 1, actionCount: 1, degradedProjectCount: 0 },
  };
}

describe('desktop workspace', () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'desktop');
  });

  it('sorts Changes by recent activity with stable IDs and missing timestamps last', () => {
    const base = fixture().projects[0]!.changes[0]!;
    const changes = [
      { ...base, id: 'missing', name: 'missing', lastActivityAt: undefined },
      { ...base, id: 'same-b', name: 'same-b', lastActivityAt: '2026-08-09T08:00:00.000Z' },
      { ...base, id: 'newest', name: 'newest', lastActivityAt: '2026-08-10T08:00:00.000Z' },
      { ...base, id: 'same-a', name: 'same-a', lastActivityAt: '2026-08-09T08:00:00.000Z' },
    ];

    expect(sortChangesByRecentActivity(changes).map((change) => change.id)).toEqual([
      'newest',
      'same-a',
      'same-b',
      'missing',
    ]);
  });

  it('keeps long Change names available while using one primary detail status', async () => {
    const data = fixture();
    const longName = `支持长中文与连续路径-${'能力名称'.repeat(24)}-openspec/changes/demo/tasks.md`;
    data.projects[0]!.changes[0]!.name = longName;
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      getChangeLifecycle: vi.fn().mockResolvedValue(lifecycleFixture()),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    render(<App />);

    const heading = await screen.findByRole('heading', { name: longName });
    const detailHeading = heading.closest('.detail-heading');
    expect(detailHeading).not.toBeNull();
    expect(detailHeading!.querySelectorAll('.status-badge')).toHaveLength(1);
    expect(screen.getByRole('listitem', { name: longName })).toHaveAttribute('title', longName);
  });

  it('enters the application action mode, refreshes its scope, and opens the target Change', async () => {
    const data = fixture();
    const actions = actionCenterFixture();
    const getActionCenter = vi.fn().mockResolvedValue(actions);
    const refreshActionCenter = vi.fn().mockResolvedValue({
      ...actions,
      scope: { kind: 'project', projectId: 'project-1' },
    });
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      getActionCenter,
      refreshActionCenter,
      buildCodexHandoff: vi.fn(),
      getChangeLifecycle: vi.fn().mockResolvedValue(lifecycleFixture()),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);

    const entry = await screen.findByRole('button', { name: /行动中心.*1 个待处理行动/ });
    await user.click(entry);
    expect(await screen.findByRole('heading', { name: '行动中心' })).toBeVisible();
    expect(
      screen.getByRole('option', { name: /Demo project.*继续实施剩余 1 项任务/ }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: '当前项目' }));
    await waitFor(() => expect(getActionCenter).toHaveBeenCalledWith({ projectId: 'project-1' }));
    await user.click(screen.getByRole('button', { name: '刷新行动中心' }));
    await waitFor(() =>
      expect(refreshActionCenter).toHaveBeenCalledWith({ projectId: 'project-1' }),
    );
    await user.click(screen.getByRole('button', { name: '打开 Change' }));
    expect(await screen.findByRole('heading', { name: 'demo' })).toBeVisible();
    expect(screen.getByRole('tab', { name: '任务' })).toHaveAttribute('data-state', 'active');
  });

  it('exposes no assurance tab or six-dimension region while retaining validation', async () => {
    const data = fixture();
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      getChangeLifecycle: vi.fn().mockResolvedValue(lifecycleFixture()),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: 'demo' });
    expect(screen.queryByRole('tab', { name: '保障' })).toBeNull();
    expect(screen.queryByRole('button', { name: '项目洞察' })).toBeNull();
    expect(screen.queryByRole('region', { name: '六维规格保障状态' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: '就绪' }));
    expect(screen.getByRole('region', { name: '严格验证' })).toBeVisible();
  });

  it('shows reopened iteration and capability evolution in the list, title, and evidence band', async () => {
    const data = fixture();
    const change = data.projects[0]!.changes[0]!;
    const version = {
      label: 'v1',
      source: 'manual' as const,
      capturedAt: '2026-08-10T08:00:00.000Z',
    };
    change.workState = {
      schemaVersion: 1,
      changeId: 'demo',
      activeGeneration: '1'.repeat(64),
      iteration: 2,
      phase: 'reopened',
      lastObservation: {
        status: 'incomplete',
        completed: 1,
        total: 2,
        remaining: 1,
        fingerprint: '2'.repeat(64),
        observedAt: '2026-08-10T08:00:00.000Z',
        projectVersion: version,
      },
      completionMilestones: [
        {
          iteration: 1,
          completedAt: '2026-08-09T08:00:00.000Z',
          taskFingerprint: '3'.repeat(64),
          counts: { completed: 1, total: 1, remaining: 0 },
          projectVersion: version,
        },
      ],
      reopenedEvents: [
        {
          eventKey: '4'.repeat(64),
          iteration: 2,
          reopenedAt: '2026-08-10T08:00:00.000Z',
          reason: 'tasks-added',
          before: { completed: 1, total: 1, remaining: 0 },
          after: { completed: 1, total: 2, remaining: 1 },
          delta: { completed: 0, total: 1 },
          fromFingerprint: '3'.repeat(64),
          toFingerprint: '2'.repeat(64),
          projectVersion: version,
        },
      ],
      evolution: {
        status: 'iteration',
        assessedAt: '2026-08-10T08:00:00.000Z',
        capabilities: [
          {
            capabilityPath: 'openspec/changes/demo/specs/demo/spec.md',
            targetPath: 'openspec/specs/demo/spec.md',
            status: 'existing',
          },
        ],
      },
      updatedAt: '2026-08-10T08:00:00.000Z',
    };
    change.evolution = change.workState.evolution;
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      getActionCenter: vi.fn().mockResolvedValue(actionCenterFixture()),
      getChangeLifecycle: vi.fn().mockResolvedValue(lifecycleFixture()),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    render(<App />);

    expect((await screen.findAllByText('再次实施 · 第 2 轮')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('能力迭代').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/新增任务.*1\/1 → 1\/2.*v1/)).toBeVisible();
  });

  it('shows archived integrity evidence without offering restoration or automatic reimplementation', async () => {
    const data = fixture();
    const change = data.projects[0]!.changes[0]!;
    change.archived = true;
    change.artifacts = change.artifacts.map((artifact) => ({ ...artifact, archived: true }));
    change.workState = {
      schemaVersion: 1,
      changeId: 'demo',
      activeGeneration: '1'.repeat(64),
      iteration: 1,
      phase: 'completed',
      completionMilestones: [],
      reopenedEvents: [],
      archiveIntegrity: {
        status: 'changed',
        baselineFingerprint: '2'.repeat(64),
        currentFingerprint: '3'.repeat(64),
        observedAt: '2026-08-10T08:00:00.000Z',
        incident: 1,
        changedAt: '2026-08-10T08:00:00.000Z',
        lastEventKey: '4'.repeat(64),
      },
      archivedAt: '2026-08-09T08:00:00.000Z',
      updatedAt: '2026-08-10T08:00:00.000Z',
    };
    data.catalog.preferences.showArchived = true;
    const archivedLifecycle = { ...lifecycleFixture(), archived: true, archiveKey: 'archive:demo' };
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      getActionCenter: vi.fn().mockResolvedValue(actionCenterFixture()),
      getChangeLifecycle: vi.fn().mockResolvedValue(archivedLifecycle),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    render(<App />);

    expect((await screen.findAllByText('归档内容异常')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/后续工作应创建新的 Change/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /恢复归档|重新实施归档|移动归档/ })).toBeNull();
  });

  it('lets a transient operation notice close without moving workspace content', async () => {
    const data = fixture();
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      rescanProject: vi.fn().mockResolvedValue(data),
      getChangeLifecycle: vi.fn().mockResolvedValue(lifecycleFixture()),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: 'demo' });
    await user.click(screen.getByRole('button', { name: '重新扫描项目' }));
    const message = await screen.findByText('项目已重新扫描');
    const toast = message.closest('.toast');
    expect(toast).not.toBeNull();
    expect(toast!.className).toMatch(/is-(entering|open)/);
    await user.click(screen.getByRole('button', { name: '关闭通知' }));
    expect(toast).toHaveClass('is-closing');
    await waitFor(() => expect(screen.queryByText('项目已重新扫描')).toBeNull());
  });

  it('renders a safe artifact view, task tab, and raw source without executing HTML', async () => {
    const data = fixture();
    const api: DesktopApi = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      selectProject: vi.fn(),
      registerProject: vi.fn(),
      listCodexProjects: vi.fn().mockResolvedValue({
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
      }),
      importCodexProjects: vi.fn(),
      updateProject: vi.fn(),
      relocateProject: vi.fn(),
      selectRelocation: vi.fn(),
      unregisterProject: vi.fn(),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      removeGroup: vi.fn(),
      rescanProject: vi.fn(),
      refreshVersion: vi.fn(),
      getChangeLifecycle: vi.fn().mockResolvedValue(lifecycleFixture()),
      runChangeValidation: vi.fn().mockResolvedValue(lifecycleFixture()),
      getActionCenter: vi.fn(),
      refreshActionCenter: vi.fn(),
      buildCodexHandoff: vi.fn(),
      copyCodexHandoff: vi.fn(),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      listRevisions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listActivity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      compareRevisions: vi.fn(),
      clearHistory: vi.fn(),
      getRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      setRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      revealArtifact: vi.fn(),
      revealUserData: vi.fn(),
      getUserDataPath: vi.fn().mockResolvedValue('C:/test-data/OpenSpec'),
      openExternal: vi.fn(),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    };
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'demo' })).toBeVisible();
    expect(document.querySelector('script:not([src])')).toBeNull();
    await user.click(screen.getByRole('tab', { name: /任务/ }));
    expect(screen.getByText('Watch files')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: '文档' }));
    await user.click(screen.getByRole('button', { name: '原文' }));
    expect(screen.getByText(/<script>window.bad = true<\/script>/)).toBeVisible();
  });

  it('applies a subscribed projection while preserving the selected Change', async () => {
    const data = fixture();
    let listener: ((event: ProjectionEvent) => void) | undefined;
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      selectProject: vi.fn(),
      registerProject: vi.fn(),
      updateProject: vi.fn(),
      relocateProject: vi.fn(),
      selectRelocation: vi.fn(),
      unregisterProject: vi.fn(),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      removeGroup: vi.fn(),
      rescanProject: vi.fn(),
      refreshVersion: vi.fn(),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      listRevisions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listActivity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      compareRevisions: vi.fn(),
      clearHistory: vi.fn(),
      getRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      setRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      revealArtifact: vi.fn(),
      revealUserData: vi.fn(),
      openExternal: vi.fn(),
      onProjection: vi.fn((callback: (event: ProjectionEvent) => void) => {
        listener = callback;
        return () => undefined;
      }),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    render(<App />);
    expect(await screen.findByText('0/1 任务')).toBeVisible();
    const updated = structuredClone(data.projects[0]!);
    updated.changes[0]!.taskTotals = { completed: 1, total: 1 };
    updated.changes[0]!.stage = 'completed';
    updated.changes[0]!.artifacts[0]!.taskTotals = { completed: 1, total: 1 };
    updated.changes[0]!.artifacts[0]!.tasks[0]!.checked = true;
    listener?.({
      type: 'project-updated',
      projectId: 'project-1',
      changeIds: ['demo'],
      emittedAt: new Date().toISOString(),
      snapshot: updated,
    });
    await waitFor(() => screen.queryByText('1/1 任务') !== null);
    expect(screen.getByRole('heading', { name: 'demo' })).toBeVisible();
  });

  it('keeps primary controls keyboard reachable', async () => {
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(fixture()),
      updatePreferences: vi.fn().mockResolvedValue(fixture()),
      selectProject: vi.fn(),
      registerProject: vi.fn(),
      updateProject: vi.fn(),
      relocateProject: vi.fn(),
      selectRelocation: vi.fn(),
      unregisterProject: vi.fn(),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      removeGroup: vi.fn(),
      rescanProject: vi.fn(),
      refreshVersion: vi.fn(),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      listRevisions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listActivity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      compareRevisions: vi.fn(),
      clearHistory: vi.fn(),
      getRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      setRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      revealArtifact: vi.fn(),
      revealUserData: vi.fn(),
      getUserDataPath: vi.fn().mockResolvedValue('C:/data'),
      openExternal: vi.fn(),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'demo' });
    await user.tab();
    const catalogTrigger = screen.getByRole('button', { name: '打开项目目录' });
    expect(catalogTrigger).toHaveFocus();

    await user.keyboard('{Enter}');
    const catalogDialog = screen.getByRole('dialog', { name: '项目目录' });
    expect(catalogTrigger).toHaveAttribute('aria-expanded', 'true');
    const firstCatalogControl = within(catalogDialog).getByRole('button', { name: '添加项目' });
    await waitFor(() => expect(firstCatalogControl).toHaveFocus());

    await user.tab({ shift: true });
    expect(within(catalogDialog).getByRole('button', { name: '项目设置' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '项目目录' })).toBeNull();
    await waitFor(() => expect(catalogTrigger).toHaveFocus());
  });

  it('persists the selected context and traps focus inside project settings', async () => {
    const data = fixture();
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      selectProject: vi.fn(),
      registerProject: vi.fn(),
      updateProject: vi.fn(),
      relocateProject: vi.fn(),
      selectRelocation: vi.fn(),
      unregisterProject: vi.fn(),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      removeGroup: vi.fn(),
      rescanProject: vi.fn(),
      refreshVersion: vi.fn(),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      listRevisions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listActivity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      compareRevisions: vi.fn(),
      clearHistory: vi.fn(),
      getRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      setRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      revealArtifact: vi.fn(),
      revealUserData: vi.fn(),
      getUserDataPath: vi.fn().mockResolvedValue('C:/data'),
      openExternal: vi.fn(),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'demo' });
    await waitFor(() =>
      expect(api.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedProjectId: 'project-1',
          selectedChangeId: 'demo',
          showArchived: false,
        }),
      ),
    );

    const settingsTrigger = screen.getAllByRole('button', { name: '项目设置' })[0]!;
    await user.click(settingsTrigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeVisible();
    const localDataNote = within(dialog).getByRole('note', { name: '本地数据说明' });
    expect(localDataNote).toHaveTextContent('行动中心只读');
    expect(localDataNote).toHaveTextContent('严格验证只检查 OpenSpec 契约');
    expect(localDataNote).toHaveTextContent('清除历史会重置快照、活动、轮次和归档基线');
    expect(localDataNote).toHaveTextContent('不代表代码已交付');
    expect(localDataNote).toHaveTextContent('归档就绪只表示项目工件、任务和严格验证满足门槛');
    expect(localDataNote).toHaveTextContent('旧版规格保障数据已停用');
    expect(screen.queryByRole('button', { name: '清除保障数据' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: '规格保障模式' })).toBeNull();
    expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: '移除项目登记' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(settingsTrigger).toHaveFocus();
  });

  it('opens the add menu and imports selected Codex projects', async () => {
    const data = fixture();
    const listCodexProjects = vi.fn().mockResolvedValue({
      entries: [
        {
          kind: 'direct-project',
          id: 'codex-available',
          displayName: 'Codex Demo',
          rootPath: 'C:/Projects/codex-demo',
          source: 'local-project',
          lastUsedAt: '2026-08-07T08:00:00.000Z',
          status: 'available',
        },
        {
          kind: 'direct-project',
          id: 'codex-existing',
          displayName: 'Existing',
          rootPath: 'C:/Projects/demo',
          source: 'saved-workspace',
          status: 'already-added',
          reason: '该项目已添加到工作区',
        },
      ],
      summary: {
        source: 'primary',
        indexedRootCount: 2,
        workspaceCount: 0,
        repositoryCount: 2,
        openSpecProjectCount: 2,
        availableCount: 1,
        truncated: false,
        truncationReasons: [],
      },
      scannedAt: '2026-08-07T08:00:00.000Z',
    });
    const importCodexProjects = vi.fn().mockResolvedValue({
      snapshot: data,
      items: [
        { rootPath: 'C:/Projects/codex-demo', displayName: 'Codex Demo', status: 'imported' },
      ],
    });
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      selectProject: vi.fn(),
      registerProject: vi.fn(),
      listCodexProjects,
      importCodexProjects,
      updateProject: vi.fn(),
      relocateProject: vi.fn(),
      selectRelocation: vi.fn(),
      unregisterProject: vi.fn(),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      removeGroup: vi.fn(),
      rescanProject: vi.fn(),
      refreshVersion: vi.fn(),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      listRevisions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listActivity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      compareRevisions: vi.fn(),
      clearHistory: vi.fn(),
      getRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      setRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      revealArtifact: vi.fn(),
      revealUserData: vi.fn(),
      getUserDataPath: vi.fn().mockResolvedValue('C:/data'),
      openExternal: vi.fn(),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'demo' });

    await user.click(screen.getByRole('button', { name: '添加项目' }));
    await user.click(screen.getByRole('menuitem', { name: '从 Codex 导入' }));
    const dialog = await screen.findByRole('dialog', { name: '从 Codex 导入' });
    expect(dialog).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Codex Demo/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Existing/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '导入 1 个项目' }));
    await waitFor(() =>
      expect(importCodexProjects).toHaveBeenCalledWith({
        projects: [{ rootPath: 'C:/Projects/codex-demo', displayName: 'Codex Demo' }],
      }),
    );
    expect(screen.queryByRole('dialog', { name: '从 Codex 导入' })).toBeNull();
    expect(screen.getByText('已导入 1 个 Codex 项目')).toBeVisible();
  });

  it('renders, selects, refreshes, and imports hierarchical Codex workspaces accessibly', async () => {
    const data = fixture();
    data.catalog.groups = [
      {
        id: 'group-demo',
        name: 'Demo Workspace',
        order: 0,
        kind: 'codex-workspace',
        sourceRootPath: 'C:/Demo',
      },
    ];
    data.catalog.projects[0]!.groupId = 'group-demo';
    data.projects[0]!.groups = data.catalog.groups;
    const workspace = {
      kind: 'workspace' as const,
      id: 'workspace-demo',
      displayName: 'Demo Workspace',
      rootPath: 'C:/Demo',
      source: 'local-project' as const,
      members: [
        {
          kind: 'openspec-project' as const,
          id: 'frontend',
          displayName: 'Frontend',
          rootPath: 'C:/Demo/web',
          status: 'available' as const,
        },
        {
          kind: 'repository' as const,
          id: 'backend',
          displayName: 'Backend',
          rootPath: 'C:/Demo/api',
          status: 'not-configured' as const,
          reason: '尚未配置 OpenSpec',
        },
        {
          kind: 'openspec-project' as const,
          id: 'tools',
          displayName: 'Tools',
          rootPath: 'C:/Demo/tools',
          status: 'available' as const,
        },
      ],
      diagnostics: [{ code: 'disappeared' as const, path: 'C:/Demo/old', message: '目录已消失' }],
      truncated: true,
      truncationReasons: ['max-directories' as const],
      repositoryCount: 3,
      openSpecProjectCount: 2,
      availableCount: 2,
    };
    const initialList = {
      entries: [workspace],
      summary: {
        source: 'primary' as const,
        indexedRootCount: 1,
        workspaceCount: 1,
        repositoryCount: 3,
        openSpecProjectCount: 2,
        availableCount: 2,
        truncated: false,
        truncationReasons: [],
      },
      scannedAt: '2026-08-11T01:00:00.000Z',
    };
    const refreshedWorkspace = {
      ...workspace,
      members: workspace.members.filter((member) => member.id !== 'tools'),
      repositoryCount: 2,
      openSpecProjectCount: 1,
      availableCount: 1,
    };
    const refreshedList = {
      ...initialList,
      entries: [refreshedWorkspace],
      summary: {
        ...initialList.summary,
        repositoryCount: 2,
        openSpecProjectCount: 1,
        availableCount: 1,
      },
      scannedAt: '2026-08-11T01:01:00.000Z',
    };
    const listCodexProjects = vi
      .fn()
      .mockResolvedValueOnce(initialList)
      .mockResolvedValue(refreshedList);
    const importCodexProjects = vi.fn().mockResolvedValue({
      snapshot: data,
      items: [
        {
          rootPath: 'C:/Demo/web',
          displayName: 'Frontend',
          status: 'imported',
          projectId: 'project-frontend',
          workspace: {
            id: 'workspace-demo',
            rootPath: 'C:/Demo',
            displayName: 'Demo Workspace',
          },
          workspaceGroupId: 'group-demo',
        },
      ],
    });
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      selectProject: vi.fn(),
      registerProject: vi.fn(),
      listCodexProjects,
      importCodexProjects,
      updateProject: vi.fn(),
      relocateProject: vi.fn(),
      selectRelocation: vi.fn(),
      unregisterProject: vi.fn(),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      removeGroup: vi.fn(),
      rescanProject: vi.fn(),
      refreshVersion: vi.fn(),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      listRevisions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listActivity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      compareRevisions: vi.fn(),
      clearHistory: vi.fn(),
      getRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      setRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      revealArtifact: vi.fn(),
      revealUserData: vi.fn(),
      getUserDataPath: vi.fn().mockResolvedValue('C:/data'),
      openExternal: vi.fn(),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'demo' });

    const sidebarGroup = screen.getByText('Demo Workspace').closest('[title]');
    expect(sidebarGroup).toHaveAttribute('title', 'C:/Demo');
    expect(screen.getByText('工作区')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '添加项目' }));
    await user.click(screen.getByRole('menuitem', { name: '从 Codex 导入' }));
    const dialog = await screen.findByRole('dialog', { name: '从 Codex 导入' });
    expect(within(dialog).getByText('1 个 Codex 根目录')).toBeVisible();
    expect(within(dialog).getByText('3 个代码仓库')).toBeVisible();
    expect(within(dialog).getByText('2 个 OpenSpec 项目')).toBeVisible();
    expect(within(dialog).getByText(/目录已消失/)).toBeVisible();
    expect(within(dialog).getByRole('checkbox', { name: /Backend/ })).toBeDisabled();

    const parent = within(dialog).getByRole('checkbox', {
      name: '选择工作区 Demo Workspace 的可导入项目',
    }) as HTMLInputElement;
    expect(parent).toBeChecked();
    await user.click(within(dialog).getByRole('checkbox', { name: /Frontend/ }));
    expect(parent.indeterminate).toBe(true);
    expect(parent).toHaveAttribute('aria-checked', 'mixed');

    await user.click(within(dialog).getByRole('button', { name: '刷新 Codex 项目' }));
    await waitFor(() => expect(listCodexProjects).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(within(dialog).queryByRole('checkbox', { name: /Tools/ })).toBeNull(),
    );
    expect(within(dialog).getByText('0 个已选')).toBeVisible();
    expect(parent.indeterminate).toBe(false);
    await user.click(parent);
    expect(within(dialog).getByText('1 个已选')).toBeVisible();

    const expand = within(dialog).getByRole('button', { name: '折叠工作区 Demo Workspace' });
    expand.focus();
    await user.keyboard('{Enter}');
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    await user.click(within(dialog).getByRole('button', { name: '导入 1 个项目' }));
    await waitFor(() =>
      expect(importCodexProjects).toHaveBeenCalledWith({
        projects: [
          {
            rootPath: 'C:/Demo/web',
            displayName: 'Frontend',
            workspace: {
              id: 'workspace-demo',
              rootPath: 'C:/Demo',
              displayName: 'Demo Workspace',
            },
          },
        ],
      }),
    );
  });

  it('keeps the Codex dialog open on partial failure and refreshes candidates', async () => {
    const data = fixture();
    const candidates = ['alpha', 'beta'].map((name) => ({
      kind: 'direct-project' as const,
      id: `codex-${name}`,
      displayName: name,
      rootPath: `C:/Projects/${name}`,
      source: 'local-project' as const,
      status: 'available' as const,
    }));
    const listCodexProjects = vi.fn().mockResolvedValue({
      entries: candidates,
      summary: {
        source: 'primary',
        indexedRootCount: 2,
        workspaceCount: 0,
        repositoryCount: 2,
        openSpecProjectCount: 2,
        availableCount: 2,
        truncated: false,
        truncationReasons: [],
      },
      scannedAt: '2026-08-07T08:00:00.000Z',
    });
    const importCodexProjects = vi.fn().mockResolvedValue({
      snapshot: data,
      items: [
        { rootPath: 'C:/Projects/alpha', displayName: 'alpha', status: 'imported' },
        {
          rootPath: 'C:/Projects/beta',
          displayName: 'beta',
          status: 'failed',
          error: '目录已不可用',
        },
      ],
    });
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      selectProject: vi.fn(),
      registerProject: vi.fn(),
      listCodexProjects,
      importCodexProjects,
      updateProject: vi.fn(),
      relocateProject: vi.fn(),
      selectRelocation: vi.fn(),
      unregisterProject: vi.fn(),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      removeGroup: vi.fn(),
      rescanProject: vi.fn(),
      refreshVersion: vi.fn(),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      listRevisions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listActivity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      compareRevisions: vi.fn(),
      clearHistory: vi.fn(),
      getRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      setRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      revealArtifact: vi.fn(),
      revealUserData: vi.fn(),
      getUserDataPath: vi.fn().mockResolvedValue('C:/data'),
      openExternal: vi.fn(),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'demo' });
    await user.click(screen.getByRole('button', { name: '添加项目' }));
    await user.click(screen.getByRole('menuitem', { name: '从 Codex 导入' }));
    await screen.findByText('2 个可导入');
    await user.click(screen.getByRole('button', { name: '导入 2 个项目' }));
    const dialog = screen.getByRole('dialog', { name: '从 Codex 导入' });
    expect(await within(dialog).findByText(/已导入 1 个，1 个失败/)).toBeVisible();
    expect(dialog).toBeVisible();
    await user.click(screen.getByRole('button', { name: '刷新 Codex 项目' }));
    await waitFor(() => expect(listCodexProjects).toHaveBeenCalledTimes(2));
  });

  it('shows cross-version Change context, groups activity, and filters historical records', async () => {
    const data = fixture();
    data.catalog.projects[0]!.versionMode = 'automatic';
    data.catalog.projects[0]!.versionSource = 'package-json';
    const summaries = {
      items: [
        {
          key: 'version:v1',
          label: 'v1',
          source: 'package-json' as const,
          isCurrent: true,
          activityCount: 1,
          revisionCount: 1,
          firstSeenAt: '2026-08-07T01:00:00.000Z',
          lastSeenAt: '2026-08-07T01:02:00.000Z',
          changeIds: ['demo'],
        },
        {
          key: 'workspace',
          label: '当前工作区',
          isCurrent: false,
          activityCount: 1,
          revisionCount: 0,
          firstSeenAt: '2026-08-06T01:00:00.000Z',
          lastSeenAt: '2026-08-06T01:00:00.000Z',
          changeIds: ['demo'],
        },
      ],
      currentKey: 'version:v1',
    };
    const listActivity = vi.fn((request: { versionKey?: string }) =>
      Promise.resolve({
        items: [
          {
            id: request.versionKey === 'workspace' ? 'activity-workspace' : 'activity-v1',
            projectId: 'project-1',
            kind: 'task-progress' as const,
            createdAt:
              request.versionKey === 'workspace'
                ? '2026-08-06T01:00:00.000Z'
                : '2026-08-07T01:02:00.000Z',
            relativePath: 'changes/demo/tasks.md',
            changeId: 'demo',
            artifactType: 'tasks' as const,
            projectVersion: request.versionKey === 'workspace' ? '' : 'v1',
            summary: 'tasks.md 已更新',
            taskDelta: { completed: 0, total: 1 },
          },
          {
            id: request.versionKey === 'workspace' ? 'archive-workspace' : 'archive-v1',
            projectId: 'project-1',
            kind: 'archive-integrity' as const,
            createdAt:
              request.versionKey === 'workspace'
                ? '2026-08-06T01:01:00.000Z'
                : '2026-08-07T01:03:00.000Z',
            changeId: 'demo',
            projectVersion: request.versionKey === 'workspace' ? '' : 'v1',
            summary: '归档内容异常（第 1 次）',
          },
        ],
        nextCursor: null,
      }),
    );
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      selectProject: vi.fn(),
      registerProject: vi.fn(),
      listCodexProjects: vi.fn().mockResolvedValue({
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
      }),
      importCodexProjects: vi.fn(),
      updateProject: vi.fn().mockResolvedValue(data),
      relocateProject: vi.fn(),
      selectRelocation: vi.fn(),
      unregisterProject: vi.fn(),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      removeGroup: vi.fn(),
      rescanProject: vi.fn(),
      refreshVersion: vi.fn().mockResolvedValue(data),
      listVersionSummaries: vi.fn().mockResolvedValue(summaries),
      listRevisions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listActivity,
      compareRevisions: vi.fn(),
      clearHistory: vi.fn(),
      getRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      setRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      revealArtifact: vi.fn(),
      revealUserData: vi.fn(),
      getUserDataPath: vi.fn().mockResolvedValue('C:/data'),
      openExternal: vi.fn(),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: 'demo' });
    expect(await screen.findByText(/跨 2 个版本/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: /当前版本 v1/ }));
    expect(screen.getByText('package.json')).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /当前工作区/ })).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: /当前工作区/ }));
    expect(screen.getByRole('tab', { name: '活动' })).toHaveAttribute('data-state', 'active');
    const filter = screen.getByRole('combobox', { name: '筛选历史版本' });
    await user.selectOptions(filter, 'workspace');
    await waitFor(() =>
      expect(listActivity).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'project-1', versionKey: 'workspace' }),
      ),
    );
    expect(screen.getAllByText('当前工作区').length).toBeGreaterThan(0);
    expect(screen.getByText('任务进度')).toBeVisible();
    expect(screen.getByText(/任务变化：完成 0，总数 \+1/)).toBeVisible();
    expect(screen.getByText('归档异常')).toBeVisible();
    expect(screen.getByText('归档内容异常（第 1 次）')).toBeVisible();

    const settingsTrigger = screen.getAllByRole('button', { name: '项目设置' }).at(-1)!;
    await user.click(settingsTrigger);
    await user.click(screen.getByRole('button', { name: '手动设置' }));
    const manualInput = screen.getByPlaceholderText('例如 v1.2.0');
    await user.clear(manualInput);
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('不能为空');
    await user.type(manualInput, 'v2');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(api.updateProject).toHaveBeenCalledWith(
      expect.objectContaining({ versionMode: 'manual', versionLabel: 'v2' }),
    );
  });

  it('shows a recoverable error when the Codex project index cannot be read', async () => {
    const data = fixture();
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      selectProject: vi.fn(),
      registerProject: vi.fn(),
      listCodexProjects: vi.fn().mockRejectedValue(new Error('无法读取 Codex 项目索引')),
      importCodexProjects: vi.fn(),
      updateProject: vi.fn(),
      relocateProject: vi.fn(),
      selectRelocation: vi.fn(),
      unregisterProject: vi.fn(),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      removeGroup: vi.fn(),
      rescanProject: vi.fn(),
      refreshVersion: vi.fn(),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      listRevisions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listActivity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      compareRevisions: vi.fn(),
      clearHistory: vi.fn(),
      getRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      setRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      revealArtifact: vi.fn(),
      revealUserData: vi.fn(),
      getUserDataPath: vi.fn().mockResolvedValue('C:/data'),
      openExternal: vi.fn(),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'demo' });
    await user.click(screen.getByRole('button', { name: '添加项目' }));
    await user.click(screen.getByRole('menuitem', { name: '从 Codex 导入' }));
    expect(await screen.findByText('无法读取 Codex 项目索引', {}, { timeout: 4000 })).toBeVisible();
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled();
  });

  it('requests lifecycle evidence for the newly selected project', async () => {
    const data = fixture();
    const secondProject = {
      ...data.catalog.projects[0]!,
      id: 'project-2',
      rootPath: 'C:/Projects/second',
      displayName: 'Second project',
      order: 1,
    };
    const secondSnapshot = structuredClone(data.projects[0]!);
    secondSnapshot.project = secondProject;
    data.catalog.projects.push(secondProject);
    data.projects.push(secondSnapshot);
    const getChangeLifecycle = vi.fn().mockResolvedValue(lifecycleFixture());
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      getChangeLifecycle,
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: 'demo' });
    await user.click(screen.getByRole('button', { name: /Second project/ }));
    await waitFor(() =>
      expect(getChangeLifecycle).toHaveBeenCalledWith({
        projectId: 'project-2',
        changeId: 'demo',
        archived: false,
      }),
    );
  });

  it('paginates more than ten Changes in newest-first order and resets each scope to page one', async () => {
    const data = fixture();
    const base = data.projects[0]!.changes[0]!;
    const makeChanges = (archived: boolean) =>
      Array.from({ length: 12 }, (_, index) => {
        const sequence = index + 1;
        const id = `${archived ? 'archived' : 'active'}-${String(sequence).padStart(2, '0')}`;
        return {
          ...base,
          id,
          name: id,
          archived,
          lastActivityAt: `2026-08-${String(sequence).padStart(2, '0')}T08:00:00.000Z`,
          artifacts: base.artifacts.map((artifact) => ({ ...artifact, changeId: id })),
        };
      });
    data.projects[0]!.changes = [...makeChanges(false), ...makeChanges(true)];
    data.catalog.preferences.selectedChangeId = null;
    const getChangeLifecycle = vi
      .fn()
      .mockImplementation(({ changeId, archived }: { changeId: string; archived: boolean }) =>
        Promise.resolve({
          ...lifecycleFixture(),
          changeId,
          archived,
          archiveKey: `${archived ? 'archive' : 'active'}:${changeId}`,
        }),
      );
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      getChangeLifecycle,
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'active-12' })).toBeVisible();
    let listPane = screen.getByRole('region', { name: 'Change 列表' });
    let rows = within(listPane).getAllByRole('listitem');
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent('active-12');
    expect(rows[9]).toHaveTextContent('active-03');
    expect(within(listPane).getByText('第 1 / 2 页')).toBeVisible();
    expect(within(listPane).getByRole('button', { name: '上一页' })).toBeDisabled();

    await user.click(within(listPane).getByRole('button', { name: '下一页' }));
    rows = within(listPane).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('active-02');
    expect(rows[1]).toHaveTextContent('active-01');
    expect(within(listPane).getByRole('button', { name: '下一页' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'active-12' })).toBeVisible();

    await user.click(rows[0]!);
    expect(await screen.findByRole('heading', { name: 'active-02' })).toBeVisible();

    await user.click(within(listPane).getByRole('button', { name: '已归档' }));
    listPane = screen.getByRole('region', { name: 'Change 列表' });
    await waitFor(() => expect(within(listPane).getByText('第 1 / 2 页')).toBeVisible());
    rows = within(listPane).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('archived-12');
    expect(rows[9]).toHaveTextContent('archived-03');
    expect(await screen.findByRole('heading', { name: 'archived-12' })).toBeVisible();
  });

  it('keeps archived readiness read-only while an active Change with the same id is validating', async () => {
    const data = fixture();
    const activeChange = data.projects[0]!.changes[0]!;
    const archivedChange = {
      ...activeChange,
      archived: true,
      artifacts: activeChange.artifacts.map((artifact) => ({ ...artifact, archived: true })),
    };
    data.projects[0]!.changes = [activeChange, archivedChange];
    const archivedLifecycle = {
      ...lifecycleFixture(),
      changeId: 'demo',
      archiveKey: 'archive:demo',
      archived: true,
    };
    const getChangeLifecycle = vi
      .fn()
      .mockImplementation(({ archived }: { archived: boolean }) =>
        Promise.resolve(archived ? archivedLifecycle : lifecycleFixture()),
      );
    const runChangeValidation = vi
      .fn()
      .mockReturnValue(new Promise<ChangeLifecycleAssessment>(() => undefined));
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      getChangeLifecycle,
      runChangeValidation,
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: 'demo' });
    await user.click(await screen.findByRole('button', { name: 'demo，重新验证' }));
    expect(
      await screen.findByRole('button', { name: 'demo，正在运行严格验证' }),
    ).toBeVisible();
    expect(await screen.findByText('正在调用 OpenSpec 严格验证')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '已归档' }));
    await waitFor(() =>
      expect(getChangeLifecycle).toHaveBeenCalledWith({
        projectId: 'project-1',
        changeId: 'demo',
        archived: true,
      }),
    );
    await user.click(screen.getByRole('tab', { name: '就绪' }));
    const validationRegion = await screen.findByRole('region', { name: '严格验证' });
    expect(within(validationRegion).getByText('验证失败')).toBeVisible();
    expect(within(validationRegion).queryByText('正在调用 OpenSpec 严格验证')).toBeNull();
  });

  it('navigates the six-node lifecycle, validation evidence, and archive impact accessibly', async () => {
    const data = fixture();
    const lifecycle = lifecycleFixture();
    const passed = structuredClone(lifecycle);
    passed.validation = {
      status: 'passed',
      source: 'openspec-cli',
      checkedAt: '2026-08-10T08:05:00.000Z',
      fingerprint: 'b'.repeat(64),
      diagnostics: [],
    };
    passed.nodes = passed.nodes.map((node) =>
      node.id === 'validation'
        ? { ...node, state: 'complete' }
        : node.id === 'archive'
          ? { ...node, state: 'current' }
          : node,
    );
    passed.archiveReadiness.status = 'ready';
    passed.archiveReadiness.gates = passed.archiveReadiness.gates.map((gate) =>
      gate.id === 'validation' ? { ...gate, status: 'pass' } : gate,
    );
    passed.sync = {
      ...passed.sync,
      status: 'unknown',
      message: '本地规格影响预览不可用。',
      capabilities: passed.sync.capabilities.map((capability) => ({
        ...capability,
        status: 'unknown',
      })),
      summary: { capabilityCount: 1, pendingCount: 0, syncedCount: 0, unknownCount: 1 },
    };
    passed.nextAction = {
      kind: 'archive',
      targetNode: 'archive',
      title: '确认归档',
      description: '全部门槛已满足；本地规格影响预览不可用，但不会阻止归档。',
    };
    passed.blockers = [];
    const api = {
      runtime: { platform: 'win32' },
      getSnapshot: vi.fn().mockResolvedValue(data),
      updatePreferences: vi.fn().mockResolvedValue(data),
      getChangeLifecycle: vi.fn().mockResolvedValue(lifecycle),
      runChangeValidation: vi.fn().mockResolvedValue(passed),
      listVersionSummaries: vi.fn().mockResolvedValue({ items: [], currentKey: 'version:v1' }),
      listRevisions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listActivity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      getRetention: vi
        .fn()
        .mockResolvedValue({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
      setRetention: vi.fn(),
      onProjection: vi.fn().mockReturnValue(() => undefined),
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('button', { name: /验证：阻塞/ })).toBeVisible();
    expect(screen.getByRole('button', { name: '当前变更' })).toBeVisible();
    expect(screen.getByRole('button', { name: '已归档' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: /验证：阻塞/ }));
    expect(screen.getByRole('tab', { name: '就绪' })).toHaveAttribute('data-state', 'active');
    const validationRegion = screen.getByRole('region', { name: '严格验证' });
    await waitFor(() => expect(validationRegion).toHaveFocus());
    expect(screen.getByText('修复严格验证问题')).toBeVisible();

    const diagnosticDisclosure = within(validationRegion).getByRole('button', {
      name: /验证诊断/,
    });
    diagnosticDisclosure.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(diagnosticDisclosure).toHaveAttribute('aria-expanded', 'true'));
    await user.keyboard(' ');
    await user.keyboard('{Enter}');
    expect(diagnosticDisclosure).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: /定位到 tasks.md/ }));
    expect(screen.getByRole('tab', { name: '文档' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tab', { name: 'tasks.md' })).toHaveFocus();

    expect(screen.queryByRole('button', { name: /同步预览/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /归档：阻塞/ }));
    const archiveRegion = screen.getByRole('region', { name: '归档门槛' });
    expect(within(archiveRegion).getByRole('heading', { name: '规格影响' })).toBeVisible();
    expect(within(archiveRegion).getByText(/OpenSpec 归档时会把 1 个能力/)).toBeVisible();
    expect(within(archiveRegion).getByText('归档时更新')).toBeVisible();
    await user.click(within(archiveRegion).getByText('demo'));
    expect(within(archiveRegion).getByText('Create demo')).toBeVisible();
    expect(within(archiveRegion).getByText('Success')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /重新验证/ }));
    await waitFor(() =>
      expect(api.runChangeValidation).toHaveBeenCalledWith({
        projectId: 'project-1',
        changeId: 'demo',
      }),
    );
    expect(await screen.findByText('验证通过')).toBeVisible();
    expect(await screen.findByText('确认归档')).toBeVisible();
    const currentArchiveNode = screen.getByRole('button', { name: /归档：当前/ });
    expect(currentArchiveNode).toBeVisible();
    await user.click(currentArchiveNode);
    expect(within(archiveRegion).getByText(/本地规格影响预览不可用/)).toBeVisible();
    expect(
      within(archiveRegion).getByText(/不影响 OpenSpec CLI 严格验证通过后的归档就绪判断/),
    ).toBeVisible();
  });
});
