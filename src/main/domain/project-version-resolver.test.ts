import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VERSION_GIT_MAX_BUFFER,
  DEFAULT_VERSION_GIT_TIMEOUT_MS,
  resolveProjectVersion,
} from './project-version-resolver';

describe('resolveProjectVersion', () => {
  it('prefers a deterministic tag when HEAD has multiple exact tags', async () => {
    const calls: Array<{ rootPath: string; options: unknown }> = [];
    const result = await resolveProjectVersion('C:/Projects/space "quoted"', {
      runGit: async (rootPath, options) => {
        calls.push({ rootPath, options });
        return 'v1.10.0\nv1.9.0\nrelease-2\n';
      },
      readPackageJson: async () => JSON.stringify({ version: '9.9.9' }),
      now: () => '2026-08-10T00:00:00.000Z',
    });

    expect(result).toMatchObject({
      versionLabel: 'v1.10.0',
      versionMode: 'automatic',
      versionSource: 'git-tag',
      versionResolvedAt: '2026-08-10T00:00:00.000Z',
      diagnostic: 'git-tag',
    });
    expect(calls).toEqual([
      {
        rootPath: 'C:/Projects/space "quoted"',
        options: {
          timeoutMs: DEFAULT_VERSION_GIT_TIMEOUT_MS,
          maxBuffer: DEFAULT_VERSION_GIT_MAX_BUFFER,
        },
      },
    ]);
  });

  it('falls back to package.json when git is unavailable', async () => {
    const result = await resolveProjectVersion('C:/Projects/not-git', {
      runGit: async () => {
        throw Object.assign(new Error('git not found'), { code: 'ENOENT' });
      },
      readPackageJson: async () => JSON.stringify({ version: '  2.4.0  ' }),
      now: () => '2026-08-10T00:00:00.000Z',
    });

    expect(result.versionLabel).toBe('2.4.0');
    expect(result.versionSource).toBe('package-json');
    expect(result.diagnostic).toBe('package-json');
  });

  it('returns the workspace context after git timeout and invalid package data', async () => {
    let packageRead = false;
    const result = await resolveProjectVersion('C:/Projects/slow', {
      runGit: async () => {
        throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT', killed: true });
      },
      readPackageJson: async () => {
        packageRead = true;
        return JSON.stringify({ version: '   ' });
      },
      now: () => '2026-08-10T00:00:00.000Z',
    });

    expect(packageRead).toBe(true);
    expect(result).toMatchObject({
      versionLabel: '',
      versionMode: 'automatic',
      versionSource: 'workspace',
      diagnostic: 'package-invalid',
    });
  });

  it('does not fail on malformed or oversized package files', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'openspec-version-'));
    try {
      await fs.writeFile(join(root, 'package.json'), '{broken');
      const malformed = await resolveProjectVersion(root, {
        runGit: async () => {
          throw new Error('not a repository');
        },
      });
      expect(malformed.versionSource).toBe('workspace');

      await fs.writeFile(join(root, 'package.json'), 'x'.repeat(300 * 1024));
      const oversized = await resolveProjectVersion(root, {
        runGit: async () => {
          throw new Error('not a repository');
        },
      });
      expect(oversized.versionLabel).toBe('');
      expect(oversized.versionSource).toBe('workspace');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
