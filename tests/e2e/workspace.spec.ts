import { expect, test, type Page } from '@playwright/test';
import type {
  ActivityEntry,
  AppSnapshot,
  Revision,
  VersionSummaryList,
} from '../../src/shared/contracts';

interface HistoryFixture {
  versionSummaries: VersionSummaryList;
  activity: ActivityEntry[];
  revisions: Revision[];
}

function fixture(): AppSnapshot {
  const longText = `${'long-content '.repeat(120)}\n\n<script>window.e2eUnsafe = true</script>`;
  const artifact = {
    type: 'tasks' as const,
    relativePath: 'changes/demo/tasks.md',
    sourcePath: 'openspec/changes/demo/tasks.md',
    title: 'Tasks',
    headings: [{ depth: 1, text: 'Tasks', line: 1 }],
    tasks: [{ id: 'task-1', text: 'Watch files', checked: false, line: 3 }],
    taskTotals: { completed: 0, total: 1 },
    rawContent: `# Tasks\n\n- [ ] Watch files\n\n${longText}`,
    contentHash: 'a'.repeat(64),
    size: longText.length,
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
    artifacts: [artifact],
    missingArtifacts: [],
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

function emptyFixture(): AppSnapshot {
  const snapshot = fixture();
  return {
    ...snapshot,
    catalog: {
      ...snapshot.catalog,
      projects: [],
      preferences: {
        ...snapshot.catalog.preferences,
        selectedProjectId: null,
        selectedChangeId: null,
      },
    },
    projects: [],
  };
}

async function installDesktopFixture(
  page: Page,
  initialSnapshot = fixture(),
  history: Partial<HistoryFixture> = {},
): Promise<void> {
  const defaultVersionSummaries: VersionSummaryList = {
    items: [],
    currentKey: initialSnapshot.catalog.projects[0]?.versionLabel
      ? `version:${initialSnapshot.catalog.projects[0].versionLabel.trim()}`
      : 'workspace',
  };
  await page.addInitScript(
    ({ snapshot, history: fixtureHistory }) => {
      const updateProjectCalls: unknown[] = [];
      let listener: ((event: unknown) => void) | undefined;
      const desktop = {
        runtime: { platform: 'win32' },
        getSnapshot: async () => snapshot,
        updatePreferences: async () => snapshot,
        selectProject: async () => snapshot,
        registerProject: async () => snapshot,
        listCodexProjects: async () => ({
          candidates: [
            {
              id: 'codex-tooling',
              displayName: 'Codex Tooling',
              rootPath: 'C:/Projects/codex-tooling',
              source: 'local-project',
              lastUsedAt: '2026-08-07T08:30:00.000Z',
              status: 'available',
            },
            {
              id: 'codex-not-openspec',
              displayName: 'Scratch workspace',
              rootPath: 'C:/Projects/scratch-workspace',
              source: 'saved-workspace',
              status: 'invalid-openspec',
              reason: '未发现 OpenSpec 项目结构',
            },
          ],
          summary: { source: 'primary', candidateCount: 2, availableCount: 1, truncated: false },
          scannedAt: '2026-08-07T08:30:00.000Z',
        }),
        importCodexProjects: async (input: {
          projects: Array<{ rootPath: string; displayName: string }>;
        }) => ({
          snapshot,
          items: input.projects.map((project) => ({ ...project, status: 'imported' })),
        }),
        updateProject: async (input: unknown) => {
          updateProjectCalls.push(input);
          return snapshot;
        },
        relocateProject: async () => snapshot,
        selectRelocation: async () => snapshot,
        unregisterProject: async () => snapshot,
        createGroup: async () => snapshot,
        updateGroup: async () => snapshot,
        removeGroup: async () => snapshot,
        rescanProject: async () => snapshot,
        refreshVersion: async () => snapshot,
        listVersionSummaries: async () => fixtureHistory.versionSummaries,
        listRevisions: async (request: { versionKey?: string }) => ({
          items: fixtureHistory.revisions.filter(
            (revision) =>
              !request.versionKey ||
              (revision.projectVersion
                ? `version:${revision.projectVersion.trim()}`
                : 'workspace') === request.versionKey,
          ),
          nextCursor: null,
        }),
        listActivity: async (request: { versionKey?: string }) => ({
          items: fixtureHistory.activity.filter(
            (entry) =>
              !request.versionKey ||
              (entry.projectVersion ? `version:${entry.projectVersion.trim()}` : 'workspace') ===
                request.versionKey,
          ),
          nextCursor: null,
        }),
        compareRevisions: async () => {
          throw new Error('no revisions');
        },
        clearHistory: async () => snapshot,
        getRetention: async () => ({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
        setRetention: async () => ({ revisionsPerArtifact: 50, activityPerProject: 1000 }),
        revealArtifact: async () => undefined,
        revealUserData: async () => undefined,
        getUserDataPath: async () => 'C:/Users/test/AppData/Local/openspec-desktop',
        openExternal: async () => undefined,
        onProjection: (next: (event: unknown) => void) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
      };
      Object.defineProperty(window, 'desktop', { configurable: true, value: desktop });
      Object.defineProperty(window, '__updateProjectCalls', {
        configurable: true,
        value: updateProjectCalls,
      });
      Object.defineProperty(window, '__emitProjection', {
        configurable: true,
        value: (event: unknown) => listener?.(event),
      });
    },
    {
      snapshot: initialSnapshot,
      history: {
        versionSummaries: history.versionSummaries ?? defaultVersionSummaries,
        activity: history.activity ?? [],
        revisions: history.revisions ?? [],
      },
    },
  );
}

test('renders the desktop workspace and preserves long Markdown safely', async ({
  page,
}, testInfo) => {
  await installDesktopFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'demo' })).toBeVisible();
  await page.getByRole('tab', { name: '文档' }).click();
  await page.getByRole('button', { name: '原文' }).click();
  await expect(page.locator('.raw-markdown')).toContainText('long-content');
  await expect(page.locator('script:not([src])')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('workspace-desktop.png'), fullPage: true });
});

