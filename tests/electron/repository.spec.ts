import { _electron as electron, expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const packagedExecutable = process.env['OPENSPEC_DESKTOP_E2E_EXECUTABLE'];
const electronPath = resolve(packagedExecutable ?? 'node_modules/electron/dist/electron.exe');

function launchArgs(userDataPath: string): string[] {
  return [
    `--user-data-dir=${userDataPath}`,
    ...(packagedExecutable ? [] : [resolve('out/main/index.js')]),
  ];
}

test.describe('packaged Electron repository monitor', () => {
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
      await expect(window.getByRole('button', { name: /AI开发管理平台/ })).toBeVisible({
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
        window.getByLabel('Change 详情', { exact: true }).getByText('已完成', { exact: true }),
      ).toBeVisible();
    } finally {
      await app?.close();
      await fs.rm(changeRoot, { recursive: true, force: true });
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
    const catalog = {
      schemaVersion: 1,
      groups: [],
      projects: [
        {
          id: 'visual-project',
          rootPath: projectRoot,
          displayName: 'OpenSpec desktop visual verification project with a long name',
          versionLabel: '2026.08-visual-verification',
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
      await expect(window.getByText('实时监控', { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(window.getByText('解析异常', { exact: true }).first()).toBeVisible();
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
          window
            .locator('.catalog-layer')
            .evaluate((element) => Math.round(element.getBoundingClientRect().right)),
        )
        .toBeLessThanOrEqual(0);
      const dimensions = await window.evaluate(() => ({
        contentWidth: document.documentElement.scrollWidth,
        viewportWidth: globalThis.innerWidth,
      }));
      expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
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
});
