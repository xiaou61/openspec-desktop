import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { createActionCenterDiskFixture } from '../fixtures/action-center-project';

const packagedExecutable = process.env['OPENSPEC_DESKTOP_E2E_EXECUTABLE'];
const electronPath = resolve(packagedExecutable ?? 'node_modules/electron/dist/electron.exe');
const electronLaunchTimeout = packagedExecutable ? 90_000 : 30_000;

function launchArgs(userDataPath: string): string[] {
  return [
    `--user-data-dir=${userDataPath}`,
    ...(packagedExecutable ? [] : [resolve('out/main/index.js')]),
  ];
}

async function hashProjectFiles(root: string): Promise<string> {
  const files: Array<{ relativePath: string; fingerprint: string }> = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        const content = await fs.readFile(absolutePath);
        files.push({
          relativePath: relative(root, absolutePath).replaceAll('\\', '/'),
          fingerprint: createHash('sha256').update(content).digest('hex'),
        });
      }
    }
  };
  await visit(root);
  return createHash('sha256').update(JSON.stringify(files), 'utf8').digest('hex');
}

async function captureElectronScreenshot(
  app: Awaited<ReturnType<typeof electron.launch>>,
  path: string,
): Promise<void> {
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0];
    if (!target) throw new Error('Electron window is unavailable');
    return (await target.webContents.capturePage()).toPNG().toString('base64');
  });
  await fs.writeFile(path, Buffer.from(png, 'base64'));
}

