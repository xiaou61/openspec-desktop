import { expect, test, type Page } from '@playwright/test';
import type { AppSnapshot } from '../../src/shared/contracts';

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
    groupId: null,
    order: 0,
    watcherEnabled: true,
    watcherState: 'watching' as const,
    available: true,
    registeredAt: '2026-08-07T00:00:00.000Z',
  };
  return {
    catalog: {
      schemaVersion: 1,
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

async function installDesktopFixture(page: Page, initialSnapshot = fixture()): Promise<void> {
  await page.addInitScript((snapshot) => {
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
      updateProject: async () => snapshot,
      relocateProject: async () => snapshot,
      selectRelocation: async () => snapshot,
      unregisterProject: async () => snapshot,
      createGroup: async () => snapshot,
      updateGroup: async () => snapshot,
      removeGroup: async () => snapshot,
      rescanProject: async () => snapshot,
      listRevisions: async () => ({ items: [], nextCursor: null }),
      listActivity: async () => ({ items: [], nextCursor: null }),
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
    Object.defineProperty(window, '__emitProjection', {
      configurable: true,
      value: (event: unknown) => listener?.(event),
    });
  }, initialSnapshot);
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