test('reflows at the minimum supported window and exposes the mobile catalog control', async ({
  page,
}, testInfo) => {
  await installDesktopFixture(page);
  await page.setViewportSize({ width: 920, height: 640 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'demo' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport + 1);
  await page.screenshot({ path: testInfo.outputPath('workspace-minimum.png'), fullPage: true });

  await page.setViewportSize({ width: 700, height: 760 });
  await expect(page.getByRole('button', { name: '打开项目目录' })).toBeVisible();
  await page.getByRole('button', { name: '打开项目目录' }).click();
  await expect(page.getByRole('button', { name: '关闭项目目录' })).toBeVisible();
  await expect
    .poll(async () =>
      page.locator('.catalog-layer .sidebar').evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: Math.round(bounds.x), width: Math.round(bounds.width) };
      }),
    )
    .toEqual({ x: 0, width: 232 });
  await page.screenshot({
    path: testInfo.outputPath('workspace-mobile-catalog.png'),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
});

test('opens the add menu from an empty workspace', async ({ page }, testInfo) => {
  await installDesktopFixture(page, emptyFixture());
  await page.setViewportSize({ width: 920, height: 700 });
  await page.goto('/');

  await expect(page.getByText('选择一个项目开始查看')).toBeVisible();
  await page.getByRole('button', { name: '打开项目目录' }).click();
  await page.locator('.catalog-layer .sidebar').getByRole('button', { name: '添加项目' }).click();
  await expect(page.getByRole('menuitem', { name: '选择文件夹' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '从 Codex 导入' })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('workspace-empty-add-menu.png'),
    fullPage: true,
  });
});

test('imports an eligible Codex project from a populated workspace', async ({ page }, testInfo) => {
  const snapshot = fixture();
  const secondProject = {
    ...snapshot.catalog.projects[0]!,
    id: 'project-2',
    displayName: 'Very long integration workspace name for responsive layout checks',
    rootPath: 'C:/Projects/integration-workspace-with-a-long-directory-name',
    order: 1,
  };
  snapshot.catalog.projects.push(secondProject);
  snapshot.projects.push({ ...snapshot.projects[0]!, project: secondProject });

  await installDesktopFixture(page, snapshot);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: '添加项目' }).click();
  await page.getByRole('menuitem', { name: '从 Codex 导入' }).click();

  const dialog = page.getByRole('dialog', { name: '从 Codex 导入' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /Codex Tooling/ })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /Scratch workspace/ })).toBeDisabled();
  await expect(dialog.getByText('不是 OpenSpec 项目')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('codex-import-dialog.png'), fullPage: true });

  await dialog.getByRole('button', { name: '导入 1 个项目' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('已导入 1 个 Codex 项目')).toBeVisible();
});

