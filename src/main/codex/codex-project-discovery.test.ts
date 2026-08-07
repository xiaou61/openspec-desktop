import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
        candidateCount: 4,
        availableCount: 2,
        truncated: false,
      });
      expect(result.candidates.map((candidate) => candidate.displayName)).toEqual([
        'Beta',
        'Alpha',
        'Alpha',
        'extra',
      ]);
      expect(result.candidates.map((candidate) => candidate.status)).toEqual([
        'already-added',
        'available',
        'invalid-openspec',
        'available',
      ]);
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
      expect(result.candidates).toHaveLength(1);
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
      expect(result.candidates).toEqual([]);
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
        candidateCount: 1,
        availableCount: 1,
        truncated: true,
      });
    } finally {
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