test.describe('packaged Electron repository monitor', () => {
  test.describe.configure({ timeout: 90_000 });
  test.skip(!process.env['RUN_ELECTRON_E2E'], 'Run with pnpm test:e2e:electron to launch Electron');
  test.skip(process.platform !== 'win32', 'The release smoke test targets Windows');

  test('registers a project from the add-project button', async () => {
    const projectRoot = resolve(process.cwd());
    const userDataPath = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-add-project-'));
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      app = await electron.launch({
        executablePath: electronPath,
        args: launchArgs(userDataPath),
        env: {
          ...process.env,
          ELECTRON_RENDERER_URL: '',
          OPENSPEC_DESKTOP_USER_DATA: userDataPath,
        },
        timeout: 30_000,
      });
      const window = await app.firstWindow();
      await expect
        .poll(() => window.evaluate(() => typeof Reflect.get(window, 'desktop')))
        .toBe('object');
      await app.evaluate(({ dialog }, rootPath) => {
        const probe = { calls: 0 };
        Object.defineProperty(globalThis, '__addProjectDialogCalls', {
          configurable: true,
          get: () => probe.calls,
        });
        Object.defineProperty(globalThis, '__resetAddProjectDialogCalls', {
          configurable: true,
          value: () => {
            probe.calls = 0;
          },
        });
        dialog.showOpenDialog = async () => {
          probe.calls += 1;
          return { canceled: false, filePaths: [rootPath] };
        };
      }, projectRoot);
      await app.evaluate(async ({ dialog }) =>
        dialog.showOpenDialog({ properties: ['openDirectory'] }),
      );
      await expect
        .poll(() => app?.evaluate(() => Reflect.get(globalThis, '__addProjectDialogCalls')))
        .toBe(1);
      await app.evaluate(() =>
        (Reflect.get(globalThis, '__resetAddProjectDialogCalls') as () => void)(),
      );

      await window
        .getByLabel('项目目录')
        .getByRole('button', { name: '添加项目', exact: true })
        .click();
      await window.getByRole('menuitem', { name: '选择文件夹' }).click();

      await expect
        .poll(() => app?.evaluate(() => Reflect.get(globalThis, '__addProjectDialogCalls')))
        .toBe(1);
      await expect(window.getByRole('button', { name: basename(projectRoot) })).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await app?.close();
      await fs.rm(userDataPath, { recursive: true, force: true });
    }
  });

  test('imports an OpenSpec project from the local Codex project index', async () => {
    const projectRoot = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-codex-project-'));
    const codexHome = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-codex-home-'));
    const userDataPath = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-codex-data-'));
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await fs.mkdir(join(projectRoot, 'openspec'), { recursive: true });
      await fs.writeFile(join(projectRoot, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
      await fs.writeFile(
        join(codexHome, '.codex-global-state.json'),
        JSON.stringify({
          'local-projects': {
            'opaque-local-id': {
              id: 'opaque-local-id',
              name: 'Codex 本机项目',
              rootPaths: [projectRoot],
              createdAt: Date.now() - 60_000,
              updatedAt: Date.now(),
            },
          },
          'project-order': ['opaque-local-id'],
          'electron-saved-workspace-roots': [],
        }),
      );

      app = await electron.launch({
        executablePath: electronPath,
        args: launchArgs(userDataPath),
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          ELECTRON_RENDERER_URL: '',
          OPENSPEC_DESKTOP_USER_DATA: userDataPath,
        },
        timeout: 30_000,
      });
      const window = await app.firstWindow();
      await expect
        .poll(() => window.evaluate(() => typeof Reflect.get(window, 'desktop')))
        .toBe('object');

      await window
        .getByLabel('项目目录')
        .getByRole('button', { name: '添加项目', exact: true })
        .click();
      await window.getByRole('menuitem', { name: '从 Codex 导入' }).click();
      const dialog = window.getByRole('dialog', { name: '从 Codex 导入' });
      await expect(dialog.getByText('Codex 本机项目')).toBeVisible({ timeout: 15_000 });
      await expect(dialog.getByRole('checkbox', { name: /Codex 本机项目/ })).toBeChecked();
      await dialog.getByRole('button', { name: '导入 1 个项目' }).click();

      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect(window.getByRole('button', { name: /Codex 本机项目/ })).toBeVisible({
        timeout: 15_000,
      });
      await expect(window.getByText('已导入 1 个 Codex 项目')).toBeVisible();
    } finally {
      await app?.close();
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
      await fs.rm(userDataPath, { recursive: true, force: true });
    }
  });

  test('imports and restores a multi-project Codex workspace at both supported sizes', async () => {
    const fixtureRoot = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-workspace-'));
    const workspaceRoot = join(fixtureRoot, 'Demo Workspace');
    const openSpecRoot = join(workspaceRoot, 'demo-web');
    const codexHome = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-workspace-codex-'));
    const userDataPath = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-workspace-data-'));
    const verificationRoot = resolve('output', 'playwright');
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    const launch = async (): Promise<{
      app: Awaited<ReturnType<typeof electron.launch>>;
      window: Page;
    }> => {
      const launched = await electron.launch({
        executablePath: electronPath,
        args: launchArgs(userDataPath),
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          ELECTRON_RENDERER_URL: '',
          OPENSPEC_DESKTOP_USER_DATA: userDataPath,
        },
        timeout: electronLaunchTimeout,
      });
      const window = await launched.firstWindow();
      await expect
        .poll(() => window.evaluate(() => typeof Reflect.get(window, 'desktop')))
        .toBe('object');
      return { app: launched, window };
    };
    const setWindowSize = async (
      launched: Awaited<ReturnType<typeof electron.launch>>,
      window: Page,
      width: number,
      height: number,
    ): Promise<void> => {
      const browserWindow = await launched.browserWindow(window);
      await browserWindow.evaluate(
        (currentWindow, bounds) => {
          if (currentWindow.isMinimized()) currentWindow.restore();
          if (currentWindow.isMaximized()) currentWindow.unmaximize();
          currentWindow.setSize(bounds.width, bounds.height);
          currentWindow.show();
        },
        { width, height },
      );
      await expect
        .poll(async () => {
          const bounds = await browserWindow.evaluate((currentWindow) => {
            const bounds = currentWindow.getBounds();
            return { width: bounds.width, height: bounds.height };
          });
          return Math.abs(bounds.width - width) <= 1 && Math.abs(bounds.height - height) <= 1;
        })
        .toBe(true);
    };
    const readCatalogShape = async (): Promise<unknown> => {
      try {
        const catalog = JSON.parse(
          await fs.readFile(join(userDataPath, 'catalog.json'), 'utf8'),
        ) as {
          schemaVersion?: number;
          groups?: Array<{
            id?: string;
            kind?: string;
            name?: string;
            sourceRootPath?: string;
          }>;
          projects?: Array<{ rootPath?: string; groupId?: string | null }>;
        };
        const group = catalog.groups?.find((candidate) => candidate.kind === 'codex-workspace');
        const project = catalog.projects?.find((candidate) => candidate.rootPath === openSpecRoot);
        return {
          schemaVersion: catalog.schemaVersion,
          groupCount: catalog.groups?.length ?? 0,
          groupKind: group?.kind,
          groupName: group?.name,
          sourceRootPath: group?.sourceRootPath,
          projectCount: catalog.projects?.length ?? 0,
          projectRootPath: project?.rootPath,
          projectLinked: Boolean(group?.id && project?.groupId === group.id),
          parentRegistered: catalog.projects?.some(
            (candidate) => candidate.rootPath === workspaceRoot,
          ),
        };
      } catch {
        return null;
      }
    };
    const expectDialogWithoutOverlap = async (window: Page): Promise<void> => {
      const layout = await window.evaluate(() => {
        const rect = (selector: string) => {
          const bounds = document.querySelector(selector)?.getBoundingClientRect();
          return bounds
            ? {
                left: bounds.left,
                top: bounds.top,
                right: bounds.right,
                bottom: bounds.bottom,
              }
            : null;
        };
        const overlaps = (left: ReturnType<typeof rect>, right: ReturnType<typeof rect>): boolean =>
          Boolean(
            left &&
            right &&
            left.left < right.right &&
            left.right > right.left &&
            left.top < right.bottom &&
            left.bottom > right.top,
          );
        const dialog = document.querySelector('.codex-import-dialog');
        const workspaceRow = document.querySelector('.codex-workspace-row');
        const privacy = rect('.codex-dialog-footer .privacy-note');
        const actions = rect('.codex-dialog-footer .dialog-footer-actions');
        return {
          dialog: rect('.codex-import-dialog'),
          viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
          dialogOverflow: dialog ? dialog.scrollWidth - dialog.clientWidth : 1,
          workspaceOverflow: workspaceRow ? workspaceRow.scrollWidth - workspaceRow.clientWidth : 1,
          footerOverlap: overlaps(privacy, actions),
        };
      });
      expect(layout.dialog).not.toBeNull();
      expect(layout.dialog!.left).toBeGreaterThanOrEqual(0);
      expect(layout.dialog!.top).toBeGreaterThanOrEqual(0);
      expect(layout.dialog!.right).toBeLessThanOrEqual(layout.viewport.width + 1);
      expect(layout.dialog!.bottom).toBeLessThanOrEqual(layout.viewport.height + 1);
      expect(layout.dialogOverflow).toBeLessThanOrEqual(1);
      expect(layout.workspaceOverflow).toBeLessThanOrEqual(1);
      expect(layout.footerOverlap).toBe(false);
    };

    try {
      await fs.mkdir(join(openSpecRoot, 'openspec'), { recursive: true });
      await fs.mkdir(join(workspaceRoot, 'demo-api', '.git'), { recursive: true });
      await fs.mkdir(join(workspaceRoot, 'demo-tools'), { recursive: true });
      await fs.mkdir(verificationRoot, { recursive: true });
      await fs.writeFile(join(openSpecRoot, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
      await fs.writeFile(join(openSpecRoot, 'package.json'), '{"name":"demo-web"}\n');
      await fs.writeFile(
        join(workspaceRoot, 'demo-api', 'package.json'),
        '{"name":"demo-api"}\n',
      );
      await fs.writeFile(
        join(workspaceRoot, 'demo-tools', 'pyproject.toml'),
        '[project]\nname = "demo-tools"\n',
      );
      await fs.writeFile(
        join(codexHome, '.codex-global-state.json'),
        JSON.stringify({
          'local-projects': {
            'demo-workspace': {
              id: 'demo-workspace',
              name: 'Demo Workspace',
              rootPaths: [workspaceRoot],
              createdAt: Date.now() - 60_000,
              updatedAt: Date.now(),
            },
          },
          'project-order': ['demo-workspace'],
          'electron-saved-workspace-roots': [],
        }),
      );
      const projectHash = await hashProjectFiles(workspaceRoot);

      ({ app } = await launch());
      let window = await app.firstWindow();
      await setWindowSize(app, window, 1440, 900);
      await window
        .getByLabel('项目目录')
        .getByRole('button', { name: '添加项目', exact: true })
        .click();
      await window.getByRole('menuitem', { name: '从 Codex 导入' }).click();
      const dialog = window.getByRole('dialog', { name: '从 Codex 导入' });
      const summary = dialog.locator('.codex-summary');
      await expect(summary.getByText('1 个 Codex 根目录', { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      await expect(summary.getByText('1 个工作区', { exact: true })).toBeVisible();
      await expect(summary.getByText('3 个代码仓库', { exact: true })).toBeVisible();
      await expect(summary.getByText('1 个 OpenSpec 项目', { exact: true })).toBeVisible();
      await expect(summary.getByText('1 个可导入', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('checkbox', { name: /demo-api/ })).toBeDisabled();
      await expect(dialog.getByRole('checkbox', { name: /demo-tools/ })).toBeDisabled();

      const collapse = dialog.getByRole('button', { name: '折叠工作区 Demo Workspace' });
      await collapse.focus();
      await collapse.press('Enter');
      const expand = dialog.getByRole('button', { name: '展开工作区 Demo Workspace' });
      await expect(expand).toHaveAttribute('aria-expanded', 'false');
      await expand.press('Enter');
      const parent = dialog.getByRole('checkbox', {
        name: '选择工作区 Demo Workspace 的可导入项目',
      });
      await parent.focus();
      await parent.press('Space');
      await expect(parent).not.toBeChecked();
      await parent.press('Space');
      await expect(parent).toBeChecked();
      await expectDialogWithoutOverlap(window);
      await window.screenshot({
        path: join(verificationRoot, 'electron-codex-workspace-1440x900.png'),
      });

      await setWindowSize(app, window, 920, 700);
      await expectDialogWithoutOverlap(window);
      await window.screenshot({
        path: join(verificationRoot, 'electron-codex-workspace-920x700.png'),
      });
      await dialog.getByRole('button', { name: '导入 1 个项目' }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(window.getByText('已导入 1 个 Codex 项目')).toBeVisible();
      await window.getByRole('button', { name: '打开项目目录' }).click();
      const workspaceHeading = window
        .locator('.tree-group-heading > span[title]')
        .filter({ hasText: 'Demo Workspace' });
      await expect(workspaceHeading).toHaveAttribute('title', workspaceRoot);
      await expect(workspaceHeading.getByText('工作区')).toBeVisible();
      await expect(window.getByRole('button', { name: /demo-web/ })).toBeVisible();
      await expect.poll(readCatalogShape).toEqual({
        schemaVersion: 3,
        groupCount: 1,
        groupKind: 'codex-workspace',
        groupName: 'Demo Workspace',
        sourceRootPath: workspaceRoot,
        projectCount: 1,
        projectRootPath: openSpecRoot,
        projectLinked: true,
        parentRegistered: false,
      });
      expect(await hashProjectFiles(workspaceRoot)).toBe(projectHash);

      await app.close();
      app = undefined;
      ({ app } = await launch());
      window = await app.firstWindow();
      await setWindowSize(app, window, 920, 700);
      await window.getByRole('button', { name: '打开项目目录' }).click();
      const restoredHeading = window
        .locator('.tree-group-heading > span[title]')
        .filter({ hasText: 'Demo Workspace' });
      await expect(restoredHeading).toHaveAttribute('title', workspaceRoot, { timeout: 20_000 });
      await expect(restoredHeading.getByText('工作区')).toBeVisible();
      await expect(window.getByRole('button', { name: /demo-web/ })).toBeVisible();
      expect(await hashProjectFiles(workspaceRoot)).toBe(projectHash);
    } finally {
      await app?.close();
      await fs.rm(fixtureRoot, { recursive: true, force: true });
      await fs.rm(codexHome, { recursive: true, force: true });
      await fs.rm(userDataPath, { recursive: true, force: true });
    }
  });

  test('scans this repository and publishes a live task update', async () => {
    const projectRoot = resolve(process.cwd());
    const changeId = `codex-e2e-${process.pid}`;
    const changeRoot = join(projectRoot, 'openspec', 'changes', changeId);
    const userDataPath = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-e2e-'));
    const projectId = 'e2e-repository';
    const now = new Date().toISOString();
    const catalog = {
      schemaVersion: 1,
      groups: [],
      projects: [
        {
          id: projectId,
          rootPath: projectRoot,
          displayName: '当前仓库',
          versionLabel: 'e2e',
          groupId: null,
          order: 0,
          watcherEnabled: true,
          watcherState: 'scanning',
          available: true,
          registeredAt: now,
        },
      ],
      preferences: {
        selectedProjectId: projectId,
        selectedChangeId: changeId,
        showArchived: false,
        windowBounds: { width: 1200, height: 800 },
      },
    };
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await fs.rm(changeRoot, { recursive: true, force: true });
      await fs.mkdir(join(changeRoot, 'specs', 'smoke'), { recursive: true });
      await fs.writeFile(join(changeRoot, 'proposal.md'), '# Disposable smoke change\n');
      await fs.writeFile(join(changeRoot, 'design.md'), '# Design\n');
      await fs.writeFile(join(changeRoot, 'specs', 'smoke', 'spec.md'), '# Spec\n');
      const tasksPath = join(changeRoot, 'tasks.md');
      await fs.writeFile(tasksPath, '# Tasks\n\n- [ ] live update\n');
      await fs.writeFile(join(changeRoot, '.openspec.yaml'), 'schema: spec-driven\n');
      await fs.writeFile(
        join(userDataPath, 'catalog.json'),
        `${JSON.stringify(catalog, null, 2)}\n`,
      );

      app = await electron.launch({
        executablePath: electronPath,
        args: launchArgs(userDataPath),
        env: {
          ...process.env,
          ELECTRON_RENDERER_URL: '',
          OPENSPEC_DESKTOP_USER_DATA: userDataPath,
        },
        timeout: 30_000,
      });
      const window = await app.firstWindow();
      await expect(window.getByRole('heading', { name: changeId })).toBeVisible({
        timeout: 15_000,
      });
      const changeRow = window.getByRole('listitem').filter({ hasText: changeId });
      await expect(changeRow.getByText('0/1 任务')).toBeVisible({ timeout: 10_000 });
      await fs.writeFile(tasksPath, '# Tasks\n\n- [x] live update\n');
      await expect(changeRow.getByText('1/1 任务')).toBeVisible({ timeout: 15_000 });
      await expect(
        window
          .getByLabel('Change 详情', { exact: true })
          .getByRole('button', { name: '任务：已完成' }),
      ).toBeVisible();
    } finally {
      await app?.close();
      await fs.rm(changeRoot, { recursive: true, force: true });
      await fs.rm(userDataPath, { recursive: true, force: true });
    }
  });

  test('does not read, write, migrate, or clean legacy spec-assurance user data', async () => {
    test.setTimeout(packagedExecutable ? 300_000 : 180_000);
    const projectRoot = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-retired-assurance-project-'));
    const userDataPath = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-retired-assurance-data-'));
    const projectId = 'retired-assurance-project';
    const changeId = 'retired-assurance-change';
    const changeRoot = join(projectRoot, 'openspec', 'changes', changeId);
    const legacyRoot = join(userDataPath, 'spec-assurance');
    const now = '2026-08-11T14:00:00.000Z';
    const catalog = {
      schemaVersion: 2,
      groups: [],
      projects: [
        {
          id: projectId,
          rootPath: projectRoot,
          displayName: 'Retired assurance project',
          versionLabel: '',
          versionMode: 'automatic',
          versionSource: 'workspace',
          versionResolvedAt: now,
          groupId: null,
          order: 0,
          watcherEnabled: true,
          watcherState: 'scanning',
          available: true,
          registeredAt: now,
        },
      ],
      preferences: {
        selectedProjectId: projectId,
        selectedChangeId: changeId,
        showArchived: false,
        windowBounds: { width: 1280, height: 820 },
      },
    };
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    let window!: Page;
    try {
      await fs.mkdir(join(changeRoot, 'specs', 'retired'), { recursive: true });
      await fs.mkdir(join(legacyRoot, projectId), { recursive: true });
      await fs.writeFile(join(projectRoot, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
      await fs.writeFile(join(changeRoot, 'proposal.md'), '# Retired assurance\n');
      await fs.writeFile(join(changeRoot, 'design.md'), '# Retired assurance design\n');
      await fs.writeFile(
        join(changeRoot, 'specs', 'retired', 'spec.md'),
        '# Retired spec\n\n## ADDED Requirements\n\n### Requirement: 保留只读边界\n',
      );
      await fs.writeFile(join(changeRoot, '.openspec.yaml'), 'schema: spec-driven\n');
      await fs.writeFile(join(changeRoot, 'tasks.md'), '# Tasks\n\n- [ ] Initial scan\n');
      await fs.writeFile(
        join(userDataPath, 'catalog.json'),
        `${JSON.stringify(catalog, null, 2)}\n`,
      );
      await fs.writeFile(
        join(legacyRoot, projectId, 'index.json'),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            mode: 'strict',
            active: { [changeId]: { reviewedAt: now } },
            provenance: { retired: { entries: [] } },
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      await fs.writeFile(join(legacyRoot, projectId, 'state.json'), '{corrupt', 'utf8');
      const before = await hashProjectFiles(legacyRoot);

      const launched = await electron.launch({
        executablePath: electronPath,
        args: launchArgs(userDataPath),
        env: {
          ...process.env,
          ELECTRON_RENDERER_URL: '',
          OPENSPEC_DESKTOP_USER_DATA: userDataPath,
        },
        timeout: electronLaunchTimeout,
      });
      app = launched;
      window = await launched.firstWindow();
      await expect(window.getByRole('heading', { name: changeId })).toBeVisible({
        timeout: 20_000,
      });
      await expect(window.getByRole('tab', { name: '保障' })).toHaveCount(0);
      await expect(window.getByRole('heading', { name: '规格保障' })).toHaveCount(0);
      await window.getByRole('button', { name: '项目设置' }).first().click();
      const settings = window.getByRole('dialog', { name: 'Retired assurance project' });
      await expect(settings.getByRole('radiogroup', { name: '规格保障模式' })).toHaveCount(0);
      await expect(settings.getByRole('button', { name: '清除保障数据' })).toHaveCount(0);
      await settings.getByRole('button', { name: '关闭' }).click();

      const forbidden = await window.evaluate(() => {
        const desktop = Reflect.get(globalThis, 'desktop') as Record<string, unknown>;
        return [
          'getSpecAssuranceMode',
          'setSpecAssuranceMode',
          'getSpecAssurance',
          'refreshSpecAssurance',
          'recordRequirementReviews',
          'importAssuranceReport',
          'previewAssuranceReport',
          'updateAssuranceConflict',
          'selectAssuranceReportFile',
          'requestClearSpecAssurance',
          'clearSpecAssurance',
        ].filter((method) => typeof desktop[method] === 'function');
      });
      expect(forbidden).toEqual([]);
      expect(await hashProjectFiles(legacyRoot)).toBe(before);
    } finally {
      await app?.close();
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(userDataPath, { recursive: true, force: true });
    }
  });

  test('keeps the 93 completed task history when new unchecked tasks reopen a completed change', async () => {
    test.setTimeout(180_000);
    const projectRoot = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-rework-93-'));
    const userDataPath = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-rework-93-data-'));
    const changeId = 'rework-93-change';
    const changeRoot = join(projectRoot, 'openspec', 'changes', changeId);
    const projectId = 'rework-93-project';
    const now = new Date().toISOString();
    const tasksPath = join(changeRoot, 'tasks.md');
    const catalog = {
      schemaVersion: 2,
      groups: [],
      projects: [
        {
          id: projectId,
          rootPath: projectRoot,
          displayName: 'Rework 93 project',
          versionLabel: 'v1',
          versionMode: 'manual',
          versionSource: 'manual',
          groupId: null,
          order: 0,
          watcherEnabled: true,
          watcherState: 'scanning',
          available: true,
          registeredAt: now,
        },
      ],
      preferences: {
        selectedProjectId: projectId,
        selectedChangeId: changeId,
        showArchived: false,
        windowBounds: { width: 1280, height: 820 },
      },
    };
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await fs.mkdir(join(changeRoot, 'specs', 'rework'), { recursive: true });
      await fs.mkdir(join(projectRoot, 'openspec'), { recursive: true });
      await fs.writeFile(join(projectRoot, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
      await fs.writeFile(join(changeRoot, 'proposal.md'), '# Rework 93 proposal\n');
      await fs.writeFile(join(changeRoot, 'design.md'), '# Rework 93 design\n');
      await fs.writeFile(join(changeRoot, '.openspec.yaml'), 'schema: spec-driven\n');
      await fs.writeFile(
        join(changeRoot, 'specs', 'rework', 'spec.md'),
        [
          '## ADDED Requirements',
          '',
          '### Requirement: 二次开发',
          'The system MUST reopen completed changes when new tasks appear.',
          '',
          '#### Scenario: New tasks',
          '- **WHEN** unchecked tasks are added to a completed change',
          '- **THEN** the change enters implementation round 2 with original checks preserved',
          '',
        ].join('\n'),
      );
      const completedTasks = Array.from(
        { length: 93 },
        (_, index) => `- [x] Task ${index + 1}`,
      ).join('\n');
      await fs.writeFile(tasksPath, `# Tasks\n\n${completedTasks}\n`);
      await fs.writeFile(
        join(userDataPath, 'catalog.json'),
        `${JSON.stringify(catalog, null, 2)}\n`,
      );

      app = await electron.launch({
        executablePath: electronPath,
        args: launchArgs(userDataPath),
        env: {
          ...process.env,
          ELECTRON_RENDERER_URL: '',
          OPENSPEC_DESKTOP_USER_DATA: userDataPath,
        },
        timeout: 30_000,
      });
      const window = await app.firstWindow();
      await expect(window.getByRole('heading', { name: changeId })).toBeVisible({
        timeout: 20_000,
      });
      const changeRow = window.getByRole('listitem').filter({ hasText: changeId });
      await expect(changeRow.getByText('93/93 任务')).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(
          async () => {
            try {
              const state = JSON.parse(
                await fs.readFile(
                  join(userDataPath, 'change-work-state', projectId, 'index.json'),
                  'utf8',
                ),
              ) as { active?: Record<string, { phase?: string }> };
              return state.active?.[changeId]?.phase;
            } catch {
              return undefined;
            }
          },
          { timeout: 30_000 },
        )
        .toBe('completed');

      const reopened = Array.from(
        { length: 12 },
        (_, index) => `- [ ] Rework task ${index + 1}`,
      ).join('\n');
      await fs.writeFile(tasksPath, `# Tasks\n\n${completedTasks}\n${reopened}\n`);
      await expect(changeRow.getByText('93/105 任务')).toBeVisible({ timeout: 30_000 });
      await expect(window.getByText('再次实施 · 第 2 轮').first()).toBeVisible({
        timeout: 30_000,
      });

      const rawTasks = await fs.readFile(tasksPath, 'utf8');
      expect(rawTasks.split('\n').filter((line) => line.startsWith('- [x]'))).toHaveLength(93);
      expect(rawTasks.split('\n').filter((line) => line.startsWith('- [ ]'))).toHaveLength(12);
      expect(rawTasks).toContain('- [x] Task 1');
      expect(rawTasks).toContain('- [x] Task 93');
    } finally {
      await app?.close();
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(userDataPath, { recursive: true, force: true });
    }
  });

  test('keeps rework and cross-project actions read-only across desktop and minimum windows', async () => {
    test.setTimeout(90_000);
    const root = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-action-center-'));
    const fixture = await createActionCenterDiskFixture(root);
    const primaryChangesRoot = join(fixture.primaryRoot, 'openspec', 'changes');
    for (const entry of await fs.readdir(primaryChangesRoot, { withFileTypes: true })) {
      if (entry.name === 'completed-then-expanded') continue;
      await fs.rm(join(primaryChangesRoot, entry.name), { recursive: true, force: true });
    }
    const userDataPath = join(root, 'user-data');
    const verificationRoot = resolve('output', 'playwright');
    const now = new Date().toISOString();
    const catalog = {
      schemaVersion: 2,
      groups: [],
      projects: [
        {
          id: 'action-primary',
          rootPath: fixture.primaryRoot,
          displayName: 'Primary project',
          versionLabel: 'v1',
          versionMode: 'manual',
          versionSource: 'manual',
          groupId: null,
          order: 0,
          watcherEnabled: true,
          watcherState: 'scanning',
          available: true,
          registeredAt: now,
        },
        {
          id: 'action-secondary',
          rootPath: fixture.secondaryRoot,
          displayName: 'Secondary project',
          versionLabel: 'v1',
          versionMode: 'manual',
          versionSource: 'manual',
          groupId: null,
          order: 1,
          watcherEnabled: true,
          watcherState: 'scanning',
          available: true,
          registeredAt: now,
        },
      ],
      preferences: {
        selectedProjectId: 'action-primary',
        selectedChangeId: 'completed-then-expanded',
        showArchived: false,
        windowBounds: { width: 1440, height: 900 },
      },
    };
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await fs.mkdir(userDataPath, { recursive: true });
      await fs.mkdir(verificationRoot, { recursive: true });
      await fs.writeFile(
        join(userDataPath, 'catalog.json'),
        `${JSON.stringify(catalog, null, 2)}\n`,
      );

      app = await electron.launch({
        executablePath: electronPath,
        args: launchArgs(userDataPath),
        env: {
          ...process.env,
          ELECTRON_RENDERER_URL: '',
          OPENSPEC_DESKTOP_USER_DATA: userDataPath,
        },
        timeout: 30_000,
      });
      const window = await app.firstWindow();
      const browserWindow = await app.browserWindow(window);
      await browserWindow.evaluate((currentWindow) => currentWindow.setSize(1440, 900));
      await expect(window.getByRole('heading', { name: 'completed-then-expanded' })).toBeVisible({
        timeout: 20_000,
      });
      await expect
        .poll(async () => {
          try {
            const raw = await fs.readFile(
              join(userDataPath, 'change-work-state', 'action-primary', 'index.json'),
              'utf8',
            );
            const state = JSON.parse(raw) as {
              active?: Record<string, { phase?: string }>;
            };
            return state.active?.['completed-then-expanded']?.phase;
          } catch {
            return undefined;
          }
        })
        .toBe('completed');

      const changeRow = window.getByRole('listitem').filter({ hasText: 'completed-then-expanded' });
      await expect(changeRow.getByText('57/57 任务')).toBeVisible();
      await fixture.expandCompletedChange();
      await expect(changeRow.getByText('57/64 任务')).toBeVisible({ timeout: 20_000 });
      await expect(window.getByText('再次实施 · 第 2 轮').first()).toBeVisible();

      const lifecycleTrack = window.getByRole('navigation', { name: 'Change 生命周期' });
      const taskNode = lifecycleTrack.getByRole('button', { name: '任务：当前' });
      await expect(taskNode).toBeVisible({ timeout: 20_000 });
      await expect(taskNode.locator('.lifecycle-state-mark svg')).toHaveClass(
        /lucide-loader-circle/,
      );
      await expect(taskNode.locator('.lifecycle-state-mark svg')).not.toHaveClass(/lucide-check/);

      const projectHashes = await fixture.hashProjects();
      await window.getByRole('button', { name: /行动中心/ }).click();
      await expect(window.getByRole('heading', { name: '行动中心', exact: true })).toBeVisible({
        timeout: 20_000,
      });
      const queue = window.getByRole('listbox', { name: '行动队列' });
      const reopenedOption = queue.getByRole('option', { name: /completed-then-expanded/ });
      await expect(reopenedOption).toBeVisible({ timeout: 20_000 });

      const options = queue.getByRole('option');
      expect(await options.count()).toBeGreaterThan(1);
      await options.first().focus();
      await options.first().press('ArrowDown');
      await expect(options.nth(1)).toBeFocused();
      await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
      await options.nth(1).press('Home');
      await expect(options.first()).toBeFocused();
      await options.first().press('End');
      await expect(options.last()).toBeFocused();

      const refreshActionCenter = window.getByRole('button', { name: '刷新行动中心' });
      await refreshActionCenter.click();
      await expect(refreshActionCenter).toBeEnabled({ timeout: 20_000 });
      await expect(reopenedOption).toBeVisible({ timeout: 20_000 });
      await reopenedOption.click();
      await expect(reopenedOption).toHaveAttribute('aria-selected', 'true');
      await expect(window.getByLabel('任务计数').getByText('57 / 64')).toBeVisible();
      await expect(window.getByText('再次实施 · 第 2 轮').last()).toBeVisible();
      await window.getByRole('button', { name: '复制 Codex 交接' }).click();
      await expect(window.getByText('Codex 交接已复制')).toBeVisible({ timeout: 20_000 });
      await expect(window.getByLabel('Codex 交接内容')).toContainText('completed-then-expanded');
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain(
        'completed-then-expanded',
      );

      const desktopLayout = await window.evaluate(() => {
        const bounds = (selector: string) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          return rect ? { left: rect.left, right: rect.right } : null;
        };
        return {
          list: bounds('.action-list-pane'),
          detail: bounds('.action-detail-pane'),
          contentWidth: document.documentElement.scrollWidth,
          viewportWidth: globalThis.innerWidth,
        };
      });
      expect(desktopLayout.list!.right).toBeLessThanOrEqual(desktopLayout.detail!.left + 1);
      expect(desktopLayout.contentWidth).toBeLessThanOrEqual(desktopLayout.viewportWidth + 1);
      await window.screenshot({
        path: join(verificationRoot, 'electron-action-center-desktop.png'),
      });

      await browserWindow.evaluate((currentWindow) => {
        if (currentWindow.isMinimized()) currentWindow.restore();
        if (!currentWindow.isVisible()) currentWindow.show();
        if (currentWindow.isMaximized()) currentWindow.unmaximize();
      });
      await expect
        .poll(() =>
          browserWindow.evaluate(
            (currentWindow) =>
              currentWindow.isVisible() &&
              !currentWindow.isMinimized() &&
              !currentWindow.isMaximized(),
          ),
        )
        .toBe(true);
      await browserWindow.evaluate((currentWindow) => {
        const bounds = currentWindow.getBounds();
        currentWindow.setBounds({ x: bounds.x, y: bounds.y, width: 920, height: 700 });
      });
      await expect
        .poll(async () => {
          const bounds = await browserWindow.evaluate((currentWindow) => {
            const bounds = currentWindow.getBounds();
            return { width: bounds.width, height: bounds.height };
          });
          return bounds.width >= 920 && bounds.width <= 921 && bounds.height === 700;
        })
        .toBe(true);
      await expect(window.getByRole('heading', { name: '行动中心', exact: true })).toBeVisible();
      const minimumLayout = await window.evaluate(() => ({
        contentWidth: document.documentElement.scrollWidth,
        viewportWidth: globalThis.innerWidth,
        listWidth: document.querySelector('.action-list-pane')?.getBoundingClientRect().width ?? 0,
        detailWidth:
          document.querySelector('.action-detail-pane')?.getBoundingClientRect().width ?? 0,
      }));
      expect(minimumLayout.contentWidth).toBeLessThanOrEqual(minimumLayout.viewportWidth + 1);
      expect(minimumLayout.listWidth).toBeGreaterThan(200);
      expect(minimumLayout.detailWidth).toBeGreaterThan(400);
      await window.screenshot({
        path: join(verificationRoot, 'electron-action-center-minimum.png'),
      });
      expect(await fixture.hashProjects()).toEqual(projectHashes);
    } finally {
      await app?.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('does not expose project insights UI or desktop APIs while core Change flow stays available', async () => {
    test.setTimeout(90_000);
    const root = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-no-insights-'));
    const fixture = await createActionCenterDiskFixture(root);
    const projectId = 'no-insights-primary';
    const userDataPath = join(root, 'user-data');
    const now = new Date().toISOString();
    const catalog = {
      schemaVersion: 2,
      groups: [],
      projects: [
        {
          id: projectId,
          rootPath: fixture.primaryRoot,
          displayName: 'Primary project',
          versionLabel: 'v1',
          versionMode: 'manual',
          versionSource: 'manual',
          groupId: null,
          order: 0,
          watcherEnabled: true,
          watcherState: 'scanning',
          available: true,
          registeredAt: now,
        },
      ],
      preferences: {
        selectedProjectId: projectId,
        selectedChangeId: 'first-incomplete',
        showArchived: false,
        windowBounds: { width: 1440, height: 900 },
      },
    };
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await fs.mkdir(userDataPath, { recursive: true });
      await fs.writeFile(
        join(userDataPath, 'catalog.json'),
        `${JSON.stringify(catalog, null, 2)}\n`,
      );

      app = await electron.launch({
        executablePath: electronPath,
        args: launchArgs(userDataPath),
        env: {
          ...process.env,
          ELECTRON_RENDERER_URL: '',
          OPENSPEC_DESKTOP_USER_DATA: userDataPath,
        },
        timeout: 30_000,
      });
      const window = await app.firstWindow();
      const browserWindow = await app.browserWindow(window);
      await browserWindow.evaluate((currentWindow) => currentWindow.setSize(1440, 900));

      await expect(window.getByRole('heading', { name: 'first-incomplete' })).toBeVisible({
        timeout: 20_000,
      });
      await expect(window.getByRole('button', { name: '项目洞察' })).toHaveCount(0);
      await expect(window.getByRole('tab', { name: '能力' })).toHaveCount(0);
      await expect(window.getByRole('tab', { name: '简报' })).toHaveCount(0);
      const forbidden = await window.evaluate(() => {
        const desktop = Reflect.get(window, 'desktop') as Record<string, unknown>;
        return [
          'getProjectInsights',
          'getProjectInsightsWorkspaceSummary',
          'getProjectInsightsCapability',
          'generateProjectInsightsDigest',
          'copyProjectInsightsDigest',
          'exportProjectInsightsDigest',
        ].filter((method) => typeof desktop[method] === 'function');
      });
      expect(forbidden).toEqual([]);

      await window.getByRole('button', { name: /行动中心/ }).click();
      await expect(window.getByRole('heading', { name: '行动中心', exact: true })).toBeVisible({
        timeout: 20_000,
      });
      await window.reload();
      await expect(window.getByRole('heading', { name: 'first-incomplete' })).toBeVisible({
        timeout: 20_000,
      });
      await expect(window.getByRole('button', { name: '项目洞察' })).toHaveCount(0);
    } finally {
      await app?.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('resolves a package version and associates live history after a manual switch', async () => {
    const projectRoot = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-version-project-'));
    const userDataPath = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-version-data-'));
    const changeId = 'version-context-check';
    const changeRoot = join(projectRoot, 'openspec', 'changes', changeId);
    const tasksPath = join(changeRoot, 'tasks.md');
    const now = new Date().toISOString();
    const projectId = 'version-context-project';
    const catalog = {
      schemaVersion: 2,
      groups: [],
      projects: [
        {
          id: projectId,
          rootPath: projectRoot,
          displayName: '版本上下文验收项目',
          versionLabel: '',
          versionMode: 'automatic',
          versionSource: 'workspace',
          versionResolvedAt: now,
          groupId: null,
          order: 0,
          watcherEnabled: true,
          watcherState: 'scanning',
          available: true,
          registeredAt: now,
        },
      ],
      preferences: {
        selectedProjectId: projectId,
        selectedChangeId: changeId,
        showArchived: false,
        windowBounds: { width: 1280, height: 820 },
      },
    };
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await fs.mkdir(join(changeRoot, 'specs', 'version-context'), { recursive: true });
      await fs.writeFile(join(projectRoot, 'package.json'), '{"version":"1.2.3"}\n');
      await fs.writeFile(join(projectRoot, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
      await fs.writeFile(join(changeRoot, 'proposal.md'), '# 版本上下文验收\n');
      await fs.writeFile(join(changeRoot, 'design.md'), '# 设计\n');
      await fs.writeFile(
        join(changeRoot, 'specs', 'version-context', 'spec.md'),
        '# 版本关联规格\n',
      );
      await fs.writeFile(join(changeRoot, '.openspec.yaml'), 'schema: spec-driven\n');
      await fs.writeFile(tasksPath, '# 任务\n\n- [ ] 监听版本切换\n');
      await fs.writeFile(
        join(userDataPath, 'catalog.json'),
        `${JSON.stringify(catalog, null, 2)}\n`,
      );

      app = await electron.launch({
        executablePath: electronPath,
        args: launchArgs(userDataPath),
        env: {
          ...process.env,
          ELECTRON_RENDERER_URL: '',
          OPENSPEC_DESKTOP_USER_DATA: userDataPath,
        },
        timeout: 30_000,
      });
      const window = await app.firstWindow();
      await expect(window.getByRole('heading', { name: changeId })).toBeVisible({
        timeout: 15_000,
      });
      const automaticTrigger = window.getByRole('button', {
        name: '当前版本 1.2.3，打开版本菜单',
      });
      await expect(automaticTrigger).toBeVisible({ timeout: 15_000 });
      await automaticTrigger.click();
      await expect(window.getByRole('menu').getByText('package.json')).toBeVisible();
      await window.getByRole('menuitem', { name: '项目与版本设置' }).click();

      const settings = window.getByRole('dialog', { name: '版本上下文验收项目' });
      await settings.getByRole('button', { name: '手动设置' }).click();
      await settings.getByPlaceholder('例如 v1.2.0').fill('2.0.0');
      await settings.getByRole('button', { name: '保存', exact: true }).click();
      await expect(
        window.getByRole('button', { name: '当前版本 2.0.0，打开版本菜单' }),
      ).toBeVisible({ timeout: 15_000 });

      await fs.writeFile(tasksPath, '# 任务\n\n- [x] 监听版本切换\n');
      const changeRow = window.getByRole('listitem').filter({ hasText: changeId });
      await expect(changeRow.getByText('1/1 任务')).toBeVisible({ timeout: 15_000 });
      await window.getByRole('tab', { name: '活动' }).click();
      await expect(
        window.locator('.activity-group > header').filter({ hasText: '2.0.0' }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        window.locator('.activity-group > header').filter({ hasText: '1.2.3' }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(window.getByText('任务变化：完成 +1，总数 0')).toBeVisible();
    } finally {
      await app?.close();
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(userDataPath, { recursive: true, force: true });
    }
  });

  test('captures long-content, parse-error, focus, and minimum-window states', async () => {
    const projectRoot = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-visual-project-'));
    const userDataPath = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-visual-data-'));
    const changeId = 'visual-layout-check';
    const changeRoot = join(projectRoot, 'openspec', 'changes', changeId);
    const verificationRoot = resolve('release', 'verification');
    const now = new Date().toISOString();
    const longVersionLabel = `2026.08-${'release-candidate-'.repeat(8)}`.slice(0, 120);
    const catalog = {
      schemaVersion: 1,
      groups: [],
      projects: [
        {
          id: 'visual-project',
          rootPath: projectRoot,
          displayName: 'OpenSpec desktop visual verification project with a long name',
          versionLabel: longVersionLabel,
          groupId: null,
          order: 0,
          watcherEnabled: true,
          watcherState: 'scanning',
          available: true,
          registeredAt: now,
        },
      ],
      preferences: {
        selectedProjectId: 'visual-project',
        selectedChangeId: changeId,
        showArchived: false,
        windowBounds: { width: 1440, height: 900 },
      },
    };
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      await fs.mkdir(join(changeRoot, 'specs', 'visual'), { recursive: true });
      await fs.mkdir(verificationRoot, { recursive: true });
      await fs.writeFile(join(projectRoot, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
      await fs.writeFile(join(changeRoot, 'proposal.md'), '# Visual layout verification\n');
      await fs.writeFile(
        join(changeRoot, 'design.md'),
        '# Design\n\nDesktop layout remains stable.\n',
      );
      await fs.writeFile(join(changeRoot, 'specs', 'visual', 'spec.md'), '# Visual spec\n');
      await fs.writeFile(join(changeRoot, '.openspec.yaml'), 'schema: [\n');
      await fs.writeFile(
        join(changeRoot, 'tasks.md'),
        [
          '# Long Markdown layout verification',
          '',
          '- [x] Initial scan is visible',
          '- [ ] Watcher updates remain visible without overlap',
          '',
          `long-word-${'x'.repeat(180)}`,
          '',
          'long-content '.repeat(180),
          '',
          '<script>window.visualUnsafe = true</script>',
          '',
        ].join('\n'),
      );
      await fs.writeFile(
        join(userDataPath, 'catalog.json'),
        `${JSON.stringify(catalog, null, 2)}\n`,
      );

      app = await electron.launch({
        executablePath: electronPath,
        args: launchArgs(userDataPath),
        env: {
          ...process.env,
          ELECTRON_RENDERER_URL: '',
          OPENSPEC_DESKTOP_USER_DATA: userDataPath,
        },
        timeout: 30_000,
      });
      const window = await app.firstWindow();
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.setSize(1440, 900),
      );
      await expect
        .poll(() =>
          window.evaluate(
            () =>
              Math.abs(globalThis.outerWidth - 1440) <= 1 &&
              Math.abs(globalThis.outerHeight - 900) <= 1,
          ),
        )
        .toBe(true);
      await expect(window.getByRole('heading', { name: changeId })).toBeVisible({
        timeout: 15_000,
      });
      const versionTrigger = window.getByRole('button', {
        name: `当前版本 ${longVersionLabel}，打开版本菜单`,
      });
      await expect(versionTrigger).toBeVisible();
      const versionBounds = await versionTrigger.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, viewport: globalThis.innerWidth };
      });
      expect(versionBounds.left).toBeGreaterThanOrEqual(0);
      expect(versionBounds.right).toBeLessThanOrEqual(versionBounds.viewport);
      await expect(window.getByText('实时监控', { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(window.getByText('解析异常', { exact: true }).first()).toBeVisible();
      const lifecycleTrack = window.getByRole('navigation', { name: 'Change 生命周期' });
      await expect(lifecycleTrack.getByRole('button')).toHaveCount(6);
      await expect
        .poll(() =>
          lifecycleTrack.evaluate((element) => Math.round(element.getBoundingClientRect().height)),
        )
        .toBe(88);
      await lifecycleTrack.getByRole('button', { name: /验证：/ }).click();
      await expect(window.getByRole('tab', { name: '就绪' })).toHaveAttribute(
        'data-state',
        'active',
      );
      await expect(window.getByRole('region', { name: '严格验证' })).toBeVisible();
      await window.screenshot({
        path: join(verificationRoot, 'electron-lifecycle-readiness.png'),
      });

      await window.getByRole('tab', { name: '文档' }).click();
      await window.getByRole('tab', { name: 'tasks.md' }).click();
      await window.getByRole('button', { name: '原文' }).click();
      await expect(window.locator('.raw-markdown')).toContainText('long-content');
      expect(await window.evaluate(() => Reflect.get(window, 'visualUnsafe'))).toBeUndefined();

      await window.keyboard.press('Tab');
      const focus = await window.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        const style = element ? getComputedStyle(element) : null;
        return {
          tagName: element?.tagName ?? '',
          hasIndicator: Boolean(
            style && (style.outlineWidth !== '0px' || style.boxShadow !== 'none'),
          ),
        };
      });
      expect(focus.tagName).not.toBe('BODY');
      expect(focus.hasIndicator).toBe(true);
      await window.screenshot({ path: join(verificationRoot, 'electron-primary.png') });
      const desktopPixels = await app.evaluate(async ({ BrowserWindow }) => {
        const target = BrowserWindow.getAllWindows()[0];
        if (!target) return { width: 0, height: 0, nonWhite: 0 };
        const image = await target.webContents.capturePage();
        const bitmap = image.toBitmap();
        let nonWhite = 0;
        for (let offset = 0; offset + 3 < bitmap.length; offset += 4) {
          if (bitmap[offset]! < 245 || bitmap[offset + 1]! < 245 || bitmap[offset + 2]! < 245)
            nonWhite += 1;
        }
        return { ...image.getSize(), nonWhite };
      });
      expect(desktopPixels.width).toBeGreaterThan(1000);
      expect(desktopPixels.height).toBeGreaterThan(700);
      expect(desktopPixels.nonWhite).toBeGreaterThan(5_000);
      const desktopLayout = await window.evaluate(() => {
        const rect = (selector: string) => {
          const bounds = document.querySelector(selector)?.getBoundingClientRect();
          return bounds ? { left: bounds.left, right: bounds.right } : null;
        };
        return {
          sidebar: rect('.sidebar'),
          changes: rect('.change-list-pane'),
          detail: rect('.detail-pane'),
          contentWidth: document.documentElement.scrollWidth,
          viewportWidth: globalThis.innerWidth,
        };
      });
      expect(desktopLayout.sidebar!.right).toBeLessThanOrEqual(desktopLayout.changes!.left + 1);
      expect(desktopLayout.changes!.right).toBeLessThanOrEqual(desktopLayout.detail!.left + 1);
      expect(desktopLayout.contentWidth).toBeLessThanOrEqual(desktopLayout.viewportWidth + 1);

      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.setSize(920, 700),
      );
      await expect
        .poll(() => window.evaluate(() => globalThis.outerWidth))
        .toBeLessThanOrEqual(921);
      expect(await window.evaluate(() => globalThis.outerWidth)).toBeGreaterThanOrEqual(920);
      await expect.poll(() => window.evaluate(() => globalThis.outerHeight)).toBe(700);
      await expect
        .poll(() =>
          window.locator('.catalog-layer').evaluate((element) => {
            const style = getComputedStyle(element);
            return { visibility: style.visibility, pointerEvents: style.pointerEvents };
          }),
        )
        .toEqual({ visibility: 'hidden', pointerEvents: 'none' });
      const dimensions = await window.evaluate(() => ({
        contentWidth: document.documentElement.scrollWidth,
        viewportWidth: globalThis.innerWidth,
      }));
      expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      const trackOverflow = await lifecycleTrack.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(trackOverflow.scrollWidth).toBeLessThanOrEqual(trackOverflow.clientWidth + 1);
      const archiveNode = lifecycleTrack.getByRole('button', { name: /归档：/ });
      await archiveNode.focus();
      await expect(archiveNode).toBeFocused();
      await archiveNode.press('Enter');
      await expect(window.getByRole('tab', { name: '就绪' })).toHaveAttribute(
        'data-state',
        'active',
      );
      await expect(window.getByRole('region', { name: '归档门槛' })).toBeVisible();
      await expect(window.getByRole('tab', { name: '保障' })).toHaveCount(0);
      await expect(window.getByRole('region', { name: '六维规格保障状态' })).toHaveCount(0);
      await window.screenshot({ path: join(verificationRoot, 'electron-minimum.png') });
      const minimumPixels = await app.evaluate(async ({ BrowserWindow }) => {
        const target = BrowserWindow.getAllWindows()[0];
        if (!target) return { width: 0, height: 0, nonWhite: 0 };
        const image = await target.webContents.capturePage();
        const bitmap = image.toBitmap();
        let nonWhite = 0;
        for (let offset = 0; offset + 3 < bitmap.length; offset += 4) {
          if (bitmap[offset]! < 245 || bitmap[offset + 1]! < 245 || bitmap[offset + 2]! < 245)
            nonWhite += 1;
        }
        return { ...image.getSize(), nonWhite };
      });
      expect(minimumPixels.width).toBeGreaterThan(800);
      expect(minimumPixels.height).toBeGreaterThan(550);
      expect(minimumPixels.nonWhite).toBeGreaterThan(3_000);
    } finally {
      await app?.close();
      await fs.rm(projectRoot, { recursive: true, force: true });
      await fs.rm(userDataPath, { recursive: true, force: true });
    }
  });

  test('runs inline strict validation, reflects stale and project switching, and keeps projects read-only', async () => {
    test.setTimeout(120_000);
    const root = await fs.mkdtemp(join(tmpdir(), 'openspec-electron-inline-validation-'));
    const projectRoot = join(root, 'primary-project');
    const secondaryRoot = join(root, 'secondary-project');
    const userDataPath = join(root, 'user-data');
    const verificationRoot = resolve('output', 'playwright');
    const projectId = 'inline-primary';
    const secondaryProjectId = 'inline-secondary';
    const changeId = 'inline-demo';
    const secondaryChangeId = 'secondary-demo';
    const now = new Date().toISOString();
    const taskMarkdown = (completed: number, total: number): string => {
      const lines = ['# Tasks', ''];
      for (let index = 1; index <= total; index += 1) {
        lines.push(`- [${index <= completed ? 'x' : ' '}] Task ${index}`);
      }
      return `${lines.join('\n')}\n`;
    };
    const writeChange = async (
      project: string,
      id: string,
      completed: number,
      total: number,
    ): Promise<string> => {
      const changeRoot = join(project, 'openspec', 'changes', id);
      const specRoot = join(changeRoot, 'specs', 'demo');
      await fs.mkdir(specRoot, { recursive: true });
      await fs.writeFile(join(changeRoot, 'proposal.md'), `# ${id}\n`, 'utf8');
      await fs.writeFile(join(changeRoot, 'design.md'), '# Design\n', 'utf8');
      await fs.writeFile(join(changeRoot, '.openspec.yaml'), 'schema: spec-driven\n', 'utf8');
      await fs.writeFile(
        join(specRoot, 'spec.md'),
        '# Demo\n\n## ADDED Requirements\n\n### Requirement: Demo works\n\nThe system MUST provide a demo.\n\n#### Scenario: Demo succeeds\n\n- **WHEN** the demo runs\n- **THEN** the demo returns success\n',
        'utf8',
      );
      const tasksPath = join(changeRoot, 'tasks.md');
      await fs.writeFile(tasksPath, taskMarkdown(completed, total), 'utf8');
      return tasksPath;
    };
    const primaryTasksPath = await writeChange(projectRoot, changeId, 1, 1);
    const primarySpecPath = join(
      projectRoot,
      'openspec',
      'changes',
      changeId,
      'specs',
      'demo',
      'spec.md',
    );
    await writeChange(secondaryRoot, secondaryChangeId, 0, 1);
    const catalog = {
      schemaVersion: 2,
      groups: [],
      projects: [
        {
          id: projectId,
          rootPath: projectRoot,
          displayName: 'Primary project',
          versionLabel: 'v1',
          versionMode: 'manual',
          versionSource: 'manual',
          groupId: null,
          order: 0,
          watcherEnabled: true,
          watcherState: 'scanning',
          available: true,
          registeredAt: now,
        },
        {
          id: secondaryProjectId,
          rootPath: secondaryRoot,
          displayName: 'Secondary project',
          versionLabel: 'v1',
          versionMode: 'manual',
          versionSource: 'manual',
          groupId: null,
          order: 1,
          watcherEnabled: true,
          watcherState: 'scanning',
          available: true,
          registeredAt: now,
        },
      ],
      preferences: {
        selectedProjectId: projectId,
        selectedChangeId: changeId,
        showArchived: false,
        windowBounds: { width: 1440, height: 900 },
      },
    };
    await fs.mkdir(userDataPath, { recursive: true });
    await fs.writeFile(join(userDataPath, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
    await fs.mkdir(verificationRoot, { recursive: true });
    const primaryBefore = await hashProjectFiles(projectRoot);
    const secondaryBefore = await hashProjectFiles(secondaryRoot);
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      app = await electron.launch({
        executablePath: electronPath,
        args: launchArgs(userDataPath),
        env: {
          ...process.env,
          ELECTRON_RENDERER_URL: '',
          OPENSPEC_DESKTOP_USER_DATA: userDataPath,
        },
        timeout: electronLaunchTimeout,
      });
      const window = await app.firstWindow();
      const browserWindow = await app.browserWindow(window);
      await browserWindow.evaluate((currentWindow) => {
        if (currentWindow.isMinimized()) currentWindow.restore();
        if (currentWindow.isMaximized()) currentWindow.unmaximize();
        currentWindow.setSize(1440, 900);
        currentWindow.show();
      });
      await expect(window.getByRole('heading', { name: changeId })).toBeVisible({
        timeout: 20_000,
      });

      const firstRun = window.getByRole('button', { name: /运行严格验证/ });
      await expect(firstRun).toBeVisible();
      await firstRun.press('Enter');
      await window.getByRole('tab', { name: '就绪' }).click();
      const validationRegion = window.getByRole('region', { name: '严格验证' });
      await expect(validationRegion.getByText('验证通过', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(window.getByRole('button', { name: /运行严格验证|重新验证/ })).toHaveCount(0);
      expect(await hashProjectFiles(projectRoot)).toBe(primaryBefore);
      expect(await hashProjectFiles(secondaryRoot)).toBe(secondaryBefore);

      await window.getByRole('button', { name: /Secondary project/ }).click();
      await expect(window.getByRole('heading', { name: secondaryChangeId })).toBeVisible({
        timeout: 20_000,
      });
      await expect(window.getByRole('button', { name: /运行严格验证/ })).toBeVisible();
      await window.getByRole('button', { name: /Primary project/ }).click();
      await expect(window.getByRole('heading', { name: changeId })).toBeVisible({
        timeout: 20_000,
      });

      await fs.writeFile(primaryTasksPath, taskMarkdown(1, 2), 'utf8');
      await window.getByRole('button', { name: '重新扫描项目' }).click();
      const retry = window.getByRole('button', { name: /重新验证/ });
      await expect(retry).toBeVisible({ timeout: 30_000 });
      const staleHash = await hashProjectFiles(projectRoot);
      await retry.press('Enter');
      await expect(validationRegion.getByText('验证通过', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      const archiveRegion = window.getByRole('region', { name: '归档门槛' });
      await expect(archiveRegion.getByText('任务门槛')).toBeVisible();
      await expect(archiveRegion.getByText('未通过')).toBeVisible();
      await expect(window.getByRole('button', { name: /运行严格验证|重新验证/ })).toHaveCount(0);
      expect(await hashProjectFiles(projectRoot)).toBe(staleHash);
      expect(await hashProjectFiles(secondaryRoot)).toBe(secondaryBefore);

      await fs.writeFile(
        primarySpecPath,
        '# Demo\n\n## ADDED Requirements\n\n### Requirement: Broken\n',
        'utf8',
      );
      await window.getByRole('button', { name: '重新扫描项目' }).click();
      const failedRetry = window.getByRole('button', { name: /重新验证/ });
      await expect(failedRetry).toBeVisible({ timeout: 30_000 });
      const failedHash = await hashProjectFiles(projectRoot);
      await failedRetry.press('Enter');
      await expect(validationRegion.getByText('失败', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(validationRegion.getByText('2 条验证诊断')).toBeVisible();
      await expect(window.getByRole('button', { name: /重新验证/ })).toBeVisible();
      expect(await hashProjectFiles(projectRoot)).toBe(failedHash);

      await browserWindow.evaluate((currentWindow) => currentWindow.setSize(920, 640));
      await expect
        .poll(() => window.evaluate(() => globalThis.outerWidth))
        .toBeLessThanOrEqual(921);
      await expect(window.getByRole('button', { name: /重新验证/ })).toBeVisible();
      const dimensions = await window.evaluate(() => {
        const action = document.querySelector<HTMLElement>('.validation-action-block');
        const version = document.querySelector<HTMLElement>('.version-trigger');
        return {
          contentWidth: document.documentElement.scrollWidth,
          viewportWidth: globalThis.innerWidth,
          actionOverflow: action ? action.scrollWidth - action.clientWidth : 0,
          versionRight: version ? version.getBoundingClientRect().right : 0,
        };
      });
      expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      expect(dimensions.actionOverflow).toBeLessThanOrEqual(1);
      expect(dimensions.versionRight).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      await captureElectronScreenshot(
        app,
        join(verificationRoot, 'electron-inline-validation-minimum.png'),
      );
    } finally {
      await app?.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
