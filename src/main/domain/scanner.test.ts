import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanOpenSpecProject } from './scanner';

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'openspec-scan-'));
  await fs.mkdir(join(root, 'openspec', 'changes', 'add-monitor', 'specs'), { recursive: true });
  await fs.mkdir(join(root, 'openspec', 'changes', 'archive', '2026-08-01-old-change'), {
    recursive: true,
  });
  await fs.mkdir(join(root, 'openspec', 'specs'), { recursive: true });
  await fs.writeFile(join(root, 'openspec', 'config.yaml'), 'schema: spec-driven\nversion: "1"\n');
  await fs.writeFile(join(root, 'openspec', 'specs', 'workspace.md'), '# Workspace\n');
  await fs.writeFile(
    join(root, 'openspec', 'changes', 'add-monitor', 'proposal.md'),
    '# Add monitor\n',
  );
  await fs.writeFile(
    join(root, 'openspec', 'changes', 'add-monitor', 'specs', 'monitor.md'),
    '# Monitor\n',
  );
  await fs.writeFile(join(root, 'openspec', 'changes', 'add-monitor', 'design.md'), '# Design\n');
  await fs.writeFile(
    join(root, 'openspec', 'changes', 'add-monitor', 'tasks.md'),
    '# Tasks\n\n- [x] Scan\n- [ ] Watch\n',
  );
  await fs.writeFile(
    join(root, 'openspec', 'changes', 'add-monitor', '.openspec.yaml'),
    'schema: spec-driven\nstatus: implementing\n',
  );
  await fs.writeFile(
    join(root, 'openspec', 'changes', 'archive', '2026-08-01-old-change', 'proposal.md'),
    '# Old\n',
  );
  return root;
}

describe('scanOpenSpecProject', () => {
  it('scans deterministically and separates active, archived, and top-level specs', async () => {
    const root = await createFixture();
    try {
      const result = await scanOpenSpecProject(root);
      expect(result.available).toBe(true);
      expect(result.specs).toHaveLength(1);
      expect(result.changes.map((change) => [change.id, change.archived])).toEqual([
        ['add-monitor', false],
        ['2026-08-01-old-change', true],
      ]);
      expect(result.changes[0]?.taskTotals).toEqual({ completed: 1, total: 2 });
      expect(result.changes[0]?.readiness).toBe('ready');
      expect(result.changes[0]?.stage).toBe('implementing');
      expect(result.files.every((file) => file.rawContent !== undefined)).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('reports unavailable projects without touching their directories', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'openspec-missing-'));
    try {
      const result = await scanOpenSpecProject(root);
      expect(result.available).toBe(false);
      expect(result.issues[0]?.kind).toBe('unavailable');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps raw content and reports an oversize artifact', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'openspec-large-'));
    try {
      await fs.mkdir(join(root, 'openspec', 'changes', 'demo'), { recursive: true });
      await fs.writeFile(join(root, 'openspec', 'changes', 'demo', 'tasks.md'), '#'.repeat(20));
      const result = await scanOpenSpecProject(root, { maxFileBytes: 4 });
      const artifact = result.changes[0]?.artifacts[0];
      expect(artifact?.parseHealth).toBe('unreadable');
      expect(result.issues[0]?.kind).toBe('oversize');
      expect(artifact?.rawContent).toBeUndefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
