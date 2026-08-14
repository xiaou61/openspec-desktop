import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CodexProjectList } from '@shared/contracts';
import { AppController } from './app-controller';
import { CatalogService } from './catalog/catalog-service';
import { CatalogStore } from './catalog/catalog-store';
import type { WatcherManager } from './watcher/watcher-manager';

async function makeOpenSpecProject(parent: string, name: string): Promise<string> {
  const root = join(parent, name);
  await fs.mkdir(join(root, 'openspec', 'changes'), { recursive: true });
  await fs.writeFile(join(root, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  return root;
}

function watcherStub(): WatcherManager {
  return {
    startProject: vi.fn(),
    stopProject: vi.fn(),
    rescanProject: vi.fn(),
    updateProjectContext: vi.fn(),
    getHistory: vi.fn(),
    flush: vi.fn(),
  } as unknown as WatcherManager;
}

describe('AppController Codex import', () => {
  it('imports valid candidates, preserves partial failures, and prevents duplicates', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'app-controller-codex-'));
    try {
      const codexHome = join(root, '.codex');
      const userDataPath = join(root, 'user-data');
      const valid = await makeOpenSpecProject(root, 'valid');
      const validAlias = join(root, 'VALID~1');
      const originalRealpath = fs.realpath.bind(fs);
      const canonicalValid = await originalRealpath(valid);
      vi.spyOn(fs, 'realpath').mockImplementation(async (path) =>
        String(path) === validAlias ? canonicalValid : originalRealpath(path),
      );
      const missing = join(root, 'missing');
      await fs.mkdir(codexHome);
      await fs.writeFile(
        join(codexHome, '.codex-global-state.json'),
        JSON.stringify({
          'local-projects': {
            valid: { id: 'valid', name: '有效项目', rootPaths: [valid], updatedAt: Date.now() },
            missing: {
              id: 'missing',
              name: '缺失项目',
              rootPaths: [missing],
              updatedAt: Date.now(),
            },
          },
          'project-order': ['valid', 'missing'],
        }),
      );
      const catalog = new CatalogService(new CatalogStore(userDataPath), {
        resolveVersion: async () => ({
          versionLabel: '',
          versionMode: 'automatic',
          versionSource: 'workspace',
          versionResolvedAt: new Date().toISOString(),
        }),
      });
      const controller = new AppController({
        userDataPath,
        userHome: root,
        codexHome,
        catalog,
        watchers: watcherStub(),
      });
      await controller.initialize();

      const listed = await controller.listCodexProjects();
      expect(
        listed.entries.map((candidate) =>
          candidate.kind === 'direct-project' ? candidate.status : candidate.kind,
        ),
      ).toEqual(['available', 'unavailable']);
      const imported = await controller.importCodexProjects({
        projects: [
          { rootPath: validAlias, displayName: '由渲染进程提供的名称' },
          { rootPath: missing, displayName: '缺失项目' },
        ],
      });
      expect(imported.items.map((item) => item.status)).toEqual(['imported', 'failed']);
      expect(imported.items[0]?.displayName).toBe('有效项目');
      expect(imported.snapshot.catalog.projects).toHaveLength(1);
      expect(imported.snapshot.catalog.projects[0]).toMatchObject({
        versionLabel: '',
        versionMode: 'automatic',
        versionSource: 'workspace',
      });

      const duplicate = await controller.importCodexProjects({
        projects: [{ rootPath: validAlias, displayName: '有效项目' }],
      });
      expect(duplicate.items[0]?.status).toBe('already-added');
      expect(duplicate.snapshot.catalog.projects).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a path that is not present in the current Codex index', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'app-controller-whitelist-'));
    try {
      const codexHome = join(root, '.codex');
      const userDataPath = join(root, 'user-data');
      await fs.mkdir(codexHome);
      await fs.writeFile(
        join(codexHome, '.codex-global-state.json'),
        JSON.stringify({ 'local-projects': {} }),
      );
      const controller = new AppController({
        userDataPath,
        userHome: root,
        codexHome,
        catalog: new CatalogService(new CatalogStore(userDataPath)),
        watchers: watcherStub(),
      });
      await controller.initialize();
      const result = await controller.importCodexProjects({
        projects: [{ rootPath: join(root, 'outside'), displayName: 'Outside' }],
      });
      expect(result.items[0]).toMatchObject({
        status: 'failed',
        error: '该目录不在当前 Codex 项目索引中',
      });
      expect(result.snapshot.catalog.projects).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('imports a workspace leaf into a persistent source group without registering its parent', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'app-controller-workspace-'));
    try {
      const codexHome = join(root, '.codex');
      const userDataPath = join(root, 'user-data');
      const workspaceRoot = join(root, 'Demo');
      await fs.mkdir(workspaceRoot);
      const projectRoot = await makeOpenSpecProject(workspaceRoot, 'frontend');
      const [canonicalWorkspaceRoot, canonicalProjectRoot] = await Promise.all([
        fs.realpath(workspaceRoot),
        fs.realpath(projectRoot),
      ]);
      await fs.mkdir(join(workspaceRoot, 'backend', '.git'), { recursive: true });
      await fs.mkdir(codexHome);
      await fs.writeFile(
        join(codexHome, '.codex-global-state.json'),
        JSON.stringify({ 'electron-saved-workspace-roots': [workspaceRoot] }),
      );
      const catalog = new CatalogService(new CatalogStore(userDataPath));
      const controller = new AppController({
        userDataPath,
        userHome: root,
        codexHome,
        catalog,
        watchers: watcherStub(),
      });
      await controller.initialize();

      const discovered = await controller.listCodexProjects();
      const workspace = discovered.entries[0];
      if (!workspace || workspace.kind !== 'workspace') throw new Error('expected workspace');
      const member = workspace.members.find((entry) => entry.kind === 'openspec-project');
      if (!member) throw new Error('expected OpenSpec member');
      const result = await controller.importCodexProjects({
        projects: [
          {
            rootPath: member.rootPath,
            displayName: member.displayName,
            workspace: {
              id: workspace.id,
              rootPath: workspace.rootPath,
              displayName: workspace.displayName,
            },
          },
        ],
      });

      expect(result.items[0]).toMatchObject({
        status: 'imported',
        rootPath: canonicalProjectRoot,
        workspace: { id: workspace.id, rootPath: canonicalWorkspaceRoot },
      });
      expect(result.items[0]?.workspaceGroupId).toBeTruthy();
      expect(result.snapshot.catalog.projects.map((project) => project.rootPath)).toEqual([
        canonicalProjectRoot,
      ]);
      expect(result.snapshot.catalog.groups).toMatchObject([
        { kind: 'codex-workspace', sourceRootPath: canonicalWorkspaceRoot },
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects forged workspace ancestry and revalidates OpenSpec at confirmation time', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'app-controller-workspace-forged-'));
    try {
      const userDataPath = join(root, 'user-data');
      const workspaceRoot = join(root, 'workspace');
      const outsideRoot = await makeOpenSpecProject(root, 'outside');
      await fs.mkdir(workspaceRoot);
      const [canonicalWorkspaceRoot, canonicalOutsideRoot] = await Promise.all([
        fs.realpath(workspaceRoot),
        fs.realpath(outsideRoot),
      ]);
      const discovered: CodexProjectList = {
        entries: [
          {
            kind: 'workspace',
            id: 'workspace-1',
            displayName: 'Workspace',
            rootPath: canonicalWorkspaceRoot,
            source: 'saved-workspace',
            members: [
              {
                kind: 'openspec-project',
                id: 'outside-project',
                displayName: 'Outside',
                rootPath: canonicalOutsideRoot,
                status: 'available',
              },
            ],
            diagnostics: [],
            truncated: false,
            truncationReasons: [],
            repositoryCount: 1,
            openSpecProjectCount: 1,
            availableCount: 1,
          },
        ],
        summary: {
          source: 'primary',
          indexedRootCount: 1,
          workspaceCount: 1,
          repositoryCount: 1,
          openSpecProjectCount: 1,
          availableCount: 1,
          truncated: false,
          truncationReasons: [],
        },
        scannedAt: new Date().toISOString(),
      };
      const catalog = new CatalogService(new CatalogStore(userDataPath));
      const controller = new AppController({
        userDataPath,
        catalog,
        watchers: watcherStub(),
        codexDiscovery: vi.fn().mockResolvedValue(discovered),
      });
      await controller.initialize();
      const workspace = {
        id: 'workspace-1',
        rootPath: workspaceRoot,
        displayName: 'Workspace',
      };

      const escaped = await controller.importCodexProjects({
        projects: [{ rootPath: outsideRoot, displayName: 'Outside', workspace }],
      });
      expect(escaped.items[0]).toMatchObject({
        status: 'failed',
        error: '子项目不在声明的工作区内',
      });
      expect(escaped.snapshot.catalog.groups).toEqual([]);

      const insideRoot = await makeOpenSpecProject(workspaceRoot, 'inside');
      const canonicalInsideRoot = await fs.realpath(insideRoot);
      discovered.entries[0] = {
        kind: 'workspace',
        id: 'workspace-1',
        displayName: 'Workspace',
        rootPath: canonicalWorkspaceRoot,
        source: 'saved-workspace',
        members: [
          {
            kind: 'openspec-project',
            id: 'inside-project',
            displayName: 'Inside',
            rootPath: canonicalInsideRoot,
            status: 'available',
          },
        ],
        diagnostics: [],
        truncated: false,
        truncationReasons: [],
        repositoryCount: 1,
        openSpecProjectCount: 1,
        availableCount: 1,
      };
      await fs.rm(join(insideRoot, 'openspec'), { recursive: true, force: true });
      const stale = await controller.importCodexProjects({
        projects: [{ rootPath: insideRoot, displayName: 'Inside', workspace }],
      });
      expect(stale.items[0]).toMatchObject({ status: 'failed' });
      expect(stale.items[0]?.error).toContain('openspec');
      expect(stale.snapshot.catalog.projects).toEqual([]);
      expect(stale.snapshot.catalog.groups).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('AppController version lifecycle', () => {
  it('propagates changed automatic versions, suppresses unchanged refresh noise, and preserves manual mode', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'app-controller-version-'));
    try {
      const userDataPath = join(root, 'user-data');
      const projectRoot = await makeOpenSpecProject(root, 'project');
      let resolvedLabel = 'v1.0.0';
      const catalog = new CatalogService(new CatalogStore(userDataPath), {
        resolveVersion: async () => ({
          versionLabel: resolvedLabel,
          versionMode: 'automatic',
          versionSource: 'git-tag',
          versionResolvedAt: new Date().toISOString(),
        }),
      });
      const watchers = watcherStub();
      const controller = new AppController({ userDataPath, catalog, watchers });
      await controller.initialize();
      await controller.registerProject({ rootPath: projectRoot, versionMode: 'automatic' });
      const projectId = controller.getAppSnapshot().catalog.projects[0]!.id;
      expect(controller.getAppSnapshot().catalog.projects[0]).toMatchObject({
        versionLabel: 'v1.0.0',
        versionMode: 'automatic',
        versionSource: 'git-tag',
      });

      resolvedLabel = 'v1.1.0';
      await controller.refreshVersion({ projectId });
      await controller.refreshVersion({ projectId });
      const afterRefresh = await controller.listActivity({ projectId, limit: 50 });
      expect(afterRefresh.items).toHaveLength(1);
      expect(afterRefresh.items[0]).toMatchObject({
        kind: 'project-settings',
        projectVersion: 'v1.1.0',
      });
      expect(watchers.updateProjectContext).toHaveBeenCalledWith(
        expect.objectContaining({ versionLabel: 'v1.1.0' }),
      );

      await controller.updateProject({
        projectId,
        versionMode: 'manual',
        versionLabel: 'v2.0.0',
      });
      resolvedLabel = 'v3.0.0';
      await controller.rescanProject(projectId);
      expect(controller.getAppSnapshot().catalog.projects[0]).toMatchObject({
        versionLabel: 'v2.0.0',
        versionMode: 'manual',
        versionSource: 'manual',
      });
      const afterManual = await controller.listActivity({ projectId, limit: 50 });
      expect(afterManual.items).toHaveLength(2);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
