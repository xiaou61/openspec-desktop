import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  codexProjectPathKey,
  discoverCodexProjects,
  normalizeCodexProjectPath,
  resolveCodexHome,
} from './codex-project-discovery';

async function makeOpenSpecProject(parent: string, name: string): Promise<string> {
  const root = join(parent, name);
  await fs.mkdir(join(root, 'openspec', 'changes'), { recursive: true });
  await fs.writeFile(join(root, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  return root;
}

async function makeRepository(parent: string, name: string, marker = '.git'): Promise<string> {
  const root = join(parent, name);
  await fs.mkdir(root, { recursive: true });
  if (marker === '.git') await fs.mkdir(join(root, marker));
  else await fs.writeFile(join(root, marker), '{}');
  return root;
}

async function writeCodexState(codexHome: string, roots: string[]): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(
    join(codexHome, '.codex-global-state.json'),
    JSON.stringify({ 'electron-saved-workspace-roots': roots }),
  );
}

describe('Codex project discovery', () => {
  it('uses CODEX_HOME when provided and otherwise resolves the user .codex directory', () => {
    expect(resolveCodexHome('C:\\Users\\person', 'D:\\portable-codex')).toBe('D:\\portable-codex');
    expect(resolveCodexHome('C:\\Users\\person')).toBe('C:\\Users\\person\\.codex');
  });

  it('orders multi-root projects, supplements saved roots, de-duplicates paths, and isolates unrelated fields', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'codex-projects-'));
    try {
      const codexHome = join(root, '.codex');
      const alpha = await makeOpenSpecProject(root, 'alpha');
      const beta = await makeOpenSpecProject(root, 'beta');
      const extra = await makeOpenSpecProject(root, 'extra');
      const invalid = join(root, 'plain-folder');
      await fs.mkdir(invalid);
      await fs.mkdir(codexHome);
      const state = {
        'local-projects': {
          opaque_key: {
            id: 'opaque_key',
            name: 'Alpha',
            rootPaths: [alpha, invalid],
            updatedAt: 1_785_888_000_000,
          },
          'project-two': {
            id: 'project-two',
            name: 'Beta',
            rootPaths: [beta],
            updatedAt: 1_785_974_400_000,
          },
        },
        'project-order': ['project-two', 'opaque_key'],
        'electron-saved-workspace-roots': [alpha, extra],
        'electron-persisted-atom-state': { 'prompt-history': ['private fixture value'] },
      };
      await fs.writeFile(join(codexHome, '.codex-global-state.json'), JSON.stringify(state));

      const result = await discoverCodexProjects({
        userHome: root,
        codexHome,
        registeredRoots: [beta],
        readRetries: 0,
      });

      expect(result.summary).toMatchObject({
        source: 'primary',
        indexedRootCount: 5,
        workspaceCount: 0,
        repositoryCount: 3,
        openSpecProjectCount: 3,
        availableCount: 2,
        truncated: false,
      });
      expect(result.entries.map((candidate) => candidate.displayName)).toEqual([
        'Beta',
        'Alpha',
        'Alpha',
        'extra',
      ]);
      expect(
        result.entries.map((candidate) =>
          candidate.kind === 'direct-project' ? candidate.status : null,
        ),
      ).toEqual(['already-added', 'available', 'unrecognized', 'available']);
      expect(JSON.stringify(result)).not.toContain('private fixture value');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to the read-only backup after malformed primary state', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'codex-backup-'));
    try {
      const codexHome = join(root, '.codex');
      const project = await makeOpenSpecProject(root, 'backup-project');
      await fs.mkdir(codexHome);
      await fs.writeFile(join(codexHome, '.codex-global-state.json'), '{broken');
      await fs.writeFile(
        join(codexHome, '.codex-global-state.json.bak'),
        JSON.stringify({
          'local-projects': { custom: { id: 'custom', name: 'Backup', rootPaths: [project] } },
          'project-order': ['custom'],
        }),
      );

      const result = await discoverCodexProjects({ userHome: root, codexHome, readRetries: 0 });
      expect(result.summary.source).toBe('backup');
      expect(result.summary.message).toContain('只读备份');
      expect(result.entries).toHaveLength(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('ignores temporary files and reports unavailable when no canonical index exists', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'codex-temporary-'));
    try {
      const codexHome = join(root, '.codex');
      await fs.mkdir(codexHome);
      await fs.writeFile(
        join(codexHome, '..codex-global-state.json.tmp-fixture'),
        JSON.stringify({
          'electron-saved-workspace-roots': [root],
        }),
      );
      const result = await discoverCodexProjects({ userHome: root, codexHome, readRetries: 0 });
      expect(result.summary.source).toBe('unavailable');
      expect(result.entries).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes Windows extended paths and truncates an oversized candidate collection', async () => {
    expect(normalizeCodexProjectPath('\\\\?\\C:\\Work\\Demo\\', 'win32')).toBe('C:\\Work\\Demo');
    expect(codexProjectPathKey('C:\\WORK\\demo', 'win32')).toBe(
      codexProjectPathKey('\\\\?\\c:\\work\\DEMO\\', 'win32'),
    );

    const root = await fs.mkdtemp(join(tmpdir(), 'codex-limit-'));
    try {
      const codexHome = join(root, '.codex');
      const first = await makeOpenSpecProject(root, 'first');
      const second = await makeOpenSpecProject(root, 'second');
      await fs.mkdir(codexHome);
      await fs.writeFile(
        join(codexHome, '.codex-global-state.json'),
        JSON.stringify({
          'electron-saved-workspace-roots': [first, second],
        }),
      );
      const result = await discoverCodexProjects({
        userHome: root,
        codexHome,
        maxCandidates: 1,
        readRetries: 0,
      });
      expect(result.summary).toMatchObject({
        indexedRootCount: 2,
        availableCount: 1,
        truncated: true,
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('discovers demo repositories as a bounded workspace with accurate counts', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'codex-workspace-'));
    try {
      const workspace = join(root, 'Demo');
      await fs.mkdir(workspace);
      const frontend = await makeOpenSpecProject(workspace, 'demo-web');
      await makeRepository(workspace, 'demo-api');
      await makeRepository(workspace, 'demo-docs', 'package.json');
      await fs.mkdir(join(workspace, 'notes'));
      const canonicalFrontend = await fs.realpath(frontend);
      const codexHome = join(root, '.codex');
      await writeCodexState(codexHome, [workspace]);

      const result = await discoverCodexProjects({ userHome: root, codexHome, readRetries: 0 });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        kind: 'workspace',
        displayName: 'Demo',
        repositoryCount: 3,
        openSpecProjectCount: 1,
        availableCount: 1,
        truncated: false,
      });
      const entry = result.entries[0];
      if (!entry || entry.kind !== 'workspace') throw new Error('expected workspace');
      expect(entry.members.map((member) => member.kind)).toEqual([
        'repository',
        'repository',
        'openspec-project',
      ]);
      expect(entry.members.find((member) => member.rootPath === canonicalFrontend)?.status).toBe(
        'available',
      );
      expect(result.summary).toMatchObject({
        indexedRootCount: 1,
        workspaceCount: 1,
        repositoryCount: 3,
        openSpecProjectCount: 1,
        availableCount: 1,
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('short-circuits direct OpenSpec roots and does not scan their descendants', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'codex-direct-short-circuit-'));
    try {
      const direct = await makeOpenSpecProject(root, 'direct');
      await makeOpenSpecProject(direct, 'nested');
      const canonicalDirect = await fs.realpath(direct);
      const codexHome = join(root, '.codex');
      await writeCodexState(codexHome, [direct]);

      const result = await discoverCodexProjects({ userHome: root, codexHome, readRetries: 0 });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        kind: 'direct-project',
        rootPath: canonicalDirect,
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('finds two-level projects while skipping excluded output and dependency directories', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'codex-workspace-depth-'));
    try {
      const workspace = join(root, 'workspace');
      await fs.mkdir(join(workspace, 'containers', 'nested'), { recursive: true });
      const nested = await makeOpenSpecProject(join(workspace, 'containers'), 'nested-project');
      const excluded = await makeOpenSpecProject(join(workspace, 'node_modules'), 'hidden');
      await makeOpenSpecProject(workspace, 'node_modules');
      const [canonicalNested, canonicalExcluded] = await Promise.all([
        fs.realpath(nested),
        fs.realpath(excluded),
      ]);
      const codexHome = join(root, '.codex');
      await writeCodexState(codexHome, [workspace]);

      const result = await discoverCodexProjects({ userHome: root, codexHome, readRetries: 0 });
      const entry = result.entries[0];
      if (!entry || entry.kind !== 'workspace') throw new Error('expected workspace');
      expect(entry.members.map((member) => member.rootPath)).toContain(canonicalNested);
      expect(entry.members.map((member) => member.rootPath)).not.toContain(canonicalExcluded);
      expect(entry.members).toHaveLength(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('reports not-configured repositories and truncation without treating ordinary folders as projects', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'codex-workspace-budget-'));
    try {
      const workspace = join(root, 'workspace');
      await fs.mkdir(workspace);
      await makeRepository(workspace, 'repo');
      await fs.mkdir(join(workspace, 'container', 'deep'), { recursive: true });
      const deep = await makeOpenSpecProject(join(workspace, 'container'), 'deep-project');
      const codexHome = join(root, '.codex');
      await writeCodexState(codexHome, [workspace]);

      const result = await discoverCodexProjects({
        userHome: root,
        codexHome,
        maxDepth: 1,
        maxDirectories: 3,
        readRetries: 0,
      });
      const entry = result.entries[0];
      if (!entry || entry.kind !== 'workspace') throw new Error('expected workspace');
      expect(entry.members).toHaveLength(1);
      const member = entry.members[0];
      if (!member) throw new Error('expected repository member');
      expect(member).toMatchObject({ kind: 'repository', status: 'not-configured' });
      expect(entry.members.map((member) => member.rootPath)).not.toContain(deep);
      expect(entry.truncated).toBe(true);
      expect(entry.truncationReasons.length).toBeGreaterThan(0);
      expect(result.summary.truncated).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('deduplicates direct and overlapping workspace sources using the nearest ancestor', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'codex-workspace-overlap-'));
    try {
      const outer = join(root, 'outer');
      const inner = join(outer, 'inner');
      await fs.mkdir(inner, { recursive: true });
      const project = await makeOpenSpecProject(inner, 'project');
      const [canonicalInner, canonicalProject] = await Promise.all([
        fs.realpath(inner),
        fs.realpath(project),
      ]);
      const codexHome = join(root, '.codex');
      await writeCodexState(codexHome, [project, outer, inner]);

      const result = await discoverCodexProjects({ userHome: root, codexHome, readRetries: 0 });
      const directProjects = result.entries.filter((entry) => entry.kind === 'direct-project');
      expect(directProjects).toHaveLength(0);
      const workspaces = result.entries.filter((entry) => entry.kind === 'workspace');
      expect(workspaces).toHaveLength(1);
      const workspace = workspaces[0];
      if (!workspace || workspace.kind !== 'workspace') throw new Error('expected workspace');
      expect(workspace).toMatchObject({ rootPath: canonicalInner });
      expect(workspace.members.map((member) => member.rootPath)).toEqual([canonicalProject]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('returns an unavailable direct entry for a missing indexed root', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'codex-unavailable-root-'));
    try {
      const missing = join(root, 'missing');
      const codexHome = join(root, '.codex');
      await writeCodexState(codexHome, [missing]);
      const result = await discoverCodexProjects({ userHome: root, codexHome, readRetries: 0 });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        kind: 'direct-project',
        status: 'unavailable',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('marks registered workspace members as added and keeps same-named workspaces distinct', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'codex-workspace-identity-'));
    try {
      const firstWorkspace = join(root, 'first', 'workspace');
      const secondWorkspace = join(root, 'second', 'workspace');
      await fs.mkdir(firstWorkspace, { recursive: true });
      await fs.mkdir(secondWorkspace, { recursive: true });
      const firstProject = await makeOpenSpecProject(firstWorkspace, 'project');
      await makeOpenSpecProject(secondWorkspace, 'project');
      const firstProjectAlias = join(root, 'FIRST~1', 'project');
      const originalRealpath = fs.realpath.bind(fs);
      const canonicalFirstProject = await originalRealpath(firstProject);
      vi.spyOn(fs, 'realpath').mockImplementation(async (path) => {
        if (codexProjectPathKey(String(path)) === codexProjectPathKey(firstProjectAlias)) {
          return canonicalFirstProject;
        }
        return originalRealpath(path);
      });
      const codexHome = join(root, '.codex');
      await writeCodexState(codexHome, [firstWorkspace, secondWorkspace]);

      const result = await discoverCodexProjects({
        userHome: root,
        codexHome,
        registeredRoots: [firstProjectAlias],
        readRetries: 0,
      });
      const workspaces = result.entries.filter((entry) => entry.kind === 'workspace');
      expect(workspaces).toHaveLength(2);
      expect(new Set(workspaces.map((workspace) => workspace.id)).size).toBe(2);
      expect(workspaces.map((workspace) => workspace.displayName)).toEqual([
        'workspace',
        'workspace',
      ]);
      expect(workspaces[0]?.members[0]).toMatchObject({ status: 'already-added' });
      expect(result.summary.availableCount).toBe(1);
    } finally {
      vi.restoreAllMocks();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('skips directory links and isolates a member that disappears during scanning', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'codex-workspace-local-error-'));
    const originalLstat = fs.lstat.bind(fs);
    try {
      const workspace = join(root, 'workspace');
      await fs.mkdir(workspace);
      const healthy = await makeOpenSpecProject(workspace, 'healthy');
      const vanishing = await makeRepository(workspace, 'vanishing');
      const outside = await makeOpenSpecProject(root, 'outside');
      const [canonicalHealthy, canonicalVanishing, canonicalOutside] = await Promise.all([
        fs.realpath(healthy),
        fs.realpath(vanishing),
        fs.realpath(outside),
      ]);
      const linked = join(workspace, 'linked');
      try {
        await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
      } catch {
        // Some Windows policies disable symlink creation; the disappearing-member assertion remains valid.
      }
      let removed = false;
      vi.spyOn(fs, 'lstat').mockImplementation(async (path) => {
        if (
          !removed &&
          codexProjectPathKey(String(path)) === codexProjectPathKey(canonicalVanishing)
        ) {
          removed = true;
          await fs.rm(canonicalVanishing, { recursive: true, force: true });
        }
        return originalLstat(path);
      });
      const codexHome = join(root, '.codex');
      await writeCodexState(codexHome, [workspace]);

      const result = await discoverCodexProjects({ userHome: root, codexHome, readRetries: 0 });
      const entry = result.entries[0];
      if (!entry || entry.kind !== 'workspace') throw new Error('expected workspace');
      expect(entry.members.map((member) => member.rootPath)).toEqual([canonicalHealthy]);
      expect(entry.members.map((member) => member.rootPath)).not.toContain(canonicalOutside);
      expect(entry.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'disappeared', path: canonicalVanishing }),
        ]),
      );
    } finally {
      vi.restoreAllMocks();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects state files beyond the configured safety limit without leaking their contents', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'codex-oversize-'));
    try {
      const codexHome = join(root, '.codex');
      await fs.mkdir(codexHome);
      await fs.writeFile(
        join(codexHome, '.codex-global-state.json'),
        JSON.stringify({
          'local-projects': {},
          padding: 'sensitive-value'.repeat(20),
        }),
      );
      const result = await discoverCodexProjects({
        userHome: root,
        codexHome,
        maxStateBytes: 32,
        readRetries: 0,
      });
      expect(result.summary.source).toBe('unavailable');
      expect(result.summary.message).toContain('安全读取上限');
      expect(JSON.stringify(result)).not.toContain('sensitive-value');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
