import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSnapshot, ProjectionEvent } from '@shared/contracts';
import type { DesktopApi } from '@shared/desktop-api';
import { App } from './App';

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
      schemaVersion: 2,
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

describe('desktop workspace', () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'desktop');
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
        candidates: [],
        summary: { source: 'primary', candidateCount: 0, availableCount: 0, truncated: false },
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
      getUserDataPath: vi.fn().mockResolvedValue('C:/Users/test/AppData/OpenSpec'),
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
    expect(screen.getByRole('button', { name: '打开项目目录' })).toHaveFocus();
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
      candidates: [
        {
          id: 'codex-available',
          displayName: 'Codex Demo',
          rootPath: 'C:/Projects/codex-demo',
          source: 'local-project',
          lastUsedAt: '2026-08-07T08:00:00.000Z',
          status: 'available',
        },
        {
          id: 'codex-existing',
          displayName: 'Existing',
          rootPath: 'C:/Projects/demo',
          source: 'saved-workspace',
          status: 'already-added',
          reason: '该项目已添加到工作区',
        },
      ],
      summary: { source: 'primary', candidateCount: 2, availableCount: 1, truncated: false },
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

  it('keeps the Codex dialog open on partial failure and refreshes candidates', async () => {
    const data = fixture();
    const candidates = ['alpha', 'beta'].map((name) => ({
      id: `codex-${name}`,
      displayName: name,
      rootPath: `C:/Projects/${name}`,
      source: 'local-project' as const,
      status: 'available' as const,
    }));
    const listCodexProjects = vi.fn().mockResolvedValue({
      candidates,
      summary: { source: 'primary', candidateCount: 2, availableCount: 2, truncated: false },
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
            kind: 'artifact-change' as const,
            createdAt:
              request.versionKey === 'workspace'
                ? '2026-08-06T01:00:00.000Z'
                : '2026-08-07T01:02:00.000Z',
            relativePath: 'changes/demo/tasks.md',
            changeId: 'demo',
            artifactType: 'tasks' as const,
            projectVersion: request.versionKey === 'workspace' ? '' : 'v1',
            summary: 'tasks.md 已更新',
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
        candidates: [],
        summary: { source: 'primary', candidateCount: 0, availableCount: 0, truncated: false },
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
});
