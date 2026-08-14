import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactProjection, ChangeProjection } from '@shared/contracts';
import type { ProjectScanResult } from '../domain/scanner';
import { createLifecycleFingerprint } from './fingerprint';
import { ValidationCache, ValidationCoordinator } from './validation';

function artifact(
  relativePath: string,
  type: ArtifactProjection['type'],
  hash: string,
  changeId?: string,
  archived = false,
): ArtifactProjection {
  return {
    type,
    relativePath,
    sourcePath: `openspec/${relativePath}`,
    title: relativePath,
    headings: [],
    tasks: [],
    taskTotals: { completed: 0, total: 0 },
    contentHash: hash.repeat(64).slice(0, 64),
    parseHealth: 'ok',
    ...(changeId ? { changeId } : {}),
    archived,
  };
}

function fixture(archived = false): { scan: ProjectScanResult; change: ChangeProjection } {
  const prefix = archived ? 'changes/archive/change-a' : 'changes/change-a';
  const changeArtifacts = [
    artifact(`${prefix}/proposal.md`, 'proposal', 'a', 'change-a', archived),
    artifact(`${prefix}/specs/demo/spec.md`, 'spec', 'b', 'change-a', archived),
  ];
  const change: ChangeProjection = {
    id: 'change-a',
    name: 'change-a',
    archived,
    stage: archived ? 'archived' : 'implementing',
    readiness: 'incomplete',
    artifacts: changeArtifacts,
    missingArtifacts: ['design', 'tasks'],
    taskTotals: { completed: 0, total: 0 },
    parseHealth: 'ok',
    validation: { source: 'structural', status: 'not-run' },
  };
  return {
    change,
    scan: {
      rootPath: 'C:/Projects/demo',
      openspecPath: 'C:/Projects/demo/openspec',
      available: true,
      scannedAt: '2026-08-10T08:00:00.000Z',
      config: artifact('config.yaml', 'config', 'c'),
      specs: [artifact('specs/demo/spec.md', 'spec', 'd')],
      changes: [change],
      files: [...changeArtifacts, artifact('specs/demo/spec.md', 'spec', 'd')],
      issues: [],
    },
  };
}

