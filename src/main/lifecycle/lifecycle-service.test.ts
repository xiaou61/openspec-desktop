import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactGraph, ArtifactProjection, ChangeProjection } from '@shared/contracts';
import type { ProjectScanResult } from '../domain/scanner';
import { LifecycleService } from './lifecycle-service';

function artifact(
  type: ArtifactProjection['type'],
  relativePath: string,
  contentHash: string,
  rawContent = '# Content',
): ArtifactProjection {
  return {
    type,
    relativePath,
    sourcePath: `openspec/${relativePath}`,
    title: relativePath,
    headings: [],
    tasks: type === 'tasks' ? [{ id: 'task-1', text: 'Done', checked: true, line: 1 }] : [],
    taskTotals: type === 'tasks' ? { completed: 1, total: 1 } : { completed: 0, total: 0 },
    rawContent,
    contentHash: contentHash.repeat(64).slice(0, 64),
    parseHealth: 'ok',
    changeId: 'change-a',
    archived: false,
  };
}

function withTaskTotals(
  current: ReturnType<typeof fixture>,
  completed: number,
  total: number,
  parseHealth: ArtifactProjection['parseHealth'] = 'ok',
): ReturnType<typeof fixture> {
  const taskArtifact = current.change.artifacts.find((entry) => entry.type === 'tasks')!;
  Object.assign(taskArtifact, {
    taskTotals: { completed, total },
    parseHealth,
    ...(parseHealth === 'ok' ? {} : { error: '任务文件解析失败' }),
  });
  current.change.taskTotals = { completed, total };
  return current;
}

function fixture(): { scan: ProjectScanResult; change: ChangeProjection } {
  const artifacts = [
    artifact('proposal', 'changes/change-a/proposal.md', 'a'),
    artifact('design', 'changes/change-a/design.md', 'b'),
    artifact('tasks', 'changes/change-a/tasks.md', 'c', '- [x] Done'),
    artifact('metadata', 'changes/change-a/.openspec.yaml', 'd', 'skip_specs: true'),
  ];
  const change: ChangeProjection = {
    id: 'change-a',
    name: 'change-a',
    archived: false,
    stage: 'completed',
    readiness: 'incomplete',
    artifacts,
    missingArtifacts: ['spec'],
    taskTotals: { completed: 1, total: 1 },
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
      specs: [],
      changes: [change],
      files: artifacts,
      issues: [],
    },
  };
}

const graph: ArtifactGraph = {
  schemaName: 'spec-driven',
  source: 'openspec-cli',
  authoritative: true,
  applyRequires: ['proposal', 'design', 'tasks'],
  artifacts: [
    { id: 'proposal', status: 'done', requires: [] },
    { id: 'design', status: 'done', requires: ['proposal'] },
    { id: 'tasks', status: 'done', requires: ['design'] },
  ],
};

describe('LifecycleService', () => {
  it('keeps archive readiness to artifacts, tasks and strict validation without assurance', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'openspec-lifecycle-'));
    const service = new LifecycleService({
      userDataPath: directory,
      cli: { status: vi.fn(async () => graph), validate: vi.fn() },
      now: () => new Date('2026-08-10T08:00:00.000Z'),
    });
    const current = fixture();
    const result = await service.getAssessment({
      projectId: 'project-1',
      projectRoot: current.scan.rootPath,
      projectAvailable: true,
      scan: current.scan,
      change: current.change,
    });

    expect(result.archiveReadiness.gates.map((gate) => gate.id)).toEqual([
      'artifacts',
      'tasks',
      'validation',
    ]);
    expect(result.nodes.map((node) => node.id)).toEqual([
      'proposal',
      'specs',
      'design',
      'tasks',
      'validation',
      'archive',
    ]);
    expect(result.nodes.find((node) => node.id === 'validation')).toBeDefined();
    expect(result.nextAction.kind).toBe('run-validation');
  });

  it('shares status work and invalidates cached graph and sync facts', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'openspec-lifecycle-'));
    const status = vi.fn(async () => graph);
    const service = new LifecycleService({
      userDataPath: directory,
      cli: { status, validate: vi.fn() },
      now: () => new Date('2026-08-10T08:00:00.000Z'),
    });
    const current = fixture();
    const input = {
      projectId: 'project-1',
      projectRoot: current.scan.rootPath,
      projectAvailable: true,
      scan: current.scan,
      change: current.change,
    };

    const [first, second] = await Promise.all([
      service.getAssessment(input),
      service.getAssessment(input),
    ]);
    expect(status).toHaveBeenCalledOnce();
    expect(first).toEqual(second);
    expect(first.taskGate.status).toBe('complete');
    expect(first.sync.status).toBe('not-applicable');

    service.invalidate('project-1', ['change-a']);
    await service.getAssessment(input);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it.each([
    [57, 64, 'ok', 'incomplete'],
    [57, 57, 'ok', 'complete'],
    [0, 0, 'ok', 'empty'],
    [0, 0, 'error', 'unknown'],
  ] as const)(
    'normalizes %i/%i task counts with %s parsing as %s',
    async (completed, total, parseHealth, expectedStatus) => {
      const directory = await fs.mkdtemp(join(tmpdir(), 'openspec-lifecycle-'));
      const service = new LifecycleService({
        userDataPath: directory,
        cli: { status: vi.fn(async () => graph), validate: vi.fn() },
      });
      const current = withTaskTotals(fixture(), completed, total, parseHealth);
      const result = await service.getAssessment({
        projectId: 'project-1',
        projectRoot: current.scan.rootPath,
        projectAvailable: true,
        scan: current.scan,
        change: current.change,
      });

      expect(result.taskGate.status).toBe(expectedStatus);
    },
  );

  it('treats tasks as not applicable when a custom schema excludes it from apply dependencies', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'openspec-lifecycle-'));
    const customGraph: ArtifactGraph = {
      schemaName: 'custom',
      source: 'openspec-cli',
      authoritative: true,
      applyRequires: ['brief', 'implementation'],
      artifacts: [
        { id: 'brief', status: 'done', requires: [] },
        { id: 'implementation', status: 'done', requires: ['brief'] },
      ],
    };
    const service = new LifecycleService({
      userDataPath: directory,
      cli: { status: vi.fn(async () => customGraph), validate: vi.fn() },
    });
    const current = withTaskTotals(fixture(), 0, 1, 'error');
    const result = await service.getAssessment({
      projectId: 'project-1',
      projectRoot: current.scan.rootPath,
      projectAvailable: true,
      scan: current.scan,
      change: current.change,
    });

    expect(result.taskGate).toMatchObject({ applicable: false, status: 'not-applicable' });
  });
});