test('connects Change history to versions and keeps the version menu keyboard-friendly', async ({
  page,
}, testInfo) => {
  const history: HistoryFixture = {
    versionSummaries: {
      currentKey: 'version:v1',
      items: [
        {
          key: 'version:v1',
          label: 'v1',
          source: 'manual',
          isCurrent: true,
          activityCount: 1,
          revisionCount: 1,
          firstSeenAt: '2026-08-07T01:00:00.000Z',
          lastSeenAt: '2026-08-07T01:00:00.000Z',
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
    },
    activity: [
      {
        id: 'activity-v1',
        projectId: 'project-1',
        kind: 'artifact-change',
        createdAt: '2026-08-07T01:00:00.000Z',
        relativePath: 'openspec/changes/demo/tasks.md',
        changeId: 'demo',
        artifactType: 'tasks',
        projectVersion: 'v1',
        summary: 'v1 任务文档已更新',
        taskDelta: { completed: 1, total: 2 },
      },
      {
        id: 'activity-workspace',
        projectId: 'project-1',
        kind: 'project-registration',
        createdAt: '2026-08-06T01:00:00.000Z',
        changeId: 'demo',
        projectVersion: '',
        summary: '项目已加入当前工作区',
      },
    ],
    revisions: [],
  };

  await installDesktopFixture(page, fixture(), history);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');

  await expect(page.getByText('关联版本')).toBeVisible();
  await expect(page.getByRole('button', { name: '当前工作区', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: '活动' }).click();
  const filter = page.getByRole('combobox', { name: '筛选历史版本' });
  await expect(filter).toHaveValue('');
  await page.getByRole('button', { name: '当前版本 v1，打开版本菜单' }).press('Enter');
  const versionMenu = page.getByRole('menu');
  await expect(versionMenu).toBeVisible();
  await expect(versionMenu.getByText('手动设置')).toBeVisible();
  const menuDuration = await versionMenu.evaluate((element) => {
    const value = getComputedStyle(element).animationDuration;
    return Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
  });
  expect(menuDuration).toBeLessThanOrEqual(250);
  await page.screenshot({ path: testInfo.outputPath('version-menu-wide.png'), fullPage: true });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '当前工作区', exact: true }).click();
  await expect(filter).toHaveValue('workspace');
  await expect(page.getByText('项目已加入当前工作区')).toBeVisible();
  await expect(page.getByText('v1 任务文档已更新')).toBeHidden();

  await page.getByRole('button', { name: '当前版本 v1，打开版本菜单' }).click();
  await page.getByRole('menuitem', { name: '项目与版本设置' }).click();
  const settings = page.getByRole('dialog', { name: 'Demo project' });
  await expect(settings).toBeVisible();
  const dialogDuration = await settings.evaluate((element) => {
    const value = getComputedStyle(element).animationDuration;
    return Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
  });
  expect(dialogDuration).toBeLessThanOrEqual(300);
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('version-settings.png'), fullPage: true });
  await settings.getByRole('button', { name: '自动识别' }).click();
  await settings.getByRole('button', { name: '手动设置' }).click();
  const input = settings.getByPlaceholder('例如 v1.2.0');
  await input.fill('');
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('不能为空');
  await input.fill('v2');
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await expect(settings).toBeHidden();
  await expect(page.getByText('项目设置已保存')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __updateProjectCalls: unknown[] }).__updateProjectCalls,
      ),
    )
    .toContainEqual(expect.objectContaining({ versionMode: 'manual', versionLabel: 'v2' }));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '当前版本 v1，打开版本菜单' }).click();
  await expect(versionMenu).toBeVisible();
  await expect(versionMenu).toHaveCSS('animation-name', 'none');
  await page.keyboard.press('Escape');
  await expect(versionMenu).toBeHidden();
  await page.getByRole('button', { name: '当前版本 v1，打开版本菜单' }).click();
  await page.keyboard.press('Escape');
  await expect(versionMenu).toBeHidden();
});
