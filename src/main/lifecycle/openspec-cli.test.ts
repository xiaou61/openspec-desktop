import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeProjection } from '@shared/contracts';
import {
  RestrictedOpenSpecCli,
  createStructuralArtifactGraph,
  executeBoundedProcess,
  normalizeOpenSpecContext,
  normalizeOpenSpecDoctor,
  normalizeOpenSpecInstructions,
  normalizeValidationOutput,
  parseOpenSpecStatus,
  resolveOpenSpecInvocation,
} from './openspec-cli';

describe('OpenSpec CLI adapter', () => {
  it.skipIf(process.platform !== 'win32')(
    'resolves an npm shim with node.exe from another PATH directory',
    async () => {
      const root = await fs.mkdtemp(join(tmpdir(), 'openspec-cli-resolution-'));
      const shimDirectory = join(root, 'npm');
      const nodeDirectory = join(root, 'node');
      const script = join(
        shimDirectory,
        'node_modules',
        '@fission-ai',
        'openspec',
        'bin',
        'openspec.js',
      );
      const previousPath = process.env['PATH'];
      try {
        await fs.mkdir(join(script, '..'), { recursive: true });
        await fs.mkdir(nodeDirectory, { recursive: true });
        await Promise.all([
          fs.writeFile(join(shimDirectory, 'openspec.cmd'), '@echo off\n'),
          fs.writeFile(script, 'export {};\n'),
          fs.writeFile(join(nodeDirectory, 'node.exe'), ''),
        ]);
        process.env['PATH'] = [shimDirectory, nodeDirectory].join(delimiter);

        await expect(resolveOpenSpecInvocation()).resolves.toEqual({
          command: join(nodeDirectory, 'node.exe'),
          prefixArgs: [script],
        });
      } finally {
        if (previousPath === undefined) delete process.env['PATH'];
        else process.env['PATH'] = previousPath;
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it('parses authoritative status output with custom dependencies and skipped artifacts', () => {
    const graph = parseOpenSpecStatus(
      JSON.stringify({
        schemaName: 'custom-schema',
        applyRequires: ['deploy'],
        artifacts: [
          { id: 'proposal', status: 'done', requires: [] },
          { id: 'review', status: 'skipped', requires: ['proposal'] },
          { id: 'deploy', status: 'blocked', requires: ['review'] },
        ],
      }),
    );

    expect(graph).toEqual({
      schemaName: 'custom-schema',
      source: 'openspec-cli',
      authoritative: true,
      applyRequires: ['proposal', 'review', 'deploy'],
      artifacts: [
        { id: 'proposal', status: 'done', requires: [] },
        { id: 'review', status: 'skipped', requires: ['proposal'] },
        { id: 'deploy', status: 'blocked', requires: ['review'] },
      ],
    });
  });

  it('creates a conservative structural graph without claiming authority', () => {
    const change = {
      id: 'change-a',
      name: 'change-a',
      archived: false,
      stage: 'implementing',
      readiness: 'incomplete',
      artifacts: [
        {
          type: 'proposal',
          relativePath: 'changes/change-a/proposal.md',
          sourcePath: 'openspec/changes/change-a/proposal.md',
          title: 'Proposal',
          headings: [],
          tasks: [],
          taskTotals: { completed: 0, total: 0 },
          parseHealth: 'ok',
          changeId: 'change-a',
          archived: false,
        },
      ],
      missingArtifacts: ['spec', 'design', 'tasks'],
      taskTotals: { completed: 0, total: 0 },
      parseHealth: 'ok',
      validation: { source: 'structural', status: 'not-run' },
    } satisfies ChangeProjection;

    const graph = createStructuralArtifactGraph(change);

    expect(graph.source).toBe('structural');
    expect(graph.authoritative).toBe(false);
    expect(graph.artifacts.find((artifact) => artifact.id === 'proposal')?.status).toBe('done');
    expect(graph.artifacts.find((artifact) => artifact.id === 'specs')?.status).toBe('pending');
  });

  it('normalizes and sanitizes validation diagnostics', () => {
    const result = normalizeValidationOutput(
      JSON.stringify({
        items: [
          {
            id: 'change-a',
            valid: false,
            issues: [
              {
                level: 'ERROR',
                path: 'openspec/changes/change-a/specs/demo/spec.md',
                line: 12,
                message: ' C:\\workspace\\secret\nRequirement is invalid\u0000 ',
              },
              { level: 'warning', path: '../../secret', message: 'unsafe path is ignored' },
            ],
          },
        ],
        version: '1.0',
      }),
      {
        changeId: 'change-a',
        checkedAt: '2026-08-10T08:00:00.000Z',
        fingerprint: 'a'.repeat(64),
        projectRoot: 'C:/workspace',
        allowedPaths: ['openspec/changes/change-a/specs/demo/spec.md'],
      },
    );

    expect(result.status).toBe('failed');
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      relativePath: 'openspec/changes/change-a/specs/demo/spec.md',
      line: 12,
    });
    expect(result.diagnostics[0]?.message).toBe('<project>\\secret Requirement is invalid');
    expect(result.diagnostics[1]).not.toHaveProperty('relativePath');
  });

  it('enforces timeout and combined output limits without a shell', async () => {
    const timedOut = await executeBoundedProcess({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
      cwd: process.cwd(),
      timeoutMs: 20,
      maxOutputBytes: 1024,
      env: process.env,
    });
    expect(timedOut.outcome).toBe('timeout');

    const oversized = await executeBoundedProcess({
      command: process.execPath,
      args: ['-e', "process.stdout.write('x'.repeat(4096))"],
      cwd: process.cwd(),
      timeoutMs: 1000,
      maxOutputBytes: 128,
      env: process.env,
    });
    expect(oversized.outcome).toBe('output-limit');
    expect(
      Buffer.byteLength(oversized.stdout) + Buffer.byteLength(oversized.stderr),
    ).toBeLessThanOrEqual(128);
  });

  it('uses fixed argument templates and rejects malicious Change IDs', async () => {
    const execute = vi.fn().mockResolvedValue({
      outcome: 'completed',
      exitCode: 0,
      stdout: JSON.stringify({ schemaName: 'spec-driven', applyRequires: [], artifacts: [] }),
      stderr: '',
    });
    const cli = new RestrictedOpenSpecCli({
      resolveInvocation: async () => ({ command: process.execPath, prefixArgs: ['openspec.js'] }),
      execute,
    });

    await cli.status('C:/Projects/demo', 'change-a');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: process.execPath,
        args: ['openspec.js', 'status', '--change', 'change-a', '--json'],
      }),
    );
    await expect(cli.status('C:/Projects/demo', '../secret')).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('reports a missing CLI without weakening structural consumers', async () => {
    const cli = new RestrictedOpenSpecCli({
      resolveInvocation: async () => {
        throw new Error('未找到兼容的 OpenSpec CLI');
      },
    });

    await expect(cli.status('C:/Projects/demo', 'change-a')).rejects.toThrow(
      '未找到兼容的 OpenSpec CLI',
    );
  });

  it('normalizes OpenSpec 1.8 doctor and context output without exposing root-external paths', () => {
    const doctor = normalizeOpenSpecDoctor(
      JSON.stringify({
        root: { path: 'C:/Projects/demo', source: 'nearest', healthy: true, status: [] },
        store: null,
        references: [
          { path: 'C:/Projects/demo/reference', status: 'available' },
          { path: 'C:/secret', status: 'unavailable' },
        ],
        status: Array.from({ length: 120 }, (_, index) => ({
          level: index === 0 ? 'warning' : 'info',
          message: `diagnostic ${index} C:/Projects/demo`,
        })),
        ignored: { secret: true },
      }),
      'C:/Projects/demo',
    );
    expect(doctor).toMatchObject({ healthy: true, rootSource: 'nearest' });
    expect(doctor.relations[0]).toMatchObject({
      kind: 'reference',
      relativePath: 'reference',
    });
    expect(doctor.relations[1]).not.toHaveProperty('relativePath');
    expect(doctor.diagnostics).toHaveLength(100);
    expect(doctor.diagnostics[0]?.message).not.toContain('C:/Projects/demo');

    const context = normalizeOpenSpecContext(
      JSON.stringify({
        root: { path: 'C:/Projects/demo', source: 'nearest', role: 'openspec_root' },
        members: [
          { path: 'C:/Projects/demo/member', role: 'reference', status: 'linked' },
          { path: 'C:/outside', role: 'store', status: 'linked' },
        ],
        status: [],
      }),
      'C:/Projects/demo',
    );
    expect(context).toMatchObject({ rootRole: 'openspec_root', rootSource: 'nearest' });
    expect(context.members[0]).toMatchObject({ relativePath: 'member' });
    expect(context.members[1]).not.toHaveProperty('relativePath');
  });

  it('normalizes instructions dependencies, progress and only safe project-relative context files', () => {
    const result = normalizeOpenSpecInstructions(
      JSON.stringify({
        changeName: 'change-a',
        artifactId: 'deploy',
        schemaName: 'custom',
        contextFiles: {
          proposal: ['C:/Projects/demo/openspec/changes/change-a/proposal.md'],
          secret: ['C:/outside/secret.md'],
        },
        progress: { total: 64, complete: 57, remaining: 7 },
        dependencies: [
          { id: 'review', done: true, path: 'review.md' },
          { id: '../secret', done: false },
        ],
        state: 'ready',
        instruction: 'Continue in C:/Projects/demo without exposing paths.',
        template: 'must not cross the boundary',
      }),
      { projectRoot: 'C:/Projects/demo', changeId: 'change-a', target: 'deploy' },
    );

    expect(result).toMatchObject({
      changeId: 'change-a',
      target: 'deploy',
      schemaName: 'custom',
      progress: { total: 64, complete: 57, remaining: 7 },
      dependencies: [{ id: 'review', done: true }],
    });
    expect(result.contextFiles).toEqual([
      {
        artifactId: 'proposal',
        paths: ['openspec/changes/change-a/proposal.md'],
      },
    ]);
    expect(result.instruction).not.toContain('C:/Projects/demo');
    expect(result).not.toHaveProperty('template');
  });

  it('uses fixed read-only argument templates for doctor, context and custom artifact instructions', async () => {
    const execute = vi.fn(async (input: { args: string[] }) => {
      const command = input.args[1];
      const stdout =
        command === 'doctor'
          ? JSON.stringify({
              root: { healthy: true, source: 'nearest' },
              references: [],
              status: [],
            })
          : command === 'context'
            ? JSON.stringify({
                root: { role: 'openspec_root', source: 'nearest' },
                members: [],
                status: [],
              })
            : JSON.stringify({
                changeName: 'change-a',
                artifactId: 'deploy',
                schemaName: 'custom',
                dependencies: [],
              });
      return { outcome: 'completed' as const, exitCode: 0, stdout, stderr: '' };
    });
    const cli = new RestrictedOpenSpecCli({
      resolveInvocation: async () => ({ command: process.execPath, prefixArgs: ['openspec.js'] }),
      execute,
    });

    await cli.doctor('C:/Projects/demo');
    await cli.context('C:/Projects/demo');
    await cli.instructions('C:/Projects/demo', 'change-a', 'deploy');
    expect(execute.mock.calls.map(([input]) => input.args)).toEqual([
      ['openspec.js', 'doctor', '--json'],
      ['openspec.js', 'context', '--json'],
      ['openspec.js', 'instructions', 'deploy', '--change', 'change-a', '--json'],
    ]);
    for (const [input] of execute.mock.calls) {
      expect(input.args).not.toContain('--code-workspace');
      expect(input.args).not.toContain('--force');
    }
    await expect(cli.instructions('C:/Projects/demo', 'change-a', '../secret')).rejects.toThrow();
  });

  it('rejects timeout and incompatible JSON independently for read-only summaries', async () => {
    const timeout = new RestrictedOpenSpecCli({
      resolveInvocation: async () => ({ command: process.execPath, prefixArgs: [] }),
      execute: vi.fn().mockResolvedValue({
        outcome: 'timeout',
        exitCode: null,
        stdout: '',
        stderr: '',
      }),
    });
    await expect(timeout.doctor('C:/Projects/demo')).rejects.toThrow('超时');

    const incompatible = new RestrictedOpenSpecCli({
      resolveInvocation: async () => ({ command: process.execPath, prefixArgs: [] }),
      execute: vi.fn().mockResolvedValue({
        outcome: 'completed',
        exitCode: 0,
        stdout: 'not json',
        stderr: '',
      }),
    });
    await expect(
      incompatible.instructions('C:/Projects/demo', 'change-a', 'apply'),
    ).rejects.toThrow('不兼容');
  });
});