describe('validation fingerprint and cache', () => {
  it('is deterministic and changes for main specs, config, and archive identity', () => {
    const current = fixture();
    const first = createLifecycleFingerprint(current.scan, current.change);
    expect(createLifecycleFingerprint(current.scan, current.change)).toBe(first);

    current.scan.specs[0]!.contentHash = 'e'.repeat(64);
    expect(createLifecycleFingerprint(current.scan, current.change)).not.toBe(first);

    const configChanged = fixture();
    configChanged.scan.config!.contentHash = 'f'.repeat(64);
    expect(createLifecycleFingerprint(configChanged.scan, configChanged.change)).not.toBe(first);

    const archived = fixture(true);
    expect(createLifecycleFingerprint(archived.scan, archived.change)).not.toBe(first);
  });

  it('backs up corrupt cache files and recovers as not-run', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'openspec-validation-'));
    const cache = new ValidationCache(directory);
    const path = cache.pathFor('project-1', 'change-a', false);
    await fs.mkdir(join(path, '..'), { recursive: true });
    await fs.writeFile(path, '{broken', 'utf8');

    await expect(cache.read('project-1', 'change-a', false)).resolves.toMatchObject({
      status: 'not-run',
    });
    const files = await fs.readdir(join(directory, 'lifecycle-validation', 'project-1'));
    expect(files.some((file) => file.includes('.corrupt-'))).toBe(true);
  });

  it('keeps diagnostics but marks results stale when inputs change during validation', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'openspec-validation-'));
    const cache = new ValidationCache(directory);
    const start = fixture();
    let current = start;
    const validate = vi.fn(async () => {
      current = fixture();
      current.scan.config!.contentHash = 'f'.repeat(64);
      return {
        status: 'passed' as const,
        source: 'openspec-cli' as const,
        checkedAt: '2026-08-10T08:00:01.000Z',
        fingerprint: createLifecycleFingerprint(start.scan, start.change),
        diagnostics: [],
      };
    });
    const coordinator = new ValidationCoordinator({ cache, validate });

    const result = await coordinator.run({
      projectId: 'project-1',
      projectRoot: start.scan.rootPath,
      change: start.change,
      scan: start.scan,
      getCurrent: () => current,
    });

    expect(result.status).toBe('stale');
    expect(result.staleReason).toContain('验证期间');
    await expect(cache.read('project-1', 'change-a', false)).resolves.toMatchObject({
      status: 'stale',
    });
  });

  it('marks a cached pass stale after a relevant file changes while preserving diagnostics', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'openspec-validation-'));
    const cache = new ValidationCache(directory);
    const current = fixture();
    const fingerprint = createLifecycleFingerprint(current.scan, current.change);
    await cache.write('project-1', 'change-a', false, {
      status: 'passed',
      source: 'openspec-cli',
      checkedAt: '2026-08-10T08:00:00.000Z',
      fingerprint,
      diagnostics: [{ severity: 'info', message: 'previous diagnostic' }],
    });
    current.scan.config!.contentHash = 'f'.repeat(64);
    const coordinator = new ValidationCoordinator({
      cache,
      validate: vi.fn(),
    });

    const result = await coordinator.current('project-1', current.scan, current.change);

    expect(result.status).toBe('stale');
    expect(result.diagnostics).toEqual([{ severity: 'info', message: 'previous diagnostic' }]);
  });

  it('rejects duplicate validation requests for the same project and Change', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'openspec-validation-'));
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const current = fixture();
    const coordinator = new ValidationCoordinator({
      cache: new ValidationCache(directory),
      validate: async () => {
        await waiting;
        return {
          status: 'passed',
          source: 'openspec-cli',
          checkedAt: '2026-08-10T08:00:01.000Z',
          fingerprint: createLifecycleFingerprint(current.scan, current.change),
          diagnostics: [],
        };
      },
    });
    const request = {
      projectId: 'project-1',
      projectRoot: current.scan.rootPath,
      change: current.change,
      scan: current.scan,
      getCurrent: () => current,
    };

    const first = coordinator.run(request);
    await expect(coordinator.run(request)).rejects.toThrow('验证已在运行中');
    finish();
    await first;
  });

  it('keeps passed, failed, and stale diagnostics tied to the lifecycle validation cache', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'openspec-validation-'));
    const cache = new ValidationCache(directory);
    const current = fixture();
    const fingerprint = createLifecycleFingerprint(current.scan, current.change);
    await cache.write('project-1', 'change-a', false, {
      status: 'failed',
      source: 'openspec-cli',
      checkedAt: '2026-08-10T08:00:00.000Z',
      fingerprint,
      diagnostics: [
        { severity: 'error', message: 'missing artifact', relativePath: 'openspec/tasks.md' },
      ],
    });
    const coordinator = new ValidationCoordinator({
      cache,
      validate: vi.fn(async () => ({
        status: 'passed' as const,
        source: 'openspec-cli' as const,
        checkedAt: '2026-08-10T08:00:01.000Z',
        fingerprint,
        diagnostics: [],
      })),
    });

    await expect(coordinator.current('project-1', current.scan, current.change)).resolves.toEqual(
      expect.objectContaining({
        status: 'failed',
        diagnostics: [
          expect.objectContaining({ severity: 'error', message: 'missing artifact' }),
        ],
      }),
    );

    current.scan.config!.contentHash = 'f'.repeat(64);
    const stale = await coordinator.current('project-1', current.scan, current.change);
    expect(stale.status).toBe('stale');
    expect(stale.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', message: 'missing artifact' }),
    ]);
    await expect(coordinator.run({
      projectId: 'project-1',
      projectRoot: current.scan.rootPath,
      change: current.change,
      scan: current.scan,
      getCurrent: () => current,
    })).resolves.toMatchObject({ status: 'passed' });
  });
});
