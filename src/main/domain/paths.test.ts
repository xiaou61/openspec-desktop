import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyOpenSpecPath,
  discoverOpenSpecFiles,
  isPathWithin,
  resolveRegisteredArtifactPath,
} from './paths';

describe('OpenSpec path boundaries', () => {
  it('classifies supported active, archive, metadata, and top-level spec paths', () => {
    expect(classifyOpenSpecPath('config.yaml')?.type).toBe('config');
    expect(classifyOpenSpecPath('specs/core.md')?.type).toBe('spec');
    expect(classifyOpenSpecPath('changes/add-view/proposal.md')).toMatchObject({
      changeId: 'add-view',
      archived: false,
      type: 'proposal',
    });
    expect(classifyOpenSpecPath('changes/archive/2026-08-01-add-view/tasks.md')).toMatchObject({
      changeId: '2026-08-01-add-view',
      archived: true,
      type: 'tasks',
    });
    expect(classifyOpenSpecPath('changes/add-view/.openspec.yaml')?.type).toBe('metadata');
    expect(classifyOpenSpecPath('changes/add-view/node_modules/x.md')).toBeNull();
  });

  it('rejects traversal, temporary files, and unsupported extensions', () => {
    expect(classifyOpenSpecPath('../secrets.md')).toBeNull();
    expect(classifyOpenSpecPath('changes/demo/tasks.md.tmp')).toBeNull();
    expect(classifyOpenSpecPath('changes/demo/~$tasks.md')).toBeNull();
    expect(classifyOpenSpecPath('changes/demo/notes.txt')).toBeNull();
  });

  it('keeps registered artifact resolution inside openspec', () => {
    const root = 'C:\\Projects\\demo';
    expect(resolveRegisteredArtifactPath(root, 'openspec/changes/demo/tasks.md')).toBe(
      'C:\\Projects\\demo\\openspec\\changes\\demo\\tasks.md',
    );
    expect(() => resolveRegisteredArtifactPath(root, 'openspec/../../outside.md')).toThrow();
    expect(isPathWithin(root, join(root, 'openspec', 'changes'))).toBe(true);
    expect(isPathWithin(root, 'C:\\Projects\\outside')).toBe(false);
  });

  it('skips symlinks and editor temporary files during discovery', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'openspec-paths-'));
    try {
      await fs.mkdir(join(root, 'openspec', 'changes', 'demo'), { recursive: true });
      await fs.writeFile(join(root, 'openspec', 'changes', 'demo', 'tasks.md'), '# Tasks');
      await fs.writeFile(join(root, 'openspec', 'changes', 'demo', '.tasks.md.swp'), 'temp');
      try {
        await fs.symlink(
          join(root, 'openspec', 'changes', 'demo', 'tasks.md'),
          join(root, 'openspec', 'changes', 'demo', 'link.md'),
        );
      } catch {
        // Symlink creation can be disabled on Windows CI; the rest of the assertion remains valid.
      }
      const files = await discoverOpenSpecFiles(root);
      expect(files.map((file) => file.relativePath)).toEqual(['changes/demo/tasks.md']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
